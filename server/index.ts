import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import express, { Application, Request, Response } from 'express';
import { SEED_TEAMS, SEED_MATCHES } from './seed-data';
import { syncResults, easternDate } from './results-sync';

// The current US Eastern calendar date — the whole pool keys date boundaries
// (matchday, daily standings snapshots) off Eastern time rather than UTC.
const EASTERN_TODAY_SQL = "(NOW() AT TIME ZONE 'America/New_York')::date";

// The latest knockout round whose games have started (by US-Eastern date), used
// to split bracket points into "banked before this round" vs "gained this round".
// Fixed FIFA 2026 round start dates; 0 before the Round of 32 begins.
function currentKnockoutRound(easternToday: string): number {
  if (easternToday >= '2026-07-19') return 5; // Final
  if (easternToday >= '2026-07-14') return 4; // Semifinals
  if (easternToday >= '2026-07-09') return 3; // Quarterfinals
  if (easternToday >= '2026-07-04') return 2; // Round of 16
  if (easternToday >= '2026-06-28') return 1; // Round of 32
  return 0;
}
const currentRoundNow = () => currentKnockoutRound(easternDate(new Date().toISOString()));

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

// Stage codes: 0=group exit, 1=R32, 2=R16, 3=QF, 4=SF, 5=Final, 6=Champion.
// teams.actual_stage is NULL until the admin records the team's fate (Postgres
// LEAST ignores NULLs, hence the COALESCE — an undecided team scores 0).
// Points are cumulative per stage reached (R32 1, R16 2, QF 3, SF 5, Final 8,
// Champion 12), so the running total per stage is:
//   cum(1)=1, cum(2)=3, cum(3)=6, cum(4)=11, cum(5)=19, cum(6)=31
// A team scores cum(LEAST(predicted, actual)) for each participant.
const cumulativePointsSql = (stageExpr: string) => `
  CASE ${stageExpr}
    WHEN 1 THEN 1 WHEN 2 THEN 3 WHEN 3 THEN 6
    WHEN 4 THEN 11 WHEN 5 THEN 19 WHEN 6 THEN 31
    ELSE 0
  END`;

const BRACKET_EARNED_SQL = cumulativePointsSql('LEAST(bp.predicted_stage, COALESCE(t.actual_stage, 0))');

// Ceiling: an eliminated team's points are final; the champion can't advance
// further; everyone else can still reach the predicted stage.
const BRACKET_MAX_SQL = `
  CASE WHEN t.eliminated OR t.actual_stage = 6
    THEN ${BRACKET_EARNED_SQL}
    ELSE ${cumulativePointsSql('bp.predicted_stage')}
  END`;

// Per-participant group/bracket/total/max points. Shared by the standings
// endpoint and the daily snapshot upsert. Ends with a `totals` CTE (starts
// with WITH, so append more CTEs with a comma or follow with SELECT/INSERT).
const STANDINGS_TOTALS_CTE = `
  WITH group_pts AS (
    SELECT mp.email,
           SUM(CASE WHEN mp.pick = m.actual_result THEN CASE WHEN m.actual_result = 'D' THEN 2 ELSE 1 END ELSE 0 END) AS pts,
           SUM(CASE WHEN m.actual_result IS NULL THEN CASE WHEN mp.pick = 'D' THEN 2 ELSE 1 END
                    WHEN mp.pick = m.actual_result THEN CASE WHEN m.actual_result = 'D' THEN 2 ELSE 1 END
                    ELSE 0 END) AS max_pts
    FROM pool.match_predictions mp JOIN pool.matches m ON m.id = mp.match_id
    GROUP BY mp.email
  ),
  bracket_pts AS (
    SELECT bp.email,
           SUM(${BRACKET_EARNED_SQL}) AS pts,
           -- points for reaching up to the current round ($1): the "previous"
           -- (banked) portion. The rest is what this round's results just added.
           SUM(${cumulativePointsSql('LEAST(bp.predicted_stage, COALESCE(t.actual_stage, 0), $1)')}) AS prev_pts,
           SUM(${BRACKET_MAX_SQL}) AS max_pts
    FROM pool.bracket_predictions bp JOIN pool.teams t ON t.id = bp.team_id
    GROUP BY bp.email
  ),
  -- Per resolved match: how many players predicted it, and how many got it
  -- right. (n_pred - n_correct) is the "boldness" of a correct call there —
  -- the number of opponents you beat on that match.
  match_consensus AS (
    SELECT mp.match_id,
           COUNT(*) AS n_pred,
           SUM(CASE WHEN mp.pick = m.actual_result THEN 1 ELSE 0 END) AS n_correct
    FROM pool.match_predictions mp JOIN pool.matches m ON m.id = mp.match_id
    WHERE m.actual_result IS NOT NULL
    GROUP BY mp.match_id
  ),
  -- Contrarian-correctness tiebreaker: sum of boldness over a player's correct
  -- picks. Rewards being right when the pool was wrong; chalk everyone nailed
  -- is worth ~0.
  contrarian AS (
    SELECT mp.email, SUM(mc.n_pred - mc.n_correct)::int AS score
    FROM pool.match_predictions mp
    JOIN pool.matches m ON m.id = mp.match_id
    JOIN match_consensus mc ON mc.match_id = mp.match_id
    WHERE m.actual_result IS NOT NULL AND mp.pick = m.actual_result
    GROUP BY mp.email
  ),
  totals AS (
    SELECT p.email, p.display_name,
           COALESCE(g.pts, 0)::int AS group_points,
           COALESCE(b.pts, 0)::int AS bracket_points,
           COALESCE(b.prev_pts, 0)::int AS bracket_prev,
           (COALESCE(b.pts, 0) - COALESCE(b.prev_pts, 0))::int AS bracket_current,
           (COALESCE(g.pts, 0) + COALESCE(b.pts, 0))::int AS total_points,
           (COALESCE(g.max_pts, 0) + COALESCE(b.max_pts, 0))::int AS max_points,
           COALESCE(c.score, 0)::int AS contrarian
    FROM pool.participants p
    LEFT JOIN group_pts g ON g.email = p.email
    LEFT JOIN bracket_pts b ON b.email = p.email
    LEFT JOIN contrarian c ON c.email = p.email
  )`;

const SETUP_SQL = `
  CREATE SCHEMA IF NOT EXISTS pool;

  CREATE TABLE IF NOT EXISTS pool.teams (
    id INT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    group_letter CHAR(1) NOT NULL,
    -- NULL = fate not yet decided; 0 = eliminated in group stage
    actual_stage INT CHECK (actual_stage BETWEEN 0 AND 6),
    -- TRUE once the team is out of the tournament (stage is then final)
    eliminated BOOLEAN NOT NULL DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS pool.matches (
    id INT PRIMARY KEY,
    group_letter CHAR(1) NOT NULL,
    home_team_id INT NOT NULL REFERENCES pool.teams(id),
    away_team_id INT NOT NULL REFERENCES pool.teams(id),
    match_date DATE NOT NULL,
    actual_result CHAR(1) CHECK (actual_result IN ('H','A','D'))
  );

  -- Display-only mirror of ESPN knockout/third-place fixtures (never picked;
  -- knockouts are scored via bracket_predictions). Keyed by ESPN's event id so
  -- placeholder slots resolve to real teams as the bracket fills in.
  CREATE TABLE IF NOT EXISTS pool.knockout_matches (
    espn_id    TEXT PRIMARY KEY,
    round      TEXT NOT NULL,          -- '1'..'5' (R32..Final) or 'third'
    match_date DATE NOT NULL,          -- US-Eastern calendar date of kickoff
    kickoff_at TIMESTAMPTZ,
    home_name  TEXT NOT NULL,          -- ESPN name: real team or placeholder slot
    away_name  TEXT NOT NULL,
    home_id    INT REFERENCES pool.teams(id),  -- NULL while placeholder
    away_id    INT REFERENCES pool.teams(id),
    home_score INT,
    away_score INT,
    home_pens  INT,                    -- penalty-shootout score (NULL if no shootout)
    away_pens  INT,
    status     TEXT                    -- 'pre' | 'in' | 'post'
  );

  CREATE TABLE IF NOT EXISTS pool.participants (
    email TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS pool.match_predictions (
    email TEXT NOT NULL REFERENCES pool.participants(email) ON DELETE CASCADE,
    match_id INT NOT NULL REFERENCES pool.matches(id),
    pick CHAR(1) NOT NULL CHECK (pick IN ('H','A','D')),
    PRIMARY KEY (email, match_id)
  );

  CREATE TABLE IF NOT EXISTS pool.bracket_predictions (
    email TEXT NOT NULL REFERENCES pool.participants(email) ON DELETE CASCADE,
    team_id INT NOT NULL REFERENCES pool.teams(id),
    predicted_stage INT NOT NULL CHECK (predicted_stage BETWEEN 0 AND 6),
    PRIMARY KEY (email, team_id)
  );

  CREATE TABLE IF NOT EXISTS pool.app_state (
    id INT PRIMARY KEY CHECK (id = 1),
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at TIMESTAMPTZ
  );

  -- Written once per boot, as the last step of schema setup. A stale row means
  -- this module could not reach its schema — which is invisible otherwise,
  -- because the app still serves HTTP and starts "successfully". Each module
  -- writes into its OWN schema on purpose: grants are per-schema, so one
  -- combined heartbeat could go green while the other schema was unreachable.
  CREATE TABLE IF NOT EXISTS pool.app_heartbeat (
    id INT PRIMARY KEY CHECK (id = 1),
    beat_at TIMESTAMPTZ NOT NULL,
    service_principal TEXT
  );
`;

const PutPredictionsBody = z.object({
  displayName: z.string().trim().min(1).max(60),
  matchPicks: z.record(z.string(), z.enum(['H', 'A', 'D'])),
  bracketPicks: z.record(z.string(), z.number().int().min(0).max(6)),
});

const PutMatchResultBody = z.object({
  result: z.enum(['H', 'A', 'D']).nullable(),
});

const PutTeamStageBody = z.object({
  stage: z.number().int().min(0).max(6).nullable(),
  eliminated: z.boolean(),
});

function getUserEmail(req: Request): string | null {
  const header = req.header('x-forwarded-email');
  if (header) return header.toLowerCase();
  // Local development only — the Apps proxy always sets the header in prod.
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_USER_EMAIL) {
    return process.env.DEV_USER_EMAIL.toLowerCase();
  }
  return null;
}

function isAdmin(email: string): boolean {
  return email === (process.env.ADMIN_EMAIL ?? '').toLowerCase();
}

function handleError(res: Response, context: string, err: unknown) {
  console.error(`${context}:`, err);
  res.status(500).json({ error: context });
}

// The pool SPA is served by us, not by AppKit's StaticServer, so it never gets
// the injected runtime config. appkit-ui degrades gracefully without it, but we
// inject an equivalent empty config for parity so nothing warns.
const CONFIG_SCRIPT =
  `<script id="__appkit__" type="application/json">` +
  `{"appName":"worldcup","queries":{},"endpoints":{},"plugins":{}}</script>` +
  `<script>window.__appkit__=JSON.parse(document.getElementById('__appkit__').textContent);</script>`;

export interface PoolOptions {
  // Absolute path to the built client. The shell app owns the directory layout,
  // so it passes this in rather than us guessing from cwd.
  distPath: string;
}

function servePoolIndex(res: Response, distPath: string) {
  const indexPath = path.join(distPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    // Fail loudly rather than falling through to the shell's catch-all, which
    // would serve the landing page for /worldcup routes.
    res
      .status(503)
      .type('text/plain')
      .send(`World cup client build is missing (${distPath}). Run: npm run build:worldcup`);
    return;
  }
  const html = fs.readFileSync(indexPath, 'utf-8').replace('<body>', `<body>${CONFIG_SCRIPT}`);
  res.type('html').send(html);
}

export async function setupPoolRoutes(appkit: AppKitWithLakebase, { distPath }: PoolOptions) {
  try {
    await appkit.lakebase.query(SETUP_SQL);
    await appkit.lakebase.query(
      'INSERT INTO pool.app_state (id, locked) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING'
    );

    // Migration: actual_stage was originally NOT NULL DEFAULT 0, which made
    // "not yet decided" indistinguishable from "out in groups". One-time
    // conversion to nullable; existing zeros were pre-tournament defaults.
    const stageCol = await appkit.lakebase.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'pool' AND table_name = 'teams' AND column_name = 'actual_stage'`
    );
    if (stageCol.rows.length > 0 && stageCol.rows[0].is_nullable === 'NO') {
      await appkit.lakebase.query('ALTER TABLE pool.teams ALTER COLUMN actual_stage DROP NOT NULL');
      await appkit.lakebase.query('ALTER TABLE pool.teams ALTER COLUMN actual_stage DROP DEFAULT');
      await appkit.lakebase.query('UPDATE pool.teams SET actual_stage = NULL');
      console.log('[pool] Migrated teams.actual_stage to nullable (NULL = not yet decided)');
    }

    // Migration: eliminated flag distinguishes a team that is out from one
    // still alive at the same stage (needed for max-possible-points).
    await appkit.lakebase.query(
      'ALTER TABLE pool.teams ADD COLUMN IF NOT EXISTS eliminated BOOLEAN NOT NULL DEFAULT FALSE'
    );

    // Migration: manual-override flags so the ESPN auto-sync never clobbers a
    // result an admin set by hand; plus a row tracking the last sync.
    await appkit.lakebase.query(
      'ALTER TABLE pool.matches ADD COLUMN IF NOT EXISTS result_manual BOOLEAN NOT NULL DEFAULT FALSE'
    );
    await appkit.lakebase.query(
      'ALTER TABLE pool.teams ADD COLUMN IF NOT EXISTS stage_manual BOOLEAN NOT NULL DEFAULT FALSE'
    );
    await appkit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS pool.sync_state (
        id INT PRIMARY KEY CHECK (id = 1),
        last_synced_at TIMESTAMPTZ,
        status TEXT
      )
    `);

    // Migration: live score/status per match (display only, mirrors ESPN) and
    // daily standings snapshots for rank-movement arrows.
    await appkit.lakebase.query('ALTER TABLE pool.matches ADD COLUMN IF NOT EXISTS home_score INT');
    await appkit.lakebase.query('ALTER TABLE pool.matches ADD COLUMN IF NOT EXISTS away_score INT');
    await appkit.lakebase.query('ALTER TABLE pool.matches ADD COLUMN IF NOT EXISTS status TEXT');
    await appkit.lakebase.query('ALTER TABLE pool.matches ADD COLUMN IF NOT EXISTS kickoff_at TIMESTAMPTZ');
    // Migration: penalty-shootout score for knockout fixtures (display only).
    await appkit.lakebase.query('ALTER TABLE pool.knockout_matches ADD COLUMN IF NOT EXISTS home_pens INT');
    await appkit.lakebase.query('ALTER TABLE pool.knockout_matches ADD COLUMN IF NOT EXISTS away_pens INT');
    await appkit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS pool.standings_snapshots (
        snapshot_date DATE NOT NULL,
        email TEXT NOT NULL,
        total_points INT NOT NULL,
        PRIMARY KEY (snapshot_date, email)
      )
    `);
    // Snapshot the tiebreaker fields too, so prev_rank ranks with the same
    // cascade (total → bracket → contrarian) the live standings use.
    await appkit.lakebase.query(
      'ALTER TABLE pool.standings_snapshots ADD COLUMN IF NOT EXISTS bracket_points INT NOT NULL DEFAULT 0'
    );
    await appkit.lakebase.query(
      'ALTER TABLE pool.standings_snapshots ADD COLUMN IF NOT EXISTS contrarian INT NOT NULL DEFAULT 0'
    );

    const { rows } = await appkit.lakebase.query('SELECT COUNT(*)::int AS n FROM pool.teams');
    if ((rows[0] as { n: number }).n === 0) {
      for (const t of SEED_TEAMS) {
        await appkit.lakebase.query('INSERT INTO pool.teams (id, name, group_letter) VALUES ($1, $2, $3)', [
          t.id,
          t.name,
          t.group,
        ]);
      }
      const teamId = new Map(SEED_TEAMS.map((t) => [t.name, t.id]));
      for (const m of SEED_MATCHES) {
        await appkit.lakebase.query(
          `INSERT INTO pool.matches (id, group_letter, home_team_id, away_team_id, match_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [m.id, m.group, teamId.get(m.home), teamId.get(m.away), m.date]
        );
      }
      console.log('[pool] Seeded 48 teams and 72 group-stage matches');
    }

    // Last step, so a fresh row proves the whole setup path reached Postgres.
    // npm run verify:deploy fails the deploy if this stays stale.
    await appkit.lakebase.query(
      `INSERT INTO pool.app_heartbeat (id, beat_at, service_principal) VALUES (1, NOW(), $1)
       ON CONFLICT (id) DO UPDATE SET beat_at = NOW(), service_principal = EXCLUDED.service_principal`,
      [process.env.DATABRICKS_CLIENT_ID ?? null]
    );
    console.log('[pool] heartbeat written');
  } catch (err) {
    console.warn('[pool] Database setup failed:', (err as Error).message);
    console.warn('[pool] Routes will be registered but may return errors');
  }

  // Pull results from ESPN. This used to run a full sweep at startup and a
  // rolling window every 5 minutes; the 2026 tournament ended on July 19, so
  // there is nothing left to pull and the automatic syncing was retired in
  // August 2026. Admin → Sync now is the only caller left. Errors are
  // swallowed (recorded in sync_state). While locked, each sync also refreshes
  // today's standings snapshot so the rank-movement arrows keep a day-over-day
  // baseline.
  const runSync = async (allDates: boolean) => {
    try {
      const s = await syncResults(appkit, { allDates });
      console.log(`[pool] results sync: ${JSON.stringify(s)}`);
      const { rows } = await appkit.lakebase.query('SELECT locked FROM pool.app_state WHERE id = 1');
      if (rows[0]?.locked === true) {
        await appkit.lakebase.query(
          `
          ${STANDINGS_TOTALS_CTE}
          INSERT INTO pool.standings_snapshots (snapshot_date, email, total_points, bracket_points, contrarian)
          SELECT ${EASTERN_TODAY_SQL}, email, total_points, bracket_points, contrarian FROM totals
          ON CONFLICT (snapshot_date, email) DO UPDATE SET
            total_points = EXCLUDED.total_points,
            bracket_points = EXCLUDED.bracket_points,
            contrarian = EXCLUDED.contrarian
        `,
          [currentRoundNow()]
        );
      }
      return s;
    } catch (e) {
      console.warn('[pool] results sync failed:', (e as Error).message);
      throw e;
    }
  };

  async function getLocked(): Promise<boolean> {
    const { rows } = await appkit.lakebase.query('SELECT locked FROM pool.app_state WHERE id = 1');
    return rows.length > 0 && rows[0].locked === true;
  }

  // Registered via server.extend, which AppKit runs BEFORE its static
  // catch-all — so everything under /worldcup takes precedence over the
  // shell's landing page without touching it.
  appkit.server.extend((app) => {
    // Resolve identity once per request; reject unauthenticated calls.
    app.use('/worldcup/api', (req, res, next) => {
      // Every /worldcup/api response is live, per-request data (fixtures, picks, standings).
      // Forbid browser/edge caching so two users never see different snapshots —
      // e.g. one seeing a team as still alive after it has been eliminated.
      res.set('Cache-Control', 'no-store');
      const email = getUserEmail(req);
      if (!email) {
        res.status(401).json({ error: 'No user identity (x-forwarded-email missing)' });
        return;
      }
      res.locals.email = email;
      next();
    });

    const adminOnly = (_req: Request, res: Response, next: () => void) => {
      if (!isAdmin(res.locals.email as string)) {
        res.status(403).json({ error: 'Admin only' });
        return;
      }
      next();
    };

    app.get('/worldcup/api/me', async (_req, res) => {
      try {
        const email = res.locals.email as string;
        const locked = await getLocked();
        const { rows } = await appkit.lakebase.query('SELECT display_name FROM pool.participants WHERE email = $1', [
          email,
        ]);
        res.json({
          email,
          isAdmin: isAdmin(email),
          locked,
          displayName: rows.length > 0 ? rows[0].display_name : null,
        });
      } catch (err) {
        handleError(res, 'Failed to load user info', err);
      }
    });

    app.get('/worldcup/api/fixtures', async (_req, res) => {
      try {
        const teams = await appkit.lakebase.query(
          'SELECT id, name, group_letter, actual_stage, eliminated FROM pool.teams ORDER BY group_letter, id'
        );
        const matches = await appkit.lakebase.query(
          `SELECT id, group_letter, home_team_id, away_team_id,
                  TO_CHAR(match_date, 'YYYY-MM-DD') AS match_date,
                  actual_result, home_score, away_score, status, kickoff_at
           FROM pool.matches ORDER BY id`
        );
        const knockout = await appkit.lakebase.query(
          `SELECT espn_id, round, TO_CHAR(match_date, 'YYYY-MM-DD') AS match_date,
                  kickoff_at, home_name, away_name, home_id, away_id,
                  home_score, away_score, home_pens, away_pens, status
           FROM pool.knockout_matches ORDER BY match_date, kickoff_at`
        );
        res.json({ teams: teams.rows, matches: matches.rows, knockout: knockout.rows });
      } catch (err) {
        handleError(res, 'Failed to load fixtures', err);
      }
    });

    // Who's in: names and completeness only — never the picks themselves,
    // so it is safe to expose before submissions are locked.
    app.get('/worldcup/api/participants/status', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(`
          SELECT p.email, p.display_name, p.updated_at,
                 (SELECT COUNT(*) FROM pool.match_predictions mp WHERE mp.email = p.email)::int AS match_count,
                 (SELECT COUNT(*) FROM pool.bracket_predictions bp WHERE bp.email = p.email)::int AS bracket_count
          FROM pool.participants p
          ORDER BY p.display_name
        `);
        res.json(rows);
      } catch (err) {
        handleError(res, 'Failed to load participant status', err);
      }
    });

    app.get('/worldcup/api/predictions/mine', async (_req, res) => {
      try {
        const email = res.locals.email as string;
        const matchPicks = await appkit.lakebase.query(
          'SELECT match_id, pick FROM pool.match_predictions WHERE email = $1',
          [email]
        );
        const bracketPicks = await appkit.lakebase.query(
          'SELECT team_id, predicted_stage FROM pool.bracket_predictions WHERE email = $1',
          [email]
        );
        res.json({ matchPicks: matchPicks.rows, bracketPicks: bracketPicks.rows });
      } catch (err) {
        handleError(res, 'Failed to load predictions', err);
      }
    });

    app.put('/worldcup/api/predictions/mine', async (req, res) => {
      try {
        if (await getLocked()) {
          res.status(403).json({ error: 'Submissions are locked' });
          return;
        }
        const parsed = PutPredictionsBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid predictions payload' });
          return;
        }
        const email = res.locals.email as string;
        const { displayName, matchPicks, bracketPicks } = parsed.data;

        await appkit.lakebase.query(
          `INSERT INTO pool.participants (email, display_name, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (email) DO UPDATE SET display_name = $2, updated_at = NOW()`,
          [email, displayName]
        );
        for (const [matchId, pick] of Object.entries(matchPicks)) {
          await appkit.lakebase.query(
            `INSERT INTO pool.match_predictions (email, match_id, pick) VALUES ($1, $2, $3)
             ON CONFLICT (email, match_id) DO UPDATE SET pick = $3`,
            [email, parseInt(matchId, 10), pick]
          );
        }
        for (const [teamId, stage] of Object.entries(bracketPicks)) {
          await appkit.lakebase.query(
            `INSERT INTO pool.bracket_predictions (email, team_id, predicted_stage) VALUES ($1, $2, $3)
             ON CONFLICT (email, team_id) DO UPDATE SET predicted_stage = $3`,
            [email, parseInt(teamId, 10), stage]
          );
        }
        res.json({ ok: true });
      } catch (err) {
        handleError(res, 'Failed to save predictions', err);
      }
    });

    app.get('/worldcup/api/predictions/all', async (_req, res) => {
      try {
        if (!(await getLocked())) {
          res.status(403).json({ error: 'Predictions are hidden until submissions are locked' });
          return;
        }
        const participants = await appkit.lakebase.query(
          'SELECT email, display_name FROM pool.participants ORDER BY display_name'
        );
        const matchPicks = await appkit.lakebase.query('SELECT email, match_id, pick FROM pool.match_predictions');
        const bracketPicks = await appkit.lakebase.query(
          'SELECT email, team_id, predicted_stage FROM pool.bracket_predictions'
        );
        res.json({
          participants: participants.rows,
          matchPicks: matchPicks.rows,
          bracketPicks: bracketPicks.rows,
        });
      } catch (err) {
        handleError(res, "Failed to load everyone's predictions", err);
      }
    });

    app.get('/worldcup/api/standings', async (_req, res) => {
      try {
        if (!(await getLocked())) {
          res.status(403).json({ error: 'Standings are hidden until submissions are locked' });
          return;
        }
        const { rows } = await appkit.lakebase.query(
          `
          ${STANDINGS_TOTALS_CTE},
          prev AS (
            SELECT email, RANK() OVER (
              ORDER BY total_points DESC, bracket_points DESC, contrarian DESC
            ) AS rk
            FROM pool.standings_snapshots
            WHERE snapshot_date = (
              SELECT MAX(snapshot_date) FROM pool.standings_snapshots WHERE snapshot_date < ${EASTERN_TODAY_SQL}
            )
          )
          SELECT s.email, s.display_name, s.group_points, s.bracket_points,
                 s.bracket_prev, s.bracket_current,
                 s.total_points, s.max_points, s.contrarian, prev.rk::int AS prev_rank
          FROM totals s
          LEFT JOIN prev ON prev.email = s.email
          ORDER BY s.total_points DESC, s.bracket_points DESC, s.contrarian DESC, s.display_name
        `,
          [currentRoundNow()]
        );
        res.json(rows);
      } catch (err) {
        handleError(res, 'Failed to compute standings', err);
      }
    });

    app.post('/worldcup/api/admin/lock', adminOnly, async (_req, res) => {
      try {
        await appkit.lakebase.query('UPDATE pool.app_state SET locked = TRUE, locked_at = NOW() WHERE id = 1');
        res.json({ ok: true, locked: true });
      } catch (err) {
        handleError(res, 'Failed to lock submissions', err);
      }
    });

    app.post('/worldcup/api/admin/unlock', adminOnly, async (_req, res) => {
      try {
        await appkit.lakebase.query('UPDATE pool.app_state SET locked = FALSE, locked_at = NULL WHERE id = 1');
        res.json({ ok: true, locked: false });
      } catch (err) {
        handleError(res, 'Failed to unlock submissions', err);
      }
    });

    app.put('/worldcup/api/admin/results/match/:id', adminOnly, async (req, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        const parsed = PutMatchResultBody.safeParse(req.body);
        if (isNaN(id) || !parsed.success) {
          res.status(400).json({ error: 'Invalid match result' });
          return;
        }
        const { rows } = await appkit.lakebase.query(
          'UPDATE pool.matches SET actual_result = $2, result_manual = TRUE WHERE id = $1 RETURNING id',
          [id, parsed.data.result]
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Match not found' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        handleError(res, 'Failed to save match result', err);
      }
    });

    app.put('/worldcup/api/admin/results/team/:id', adminOnly, async (req, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        const parsed = PutTeamStageBody.safeParse(req.body);
        if (isNaN(id) || !parsed.success) {
          res.status(400).json({ error: 'Invalid team stage' });
          return;
        }
        const { stage } = parsed.data;
        // Stage 0 (out in groups) is by definition eliminated; an undecided
        // team cannot be eliminated yet.
        const eliminated = stage === 0 ? true : stage === null ? false : parsed.data.eliminated;
        const { rows } = await appkit.lakebase.query(
          'UPDATE pool.teams SET actual_stage = $2, eliminated = $3, stage_manual = TRUE WHERE id = $1 RETURNING id',
          [id, stage, eliminated]
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Team not found' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        handleError(res, 'Failed to save team stage', err);
      }
    });

    // Full reset for dry runs: wipes predictions, participants, and results,
    // unlocks submissions. Seeded fixtures/teams are kept.
    app.post('/worldcup/api/admin/reset', adminOnly, async (_req, res) => {
      try {
        await appkit.lakebase.query('DELETE FROM pool.match_predictions');
        await appkit.lakebase.query('DELETE FROM pool.bracket_predictions');
        await appkit.lakebase.query('DELETE FROM pool.participants');
        await appkit.lakebase.query(
          'UPDATE pool.matches SET actual_result = NULL, result_manual = FALSE, home_score = NULL, away_score = NULL, status = NULL'
        );
        await appkit.lakebase.query(
          'UPDATE pool.teams SET actual_stage = NULL, eliminated = FALSE, stage_manual = FALSE'
        );
        await appkit.lakebase.query('DELETE FROM pool.standings_snapshots');
        await appkit.lakebase.query('UPDATE pool.app_state SET locked = FALSE, locked_at = NULL WHERE id = 1');
        res.json({ ok: true });
      } catch (err) {
        handleError(res, 'Failed to reset pool', err);
      }
    });

    // Auto-sync status (any signed-in user) and a manual "Sync now" (admin).
    app.get('/worldcup/api/sync-status', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query('SELECT last_synced_at, status FROM pool.sync_state WHERE id = 1');
        res.json(rows[0] ?? { last_synced_at: null, status: null });
      } catch (err) {
        handleError(res, 'Failed to load sync status', err);
      }
    });

    app.post('/worldcup/api/admin/sync', adminOnly, async (_req, res) => {
      try {
        // runSync rather than syncResults directly, so the manual button also
        // refreshes the standings snapshot the way the retired timer did.
        const summary = await runSync(true);
        res.json(summary);
      } catch (err) {
        handleError(res, 'Failed to sync results', err);
      }
    });

    // Static assets (built with base '/worldcup/') and the SPA fallback for
    // deep links like /worldcup/standings on hard refresh.
    app.use('/worldcup', express.static(distPath, { index: false }));
    app.get(['/worldcup', '/worldcup/*'], (_req, res) => servePoolIndex(res, distPath));
  });
}

import { z } from 'zod';
import { Application, Request, Response } from 'express';
import { SEED_TEAMS, SEED_MATCHES } from '../seed-data';
import { syncResults } from '../results-sync';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

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

export async function setupPoolRoutes(appkit: AppKitWithLakebase) {
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
  } catch (err) {
    console.warn('[pool] Database setup failed:', (err as Error).message);
    console.warn('[pool] Routes will be registered but may return errors');
  }

  // Auto-pull results from ESPN: a full sweep at startup, then a rolling
  // window every 5 minutes. Errors are swallowed (recorded in sync_state).
  const runSync = (allDates: boolean) =>
    syncResults(appkit, { allDates })
      .then((s) => console.log(`[pool] results sync: ${JSON.stringify(s)}`))
      .catch((e) => console.warn('[pool] results sync failed:', (e as Error).message));
  void runSync(true);
  setInterval(() => void runSync(false), SYNC_INTERVAL_MS);

  async function getLocked(): Promise<boolean> {
    const { rows } = await appkit.lakebase.query('SELECT locked FROM pool.app_state WHERE id = 1');
    return rows.length > 0 && rows[0].locked === true;
  }

  appkit.server.extend((app) => {
    // Resolve identity once per request; reject unauthenticated calls.
    app.use('/api', (req, res, next) => {
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

    app.get('/api/me', async (_req, res) => {
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

    app.get('/api/fixtures', async (_req, res) => {
      try {
        const teams = await appkit.lakebase.query(
          'SELECT id, name, group_letter, actual_stage, eliminated FROM pool.teams ORDER BY group_letter, id'
        );
        const matches = await appkit.lakebase.query(
          `SELECT id, group_letter, home_team_id, away_team_id,
                  TO_CHAR(match_date, 'YYYY-MM-DD') AS match_date, actual_result
           FROM pool.matches ORDER BY id`
        );
        res.json({ teams: teams.rows, matches: matches.rows });
      } catch (err) {
        handleError(res, 'Failed to load fixtures', err);
      }
    });

    // Who's in: names and completeness only — never the picks themselves,
    // so it is safe to expose before submissions are locked.
    app.get('/api/participants/status', async (_req, res) => {
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

    app.get('/api/predictions/mine', async (_req, res) => {
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

    app.put('/api/predictions/mine', async (req, res) => {
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

    app.get('/api/predictions/all', async (_req, res) => {
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

    app.get('/api/standings', async (_req, res) => {
      try {
        if (!(await getLocked())) {
          res.status(403).json({ error: 'Standings are hidden until submissions are locked' });
          return;
        }
        const { rows } = await appkit.lakebase.query(`
          WITH group_pts AS (
            SELECT mp.email,
                   SUM(CASE WHEN mp.pick = m.actual_result
                            THEN CASE WHEN m.actual_result = 'D' THEN 2 ELSE 1 END
                            ELSE 0 END) AS pts,
                   SUM(CASE WHEN m.actual_result IS NULL
                            THEN CASE WHEN mp.pick = 'D' THEN 2 ELSE 1 END
                            WHEN mp.pick = m.actual_result
                            THEN CASE WHEN m.actual_result = 'D' THEN 2 ELSE 1 END
                            ELSE 0 END) AS max_pts
            FROM pool.match_predictions mp
            JOIN pool.matches m ON m.id = mp.match_id
            GROUP BY mp.email
          ),
          bracket_pts AS (
            SELECT bp.email,
                   SUM(${BRACKET_EARNED_SQL}) AS pts,
                   SUM(${BRACKET_MAX_SQL}) AS max_pts
            FROM pool.bracket_predictions bp
            JOIN pool.teams t ON t.id = bp.team_id
            GROUP BY bp.email
          )
          SELECT p.email, p.display_name,
                 COALESCE(g.pts, 0)::int AS group_points,
                 COALESCE(b.pts, 0)::int AS bracket_points,
                 (COALESCE(g.pts, 0) + COALESCE(b.pts, 0))::int AS total_points,
                 (COALESCE(g.max_pts, 0) + COALESCE(b.max_pts, 0))::int AS max_points
          FROM pool.participants p
          LEFT JOIN group_pts g ON g.email = p.email
          LEFT JOIN bracket_pts b ON b.email = p.email
          ORDER BY total_points DESC, p.display_name
        `);
        res.json(rows);
      } catch (err) {
        handleError(res, 'Failed to compute standings', err);
      }
    });

    app.post('/api/admin/lock', adminOnly, async (_req, res) => {
      try {
        await appkit.lakebase.query('UPDATE pool.app_state SET locked = TRUE, locked_at = NOW() WHERE id = 1');
        res.json({ ok: true, locked: true });
      } catch (err) {
        handleError(res, 'Failed to lock submissions', err);
      }
    });

    app.post('/api/admin/unlock', adminOnly, async (_req, res) => {
      try {
        await appkit.lakebase.query('UPDATE pool.app_state SET locked = FALSE, locked_at = NULL WHERE id = 1');
        res.json({ ok: true, locked: false });
      } catch (err) {
        handleError(res, 'Failed to unlock submissions', err);
      }
    });

    app.put('/api/admin/results/match/:id', adminOnly, async (req, res) => {
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

    app.put('/api/admin/results/team/:id', adminOnly, async (req, res) => {
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
    app.post('/api/admin/reset', adminOnly, async (_req, res) => {
      try {
        await appkit.lakebase.query('DELETE FROM pool.match_predictions');
        await appkit.lakebase.query('DELETE FROM pool.bracket_predictions');
        await appkit.lakebase.query('DELETE FROM pool.participants');
        await appkit.lakebase.query('UPDATE pool.matches SET actual_result = NULL, result_manual = FALSE');
        await appkit.lakebase.query(
          'UPDATE pool.teams SET actual_stage = NULL, eliminated = FALSE, stage_manual = FALSE'
        );
        await appkit.lakebase.query('UPDATE pool.app_state SET locked = FALSE, locked_at = NULL WHERE id = 1');
        res.json({ ok: true });
      } catch (err) {
        handleError(res, 'Failed to reset pool', err);
      }
    });

    // Auto-sync status (any signed-in user) and a manual "Sync now" (admin).
    app.get('/api/sync-status', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query('SELECT last_synced_at, status FROM pool.sync_state WHERE id = 1');
        res.json(rows[0] ?? { last_synced_at: null, status: null });
      } catch (err) {
        handleError(res, 'Failed to load sync status', err);
      }
    });

    app.post('/api/admin/sync', adminOnly, async (_req, res) => {
      try {
        const summary = await syncResults(appkit, { allDates: true });
        res.json(summary);
      } catch (err) {
        handleError(res, 'Failed to sync results', err);
      }
    });
  });
}

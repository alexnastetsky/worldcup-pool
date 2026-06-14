// Auto-pull match results from ESPN's public scoreboard API and write them
// into the pool tables. Self-contained: depends only on the seed data and the
// Lakebase handle, so it can run inside the app server's poller.
//
// ESPN endpoint (no API key):
//   https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD
//
// Stage codes (match the rest of the pool): 0 = out in groups, 1 = reached
// R32, 2 = R16, 3 = QF, 4 = SF, 5 = Final, 6 = Champion. A knockout game in
// round r (R32=1 … Final=5) means both teams reached stage r, the winner
// reaches r+1, and the loser is eliminated at r.

import { SEED_TEAMS, SEED_MATCHES } from './seed-data';

export type Result = 'H' | 'A' | 'D';
export type Round = 'group' | 'third' | 1 | 2 | 3 | 4 | 5;

interface AppKitLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
}

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

// --- team name → id, with defensive aliases for naming variants ---------------

const idByName = new Map(SEED_TEAMS.map((t) => [t.name, t.id]));

const ALIASES: Record<string, string> = {
  Turkey: 'Türkiye',
  Turkiye: 'Türkiye',
  'Czech Republic': 'Czechia',
  USA: 'United States',
  'United States of America': 'United States',
  'Korea Republic': 'South Korea',
  'Korea, Republic of': 'South Korea',
  'South Korea': 'South Korea',
  'Congo DR': 'DR Congo',
  'DR Congo': 'DR Congo',
  'Congo (DR)': 'DR Congo',
  "Cote d'Ivoire": 'Ivory Coast',
  'Côte d’Ivoire': 'Ivory Coast',
  "Côte d'Ivoire": 'Ivory Coast',
  'Cabo Verde': 'Cape Verde',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  Curacao: 'Curaçao',
};

export function teamIdFromName(name: string): number | null {
  const canonical = ALIASES[name] ?? name;
  return idByName.get(canonical) ?? null;
}

// ESPN seeds knockout fixtures with placeholder "teams" before they are
// decided (e.g. "Group A Winner", "Round of 32 1 Winner", "Semifinal 1
// Loser", "Third Place Group A/B/C/D/F"). These are expected non-matches, not
// data problems, so they are excluded from the unmapped-name warning.
const PLACEHOLDER_RE = /winner|loser|place|\b1st\b|\b2nd\b|\b3rd\b|runner/i;
export function isPlaceholderName(name: string): boolean {
  return PLACEHOLDER_RE.test(name);
}

const pairKey = (a: number, b: number) => [a, b].sort((x, y) => x - y).join('-');

// Each group-stage pair plays exactly once, so the unordered pair uniquely
// identifies the seed match regardless of ESPN's date bucketing.
const groupMatchByPair = new Map<string, { id: number; homeId: number; awayId: number }>();
for (const m of SEED_MATCHES) {
  const homeId = idByName.get(m.home);
  const awayId = idByName.get(m.away);
  if (homeId !== undefined && awayId !== undefined) {
    groupMatchByPair.set(pairKey(homeId, awayId), { id: m.id, homeId, awayId });
  }
}

// --- ESPN parsing -------------------------------------------------------------

export interface EspnEvent {
  homeName: string;
  awayName: string;
  homeId: number | null;
  awayId: number | null;
  homeScore: number;
  awayScore: number;
  completed: boolean;
  state: 'pre' | 'in' | 'post'; // ESPN status: scheduled / live / final
  winnerId: number | null; // ESPN's winner flag (accounts for penalties)
  round: Round | null;
}

function parseRound(text: string, homeId: number | null, awayId: number | null): Round | null {
  // A known group pair is always a group game, whatever the label says.
  if (homeId !== null && awayId !== null && groupMatchByPair.has(pairKey(homeId, awayId))) {
    return 'group';
  }
  const t = text.toLowerCase();
  if (/third place|3rd place/.test(t)) return 'third';
  if (/round of 32|\br32\b/.test(t)) return 1;
  if (/round of 16|\br16\b/.test(t)) return 2;
  if (/quarter-?final/.test(t)) return 3;
  if (/semi-?final/.test(t)) return 4;
  if (/\bfinal\b/.test(t)) return 5;
  return null;
}

// Narrow shape of the bits of the ESPN scoreboard payload we read.
interface EspnCompetitor {
  homeAway?: string;
  score?: string | number;
  winner?: boolean;
  team?: { displayName?: string };
}
interface EspnCompetition {
  status?: { type?: { completed?: boolean; state?: string } };
  notes?: { headline?: string }[];
  competitors?: EspnCompetitor[];
}
interface EspnGameEvent {
  name?: string;
  shortName?: string;
  competitions?: EspnCompetition[];
}
export interface EspnScoreboard {
  events?: EspnGameEvent[];
}

export function parseEspnDay(json: EspnScoreboard): EspnEvent[] {
  const events: EspnEvent[] = [];
  for (const ev of json.events ?? []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === 'home');
    const away = comp.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    const homeName = home.team?.displayName ?? '';
    const awayName = away.team?.displayName ?? '';
    const homeId = teamIdFromName(homeName);
    const awayId = teamIdFromName(awayName);
    const notesText = (comp.notes ?? []).map((n) => n.headline ?? '').join(' ');
    const labelText = [ev.name, ev.shortName, notesText].filter(Boolean).join(' ');
    const homeScore = parseInt(String(home.score ?? ''), 10);
    const awayScore = parseInt(String(away.score ?? ''), 10);
    const winnerId = home.winner ? homeId : away.winner ? awayId : null;
    const rawState = comp.status?.type?.state;
    const state: EspnEvent['state'] = rawState === 'in' || rawState === 'post' ? rawState : 'pre';
    events.push({
      homeName,
      awayName,
      homeId,
      awayId,
      homeScore: Number.isNaN(homeScore) ? 0 : homeScore,
      awayScore: Number.isNaN(awayScore) ? 0 : awayScore,
      completed: comp.status?.type?.completed === true,
      state,
      winnerId,
      round: parseRound(labelText, homeId, awayId),
    });
  }
  return events;
}

export async function fetchEspnDay(date: string): Promise<EspnEvent[]> {
  const res = await fetch(`${ESPN_URL}?dates=${date}`);
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${date}`);
  return parseEspnDay((await res.json()) as EspnScoreboard);
}

// --- pure result/qualifier/knockout logic (unit-tested) -----------------------

// Result of a group event relative to OUR seed's home team.
export function groupResult(event: EspnEvent, gm: { homeId: number }): Result {
  const ourHome = event.homeId === gm.homeId ? event.homeScore : event.awayScore;
  const ourAway = event.homeId === gm.homeId ? event.awayScore : event.homeScore;
  return ourHome > ourAway ? 'H' : ourHome < ourAway ? 'A' : 'D';
}

interface Row {
  teamId: number;
  pts: number;
  wins: number;
}

// The 32 qualifiers (12 winners + 12 runners-up + 8 best thirds) from final
// group results. Mirrors the client's standings/qualifier tiebreaks: points
// (3/1/0) → head-to-head among tied teams → seeding (team id). Returns null
// until all 72 group results are present.
export function computeQualifierIds(results: Map<number, Result>): Set<number> | null {
  if (SEED_MATCHES.some((m) => !results.has(m.id))) return null;

  const matchIdByPair = new Map<string, number>();
  for (const m of SEED_MATCHES) {
    matchIdByPair.set(pairKey(idByName.get(m.home) as number, idByName.get(m.away) as number), m.id);
  }
  const resultForPair = (a: number, b: number): Result | undefined => {
    const id = matchIdByPair.get(pairKey(a, b));
    return id === undefined ? undefined : results.get(id);
  };
  // Which of two teams won their head-to-head, from the seed-oriented result.
  const winnerFromPair = (teamA: number, teamB: number, r: Result): number => {
    const id = matchIdByPair.get(pairKey(teamA, teamB));
    const m = SEED_MATCHES.find((x) => x.id === id);
    if (!m) return teamA;
    return r === 'H' ? (idByName.get(m.home) as number) : (idByName.get(m.away) as number);
  };

  const groups = [...new Set(SEED_TEAMS.map((t) => t.group))];
  const thirds: Row[] = [];
  const qualifiers = new Set<number>();

  for (const g of groups) {
    const teams = SEED_TEAMS.filter((t) => t.group === g).map((t) => t.id);
    const pts = new Map(teams.map((id) => [id, 0]));
    const wins = new Map(teams.map((id) => [id, 0]));
    for (const m of SEED_MATCHES.filter((x) => x.group === g)) {
      const homeId = idByName.get(m.home) as number;
      const awayId = idByName.get(m.away) as number;
      const r = results.get(m.id) as Result;
      if (r === 'H') {
        pts.set(homeId, (pts.get(homeId) ?? 0) + 3);
        wins.set(homeId, (wins.get(homeId) ?? 0) + 1);
      } else if (r === 'A') {
        pts.set(awayId, (pts.get(awayId) ?? 0) + 3);
        wins.set(awayId, (wins.get(awayId) ?? 0) + 1);
      } else {
        pts.set(homeId, (pts.get(homeId) ?? 0) + 1);
        pts.set(awayId, (pts.get(awayId) ?? 0) + 1);
      }
    }
    const rows: Row[] = teams.map((id) => ({ teamId: id, pts: pts.get(id) ?? 0, wins: wins.get(id) ?? 0 }));
    rows.sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.teamId - b.teamId);

    // Break two-way points ties on head-to-head.
    for (let i = 0; i < rows.length; ) {
      let j = i + 1;
      while (j < rows.length && rows[j].pts === rows[i].pts) j++;
      if (j - i === 2) {
        const r = resultForPair(rows[i].teamId, rows[i + 1].teamId);
        if (r && r !== 'D') {
          const pairWinner = winnerFromPair(rows[i].teamId, rows[i + 1].teamId, r);
          if (pairWinner === rows[i + 1].teamId) [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
        }
      }
      i = j;
    }

    qualifiers.add(rows[0].teamId);
    qualifiers.add(rows[1].teamId);
    thirds.push(rows[2]);
  }

  thirds.sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.teamId - b.teamId);
  for (const t of thirds.slice(0, 8)) qualifiers.add(t.teamId);
  return qualifiers;
}

export interface KnockoutEffect {
  reach: number; // both teams reached this stage
  winnerId: number | null; // advances to reach+1
  loserId: number | null; // eliminated at reach
}

// null when the event is not a scored knockout game (group, third place, or
// unknown/unfinished round).
export function knockoutEffect(event: EspnEvent): KnockoutEffect | null {
  if (!event.completed) return null;
  if (typeof event.round !== 'number') return null; // group/third/unknown
  if (event.homeId === null || event.awayId === null) return null;
  const winnerId = event.winnerId;
  const loserId = winnerId === null ? null : winnerId === event.homeId ? event.awayId : event.homeId;
  return { reach: event.round, winnerId, loserId };
}

// --- date helpers -------------------------------------------------------------

const ymd = (d: Date) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

function tournamentDates(): string[] {
  const dates: string[] = [];
  const d = new Date(Date.UTC(2026, 5, 11)); // Jun 11
  const end = new Date(Date.UTC(2026, 6, 19)); // Jul 19
  while (d <= end) {
    dates.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function rollingDates(): string[] {
  const now = Date.now();
  return [-1, 0, 1].map((off) => ymd(new Date(now + off * 86400000)));
}

// --- orchestration ------------------------------------------------------------

export interface SyncSummary {
  ok: boolean;
  groupResults: number;
  knockoutGames: number;
  unmapped: string[];
  error?: string;
}

export async function syncResults(appkit: AppKitLakebase, opts: { allDates?: boolean } = {}): Promise<SyncSummary> {
  const dates = opts.allDates ? tournamentDates() : rollingDates();
  const events: EspnEvent[] = [];
  const unmapped = new Set<string>();
  try {
    for (const date of dates) {
      let evs: EspnEvent[] = [];
      try {
        evs = await fetchEspnDay(date);
      } catch {
        continue; // one bad day shouldn't fail the whole sync
      }
      for (const e of evs) {
        if (e.homeId === null && !isPlaceholderName(e.homeName)) unmapped.add(e.homeName);
        if (e.awayId === null && !isPlaceholderName(e.awayName)) unmapped.add(e.awayName);
        events.push(e);
      }
    }

    // (a) group results + live score/status (score/status mirror the feed for
    // display; actual_result is only written on completion and respects the
    // manual-override flag).
    let groupResults = 0;
    for (const e of events) {
      if (e.round !== 'group' || e.homeId === null || e.awayId === null) continue;
      const gm = groupMatchByPair.get(pairKey(e.homeId, e.awayId));
      if (!gm) continue;
      const ourHome = e.homeId === gm.homeId ? e.homeScore : e.awayScore;
      const ourAway = e.homeId === gm.homeId ? e.awayScore : e.homeScore;
      const live = e.state !== 'pre';
      await appkit.lakebase.query(
        `UPDATE pool.matches SET home_score = $2, away_score = $3, status = $4 WHERE id = $1`,
        [gm.id, live ? ourHome : null, live ? ourAway : null, e.state]
      );
      if (e.completed) {
        const result = groupResult(e, gm);
        const { rows } = await appkit.lakebase.query(
          `UPDATE pool.matches SET actual_result = $2
           WHERE id = $1 AND result_manual = FALSE AND actual_result IS DISTINCT FROM $2
           RETURNING id`,
          [gm.id, result]
        );
        groupResults += rows.length;
      }
    }

    // (b) qualifiers, once every group result is recorded
    const { rows: matchRows } = await appkit.lakebase.query('SELECT id, actual_result FROM pool.matches');
    const resultMap = new Map<number, Result>();
    for (const r of matchRows) {
      if (r.actual_result) resultMap.set(r.id as number, r.actual_result as Result);
    }
    const qualifierIds = computeQualifierIds(resultMap);
    if (qualifierIds) {
      const ids = [...qualifierIds];
      await appkit.lakebase.query(
        `UPDATE pool.teams SET actual_stage = GREATEST(COALESCE(actual_stage, 0), 1)
         WHERE id = ANY($1) AND stage_manual = FALSE AND COALESCE(actual_stage, 0) < 1`,
        [ids]
      );
      await appkit.lakebase.query(
        `UPDATE pool.teams SET actual_stage = 0, eliminated = TRUE
         WHERE id <> ALL($1) AND stage_manual = FALSE`,
        [ids]
      );
    }

    // (c) knockout progression
    let knockoutGames = 0;
    for (const e of events) {
      const eff = knockoutEffect(e);
      if (!eff) continue;
      knockoutGames += 1;
      await appkit.lakebase.query(
        `UPDATE pool.teams SET actual_stage = GREATEST(COALESCE(actual_stage, 0), $2)
         WHERE id = ANY($1) AND stage_manual = FALSE`,
        [[e.homeId, e.awayId], eff.reach]
      );
      if (eff.winnerId !== null) {
        await appkit.lakebase.query(
          `UPDATE pool.teams SET actual_stage = GREATEST(COALESCE(actual_stage, 0), $2)
           WHERE id = $1 AND stage_manual = FALSE`,
          [eff.winnerId, eff.reach + 1]
        );
      }
      if (eff.loserId !== null) {
        await appkit.lakebase.query(`UPDATE pool.teams SET eliminated = TRUE WHERE id = $1 AND stage_manual = FALSE`, [
          eff.loserId,
        ]);
      }
    }

    const summary: SyncSummary = {
      ok: true,
      groupResults,
      knockoutGames,
      unmapped: [...unmapped],
    };
    await writeSyncState(appkit, summary);
    return summary;
  } catch (err) {
    const summary: SyncSummary = {
      ok: false,
      groupResults: 0,
      knockoutGames: 0,
      unmapped: [...unmapped],
      error: (err as Error).message,
    };
    await writeSyncState(appkit, summary).catch(() => undefined);
    return summary;
  }
}

async function writeSyncState(appkit: AppKitLakebase, s: SyncSummary): Promise<void> {
  const status = s.ok
    ? `OK — ${s.groupResults} group result(s), ${s.knockoutGames} knockout game(s)` +
      (s.unmapped.length ? `; unmapped: ${s.unmapped.join(', ')}` : '')
    : `ERROR: ${s.error ?? 'unknown'}`;
  await appkit.lakebase.query(
    `INSERT INTO pool.sync_state (id, last_synced_at, status) VALUES (1, NOW(), $1)
     ON CONFLICT (id) DO UPDATE SET last_synced_at = NOW(), status = $1`,
    [status]
  );
}

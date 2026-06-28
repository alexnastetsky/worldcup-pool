import type { Fixtures, Pick } from './pool';
import { GROUP_LETTERS } from './pool';

// Official 2026 knockout structure (FIFA matches 73–104; the third-place
// match 103 is not part of the pool).
//
// Stage codes line up with pool scoring: a team's predicted_stage is
// 0 = out in groups, 1 = reached R32, … 6 = Champion. A node at `round` r
// (1=R32 … 5=Final) sends its winner to stage r+1.

export type SlotDef = { type: 'W' | 'RU'; group: string } | { type: '3RD'; pool: string[] };

export interface R32SlotDef {
  matchNo: number;
  home: SlotDef;
  away: SlotDef;
}

const w = (group: string): SlotDef => ({ type: 'W', group });
const ru = (group: string): SlotDef => ({ type: 'RU', group });
const third = (pool: string): SlotDef => ({ type: '3RD', pool: pool.split('') });

export const R32_SLOTS: R32SlotDef[] = [
  { matchNo: 73, home: ru('A'), away: ru('B') },
  { matchNo: 74, home: w('E'), away: third('ABCDF') },
  { matchNo: 75, home: w('F'), away: ru('C') },
  { matchNo: 76, home: w('C'), away: ru('F') },
  { matchNo: 77, home: w('I'), away: third('CDFGH') },
  { matchNo: 78, home: ru('E'), away: ru('I') },
  { matchNo: 79, home: w('A'), away: third('CEFHI') },
  { matchNo: 80, home: w('L'), away: third('EHIJK') },
  { matchNo: 81, home: w('D'), away: third('BEFIJ') },
  { matchNo: 82, home: w('G'), away: third('AEHIJ') },
  { matchNo: 83, home: ru('K'), away: ru('L') },
  { matchNo: 84, home: w('H'), away: ru('J') },
  { matchNo: 85, home: w('B'), away: third('EFGIJ') },
  { matchNo: 86, home: w('J'), away: ru('H') },
  { matchNo: 87, home: w('K'), away: third('DEIJL') },
  { matchNo: 88, home: ru('D'), away: ru('G') },
];

// matchNo → the two earlier matches whose winners meet there
export const FEEDS: Record<number, [number, number]> = {
  89: [74, 77],
  90: [73, 75],
  91: [76, 78],
  92: [79, 80],
  93: [83, 84],
  94: [81, 82],
  95: [86, 88],
  96: [85, 87],
  97: [89, 90],
  98: [93, 94],
  99: [91, 92],
  100: [95, 96],
  101: [97, 98],
  102: [99, 100],
  104: [101, 102],
};

export const ROUND_OF = (matchNo: number): number =>
  matchNo <= 88 ? 1 : matchNo <= 96 ? 2 : matchNo <= 100 ? 3 : matchNo <= 102 ? 4 : 5;

// Display order per round, derived from the tree so feeders sit next to each
// other vertically (top half feeds SF 101, bottom half feeds SF 102).
export const ROUND_ORDER: number[][] = (() => {
  const rounds: number[][] = [[], [], [], [], [104]];
  // walk down round by round so feeders sit in tree order
  for (let r = 5; r >= 2; r--) {
    for (const m of rounds[r - 1]) {
      const feed = FEEDS[m];
      if (feed) rounds[r - 2].push(feed[0], feed[1]);
    }
  }
  return rounds;
})();

export interface GroupStandingRow {
  teamId: number;
  pts: number;
  wins: number;
}

// Predicted group tables from H/D/A picks: win 3 pts, draw 1. Tiebreaks are
// necessarily simplified (no goals exist): points → head-to-head among the
// tied teams → draw seeding (team id). Returns null for a group until all 6
// of its matches are picked.
export function computeGroupStandings(
  picks: Record<number, Pick>,
  fixtures: Fixtures
): Record<string, GroupStandingRow[] | null> {
  const result: Record<string, GroupStandingRow[] | null> = {};
  for (const g of GROUP_LETTERS) {
    const matches = fixtures.matches.filter((m) => m.group_letter === g);
    const teams = fixtures.teams.filter((t) => t.group_letter === g);
    if (matches.some((m) => picks[m.id] === undefined)) {
      result[g] = null;
      continue;
    }
    const pts = new Map<number, number>(teams.map((t) => [t.id, 0]));
    const wins = new Map<number, number>(teams.map((t) => [t.id, 0]));
    for (const m of matches) {
      const p = picks[m.id];
      if (p === 'H') {
        pts.set(m.home_team_id, (pts.get(m.home_team_id) ?? 0) + 3);
        wins.set(m.home_team_id, (wins.get(m.home_team_id) ?? 0) + 1);
      } else if (p === 'A') {
        pts.set(m.away_team_id, (pts.get(m.away_team_id) ?? 0) + 3);
        wins.set(m.away_team_id, (wins.get(m.away_team_id) ?? 0) + 1);
      } else {
        pts.set(m.home_team_id, (pts.get(m.home_team_id) ?? 0) + 1);
        pts.set(m.away_team_id, (pts.get(m.away_team_id) ?? 0) + 1);
      }
    }
    const rows: GroupStandingRow[] = teams.map((t) => ({
      teamId: t.id,
      pts: pts.get(t.id) ?? 0,
      wins: wins.get(t.id) ?? 0,
    }));
    rows.sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.teamId - b.teamId);

    // Resolve ties on points: pairwise by the head-to-head pick; larger ties
    // by points within the tied mini-league, then seeding.
    for (let i = 0; i < rows.length; ) {
      let j = i + 1;
      while (j < rows.length && rows[j].pts === rows[i].pts) j++;
      if (j - i === 2) {
        const m = matches.find(
          (x) =>
            (x.home_team_id === rows[i].teamId && x.away_team_id === rows[i + 1].teamId) ||
            (x.home_team_id === rows[i + 1].teamId && x.away_team_id === rows[i].teamId)
        );
        const p = m ? picks[m.id] : undefined;
        if (m && p && p !== 'D') {
          const winnerId = p === 'H' ? m.home_team_id : m.away_team_id;
          if (winnerId === rows[i + 1].teamId) [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
        }
      } else if (j - i > 2) {
        const tiedIds = new Set(rows.slice(i, j).map((r) => r.teamId));
        const mini = new Map<number, number>([...tiedIds].map((id) => [id, 0]));
        for (const m of matches) {
          if (!tiedIds.has(m.home_team_id) || !tiedIds.has(m.away_team_id)) continue;
          const p = picks[m.id];
          if (p === 'H') mini.set(m.home_team_id, (mini.get(m.home_team_id) ?? 0) + 3);
          else if (p === 'A') mini.set(m.away_team_id, (mini.get(m.away_team_id) ?? 0) + 3);
          else {
            mini.set(m.home_team_id, (mini.get(m.home_team_id) ?? 0) + 1);
            mini.set(m.away_team_id, (mini.get(m.away_team_id) ?? 0) + 1);
          }
        }
        const sorted = rows
          .slice(i, j)
          .sort(
            (a, b) => (mini.get(b.teamId) ?? 0) - (mini.get(a.teamId) ?? 0) || b.wins - a.wins || a.teamId - b.teamId
          );
        rows.splice(i, j - i, ...sorted);
      }
      i = j;
    }
    result[g] = rows;
  }
  return result;
}

export interface Qualifiers {
  winners: Record<string, number>; // group → teamId
  runners: Record<string, number>;
  qualifiedThirds: { group: string; teamId: number }[]; // the 8 best thirds
  thirdSlotAssignment: Record<number, number>; // R32 matchNo → teamId
  qualifiedIds: Set<number>;
}

// Returns null until every group's standings are complete.
export function computeQualifiers(standings: Record<string, GroupStandingRow[] | null>): Qualifiers | null {
  const winners: Record<string, number> = {};
  const runners: Record<string, number> = {};
  const thirds: { group: string; teamId: number; pts: number; wins: number }[] = [];
  for (const g of GROUP_LETTERS) {
    const rows = standings[g];
    if (!rows) return null;
    winners[g] = rows[0].teamId;
    runners[g] = rows[1].teamId;
    thirds.push({ group: g, ...rows[2] });
  }
  thirds.sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.teamId - b.teamId);
  const qualifiedThirds = thirds.slice(0, 8).map(({ group, teamId }) => ({ group, teamId }));

  // Assign the 8 thirds to the 8 third-place slots, respecting each slot's
  // allowed-group pool, via small backtracking (most-constrained slot first).
  // This is deterministic but intentionally simpler than FIFA's official
  // priority tables — it has zero effect on pool scoring, only on which slot
  // a third lands in.
  const thirdSlots = R32_SLOTS.filter((s) => s.away.type === '3RD').map((s) => ({
    matchNo: s.matchNo,
    pool: (s.away as { type: '3RD'; pool: string[] }).pool,
  }));
  const byGroup = new Map(qualifiedThirds.map((t) => [t.group, t.teamId]));
  const slots = [...thirdSlots].sort(
    (a, b) => a.pool.filter((g) => byGroup.has(g)).length - b.pool.filter((g) => byGroup.has(g)).length
  );
  const assignment: Record<number, number> = {};
  const used = new Set<string>();
  const assign = (idx: number): boolean => {
    if (idx === slots.length) return true;
    const slot = slots[idx];
    for (const g of slot.pool) {
      if (used.has(g) || !byGroup.has(g)) continue;
      used.add(g);
      assignment[slot.matchNo] = byGroup.get(g) as number;
      if (assign(idx + 1)) return true;
      used.delete(g);
      delete assignment[slot.matchNo];
    }
    return false;
  };
  if (!assign(0)) {
    // No constraint-respecting matching exists for this combination of
    // thirds; fall back to filling slots in order so the bracket still works.
    const remaining = qualifiedThirds.filter((t) => !used.has(t.group));
    for (const slot of slots) {
      if (assignment[slot.matchNo] === undefined) {
        const t = remaining.shift();
        if (t) assignment[slot.matchNo] = t.teamId;
      }
    }
  }

  const qualifiedIds = new Set<number>([
    ...Object.values(winners),
    ...Object.values(runners),
    ...qualifiedThirds.map((t) => t.teamId),
  ]);
  return { winners, runners, qualifiedThirds, thirdSlotAssignment: assignment, qualifiedIds };
}

export interface BracketNode {
  matchNo: number;
  round: number; // 1=R32 … 5=Final
  home: number | null;
  away: number | null;
  winner: number | null;
}

// Build all 31 nodes from qualifiers + the user's winner choices, dropping
// any stored winner that is no longer one of the node's two teams (e.g.
// after a group-pick change replaced a qualifier).
export function buildBracket(qualifiers: Qualifiers, winners: Record<number, number>): BracketNode[] {
  const nodes = new Map<number, BracketNode>();
  for (const slot of R32_SLOTS) {
    const resolve = (def: SlotDef): number | null => {
      if (def.type === 'W') return qualifiers.winners[def.group] ?? null;
      if (def.type === 'RU') return qualifiers.runners[def.group] ?? null;
      return qualifiers.thirdSlotAssignment[slot.matchNo] ?? null;
    };
    nodes.set(slot.matchNo, {
      matchNo: slot.matchNo,
      round: 1,
      home: resolve(slot.home),
      away: resolve(slot.away),
      winner: null,
    });
  }
  const ordered = [...R32_SLOTS.map((s) => s.matchNo), ...Object.keys(FEEDS).map(Number)].sort((a, b) => a - b);
  for (const matchNo of ordered) {
    const feed = FEEDS[matchNo];
    let node = nodes.get(matchNo);
    if (feed) {
      node = {
        matchNo,
        round: ROUND_OF(matchNo),
        home: nodes.get(feed[0])?.winner ?? null,
        away: nodes.get(feed[1])?.winner ?? null,
        winner: null,
      };
      nodes.set(matchNo, node);
    }
    if (!node) continue;
    const chosen = winners[matchNo];
    if (chosen !== undefined && (chosen === node.home || chosen === node.away)) {
      node.winner = chosen;
    }
  }
  return [...nodes.values()].sort((a, b) => a.matchNo - b.matchNo);
}

// Reconstruct winner choices from saved per-team stages (the inverse of
// stagesFromBracket): at a node of round r, the winner is whichever team's
// saved stage exceeds r — valid only if exactly one of the two does.
export function winnersFromStages(qualifiers: Qualifiers, stages: Record<number, number>): Record<number, number> {
  const winners: Record<number, number> = {};
  // iterate rounds in order so feeds resolve
  for (let pass = 0; pass < 5; pass++) {
    const nodes = buildBracket(qualifiers, winners);
    for (const node of nodes) {
      if (node.winner !== null || node.home === null || node.away === null) continue;
      const sh = stages[node.home] ?? 0;
      const sa = stages[node.away] ?? 0;
      const homeAdvances = sh > node.round;
      const awayAdvances = sa > node.round;
      if (homeAdvances !== awayAdvances) {
        winners[node.matchNo] = homeAdvances ? node.home : node.away;
      }
    }
  }
  return winners;
}

// Per-team predicted stage for ALL 48 teams: 0 for non-qualifiers, 1 for
// qualifying, +1 for every bracket win. This is exactly the existing
// bracket_predictions payload — scoring is untouched.
export function stagesFromBracket(
  qualifiers: Qualifiers,
  nodes: BracketNode[],
  allTeamIds: number[]
): Record<number, number> {
  const stages: Record<number, number> = {};
  for (const id of allTeamIds) stages[id] = qualifiers.qualifiedIds.has(id) ? 1 : 0;
  for (const node of nodes) {
    if (node.winner !== null) {
      stages[node.winner] = Math.max(stages[node.winner] ?? 0, node.round + 1);
    }
  }
  return stages;
}

export function bracketProgress(nodes: BracketNode[]): { decided: number; total: number } {
  return { decided: nodes.filter((n) => n.winner !== null).length, total: nodes.length };
}

// --- real (actual-results) bracket ------------------------------------------
// The "Tournament Bracket (real results)" must mirror the official bracket, so
// it is built from authoritative data — the ESPN knockout matchups
// (fixtures.knockout) and recorded scores — NOT reconstructed from the pool's
// simplified, goal-difference-free group tiebreakers (which mis-seed the R32).

export interface ActualStandingRow {
  teamId: number;
  pts: number;
  gd: number; // goal difference
  gf: number; // goals for
}

// Real group standings from recorded results + scores: points (3/1/0) →
// goal difference → goals for → two-way head-to-head → seeding (team id).
// Unlike computeGroupStandings (pick-based, no scores) this has real goals.
export function actualGroupStandings(fixtures: Fixtures): Record<string, ActualStandingRow[]> {
  const result: Record<string, ActualStandingRow[]> = {};
  for (const g of GROUP_LETTERS) {
    const teams = fixtures.teams.filter((t) => t.group_letter === g);
    const matches = fixtures.matches.filter(
      (m) => m.group_letter === g && m.home_score !== null && m.away_score !== null
    );
    const pts = new Map<number, number>(teams.map((t) => [t.id, 0]));
    const gf = new Map<number, number>(teams.map((t) => [t.id, 0]));
    const ga = new Map<number, number>(teams.map((t) => [t.id, 0]));
    for (const m of matches) {
      const hs = m.home_score as number;
      const as = m.away_score as number;
      gf.set(m.home_team_id, (gf.get(m.home_team_id) ?? 0) + hs);
      ga.set(m.home_team_id, (ga.get(m.home_team_id) ?? 0) + as);
      gf.set(m.away_team_id, (gf.get(m.away_team_id) ?? 0) + as);
      ga.set(m.away_team_id, (ga.get(m.away_team_id) ?? 0) + hs);
      if (hs > as) pts.set(m.home_team_id, (pts.get(m.home_team_id) ?? 0) + 3);
      else if (hs < as) pts.set(m.away_team_id, (pts.get(m.away_team_id) ?? 0) + 3);
      else {
        pts.set(m.home_team_id, (pts.get(m.home_team_id) ?? 0) + 1);
        pts.set(m.away_team_id, (pts.get(m.away_team_id) ?? 0) + 1);
      }
    }
    const rows: ActualStandingRow[] = teams.map((t) => ({
      teamId: t.id,
      pts: pts.get(t.id) ?? 0,
      gd: (gf.get(t.id) ?? 0) - (ga.get(t.id) ?? 0),
      gf: gf.get(t.id) ?? 0,
    }));
    rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.teamId - b.teamId);
    // Two-way head-to-head among teams otherwise dead-even.
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      if (a.pts !== b.pts || a.gd !== b.gd || a.gf !== b.gf) continue;
      const m = matches.find(
        (x) =>
          (x.home_team_id === a.teamId && x.away_team_id === b.teamId) ||
          (x.home_team_id === b.teamId && x.away_team_id === a.teamId)
      );
      if (!m) continue;
      const aScore = m.home_team_id === a.teamId ? (m.home_score as number) : (m.away_score as number);
      const bScore = m.home_team_id === b.teamId ? (m.home_score as number) : (m.away_score as number);
      if (bScore > aScore) [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
    }
    result[g] = rows;
  }
  return result;
}

// The real bracket: R32 seeded from the actual ESPN matchups, winners filled in
// from each team's recorded furthest stage. Returns null (card shows its empty
// state) until the Round of 32 is fully drawn, or if the data can't be mapped
// cleanly onto the 16 slots — never a wrong bracket.
export function actualBracket(fixtures: Fixtures): BracketNode[] | null {
  const r32Games = fixtures.knockout.filter((k) => k.round === '1' && k.home_id != null && k.away_id != null);
  if (r32Games.length < 16) return null;

  // team id → the R32 game it appears in
  const gameOf = new Map<number, { a: number; b: number }>();
  for (const k of r32Games) {
    const a = k.home_id as number;
    const b = k.away_id as number;
    gameOf.set(a, { a, b });
    gameOf.set(b, { a, b });
  }

  const standings = actualGroupStandings(fixtures);
  const winners: Record<string, number> = {};
  const runners: Record<string, number> = {};
  for (const g of GROUP_LETTERS) {
    const rows = standings[g];
    if (!rows || rows.length < 2) return null;
    winners[g] = rows[0].teamId;
    runners[g] = rows[1].teamId;
  }

  // Seed each R32 slot from the mirror game containing its W/RU "anchor". Every
  // slot has at least one W/RU side; its actual opponent is the third-place team.
  const nodes = new Map<number, BracketNode>();
  const usedGames = new Set<string>();
  const key = (g: { a: number; b: number }) => [g.a, g.b].sort((x, y) => x - y).join('-');
  for (const slot of R32_SLOTS) {
    const anchor =
      slot.home.type === 'W'
        ? winners[slot.home.group]
        : slot.home.type === 'RU'
          ? runners[slot.home.group]
          : slot.away.type === 'W'
            ? winners[slot.away.group]
            : slot.away.type === 'RU'
              ? runners[slot.away.group]
              : null;
    if (anchor == null) return null;
    const game = gameOf.get(anchor);
    if (!game || usedGames.has(key(game))) return null; // unmapped or ambiguous → bail
    usedGames.add(key(game));
    nodes.set(slot.matchNo, { matchNo: slot.matchNo, round: 1, home: game.a, away: game.b, winner: null });
  }
  if (usedGames.size !== 16) return null;

  // Fill winners from recorded stages and feed the later rounds (reuse FEEDS).
  const stages: Record<number, number> = {};
  for (const t of fixtures.teams) if (t.actual_stage != null) stages[t.id] = t.actual_stage;
  const setWinner = (node: BracketNode) => {
    if (node.home == null || node.away == null) return;
    const homeAdv = (stages[node.home] ?? 0) > node.round;
    const awayAdv = (stages[node.away] ?? 0) > node.round;
    if (homeAdv !== awayAdv) node.winner = homeAdv ? node.home : node.away;
  };
  const ordered = [...R32_SLOTS.map((s) => s.matchNo), ...Object.keys(FEEDS).map(Number)].sort((a, b) => a - b);
  for (const matchNo of ordered) {
    let node = nodes.get(matchNo);
    const feed = FEEDS[matchNo];
    if (feed) {
      node = {
        matchNo,
        round: ROUND_OF(matchNo),
        home: nodes.get(feed[0])?.winner ?? null,
        away: nodes.get(feed[1])?.winner ?? null,
        winner: null,
      };
      nodes.set(matchNo, node);
    }
    if (node) setWinner(node);
  }
  return [...nodes.values()].sort((a, b) => a.matchNo - b.matchNo);
}

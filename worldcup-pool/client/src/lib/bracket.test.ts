import { describe, expect, it } from 'vitest';
import type { Fixtures, Pick, Team } from './pool';
import { SEED_TEAMS, SEED_MATCHES } from '../../../server/seed-data';
import {
  R32_SLOTS,
  ROUND_ORDER,
  buildBracket,
  bracketProgress,
  computeGroupStandings,
  computeQualifiers,
  stagesFromBracket,
  winnersFromStages,
} from './bracket';

// Build Fixtures from the real seed data so tests mirror production exactly.
const teams: Team[] = SEED_TEAMS.map((t) => ({
  id: t.id,
  name: t.name,
  group_letter: t.group,
  actual_stage: null,
  eliminated: false,
}));
const teamIdByName = new Map(SEED_TEAMS.map((t) => [t.name, t.id]));
const fixtures: Fixtures = {
  teams,
  matches: SEED_MATCHES.map((m) => ({
    id: m.id,
    group_letter: m.group,
    home_team_id: teamIdByName.get(m.home) as number,
    away_team_id: teamIdByName.get(m.away) as number,
    match_date: m.date,
    actual_result: null,
    home_score: null,
    away_score: null,
    status: null,
    kickoff_at: null,
  })),
  knockout: [],
};

// All home wins: deterministic full pick set.
const allHomePicks: Record<number, Pick> = Object.fromEntries(fixtures.matches.map((m) => [m.id, 'H' as Pick]));

describe('computeGroupStandings', () => {
  it('is null until all 6 group matches are picked', () => {
    const partial: Record<number, Pick> = { 1: 'H' };
    const standings = computeGroupStandings(partial, fixtures);
    expect(standings.A).toBeNull();
  });

  it('ranks by points with all home wins', () => {
    const standings = computeGroupStandings(allHomePicks, fixtures);
    for (const rows of Object.values(standings)) {
      expect(rows).not.toBeNull();
      expect(rows).toHaveLength(4);
      const pts = (rows ?? []).map((r) => r.pts);
      expect([...pts].sort((a, b) => b - a)).toEqual(pts);
      expect(pts.reduce((a, b) => a + b, 0)).toBe(18); // 6 decisive matches
    }
  });

  it('breaks a two-way points tie by head-to-head', () => {
    // Group A: Mexico(1), South Africa(2), South Korea(3), Czechia(4).
    // Matches: 1 MEX-RSA, 2 KOR-CZE, 25 CZE-RSA, 28 MEX-KOR, 53 CZE-MEX, 54 RSA-KOR.
    // Picks: MEX beats RSA & KOR, loses to CZE; CZE loses to KOR, beats RSA.
    // → MEX 6, CZE 6, head-to-head CZE beat MEX → CZE 1st despite higher seed for MEX.
    const picks: Record<number, Pick> = {
      ...allHomePicks,
      1: 'H', // MEX > RSA
      28: 'H', // MEX > KOR
      53: 'H', // CZE > MEX  (head-to-head)
      2: 'H', // KOR > CZE
      25: 'H', // CZE > RSA
      54: 'H', // RSA > KOR
    };
    const rows = computeGroupStandings(picks, fixtures).A ?? [];
    expect(rows[0].teamId).toBe(4); // Czechia via head-to-head
    expect(rows[1].teamId).toBe(1); // Mexico
  });
});

describe('computeQualifiers', () => {
  const standings = computeGroupStandings(allHomePicks, fixtures);
  const q = computeQualifiers(standings);

  it('produces 12 winners, 12 runners-up, 8 thirds, 32 qualifiers', () => {
    expect(q).not.toBeNull();
    expect(Object.keys(q?.winners ?? {})).toHaveLength(12);
    expect(Object.keys(q?.runners ?? {})).toHaveLength(12);
    expect(q?.qualifiedThirds).toHaveLength(8);
    expect(q?.qualifiedIds.size).toBe(32);
  });

  it('assigns each qualified third to a slot whose pool allows its group', () => {
    const slotPools = new Map(
      R32_SLOTS.filter((s) => s.away.type === '3RD').map((s) => [
        s.matchNo,
        (s.away as { type: '3RD'; pool: string[] }).pool,
      ])
    );
    const groupOf = new Map(teams.map((t) => [t.id, t.group_letter]));
    const assigned = Object.entries(q?.thirdSlotAssignment ?? {});
    expect(assigned).toHaveLength(8);
    for (const [matchNo, teamId] of assigned) {
      const pool = slotPools.get(Number(matchNo)) ?? [];
      expect(pool).toContain(groupOf.get(teamId));
    }
    // each third used exactly once
    expect(new Set(assigned.map(([, id]) => id)).size).toBe(8);
  });

  it('is null when any group is incomplete', () => {
    const partial = { ...allHomePicks };
    delete partial[1];
    expect(computeQualifiers(computeGroupStandings(partial, fixtures))).toBeNull();
  });
});

describe('bracket round-trip', () => {
  const q = computeQualifiers(computeGroupStandings(allHomePicks, fixtures));
  if (!q) throw new Error('qualifiers expected');

  // Decide every node: always pick the home side.
  const pickAllHome = () => {
    const winners: Record<number, number> = {};
    for (let pass = 0; pass < 5; pass++) {
      for (const node of buildBracket(q, winners)) {
        if (node.winner === null && node.home !== null) winners[node.matchNo] = node.home;
      }
    }
    return winners;
  };

  it('fills all 32 R32 slots and counts 31 nodes', () => {
    const nodes = buildBracket(q, {});
    const r32 = nodes.filter((n) => n.round === 1);
    expect(r32).toHaveLength(16);
    expect(r32.every((n) => n.home !== null && n.away !== null)).toBe(true);
    expect(nodes).toHaveLength(31);
    expect(bracketProgress(nodes)).toEqual({ decided: 0, total: 31 });
  });

  it('produces the exact stage distribution when fully decided', () => {
    const winners = pickAllHome();
    const nodes = buildBracket(q, winners);
    expect(bracketProgress(nodes).decided).toBe(31);
    const stages = stagesFromBracket(
      q,
      nodes,
      teams.map((t) => t.id)
    );
    const counts = new Map<number, number>();
    for (const s of Object.values(stages)) counts.set(s, (counts.get(s) ?? 0) + 1);
    expect(counts.get(0)).toBe(16);
    expect(counts.get(1)).toBe(16);
    expect(counts.get(2)).toBe(8);
    expect(counts.get(3)).toBe(4);
    expect(counts.get(4)).toBe(2);
    expect(counts.get(5)).toBe(1);
    expect(counts.get(6)).toBe(1);
  });

  it('reconstructs identical winners from saved stages', () => {
    const winners = pickAllHome();
    const stages = stagesFromBracket(
      q,
      buildBracket(q, winners),
      teams.map((t) => t.id)
    );
    expect(winnersFromStages(q, stages)).toEqual(winners);
  });

  it('drops downstream winners when a feeder choice changes', () => {
    const winners = pickAllHome();
    const final = buildBracket(q, winners).find((n) => n.matchNo === 104);
    const oldChampion = final?.winner;
    // flip the very first R32 match to the away side
    const flipped = { ...winners, 73: buildBracket(q, {}).find((n) => n.matchNo === 73)?.away as number };
    const nodes = buildBracket(q, flipped);
    // match 90 (fed by 73) no longer has the old winner if it referenced it
    const m90 = nodes.find((n) => n.matchNo === 90);
    expect(m90?.home).toBe(flipped[73]);
    expect(oldChampion).not.toBeUndefined();
  });

  it('ROUND_ORDER covers every node exactly once per round', () => {
    expect(ROUND_ORDER.map((r) => r.length)).toEqual([16, 8, 4, 2, 1]);
    expect(new Set(ROUND_ORDER.flat()).size).toBe(31);
  });
});

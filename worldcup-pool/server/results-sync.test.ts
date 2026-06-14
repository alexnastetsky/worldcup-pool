import { describe, expect, it } from 'vitest';
import { SEED_MATCHES } from './seed-data';
import type { EspnEvent, Result } from './results-sync';
import { computeQualifierIds, groupResult, knockoutEffect, parseEspnDay, teamIdFromName } from './results-sync';

// Minimal ESPN payload shaped like the real scoreboard response, for June 11:
// Mexico 2–0 South Africa (Group A), South Korea 2–1 Czechia (Group A).
const espnFixture = {
  events: [
    {
      name: 'Mexico vs South Africa',
      shortName: 'MEX vs RSA',
      competitions: [
        {
          status: { type: { state: 'post', completed: true } },
          notes: [],
          competitors: [
            { homeAway: 'home', score: '2', winner: true, team: { displayName: 'Mexico' } },
            { homeAway: 'away', score: '0', winner: false, team: { displayName: 'South Africa' } },
          ],
        },
      ],
    },
    {
      name: 'South Korea vs Czechia',
      shortName: 'KOR vs CZE',
      competitions: [
        {
          status: { type: { state: 'post', completed: true } },
          notes: [],
          competitors: [
            { homeAway: 'home', score: '2', winner: true, team: { displayName: 'South Korea' } },
            { homeAway: 'away', score: '1', winner: false, team: { displayName: 'Czechia' } },
          ],
        },
      ],
    },
  ],
};

describe('teamIdFromName', () => {
  it('maps exact and aliased names, null for unknown', () => {
    expect(teamIdFromName('Mexico')).not.toBeNull();
    expect(teamIdFromName('Turkey')).toBe(teamIdFromName('Türkiye'));
    expect(teamIdFromName('Czech Republic')).toBe(teamIdFromName('Czechia'));
    expect(teamIdFromName('Korea Republic')).toBe(teamIdFromName('South Korea'));
    expect(teamIdFromName('Atlantis')).toBeNull();
  });
});

describe('parseEspnDay', () => {
  it('parses events with mapped ids, scores, completion, and group round', () => {
    const events = parseEspnDay(espnFixture);
    expect(events).toHaveLength(2);
    const e = events[0];
    expect(e.homeName).toBe('Mexico');
    expect(e.homeId).toBe(teamIdFromName('Mexico'));
    expect(e.awayId).toBe(teamIdFromName('South Africa'));
    expect(e.homeScore).toBe(2);
    expect(e.awayScore).toBe(0);
    expect(e.completed).toBe(true);
    expect(e.winnerId).toBe(teamIdFromName('Mexico'));
    expect(e.round).toBe('group'); // recognized as a seed group pair
  });
});

describe('groupResult orientation', () => {
  const mexId = teamIdFromName('Mexico') as number;
  const rsaId = teamIdFromName('South Africa') as number;

  it('is H when our seed-home team wins, regardless of ESPN home/away', () => {
    // ESPN matches seed orientation here.
    const aligned: EspnEvent = {
      homeName: 'Mexico',
      awayName: 'South Africa',
      homeId: mexId,
      awayId: rsaId,
      homeScore: 2,
      awayScore: 0,
      completed: true,
      state: 'post',
      winnerId: mexId,
      round: 'group',
    };
    expect(groupResult(aligned, { homeId: mexId })).toBe('H');

    // ESPN flips home/away vs seed (seed home = Mexico). Mexico still wins → H.
    const flipped: EspnEvent = {
      ...aligned,
      homeName: 'South Africa',
      awayName: 'Mexico',
      homeId: rsaId,
      awayId: mexId,
      homeScore: 0,
      awayScore: 2,
    };
    expect(groupResult(flipped, { homeId: mexId })).toBe('H');
  });

  it('is D on equal scores', () => {
    const draw: EspnEvent = {
      homeName: 'Mexico',
      awayName: 'South Africa',
      homeId: mexId,
      awayId: rsaId,
      homeScore: 1,
      awayScore: 1,
      completed: true,
      state: 'post',
      winnerId: null,
      round: 'group',
    };
    expect(groupResult(draw, { homeId: mexId })).toBe('D');
  });
});

describe('computeQualifierIds', () => {
  it('returns null until all 72 group results exist', () => {
    const partial = new Map<number, Result>([[1, 'H']]);
    expect(computeQualifierIds(partial)).toBeNull();
  });

  it('selects exactly 32 qualifiers (12 winners + 12 runners-up + 8 thirds)', () => {
    const all = new Map<number, Result>(SEED_MATCHES.map((m) => [m.id, 'H' as Result]));
    const q = computeQualifierIds(all);
    expect(q).not.toBeNull();
    expect(q?.size).toBe(32);
  });
});

describe('knockoutEffect', () => {
  const a = teamIdFromName('Mexico') as number;
  const b = teamIdFromName('Brazil') as number;
  const base: EspnEvent = {
    homeName: 'Mexico',
    awayName: 'Brazil',
    homeId: a,
    awayId: b,
    homeScore: 1,
    awayScore: 0,
    completed: true,
    state: 'post',
    winnerId: a,
    round: 1,
  };

  it('advances the R32 winner and eliminates the loser', () => {
    expect(knockoutEffect(base)).toEqual({ reach: 1, winnerId: a, loserId: b });
  });

  it('maps the Final winner to champion (reach 5 → stage 6)', () => {
    const eff = knockoutEffect({ ...base, round: 5 });
    expect(eff).toEqual({ reach: 5, winnerId: a, loserId: b });
    expect((eff?.reach ?? 0) + 1).toBe(6);
  });

  it('ignores group, third-place, unfinished, and unmapped games', () => {
    expect(knockoutEffect({ ...base, round: 'group' })).toBeNull();
    expect(knockoutEffect({ ...base, round: 'third' })).toBeNull();
    expect(knockoutEffect({ ...base, completed: false })).toBeNull();
    expect(knockoutEffect({ ...base, homeId: null })).toBeNull();
  });
});

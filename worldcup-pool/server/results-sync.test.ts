import { describe, expect, it } from 'vitest';
import { SEED_MATCHES } from './seed-data';
import type { EspnEvent, Result } from './results-sync';
import {
  computeQualifierIds,
  easternDate,
  groupResult,
  knockoutEffect,
  knockoutRoundForDate,
  parseEspnDay,
  teamIdFromName,
} from './results-sync';

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
    expect(e.espnId).toBeNull(); // fixture events carry no id
  });

  it('captures the ESPN event id and a knockout round with a placeholder side', () => {
    const events = parseEspnDay({
      events: [
        {
          id: '760502',
          name: 'Round of 32 1 Winner vs Round of 32 3 Winner',
          shortName: 'RD32 @ RD32',
          date: '2026-07-04T19:00Z',
          competitions: [
            {
              status: { type: { state: 'pre', completed: false } },
              notes: [{ headline: 'FIFA World Cup, Round of 16' }],
              competitors: [
                { homeAway: 'home', score: '', team: { displayName: 'Round of 32 1 Winner' } },
                { homeAway: 'away', score: '', team: { displayName: 'Round of 32 3 Winner' } },
              ],
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].espnId).toBe('760502');
    expect(events[0].round).toBe(2); // Round of 16
    expect(events[0].homeId).toBeNull(); // unresolved placeholder slot
  });

  it('rounds a finished knockout game from its date when ESPN gives no round label', () => {
    // Mirrors the real R32 payload: notes [], name is just the teams.
    const [e] = parseEspnDay({
      events: [
        {
          id: '760400',
          name: 'Canada at South Africa',
          shortName: 'CAN @ RSA',
          date: '2026-06-28T19:00Z',
          competitions: [
            {
              status: { type: { state: 'post', completed: true } },
              notes: [],
              competitors: [
                { homeAway: 'home', score: '0', winner: false, team: { displayName: 'South Africa' } },
                { homeAway: 'away', score: '1', winner: true, team: { displayName: 'Canada' } },
              ],
            },
          ],
        },
      ],
    });
    expect(e.round).toBe(1); // R32 from the date, despite no round text
    // …and that makes knockout progression actually fire for the winner.
    const eff = knockoutEffect(e);
    expect(eff).toEqual({ reach: 1, winnerId: teamIdFromName('Canada'), loserId: teamIdFromName('South Africa') });
  });
});

describe('knockoutRoundForDate', () => {
  it('maps fixed knockout dates to rounds and ignores placeholder feeder text', () => {
    expect(knockoutRoundForDate('2026-06-28')).toBe('1'); // R32 start
    expect(knockoutRoundForDate('2026-07-03')).toBe('1'); // R32 end
    expect(knockoutRoundForDate('2026-07-04')).toBe('2'); // R16
    expect(knockoutRoundForDate('2026-07-10')).toBe('3'); // QF
    expect(knockoutRoundForDate('2026-07-15')).toBe('4'); // SF (ESPN labels these "Quarterfinal Winner")
    expect(knockoutRoundForDate('2026-07-18')).toBe('third'); // 3rd place ("Semifinal Loser")
    expect(knockoutRoundForDate('2026-07-19')).toBe('5'); // Final ("Semifinal Winner")
  });

  it('returns null for group-stage dates and knockout rest days', () => {
    expect(knockoutRoundForDate('2026-06-27')).toBeNull(); // last group day
    expect(knockoutRoundForDate('2026-07-08')).toBeNull(); // rest day before QFs
    expect(knockoutRoundForDate('2026-07-13')).toBeNull(); // rest day before SFs
  });
});

describe('easternDate', () => {
  it('buckets a UTC kickoff to its US-Eastern calendar day', () => {
    // 00:30 UTC on Jun 29 is still Jun 28 (8:30 PM EDT) in New York.
    expect(easternDate('2026-06-29T00:30:00Z')).toBe('2026-06-28');
    // 19:00 UTC on Jun 28 is 3:00 PM EDT, same day.
    expect(easternDate('2026-06-28T19:00:00Z')).toBe('2026-06-28');
  });
});

describe('groupResult orientation', () => {
  const mexId = teamIdFromName('Mexico') as number;
  const rsaId = teamIdFromName('South Africa') as number;

  it('is H when our seed-home team wins, regardless of ESPN home/away', () => {
    // ESPN matches seed orientation here.
    const aligned: EspnEvent = {
      espnId: null,
      homeName: 'Mexico',
      awayName: 'South Africa',
      homeId: mexId,
      awayId: rsaId,
      homeScore: 2,
      awayScore: 0,
      completed: true,
      state: 'post',
      kickoff: null,
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
      espnId: null,
      homeName: 'Mexico',
      awayName: 'South Africa',
      homeId: mexId,
      awayId: rsaId,
      homeScore: 1,
      awayScore: 1,
      completed: true,
      state: 'post',
      kickoff: null,
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
    espnId: '760502',
    homeName: 'Mexico',
    awayName: 'Brazil',
    homeId: a,
    awayId: b,
    homeScore: 1,
    awayScore: 0,
    completed: true,
    state: 'post',
    kickoff: null,
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

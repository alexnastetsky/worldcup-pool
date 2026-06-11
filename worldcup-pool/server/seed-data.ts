// 2026 FIFA World Cup group stage — final groups and schedule after the
// March 2026 playoffs (source: ESPN match schedule, fetched 2026-06-10).

export interface SeedTeam {
  id: number;
  name: string;
  group: string;
}

export interface SeedMatch {
  id: number; // official match number 1..72
  group: string;
  home: string;
  away: string;
  date: string; // YYYY-MM-DD
}

const GROUPS: Record<string, string[]> = {
  A: ['Mexico', 'South Africa', 'South Korea', 'Czechia'],
  B: ['Canada', 'Bosnia and Herzegovina', 'Qatar', 'Switzerland'],
  C: ['Brazil', 'Morocco', 'Haiti', 'Scotland'],
  D: ['United States', 'Paraguay', 'Australia', 'Türkiye'],
  E: ['Germany', 'Curaçao', 'Ivory Coast', 'Ecuador'],
  F: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'],
  G: ['Belgium', 'Egypt', 'Iran', 'New Zealand'],
  H: ['Spain', 'Cape Verde', 'Saudi Arabia', 'Uruguay'],
  I: ['France', 'Senegal', 'Iraq', 'Norway'],
  J: ['Argentina', 'Algeria', 'Austria', 'Jordan'],
  K: ['Portugal', 'DR Congo', 'Uzbekistan', 'Colombia'],
  L: ['England', 'Croatia', 'Ghana', 'Panama'],
};

export const SEED_TEAMS: SeedTeam[] = Object.entries(GROUPS).flatMap(([group, names], gi) =>
  names.map((name, ti) => ({ id: gi * 4 + ti + 1, name, group }))
);

type MatchTuple = [group: string, home: string, away: string, date: string];

const MATCHES: MatchTuple[] = [
  // Round 1
  ['A', 'Mexico', 'South Africa', '2026-06-11'],
  ['A', 'South Korea', 'Czechia', '2026-06-11'],
  ['B', 'Canada', 'Bosnia and Herzegovina', '2026-06-12'],
  ['D', 'United States', 'Paraguay', '2026-06-12'],
  ['B', 'Qatar', 'Switzerland', '2026-06-13'],
  ['C', 'Brazil', 'Morocco', '2026-06-13'],
  ['C', 'Haiti', 'Scotland', '2026-06-13'],
  ['D', 'Australia', 'Türkiye', '2026-06-13'],
  ['E', 'Germany', 'Curaçao', '2026-06-14'],
  ['F', 'Netherlands', 'Japan', '2026-06-14'],
  ['E', 'Ivory Coast', 'Ecuador', '2026-06-14'],
  ['F', 'Sweden', 'Tunisia', '2026-06-14'],
  ['H', 'Spain', 'Cape Verde', '2026-06-15'],
  ['G', 'Belgium', 'Egypt', '2026-06-15'],
  ['H', 'Saudi Arabia', 'Uruguay', '2026-06-15'],
  ['G', 'Iran', 'New Zealand', '2026-06-15'],
  ['I', 'France', 'Senegal', '2026-06-16'],
  ['I', 'Iraq', 'Norway', '2026-06-16'],
  ['J', 'Argentina', 'Algeria', '2026-06-16'],
  ['J', 'Austria', 'Jordan', '2026-06-16'],
  ['K', 'Portugal', 'DR Congo', '2026-06-17'],
  ['L', 'England', 'Croatia', '2026-06-17'],
  ['L', 'Ghana', 'Panama', '2026-06-17'],
  ['K', 'Uzbekistan', 'Colombia', '2026-06-17'],
  // Round 2
  ['A', 'Czechia', 'South Africa', '2026-06-18'],
  ['B', 'Switzerland', 'Bosnia and Herzegovina', '2026-06-18'],
  ['B', 'Canada', 'Qatar', '2026-06-18'],
  ['A', 'Mexico', 'South Korea', '2026-06-18'],
  ['D', 'United States', 'Australia', '2026-06-19'],
  ['C', 'Scotland', 'Morocco', '2026-06-19'],
  ['C', 'Brazil', 'Haiti', '2026-06-19'],
  ['D', 'Türkiye', 'Paraguay', '2026-06-19'],
  ['F', 'Netherlands', 'Sweden', '2026-06-20'],
  ['E', 'Germany', 'Ivory Coast', '2026-06-20'],
  ['E', 'Ecuador', 'Curaçao', '2026-06-20'],
  ['F', 'Tunisia', 'Japan', '2026-06-20'],
  ['H', 'Spain', 'Saudi Arabia', '2026-06-21'],
  ['G', 'Belgium', 'Iran', '2026-06-21'],
  ['H', 'Uruguay', 'Cape Verde', '2026-06-21'],
  ['G', 'New Zealand', 'Egypt', '2026-06-21'],
  ['J', 'Argentina', 'Austria', '2026-06-22'],
  ['I', 'France', 'Iraq', '2026-06-22'],
  ['I', 'Norway', 'Senegal', '2026-06-22'],
  ['J', 'Jordan', 'Algeria', '2026-06-22'],
  ['K', 'Portugal', 'Uzbekistan', '2026-06-23'],
  ['L', 'England', 'Ghana', '2026-06-23'],
  ['L', 'Panama', 'Croatia', '2026-06-23'],
  ['K', 'Colombia', 'DR Congo', '2026-06-23'],
  // Round 3
  ['B', 'Switzerland', 'Canada', '2026-06-24'],
  ['B', 'Bosnia and Herzegovina', 'Qatar', '2026-06-24'],
  ['C', 'Scotland', 'Brazil', '2026-06-24'],
  ['C', 'Morocco', 'Haiti', '2026-06-24'],
  ['A', 'Czechia', 'Mexico', '2026-06-24'],
  ['A', 'South Africa', 'South Korea', '2026-06-24'],
  ['E', 'Ecuador', 'Germany', '2026-06-25'],
  ['E', 'Curaçao', 'Ivory Coast', '2026-06-25'],
  ['F', 'Japan', 'Sweden', '2026-06-25'],
  ['F', 'Tunisia', 'Netherlands', '2026-06-25'],
  ['D', 'Türkiye', 'United States', '2026-06-25'],
  ['D', 'Paraguay', 'Australia', '2026-06-25'],
  ['I', 'Norway', 'France', '2026-06-26'],
  ['I', 'Senegal', 'Iraq', '2026-06-26'],
  ['H', 'Cape Verde', 'Saudi Arabia', '2026-06-26'],
  ['H', 'Uruguay', 'Spain', '2026-06-26'],
  ['G', 'Egypt', 'Iran', '2026-06-26'],
  ['G', 'New Zealand', 'Belgium', '2026-06-26'],
  ['L', 'Panama', 'England', '2026-06-27'],
  ['L', 'Croatia', 'Ghana', '2026-06-27'],
  ['K', 'Colombia', 'Portugal', '2026-06-27'],
  ['K', 'DR Congo', 'Uzbekistan', '2026-06-27'],
  ['J', 'Algeria', 'Austria', '2026-06-27'],
  ['J', 'Jordan', 'Argentina', '2026-06-27'],
];

export const SEED_MATCHES: SeedMatch[] = MATCHES.map(([group, home, away, date], i) => ({
  id: i + 1,
  group,
  home,
  away,
  date,
}));

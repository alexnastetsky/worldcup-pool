export interface Me {
  email: string;
  isAdmin: boolean;
  locked: boolean;
  displayName: string | null;
}

export interface Team {
  id: number;
  name: string;
  group_letter: string;
  // null = fate not yet decided; 0 = eliminated in group stage
  actual_stage: number | null;
  // true once the team is out of the tournament (stage is then final)
  eliminated: boolean;
}

export interface Match {
  id: number;
  group_letter: string;
  home_team_id: number;
  away_team_id: number;
  match_date: string;
  actual_result: 'H' | 'A' | 'D' | null;
  // live score/status mirrored from ESPN (display only)
  home_score: number | null;
  away_score: number | null;
  status: 'pre' | 'in' | 'post' | null;
  kickoff_at: string | null; // ISO kickoff datetime from ESPN
}

// A knockout (or third-place) fixture mirrored from ESPN — display only, never
// picked. home_id/away_id resolve from null once the slot's team is decided;
// home_name/away_name carry the ESPN label (real team or placeholder slot).
export interface KnockoutMatch {
  espn_id: string;
  round: string; // '1'..'5' (R32..Final) or 'third'
  match_date: string;
  kickoff_at: string | null;
  home_name: string;
  away_name: string;
  home_id: number | null;
  away_id: number | null;
  home_score: number | null;
  away_score: number | null;
  status: 'pre' | 'in' | 'post' | null;
}

// Human label for a KnockoutMatch.round value.
export const ROUND_LABELS: Record<string, string> = {
  '1': 'Round of 32',
  '2': 'Round of 16',
  '3': 'Quarterfinal',
  '4': 'Semifinal',
  '5': 'Final',
  third: 'Third-place',
};

export interface Fixtures {
  teams: Team[];
  matches: Match[];
  knockout: KnockoutMatch[];
}

export type Pick = 'H' | 'A' | 'D';

export interface StandingRow {
  email: string;
  display_name: string;
  group_points: number;
  bracket_points: number;
  bracket_prev: number; // bracket points banked before the current knockout round
  bracket_current: number; // bracket points gained from the round currently in play
  total_points: number;
  max_points: number;
  contrarian: number; // "bold calls" tiebreaker: correct picks weighted by how many others missed them
  prev_rank: number | null; // rank at the last daily snapshot, for movement arrows
}

export interface ParticipantStatus {
  email: string;
  display_name: string;
  match_count: number;
  bracket_count: number;
  updated_at: string;
}

export const STAGE_NAMES = [
  'Out in groups',
  'Round of 32',
  'Round of 16',
  'Quarterfinals',
  'Semifinals',
  'Final',
  'Champion',
] as const;

export const STAGE_SHORT = ['—', 'R32', 'R16', 'QF', 'SF', 'F', '🏆'] as const;

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// FIFA 3-letter country codes, keyed by exact seed team name. Used to keep the
// many-player comparison grid narrow enough to fit on one screen.
export const TEAM_CODES: Record<string, string> = {
  Mexico: 'MEX',
  'South Africa': 'RSA',
  'South Korea': 'KOR',
  Czechia: 'CZE',
  Canada: 'CAN',
  'Bosnia and Herzegovina': 'BIH',
  Qatar: 'QAT',
  Switzerland: 'SUI',
  Brazil: 'BRA',
  Morocco: 'MAR',
  Haiti: 'HAI',
  Scotland: 'SCO',
  'United States': 'USA',
  Paraguay: 'PAR',
  Australia: 'AUS',
  Türkiye: 'TUR',
  Germany: 'GER',
  Curaçao: 'CUW',
  'Ivory Coast': 'CIV',
  Ecuador: 'ECU',
  Netherlands: 'NED',
  Japan: 'JPN',
  Sweden: 'SWE',
  Tunisia: 'TUN',
  Belgium: 'BEL',
  Egypt: 'EGY',
  Iran: 'IRN',
  'New Zealand': 'NZL',
  Spain: 'ESP',
  'Cape Verde': 'CPV',
  'Saudi Arabia': 'KSA',
  Uruguay: 'URU',
  France: 'FRA',
  Senegal: 'SEN',
  Iraq: 'IRQ',
  Norway: 'NOR',
  Argentina: 'ARG',
  Algeria: 'ALG',
  Austria: 'AUT',
  Jordan: 'JOR',
  Portugal: 'POR',
  'DR Congo': 'COD',
  Uzbekistan: 'UZB',
  Colombia: 'COL',
  England: 'ENG',
  Croatia: 'CRO',
  Ghana: 'GHA',
  Panama: 'PAN',
};

export function teamCode(name: string): string {
  return TEAM_CODES[name] ?? name.slice(0, 3).toUpperCase();
}

// Cumulative bracket points by stage reached: R32 1, R16 2, QF 3, SF 5,
// Final 8, Champion 12 → running totals. Mirrors the server's scoring SQL.
export const CUM_POINTS = [0, 1, 3, 6, 11, 19, 31] as const;

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function sendJson(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Request failed: ${res.status}`);
  }
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatLongDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

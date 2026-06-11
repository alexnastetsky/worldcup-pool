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
}

export interface Match {
  id: number;
  group_letter: string;
  home_team_id: number;
  away_team_id: number;
  match_date: string;
  actual_result: 'H' | 'A' | 'D' | null;
}

export interface Fixtures {
  teams: Team[];
  matches: Match[];
}

export type Pick = 'H' | 'A' | 'D';

export interface StandingRow {
  email: string;
  display_name: string;
  group_points: number;
  bracket_points: number;
  total_points: number;
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

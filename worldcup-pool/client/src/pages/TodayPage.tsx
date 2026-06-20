import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Match, Me, Pick, Team } from '../lib/pool';
import { fetchJson, formatLongDate, teamCode } from '../lib/pool';

interface AllPicksPayload {
  participants: { email: string; display_name: string }[];
  matchPicks: { email: string; match_id: number; pick: Pick }[];
  bracketPicks: { email: string; team_id: number; predicted_stage: number }[];
}

// Current US Eastern calendar date as YYYY-MM-DD — the whole app keys "today"
// off Eastern time, not the viewer's zone or UTC.
function easternToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Shift a YYYY-MM-DD date by n days (noon-UTC anchor avoids TZ edge cases).
function shiftDate(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Kickoff time in US Eastern, e.g. "3:00 PM ET".
function kickoffTime(iso: string | null): string | null {
  if (!iso) return null;
  return (
    new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' ET'
  );
}

// Today (Eastern), or the next/last matchday with games, as YYYY-MM-DD.
function focusMatchDate(matches: Match[]): string | null {
  const dates = [...new Set(matches.map((m) => m.match_date))].sort();
  if (dates.length === 0) return null;
  const today = easternToday();
  if (dates.includes(today)) return today;
  return dates.find((d) => d >= today) ?? dates[dates.length - 1];
}

interface DaySection {
  label: string | null; // 'Yesterday' | 'Today' | 'Tomorrow' | null (fallback)
  date: string;
  matches: Match[];
}

export function TodayPage({ me }: { me: Me }) {
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [allPicks, setAllPicks] = useState<AllPicksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    // Picks are only visible once locked; before that just show the fixtures.
    Promise.all([
      fetchJson<Fixtures>('/api/fixtures'),
      me.locked ? fetchJson<AllPicksPayload>('/api/predictions/all') : Promise.resolve(null),
    ])
      .then(([fx, all]) => {
        setFixtures(fx);
        setAllPicks(all);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load matches'));
  }, [me.locked]);

  // Land on the Today section once data is in (Yesterday sits above it).
  useEffect(() => {
    if (fixtures && !scrolledRef.current && todayRef.current) {
      scrolledRef.current = true;
      todayRef.current.scrollIntoView({ block: 'start' });
    }
  });

  if (error) return <p className="text-destructive text-center mt-12">{error}</p>;
  if (!fixtures) return <Skeleton className="h-64 w-full max-w-2xl mx-auto" />;

  const teamById = new Map<number, Team>(fixtures.teams.map((t) => [t.id, t]));
  const today = easternToday();

  const matchesOn = (date: string) => fixtures.matches.filter((m) => m.match_date === date);
  let sections: DaySection[] = [
    { label: 'Yesterday', date: shiftDate(today, -1), matches: [] },
    { label: 'Today', date: today, matches: [] },
    { label: 'Tomorrow', date: shiftDate(today, 1), matches: [] },
  ]
    .map((s) => ({ ...s, matches: matchesOn(s.date) }))
    .filter((s) => s.matches.length > 0);

  // Off-day window: fall back to the nearest matchday so the page isn't empty.
  if (sections.length === 0) {
    const focus = focusMatchDate(fixtures.matches);
    if (focus) sections = [{ label: null, date: focus, matches: matchesOn(focus) }];
  }

  const pickMap = new Map<string, Pick>();
  allPicks?.matchPicks.forEach((p) => pickMap.set(`${p.email}|${p.match_id}`, p.pick));
  const pickLabel = (pick: Pick, m: Match) =>
    pick === 'D' ? 'draw' : teamCode(teamById.get(pick === 'H' ? m.home_team_id : m.away_team_id)?.name ?? '?');

  const renderRow = (m: Match) => {
    const home = teamById.get(m.home_team_id)?.name ?? '?';
    const away = teamById.get(m.away_team_id)?.name ?? '?';
    const live = m.status === 'in';
    const final = m.status === 'post';
    const score = m.home_score !== null && m.away_score !== null ? `${m.home_score}–${m.away_score}` : null;
    const kickoff = kickoffTime(m.kickoff_at);
    return (
      <div key={m.id} className="border-b pb-2 last:border-0 last:pb-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs text-muted-foreground w-4 shrink-0">{m.group_letter}</span>
          <span className="flex-1 min-w-0 truncate">
            <span className="sm:hidden">
              {teamCode(home)} – {teamCode(away)}
            </span>
            <span className="hidden sm:inline">
              {home} – {away}
            </span>
          </span>
          {score && <span className="font-semibold tabular-nums">{score}</span>}
          {live ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200">
              LIVE
            </span>
          ) : final ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-muted text-muted-foreground">
              Final
            </span>
          ) : kickoff ? (
            <span className="text-xs text-muted-foreground tabular-nums shrink-0 whitespace-nowrap">{kickoff}</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 border text-muted-foreground">
              Scheduled
            </span>
          )}
        </div>
        {allPicks && (
          <div className="flex flex-wrap sm:grid sm:grid-cols-4 gap-1 mt-1 pl-6">
            {allPicks.participants.map((p) => {
              const pick = pickMap.get(`${p.email}|${m.id}`);
              if (pick === undefined) return null;
              const correct = m.actual_result !== null && pick === m.actual_result;
              return (
                <span
                  key={p.email}
                  title={`${p.display_name}: ${pickLabel(pick, m)}`}
                  className={`text-[10px] px-1.5 py-0.5 rounded border sm:min-w-0 sm:truncate ${
                    correct ? 'bg-green-100 dark:bg-green-900 border-green-300' : 'text-muted-foreground'
                  }`}
                >
                  {p.display_name}: {pickLabel(pick, m)}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex justify-end">
        <a
          href="https://kingdoggydog.github.io/worldcup2026/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
        >
          View full schedule ↗
        </a>
      </div>

      {sections.length === 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">No matches scheduled.</p>
          </CardContent>
        </Card>
      )}

      {sections.map((s) => {
        const isToday = s.label === 'Today';
        return (
          <div key={s.date} ref={isToday ? todayRef : undefined} className="scroll-mt-4">
            <Card className={isToday ? 'border-primary border-2 shadow-md' : ''}>
              <CardHeader>
                <CardTitle className={isToday ? '' : 'text-base text-muted-foreground'}>
                  {s.label ? `${s.label} · ` : ''}
                  {formatLongDate(s.date)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">{s.matches.map(renderRow)}</CardContent>
            </Card>
          </div>
        );
      })}
    </div>
  );
}

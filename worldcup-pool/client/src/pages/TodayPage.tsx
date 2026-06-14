import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Match, Me, Pick, Team } from '../lib/pool';
import { fetchJson, formatLongDate, teamCode } from '../lib/pool';

interface AllPicksPayload {
  participants: { email: string; display_name: string }[];
  matchPicks: { email: string; match_id: number; pick: Pick }[];
  bracketPicks: { email: string; team_id: number; predicted_stage: number }[];
}

// Today, or the next/last matchday with games, as YYYY-MM-DD.
function focusMatchDate(matches: Match[]): string | null {
  const dates = [...new Set(matches.map((m) => m.match_date))].sort();
  if (dates.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (dates.includes(today)) return today;
  return dates.find((d) => d >= today) ?? dates[dates.length - 1];
}

export function TodayPage({ me }: { me: Me }) {
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [allPicks, setAllPicks] = useState<AllPicksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) return <p className="text-destructive text-center mt-12">{error}</p>;
  if (!fixtures) return <Skeleton className="h-64 w-full max-w-2xl mx-auto" />;

  const focusDate = focusMatchDate(fixtures.matches);
  const matches = fixtures.matches.filter((m) => m.match_date === focusDate);
  const teamById = new Map<number, Team>(fixtures.teams.map((t) => [t.id, t]));
  const today = new Date().toISOString().slice(0, 10);
  const heading =
    focusDate === today ? "Today's Matches" : focusDate ? `Matches — ${formatLongDate(focusDate)}` : 'Matches';

  const pickMap = new Map<string, Pick>();
  allPicks?.matchPicks.forEach((p) => pickMap.set(`${p.email}|${p.match_id}`, p.pick));
  const pickLabel = (pick: Pick, m: Match) =>
    pick === 'D' ? 'draw' : teamCode(teamById.get(pick === 'H' ? m.home_team_id : m.away_team_id)?.name ?? '?');

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>{heading}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {matches.length === 0 && <p className="text-sm text-muted-foreground">No matches scheduled.</p>}
          {matches.map((m) => {
            const home = teamById.get(m.home_team_id)?.name ?? '?';
            const away = teamById.get(m.away_team_id)?.name ?? '?';
            const live = m.status === 'in';
            const final = m.status === 'post';
            const score = m.home_score !== null && m.away_score !== null ? `${m.home_score}–${m.away_score}` : null;
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
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                      live
                        ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
                        : final
                          ? 'bg-muted text-muted-foreground'
                          : 'border text-muted-foreground'
                    }`}
                  >
                    {live ? 'LIVE' : final ? 'Final' : 'Scheduled'}
                  </span>
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
          })}
        </CardContent>
      </Card>
    </div>
  );
}

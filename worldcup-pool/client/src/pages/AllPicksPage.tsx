import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Me, Pick, Team } from '../lib/pool';
import { STAGE_SHORT, fetchJson } from '../lib/pool';

interface AllPicksPayload {
  participants: { email: string; display_name: string }[];
  matchPicks: { email: string; match_id: number; pick: Pick }[];
  bracketPicks: { email: string; team_id: number; predicted_stage: number }[];
}

export function AllPicksPage({ me }: { me: Me }) {
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [data, setData] = useState<AllPicksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me.locked) return;
    Promise.all([fetchJson<Fixtures>('/api/fixtures'), fetchJson<AllPicksPayload>('/api/predictions/all')])
      .then(([fx, all]) => {
        setFixtures(fx);
        setData(all);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load picks'));
  }, [me.locked]);

  const matchPickMap = useMemo(() => {
    const map = new Map<string, Pick>();
    data?.matchPicks.forEach((p) => map.set(`${p.email}|${p.match_id}`, p.pick));
    return map;
  }, [data]);

  const bracketPickMap = useMemo(() => {
    const map = new Map<string, number>();
    data?.bracketPicks.forEach((p) => map.set(`${p.email}|${p.team_id}`, p.predicted_stage));
    return map;
  }, [data]);

  if (!me.locked) {
    return (
      <p className="text-center text-muted-foreground mt-12">
        Everyone&apos;s picks become visible once submissions are locked.
      </p>
    );
  }

  if (error) return <p className="text-destructive text-center mt-12">{error}</p>;
  if (!fixtures || !data) return <Skeleton className="h-64 w-full max-w-4xl mx-auto" />;

  const teamById = new Map<number, Team>(fixtures.teams.map((t) => [t.id, t]));
  const players = data.participants;

  const pickLabel = (pick: Pick, m: { home_team_id: number; away_team_id: number }) => {
    if (pick === 'D') return 'Draw';
    const teamId = pick === 'H' ? m.home_team_id : m.away_team_id;
    return teamById.get(teamId)?.name ?? '?';
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Match Picks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Each cell shows the team picked to win (or Draw). Green = correct (result is in).
          </p>
          <div className="overflow-x-auto">
            <table className="text-sm min-w-full">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5 pr-3 whitespace-nowrap">Match</th>
                  <th className="py-1.5 pr-3">Result</th>
                  {players.map((p) => (
                    <th key={p.email} className="py-1.5 px-2 whitespace-nowrap">
                      {p.display_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fixtures.matches.map((m) => (
                  <tr key={m.id} className="border-b last:border-b-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className="text-muted-foreground mr-1">{m.group_letter}</span>
                      {teamById.get(m.home_team_id)?.name} – {teamById.get(m.away_team_id)?.name}
                    </td>
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap">
                      {m.actual_result === null ? '·' : pickLabel(m.actual_result, m)}
                    </td>
                    {players.map((p) => {
                      const pick = matchPickMap.get(`${p.email}|${m.id}`);
                      const correct = pick !== undefined && m.actual_result !== null && pick === m.actual_result;
                      return (
                        <td
                          key={p.email}
                          className={`py-1.5 px-2 text-center whitespace-nowrap ${correct ? 'bg-green-100 dark:bg-green-900 font-semibold' : ''}`}
                        >
                          {pick === undefined ? '·' : pickLabel(pick, m)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bracket Picks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Predicted furthest stage per team. — = out in groups, R32/R16/QF/SF/F, 🏆 = champion. Reached shows · until
            a team&apos;s fate is decided.
          </p>
          <div className="overflow-x-auto">
            <table className="text-sm min-w-full">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5 pr-3">Team</th>
                  <th className="py-1.5 pr-3">Reached</th>
                  {players.map((p) => (
                    <th key={p.email} className="py-1.5 px-2 whitespace-nowrap">
                      {p.display_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fixtures.teams.map((t) => (
                  <tr key={t.id} className="border-b last:border-b-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className="text-muted-foreground mr-1">{t.group_letter}</span>
                      {t.name}
                    </td>
                    <td className="py-1.5 pr-3 font-medium">
                      {t.actual_stage === null ? '·' : STAGE_SHORT[t.actual_stage]}
                    </td>
                    {players.map((p) => {
                      const stage = bracketPickMap.get(`${p.email}|${t.id}`);
                      return (
                        <td key={p.email} className="py-1.5 px-2 text-center">
                          {stage === undefined ? '·' : STAGE_SHORT[stage]}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

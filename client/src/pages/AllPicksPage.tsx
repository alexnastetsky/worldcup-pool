import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Me, Pick, Team } from '../lib/pool';
import { STAGE_NAMES, STAGE_SHORT, fetchJson, teamCode } from '../lib/pool';
import { actualBracket, bracketProgress } from '../lib/bracket';
import { BracketCard } from './BracketCard';
import { Toc } from '../components/Toc';

interface AllPicksPayload {
  participants: { email: string; display_name: string }[];
  matchPicks: { email: string; match_id: number; pick: Pick }[];
  bracketPicks: { email: string; team_id: number; predicted_stage: number }[];
}

export function AllPicksPage({ me }: { me: Me }) {
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [data, setData] = useState<AllPicksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!me.locked) return;
    Promise.all([fetchJson<Fixtures>('/worldcup/api/fixtures'), fetchJson<AllPicksPayload>('/worldcup/api/predictions/all')])
      .then(([fx, all]) => {
        setFixtures(fx);
        setData(all);
        // Show every player's column by default; the picker can narrow it.
        setSelected(new Set(all.participants.map((p) => p.email)));
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

  // The real tournament bracket: R32 seeded from the actual ESPN matchups,
  // winners filled in from each team's recorded furthest stage.
  const realBracket = useMemo(() => (fixtures ? actualBracket(fixtures) : null), [fixtures]);

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
  const shownPlayers = players.filter((p) => selected.has(p.email));

  const togglePlayer = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  // Full name (for hover/title) and short code (for the grid cell).
  const pickFull = (pick: Pick, m: { home_team_id: number; away_team_id: number }) => {
    if (pick === 'D') return 'Draw';
    const teamId = pick === 'H' ? m.home_team_id : m.away_team_id;
    return teamById.get(teamId)?.name ?? '?';
  };
  const pickShort = (pick: Pick, m: { home_team_id: number; away_team_id: number }) =>
    pick === 'D' ? 'draw' : teamCode(pickFull(pick, m));

  // Date of a team's match in a given knockout round, for ordering.
  const knockoutDate = new Map<string, string>();
  for (const k of fixtures.knockout) {
    if (k.home_id != null) knockoutDate.set(`${k.round}|${k.home_id}`, k.match_date);
    if (k.away_id != null) knockoutDate.set(`${k.round}|${k.away_id}`, k.match_date);
  }
  // The team plays round s on its way to stage s (champions' last game is the Final, round 5).
  const roundDateFor = (s: number, teamId: number) => knockoutDate.get(`${s >= 6 ? 5 : s}|${teamId}`) ?? '';

  // For a knockout stage s (1=R32 … 6=Champion): the teams that actually
  // reached it, each with the shown players who predicted them that far or
  // deeper (cumulative, matching bracket scoring). The Round of 32 is ordered
  // least-picked first (surfaces the surprise/contrarian teams); later rounds by
  // the team's match date in that round.
  const callersForStage = (s: number) => {
    const rows = fixtures.teams
      .filter((t) => t.actual_stage != null && t.actual_stage >= s)
      .map((t) => ({
        team: t,
        callers: shownPlayers.filter((p) => (bracketPickMap.get(`${p.email}|${t.id}`) ?? 0) >= s),
      }));
    if (s === 1) {
      rows.sort((a, b) => a.callers.length - b.callers.length || a.team.name.localeCompare(b.team.name));
    } else {
      rows.sort(
        (a, b) =>
          roundDateFor(s, a.team.id).localeCompare(roundDateFor(s, b.team.id)) ||
          a.team.name.localeCompare(b.team.name)
      );
    }
    return rows;
  };
  // Stages with at least one team there yet, deepest first.
  const reachedStages = [6, 5, 4, 3, 2, 1].filter((s) => callersForStage(s).length > 0);

  return (
    <div className="space-y-6">
      <Toc
        items={[
          { id: 'players-picker', label: 'Players' },
          { id: 'match-picks', label: 'Match Picks' },
          { id: 'bracket-picks', label: 'Bracket Picks' },
          { id: 'stage-callers', label: 'Who Called It' },
          { id: 'real-bracket', label: 'Tournament Bracket' },
        ]}
      />
      <div className="max-w-6xl mx-auto space-y-6">
        <Card id="players-picker" className="scroll-mt-14">
          <CardHeader>
            <CardTitle>
              Players{' '}
              <span className="text-sm font-normal text-muted-foreground">
                — showing {shownPlayers.length} of {players.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-1.5">
              {players.map((p) => {
                const on = selected.has(p.email);
                return (
                  <button
                    key={p.email}
                    type="button"
                    onClick={() => togglePlayer(p.email)}
                    aria-pressed={on}
                    className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                      on
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {p.display_name}
                    {p.email === me.email ? ' (you)' : ''}
                  </button>
                );
              })}
              <span className="mx-1 text-muted-foreground text-xs">·</span>
              <button
                type="button"
                onClick={() => setSelected(new Set(players.map((p) => p.email)))}
                className="px-2.5 py-1 rounded-full border text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set(players.some((p) => p.email === me.email) ? [me.email] : []))}
                className="px-2.5 py-1 rounded-full border text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Just me
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Pick whose columns to show in the tables below.</p>
          </CardContent>
        </Card>

        <Card id="match-picks" className="scroll-mt-14">
          <CardHeader>
            <CardTitle>Match Picks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Cells show the FIFA country code of the team picked to win, or &quot;draw&quot; — hover for the full name.
              Green = correct (result is in).
            </p>
            <p className="text-[10px] text-muted-foreground sm:hidden mb-1">Swipe sideways to see more →</p>
            <div className="max-h-[70vh] overflow-auto">
              <table className="text-xs min-w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="sticky top-0 z-20 bg-card border-b py-1.5 pr-2 whitespace-nowrap">Match</th>
                    <th className="sticky top-0 z-20 bg-card border-b py-1.5 pr-2">Res</th>
                    {shownPlayers.map((p) => (
                      <th
                        key={p.email}
                        title={p.display_name}
                        className="sticky top-0 z-20 bg-card border-b py-1.5 px-1.5 text-center max-w-[68px] truncate"
                      >
                        {p.display_name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fixtures.matches.map((m) => (
                    <tr key={m.id} className="border-b last:border-b-0">
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        <span className="text-muted-foreground mr-1">{m.group_letter}</span>
                        <span className="sm:hidden">
                          {teamCode(teamById.get(m.home_team_id)?.name ?? '?')} –{' '}
                          {teamCode(teamById.get(m.away_team_id)?.name ?? '?')}
                        </span>
                        <span className="hidden sm:inline">
                          {teamById.get(m.home_team_id)?.name} – {teamById.get(m.away_team_id)?.name}
                        </span>
                      </td>
                      <td
                        className="py-1.5 pr-2 font-medium whitespace-nowrap"
                        title={m.actual_result === null ? undefined : pickFull(m.actual_result, m)}
                      >
                        {m.actual_result === null ? '·' : pickShort(m.actual_result, m)}
                      </td>
                      {shownPlayers.map((p) => {
                        const pick = matchPickMap.get(`${p.email}|${m.id}`);
                        const correct = pick !== undefined && m.actual_result !== null && pick === m.actual_result;
                        return (
                          <td
                            key={p.email}
                            title={pick === undefined ? undefined : pickFull(pick, m)}
                            className={`py-1.5 px-1.5 text-center whitespace-nowrap ${correct ? 'bg-green-100 dark:bg-green-900 font-semibold' : ''}`}
                          >
                            {pick === undefined ? '·' : pickShort(pick, m)}
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

        <Card id="bracket-picks" className="scroll-mt-14">
          <CardHeader>
            <CardTitle>Bracket Picks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Predicted furthest stage per team. — = out in groups, R32/R16/QF/SF/F, 🏆 = champion. Reached shows ·
              until a team&apos;s fate is decided.
            </p>
            <p className="text-[10px] text-muted-foreground sm:hidden mb-1">Swipe sideways to see more →</p>
            <div className="max-h-[70vh] overflow-auto">
              <table className="text-xs min-w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="sticky top-0 z-20 bg-card border-b py-1.5 pr-2">Team</th>
                    <th className="sticky top-0 z-20 bg-card border-b py-1.5 pr-2">Reached</th>
                    {shownPlayers.map((p) => (
                      <th
                        key={p.email}
                        title={p.display_name}
                        className="sticky top-0 z-20 bg-card border-b py-1.5 px-1.5 text-center max-w-[68px] truncate"
                      >
                        {p.display_name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fixtures.teams.map((t) => (
                    <tr key={t.id} className="border-b last:border-b-0">
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        <span className="text-muted-foreground mr-1">{t.group_letter}</span>
                        <span className="sm:hidden">{teamCode(t.name)}</span>
                        <span className="hidden sm:inline">{t.name}</span>
                      </td>
                      <td className="py-1.5 pr-2 font-medium">
                        {t.actual_stage === null ? '·' : STAGE_SHORT[t.actual_stage]}
                      </td>
                      {shownPlayers.map((p) => {
                        const stage = bracketPickMap.get(`${p.email}|${t.id}`);
                        return (
                          <td key={p.email} className="py-1.5 px-1.5 text-center">
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

        <Card id="stage-callers" className="scroll-mt-14">
          <CardHeader>
            <CardTitle>Who Called It</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              For each knockout stage, the teams that reached it and who predicted them that far (or deeper).
            </p>
            {reachedStages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Appears once teams start reaching the knockout rounds.</p>
            ) : (
              <div className="space-y-5">
                {reachedStages.map((s) => (
                  <div key={s}>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      {STAGE_NAMES[s]}
                      <span className="text-[10px] font-normal text-muted-foreground border rounded px-1 py-0.5">
                        {STAGE_SHORT[s]}
                      </span>
                    </h3>
                    <div className="space-y-1.5">
                      {callersForStage(s).map(({ team, callers }) => (
                        <div key={team.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b pb-1.5 last:border-0">
                          <span className="text-sm font-medium whitespace-nowrap">
                            <span className="text-muted-foreground mr-1">{team.group_letter}</span>
                            <span className="sm:hidden">{teamCode(team.name)}</span>
                            <span className="hidden sm:inline">{team.name}</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {callers.length}/{shownPlayers.length}
                          </span>
                          <span className="flex flex-wrap gap-1">
                            {callers.length === 0 ? (
                              <span className="text-[10px] text-muted-foreground italic">no one</span>
                            ) : (
                              callers.map((p) => (
                                <span
                                  key={p.email}
                                  className="text-[10px] px-1.5 py-0.5 rounded border bg-green-100 dark:bg-green-900 border-green-300"
                                >
                                  {p.display_name}
                                </span>
                              ))
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div id="real-bracket" className="max-w-[1180px] mx-auto scroll-mt-14">
        <BracketCard
          nodes={realBracket}
          teamById={teamById}
          locked
          decided={realBracket ? bracketProgress(realBracket).decided : 0}
          onPickWinner={() => undefined}
          title="Tournament Bracket (real results)"
          description="The actual bracket — official Round of 32 matchups, filling in with each result as the knockouts are played."
          emptyText="Appears once the Round of 32 matchups are set."
        />
      </div>
    </div>
  );
}

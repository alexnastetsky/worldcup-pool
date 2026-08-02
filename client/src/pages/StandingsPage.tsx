import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Me, Pick, StandingRow, Team } from '../lib/pool';
import { STAGE_SHORT, fetchJson } from '../lib/pool';
import { playerBreakdown } from '../lib/scoring';
import {
  bracketProgress,
  buildBracket,
  computeGroupStandings,
  computeQualifiers,
  winnersFromStages,
} from '../lib/bracket';
import { BracketCard } from './BracketCard';

interface AllPicksPayload {
  participants: { email: string; display_name: string }[];
  matchPicks: { email: string; match_id: number; pick: Pick }[];
  bracketPicks: { email: string; team_id: number; predicted_stage: number }[];
}

export function StandingsPage({ me }: { me: Me }) {
  const [rows, setRows] = useState<StandingRow[] | null>(null);
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [allPicks, setAllPicks] = useState<AllPicksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!me.locked) return;
    Promise.all([
      fetchJson<StandingRow[]>('/worldcup/api/standings'),
      fetchJson<Fixtures>('/worldcup/api/fixtures'),
      fetchJson<AllPicksPayload>('/worldcup/api/predictions/all'),
    ])
      .then(([standings, fx, all]) => {
        setRows(standings);
        setFixtures(fx);
        setAllPicks(all);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load standings'));
  }, [me.locked]);

  if (!me.locked) {
    return <p className="text-center text-muted-foreground mt-12">Standings appear once submissions are locked.</p>;
  }

  const champion = fixtures?.teams.find((t) => t.actual_stage === 6) ?? null;
  // Standard competition ranking (1, 2, 2, 4). Rows arrive pre-sorted by the
  // server cascade total → bracket → contrarian; only players identical on all
  // three share a rank. Matches the SQL RANK() for prev_rank so deltas line up.
  const rankKey = (r: StandingRow) => `${r.total_points}|${r.bracket_points}|${r.contrarian}`;
  const ranks: number[] = [];
  {
    let rank = 0;
    let prevKey: string | null = null;
    (rows ?? []).forEach((r, i) => {
      const key = rankKey(r);
      if (key !== prevKey) {
        rank = i + 1;
        prevKey = key;
      }
      ranks.push(rank);
    });
  }
  // Biggest climber(s) since the last daily snapshot — everyone tied for the
  // largest jump up.
  const climbers = (rows ?? [])
    .map((r, i) => ({ name: r.display_name, up: r.prev_rank !== null ? r.prev_rank - ranks[i] : 0 }))
    .filter((m) => m.up > 0);
  const topUp = climbers.reduce((mx, m) => Math.max(mx, m.up), 0);
  const movers = climbers.filter((m) => m.up === topUp);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {champion && rows && rows.length > 0 && <Podium rows={rows} championTeam={champion.name} />}

      <Card>
        <CardHeader>
          <CardTitle>Standings</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-destructive">{error}</p>}
          {!rows && !error && <Skeleton className="h-40 w-full" />}
          {rows && rows.length === 0 && <p className="text-muted-foreground">No participants yet.</p>}
          {rows && rows.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                Bracket shows points banked before this knockout round; the green{' '}
                <span className="text-green-600 font-medium">+N</span> is what the round in play has added so far. Max =
                points still reachable given eliminated teams and remaining matches. 🎯 = bold calls (correct picks
                weighted by how many others missed them), used to break ties on equal points. Click a row for the
                breakdown.
              </p>
              {movers.length > 0 && (
                <p className="text-xs mb-2">
                  📈 {movers.length > 1 ? 'Biggest movers' : 'Biggest mover'}:{' '}
                  <strong>{movers.map((m) => m.name).join(', ')}</strong>{' '}
                  <span className="text-green-600">▲{topUp}</span> since yesterday
                </p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-2 w-8">#</th>
                    <th className="py-2 pr-2">Player</th>
                    <th className="py-2 pr-2 text-right">
                      <span className="sm:hidden">Grp</span>
                      <span className="hidden sm:inline">Group</span>
                    </th>
                    <th className="py-2 pr-2 text-right">
                      <span className="sm:hidden">Brk</span>
                      <span className="hidden sm:inline">Bracket</span>
                    </th>
                    <th className="py-2 pr-2 text-right">
                      <span className="sm:hidden">Tot</span>
                      <span className="hidden sm:inline">Total</span>
                    </th>
                    <th
                      className="py-2 pr-2 text-right"
                      title="Bold calls — correct picks weighted by how many others missed them. Breaks ties on equal points."
                    >
                      🎯
                    </th>
                    <th className="py-2 text-right">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <Fragment key={r.email}>
                      <tr
                        className={`border-b cursor-pointer hover:bg-muted/50 ${r.email === me.email ? 'font-semibold' : ''}`}
                        onClick={() => setExpanded(expanded === r.email ? null : r.email)}
                      >
                        <td className="py-2 pr-2 whitespace-nowrap">
                          {ranks[i]}
                          <Movement prevRank={r.prev_rank} rank={ranks[i]} />
                        </td>
                        <td className="py-2 pr-2">
                          {expanded === r.email ? '▾ ' : '▸ '}
                          {r.display_name}
                        </td>
                        <td className="py-2 pr-2 text-right">{r.group_points}</td>
                        <td className="py-2 pr-2 text-right whitespace-nowrap tabular-nums">
                          {r.bracket_prev}
                          {r.bracket_current > 0 && (
                            <span className="ml-1 text-green-600 font-medium">+{r.bracket_current}</span>
                          )}
                        </td>
                        <td className="py-2 pr-2 text-right font-medium">{r.total_points}</td>
                        <td className="py-2 pr-2 text-right text-muted-foreground tabular-nums">{r.contrarian}</td>
                        <td className="py-2 text-right text-muted-foreground">{r.max_points}</td>
                      </tr>
                      {expanded === r.email && fixtures && allPicks && (
                        <tr className="border-b bg-muted/30">
                          <td colSpan={7} className="p-3">
                            <Breakdown email={r.email} fixtures={fixtures} allPicks={allPicks} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Movement({ prevRank, rank }: { prevRank: number | null; rank: number }) {
  if (prevRank === null) return null;
  const delta = prevRank - rank;
  if (delta === 0) return <span className="ml-1 text-muted-foreground/60 text-xs">–</span>;
  return (
    <span className={`ml-1 text-xs ${delta > 0 ? 'text-green-600' : 'text-destructive'}`}>
      {delta > 0 ? `▲${delta}` : `▼${-delta}`}
    </span>
  );
}

function Podium({ rows, championTeam }: { rows: StandingRow[]; championTeam: string }) {
  const top = rows.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <Card className="border-amber-300 dark:border-amber-700">
      <CardContent className="py-5 text-center space-y-3">
        <p className="text-lg font-semibold">🏆 Final Results — {championTeam} are World Champions!</p>
        <div className="flex justify-center items-end gap-3">
          {top.map((r, i) => (
            <div
              key={r.email}
              className={`rounded-lg border bg-background px-3 ${i === 0 ? 'py-4' : i === 1 ? 'py-3' : 'py-2'}`}
            >
              <div className="text-2xl">{medals[i]}</div>
              <div className="font-medium text-sm mt-1">{r.display_name}</div>
              <div className="text-xs text-muted-foreground">{r.total_points} pts</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Breakdown({ email, fixtures, allPicks }: { email: string; fixtures: Fixtures; allPicks: AllPicksPayload }) {
  const b = playerBreakdown(email, fixtures, allPicks.matchPicks, allPicks.bracketPicks);
  const teamById = new Map<number, Team>(fixtures.teams.map((t) => [t.id, t]));
  const hits = b.matchRows.filter((r) => r.points > 0);

  // The player's full predicted bracket, rebuilt from their stored picks the
  // same way PicksPage restores a saved bracket: group picks seed the
  // qualifiers, per-team predicted stages decide each node's winner.
  const nodes = useMemo(() => {
    const picks: Record<number, Pick> = {};
    for (const p of allPicks.matchPicks) if (p.email === email) picks[p.match_id] = p.pick;
    const stages: Record<number, number> = {};
    for (const p of allPicks.bracketPicks) if (p.email === email) stages[p.team_id] = p.predicted_stage;
    const qualifiers = computeQualifiers(computeGroupStandings(picks, fixtures));
    if (!qualifiers) return null;
    return buildBracket(qualifiers, winnersFromStages(qualifiers, stages));
  }, [email, fixtures, allPicks]);

  return (
    <div className="space-y-3 text-sm font-normal">
      <div>
        <p className="font-medium mb-1">
          Group stage: {b.correctMatches} correct of {b.resolvedMatches} played → {b.groupPoints} pts
        </p>
        {hits.length > 0 ? (
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {hits.map((r) => {
              const home = teamById.get(r.match.home_team_id)?.name ?? '?';
              const away = teamById.get(r.match.away_team_id)?.name ?? '?';
              const label = r.pick === 'D' ? 'Draw' : r.pick === 'H' ? home : away;
              return (
                <li key={r.match.id}>
                  ✓ {home} – {away}: picked {label} (+{r.points})
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No correct picks yet.</p>
        )}
      </div>
      <div>
        <p className="font-medium mb-1">Bracket: {b.bracketPoints} pts</p>
        <div className="text-xs text-muted-foreground mb-2 space-y-0.5">
          <p>
            One row per team you predicted, sorted by how far you picked it. Each shows the round you predicted it to
            reach — <span className="font-medium text-foreground">R32 · R16 · QF · SF · F · 🏆</span> (or{' '}
            <span className="font-medium text-foreground">—</span> = out in groups) — then{' '}
            <span className="font-medium text-foreground">+N</span>, the bracket points it has earned you so far.
          </p>
          <p>
            <span className="text-green-600">✓</span> reached your pick — points banked ·{' '}
            <span>•</span> still <span className="italic">(alive)</span> — can still get there ·{' '}
            <span className="text-destructive">✗</span> out before your pick — final ·{' '}
            <span>💩</span> you picked it to go out, but it advanced past group stages.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
          {b.teamRows.map((r) => (
            <div key={r.team.id} className="flex items-center gap-1.5">
              <span
                className={
                  r.status === 'out'
                    ? 'text-destructive'
                    : r.status === 'done'
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                }
              >
                {r.status === 'out'
                  ? r.predictedStage === 0
                    ? '💩'
                    : '✗'
                  : r.status === 'done'
                    ? '✓'
                    : '•'}
              </span>
              <span className="flex-1 truncate">{r.team.name}</span>
              <span className="text-muted-foreground">
                {STAGE_SHORT[r.predictedStage]} · +{r.earned}
                {r.status === 'alive' ? ' (alive)' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
      <BracketCard
        nodes={nodes}
        teamById={teamById}
        locked
        decided={nodes ? bracketProgress(nodes).decided : 0}
        onPickWinner={() => undefined}
        title="Predicted Bracket"
        description="How this player called the knockouts, rebuilt from their picks."
        emptyText="No complete bracket submitted."
      />
    </div>
  );
}

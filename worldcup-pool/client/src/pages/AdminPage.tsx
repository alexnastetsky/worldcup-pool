import { useEffect, useMemo, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Me, Pick, Team } from '../lib/pool';
import { STAGE_NAMES, fetchJson, formatDate, formatLongDate, sendJson } from '../lib/pool';
import { Toc } from '../components/Toc';

export function AdminPage({ me, onStateChange }: { me: Me; onStateChange: () => void }) {
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetText, setResetText] = useState('');
  const [busy, setBusy] = useState(false);

  const loadFixtures = () => {
    fetchJson<Fixtures>('/api/fixtures')
      .then(setFixtures)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load fixtures'));
  };

  useEffect(loadFixtures, []);

  const teamById = useMemo(() => new Map<number, Team>(fixtures?.teams.map((t) => [t.id, t]) ?? []), [fixtures]);

  // Distinct match dates in chronological order (matches arrive id-ordered =
  // chronological), so results can be entered in the order games are played.
  const matchDates = useMemo(() => [...new Set(fixtures?.matches.map((m) => m.match_date) ?? [])], [fixtures]);

  if (!me.isAdmin) {
    return <p className="text-center text-muted-foreground mt-12">Admins only.</p>;
  }

  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    fn()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Action failed');
      })
      .finally(() => setBusy(false));
  };

  const setLocked = (locked: boolean) => {
    run(async () => {
      await sendJson(`/api/admin/${locked ? 'lock' : 'unlock'}`, 'POST');
      onStateChange();
    });
  };

  const setMatchResult = (matchId: number, result: Pick | null) => {
    run(async () => {
      await sendJson(`/api/admin/results/match/${matchId}`, 'PUT', { result });
      loadFixtures();
    });
  };

  const setTeamStage = (teamId: number, stage: number | null, eliminated: boolean) => {
    run(async () => {
      await sendJson(`/api/admin/results/team/${teamId}`, 'PUT', { stage, eliminated });
      loadFixtures();
    });
  };

  const resetPool = () => {
    run(async () => {
      await sendJson('/api/admin/reset', 'POST');
      setResetText('');
      onStateChange();
      loadFixtures();
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Toc
        items={[
          { id: 'submissions', label: 'Submissions' },
          { id: 'results', label: 'Match Results' },
          ...matchDates.map((d) => ({ id: `results-${d}`, label: formatDate(d) })),
          { id: 'teams', label: 'Team Progress' },
          { id: 'danger', label: 'Danger Zone' },
        ]}
      />
      <Card id="submissions" className="scroll-mt-14">
        <CardHeader>
          <CardTitle>Submissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {me.locked
              ? 'Submissions are LOCKED. Everyone can see all picks and standings.'
              : 'Submissions are OPEN. Players can still edit their picks; standings are hidden.'}
          </p>
          <Button onClick={() => setLocked(!me.locked)} disabled={busy}>
            {me.locked ? 'Unlock submissions' : 'Lock submissions (finish sign-ups)'}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {!fixtures && <Skeleton className="h-64 w-full" />}

      {fixtures && (
        <Card id="results" className="scroll-mt-14">
          <CardHeader>
            <CardTitle>Match Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {matchDates.map((date) => (
              <div key={date} id={`results-${date}`} className="scroll-mt-14">
                <p className="text-sm font-medium mb-1">{formatLongDate(date)}</p>
                <div className="space-y-1">
                  {fixtures.matches
                    .filter((m) => m.match_date === date)
                    .map((m) => {
                      const home = teamById.get(m.home_team_id)?.name ?? '?';
                      const away = teamById.get(m.away_team_id)?.name ?? '?';
                      return (
                        <div key={m.id} className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="text-xs text-muted-foreground w-6 shrink-0">{m.group_letter}</span>
                          <span className="flex-1 min-w-[180px] truncate">
                            {home} – {away}
                          </span>
                          <ResultButton
                            label={home}
                            active={m.actual_result === 'H'}
                            onClick={() => setMatchResult(m.id, 'H')}
                          />
                          <ResultButton
                            label="Draw"
                            active={m.actual_result === 'D'}
                            onClick={() => setMatchResult(m.id, 'D')}
                          />
                          <ResultButton
                            label={away}
                            active={m.actual_result === 'A'}
                            onClick={() => setMatchResult(m.id, 'A')}
                          />
                          <ResultButton label="✕" active={false} onClick={() => setMatchResult(m.id, null)} />
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {fixtures && (
        <Card id="teams" className="scroll-mt-14">
          <CardHeader>
            <CardTitle>Team Progress (furthest stage reached)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Bump a team&apos;s stage as it advances, and mark it <strong>Out</strong> when it&apos;s eliminated — Out
              freezes its bracket points and feeds the &quot;Max&quot; column on Standings. &quot;Out in groups&quot; is
              always Out; &quot;Not decided yet&quot; never is.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {fixtures.teams.map((t) => {
                const forced = t.actual_stage === null || t.actual_stage === 0;
                return (
                  <div key={t.id} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-4">{t.group_letter}</span>
                    <span className="flex-1 truncate">{t.name}</span>
                    <select
                      aria-label={`Stage reached by ${t.name}`}
                      className={`border rounded-md px-2 py-1 text-sm bg-background ${
                        t.actual_stage === null ? 'text-muted-foreground' : ''
                      }`}
                      value={t.actual_stage ?? ''}
                      onChange={(e) =>
                        setTeamStage(t.id, e.target.value === '' ? null : parseInt(e.target.value, 10), t.eliminated)
                      }
                    >
                      <option value="">Not decided yet</option>
                      {STAGE_NAMES.map((name, i) => (
                        <option key={name} value={i}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <label className={`flex items-center gap-1 text-xs ${forced ? 'opacity-50' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={t.eliminated}
                        disabled={forced}
                        onChange={(e) => setTeamStage(t.id, t.actual_stage, e.target.checked)}
                      />
                      Out
                    </label>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card id="danger" className="border-destructive scroll-mt-14">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Reset the pool: deletes all participants and predictions, clears every result, and unlocks submissions.
            Fixtures stay seeded. Use this after a dry run, before the real pool starts. Type <strong>RESET</strong> to
            confirm.
          </p>
          <div className="flex gap-2">
            <Input
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              placeholder="RESET"
              className="max-w-[140px]"
            />
            <Button variant="destructive" disabled={resetText !== 'RESET' || busy} onClick={resetPool}>
              Reset pool
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResultButton(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`px-2 py-1 rounded-md text-xs border transition-colors max-w-[110px] truncate ${
        props.active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
      }`}
    >
      {props.label}
    </button>
  );
}

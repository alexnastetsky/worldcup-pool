import { useEffect, useMemo, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Me, Pick, Team } from '../lib/pool';
import { GROUP_LETTERS, STAGE_NAMES, fetchJson, formatDate, sendJson } from '../lib/pool';

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

  const setTeamStage = (teamId: number, stage: number | null) => {
    run(async () => {
      await sendJson(`/api/admin/results/team/${teamId}`, 'PUT', { stage });
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
      <Card>
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
        <Card>
          <CardHeader>
            <CardTitle>Match Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {GROUP_LETTERS.map((g) => (
              <div key={g}>
                <p className="text-sm font-medium mb-1">Group {g}</p>
                <div className="space-y-1">
                  {fixtures.matches
                    .filter((m) => m.group_letter === g)
                    .map((m) => {
                      const home = teamById.get(m.home_team_id)?.name ?? '?';
                      const away = teamById.get(m.away_team_id)?.name ?? '?';
                      return (
                        <div key={m.id} className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="text-xs text-muted-foreground w-14 shrink-0">
                            {formatDate(m.match_date)}
                          </span>
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
        <Card>
          <CardHeader>
            <CardTitle>Team Progress (furthest stage reached)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {fixtures.teams.map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-4">{t.group_letter}</span>
                  <span className="flex-1 truncate">{t.name}</span>
                  <select
                    aria-label={`Stage reached by ${t.name}`}
                    className={`border rounded-md px-2 py-1 text-sm bg-background ${
                      t.actual_stage === null ? 'text-muted-foreground' : ''
                    }`}
                    value={t.actual_stage ?? ''}
                    onChange={(e) => setTeamStage(t.id, e.target.value === '' ? null : parseInt(e.target.value, 10))}
                  >
                    <option value="">Not decided yet</option>
                    {STAGE_NAMES.map((name, i) => (
                      <option key={name} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-destructive">
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

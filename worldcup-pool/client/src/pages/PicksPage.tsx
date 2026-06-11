import { useEffect, useMemo, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Match, Me, Pick, Team } from '../lib/pool';
import { GROUP_LETTERS, STAGE_NAMES, fetchJson, formatDate, sendJson } from '../lib/pool';

interface MinePayload {
  matchPicks: { match_id: number; pick: Pick }[];
  bracketPicks: { team_id: number; predicted_stage: number }[];
}

export function PicksPage({ me }: { me: Me }) {
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [stages, setStages] = useState<Record<number, number>>({});
  const [displayName, setDisplayName] = useState(me.displayName ?? me.email.split('@')[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    Promise.all([fetchJson<Fixtures>('/api/fixtures'), fetchJson<MinePayload>('/api/predictions/mine')])
      .then(([fx, mine]) => {
        setFixtures(fx);
        setPicks(Object.fromEntries(mine.matchPicks.map((p) => [p.match_id, p.pick])));
        setStages(Object.fromEntries(mine.bracketPicks.map((p) => [p.team_id, p.predicted_stage])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, []);

  const teamById = useMemo(() => {
    const map = new Map<number, Team>();
    fixtures?.teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [fixtures]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await sendJson('/api/predictions/mine', 'PUT', {
        displayName: displayName.trim(),
        matchPicks: Object.fromEntries(Object.entries(picks).map(([k, v]) => [String(k), v])),
        bracketPicks: Object.fromEntries(Object.entries(stages).map(([k, v]) => [String(k), v])),
      });
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!fixtures) {
    return (
      <div className="max-w-3xl mx-auto space-y-3">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={`sk-${i}`} className="h-28 w-full" />)
        )}
      </div>
    );
  }

  const matchCount = Object.keys(picks).length;
  const stageCount = Object.keys(stages).length;
  const locked = me.locked;

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-24">
      <Card>
        <CardHeader>
          <CardTitle>My Predictions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {locked ? (
            <p className="text-sm text-muted-foreground">
              Submissions are locked — your picks are final and visible to everyone.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pick a result for all 72 group matches (correct win = 1 pt, correct draw = 2 pts) and how far each of the
              48 teams goes (cumulative: R32 1, R16 2, QF 3, SF 5, Final 8, Champion 12). You can edit until the pool is
              locked.
            </p>
          )}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium shrink-0" htmlFor="display-name">
              Display name
            </label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={locked}
              className="max-w-xs"
            />
          </div>
          <p className="text-sm">
            Progress: <strong>{matchCount}/72</strong> matches, <strong>{stageCount}/48</strong> teams
          </p>
        </CardContent>
      </Card>

      {GROUP_LETTERS.map((g) => (
        <GroupCard
          key={g}
          group={g}
          teams={fixtures.teams.filter((t) => t.group_letter === g)}
          matches={fixtures.matches.filter((m) => m.group_letter === g)}
          teamById={teamById}
          picks={picks}
          stages={stages}
          locked={locked}
          onPick={(matchId, pick) => setPicks((prev) => ({ ...prev, [matchId]: pick }))}
          onStage={(teamId, stage) => setStages((prev) => ({ ...prev, [teamId]: stage }))}
        />
      ))}

      {!locked && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-3">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <Button onClick={() => void save()} disabled={saving || !displayName.trim()}>
              {saving ? 'Saving…' : 'Save predictions'}
            </Button>
            {savedAt && !error && (
              <span className="text-sm text-muted-foreground">Saved at {savedAt.toLocaleTimeString()}</span>
            )}
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupCard(props: {
  group: string;
  teams: Team[];
  matches: Match[];
  teamById: Map<number, Team>;
  picks: Record<number, Pick>;
  stages: Record<number, number>;
  locked: boolean;
  onPick: (matchId: number, pick: Pick) => void;
  onStage: (teamId: number, stage: number) => void;
}) {
  const { group, teams, matches, teamById, picks, stages, locked, onPick, onStage } = props;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Group {group}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {matches.map((m) => {
            const home = teamById.get(m.home_team_id)?.name ?? '?';
            const away = teamById.get(m.away_team_id)?.name ?? '?';
            const current = picks[m.id];
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-b-0">
                <span className="text-xs text-muted-foreground w-14 shrink-0">{formatDate(m.match_date)}</span>
                <div className="flex gap-1 flex-1 min-w-[260px]">
                  <PickButton
                    label={home}
                    active={current === 'H'}
                    disabled={locked}
                    onClick={() => onPick(m.id, 'H')}
                  />
                  <PickButton
                    label="Draw"
                    active={current === 'D'}
                    disabled={locked}
                    onClick={() => onPick(m.id, 'D')}
                  />
                  <PickButton
                    label={away}
                    active={current === 'A'}
                    disabled={locked}
                    onClick={() => onPick(m.id, 'A')}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <p className="text-sm font-medium mb-2">How far does each team go?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {teams.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span className="text-sm flex-1 truncate">{t.name}</span>
                <select
                  aria-label={`Furthest stage for ${t.name}`}
                  className="border rounded-md px-2 py-1 text-sm bg-background"
                  value={stages[t.id] ?? ''}
                  disabled={locked}
                  onChange={(e) => onStage(t.id, parseInt(e.target.value, 10))}
                >
                  <option value="" disabled>
                    Pick…
                  </option>
                  {STAGE_NAMES.map((name, i) => (
                    <option key={name} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PickButton(props: { label: string; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`flex-1 px-2 py-1.5 rounded-md text-sm border transition-colors truncate ${
        props.active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted disabled:opacity-60'
      }`}
    >
      {props.label}
    </button>
  );
}

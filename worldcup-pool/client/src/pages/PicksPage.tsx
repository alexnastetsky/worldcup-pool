import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Match, Me, ParticipantStatus, Pick, Team } from '../lib/pool';
import { GROUP_LETTERS, STAGE_NAMES, fetchJson, formatDate, sendJson } from '../lib/pool';
import { bracketWarnings } from '../lib/scoring';

interface MinePayload {
  matchPicks: { match_id: number; pick: Pick }[];
  bracketPicks: { team_id: number; predicted_stage: number }[];
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'need-name';

export function PicksPage({ me }: { me: Me }) {
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [stages, setStages] = useState<Record<number, number>>({});
  const [displayName, setDisplayName] = useState(me.displayName ?? me.email.split('@')[0]);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [participants, setParticipants] = useState<ParticipantStatus[]>([]);

  // Latest values for the (debounced, chained) save to read at execution time.
  const picksRef = useRef(picks);
  const stagesRef = useRef(stages);
  const nameRef = useRef(displayName);
  useEffect(() => {
    picksRef.current = picks;
    stagesRef.current = stages;
    nameRef.current = displayName;
  }, [picks, stages, displayName]);

  const firstRunRef = useRef(true);
  // Serializes saves so an older snapshot can never overwrite a newer one.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveSeqRef = useRef(0);

  const loadParticipants = () => {
    fetchJson<ParticipantStatus[]>('/api/participants/status')
      .then(setParticipants)
      .catch(() => undefined); // non-critical
  };

  useEffect(() => {
    Promise.all([fetchJson<Fixtures>('/api/fixtures'), fetchJson<MinePayload>('/api/predictions/mine')])
      .then(([fx, mine]) => {
        setFixtures(fx);
        setPicks(Object.fromEntries(mine.matchPicks.map((p) => [p.match_id, p.pick])));
        setStages(Object.fromEntries(mine.bracketPicks.map((p) => [p.team_id, p.predicted_stage])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
    loadParticipants();
  }, []);

  // Auto-save: debounce user changes, then run saves in order.
  useEffect(() => {
    if (!fixtures || me.locked) return;
    if (firstRunRef.current) {
      // This run was triggered by the initial data load, not a user edit.
      firstRunRef.current = false;
      return;
    }
    if (!nameRef.current.trim()) {
      setSaveState('need-name');
      return;
    }
    setSaveState('pending');
    const timer = setTimeout(() => {
      const seq = ++saveSeqRef.current;
      setSaveState('saving');
      saveChainRef.current = saveChainRef.current.then(async () => {
        try {
          await sendJson('/api/predictions/mine', 'PUT', {
            displayName: nameRef.current.trim(),
            matchPicks: Object.fromEntries(Object.entries(picksRef.current).map(([k, v]) => [String(k), v])),
            bracketPicks: Object.fromEntries(Object.entries(stagesRef.current).map(([k, v]) => [String(k), v])),
          });
          if (seq === saveSeqRef.current) {
            setSaveState('saved');
            setSavedAt(new Date());
            loadParticipants();
          }
        } catch (err) {
          if (seq === saveSeqRef.current) {
            setSaveState('error');
            setError(err instanceof Error ? err.message : 'Failed to save');
          }
        }
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [picks, stages, displayName, fixtures, me.locked]);

  const teamById = useMemo(() => {
    const map = new Map<number, Team>();
    fixtures?.teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [fixtures]);

  const warnings = useMemo(() => (fixtures ? bracketWarnings(stages, fixtures.teams) : []), [stages, fixtures]);

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
    <div className="max-w-3xl mx-auto space-y-4 pb-8">
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
              48 teams goes (cumulative: R32 1, R16 2, QF 3, SF 5, Final 8, Champion 12). Changes save automatically
              until the pool is locked.
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
            {!locked && <SaveStatus state={saveState} savedAt={savedAt} error={error} />}
          </p>
          {!locked && warnings.length > 0 && (
            <div className="text-sm rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 space-y-1">
              <p className="font-medium text-amber-900 dark:text-amber-100">Bracket check</p>
              <ul className="list-disc pl-5 text-amber-900 dark:text-amber-100">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {!locked && participants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Who&apos;s in ({participants.length} player{participants.length === 1 ? '' : 's'})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
              {participants.map((p) => {
                const complete = p.match_count === 72 && p.bracket_count === 48;
                return (
                  <div
                    key={p.email}
                    className={`flex items-center gap-2 ${p.email === me.email ? 'font-semibold' : ''}`}
                  >
                    <span className={complete ? 'text-green-600' : 'text-muted-foreground'}>
                      {complete ? '✓' : '…'}
                    </span>
                    <span className="flex-1 truncate">{p.display_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.match_count}/72 · {p.bracket_count}/48
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}

function SaveStatus({ state, savedAt, error }: { state: SaveState; savedAt: Date | null; error: string | null }) {
  if (state === 'idle') return null;
  if (state === 'need-name') {
    return <span className="ml-2 text-amber-600">— enter a display name to save</span>;
  }
  if (state === 'pending' || state === 'saving') {
    return <span className="ml-2 text-muted-foreground">— saving…</span>;
  }
  if (state === 'error') {
    return <span className="ml-2 text-destructive">— save failed: {error}</span>;
  }
  return (
    <span className="ml-2 text-muted-foreground">
      — all changes saved{savedAt ? ` at ${savedAt.toLocaleTimeString()}` : ''}
    </span>
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

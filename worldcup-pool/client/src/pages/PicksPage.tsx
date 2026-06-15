import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@databricks/appkit-ui/react';
import type { Fixtures, Match, Me, ParticipantStatus, Pick, Team } from '../lib/pool';
import { GROUP_LETTERS, fetchJson, formatDate, sendJson } from '../lib/pool';
import type { GroupStandingRow } from '../lib/bracket';
import {
  bracketProgress,
  buildBracket,
  computeGroupStandings,
  computeQualifiers,
  stagesFromBracket,
  winnersFromStages,
} from '../lib/bracket';
import { BracketCard } from './BracketCard';
import { Toc } from '../components/Toc';

interface MinePayload {
  matchPicks: { match_id: number; pick: Pick }[];
  bracketPicks: { team_id: number; predicted_stage: number }[];
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function PicksPage({ me }: { me: Me }) {
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [bracketWinners, setBracketWinners] = useState<Record<number, number>>({});
  const [displayName, setDisplayName] = useState(me.displayName ?? me.email.split('@')[0]);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [participants, setParticipants] = useState<ParticipantStatus[]>([]);

  // Predicted standings → qualifiers → bracket nodes → per-team stages.
  // Stages are fully derived; the save payload/scoring is unchanged.
  const standings = useMemo(() => (fixtures ? computeGroupStandings(picks, fixtures) : {}), [picks, fixtures]);
  const qualifiers = useMemo(() => computeQualifiers(standings), [standings]);
  const nodes = useMemo(
    () => (qualifiers ? buildBracket(qualifiers, bracketWinners) : null),
    [qualifiers, bracketWinners]
  );
  const stages = useMemo(() => {
    if (!fixtures || !qualifiers || !nodes) return {};
    return stagesFromBracket(
      qualifiers,
      nodes,
      fixtures.teams.map((t) => t.id)
    );
  }, [fixtures, qualifiers, nodes]);

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
        const loadedPicks = Object.fromEntries(mine.matchPicks.map((p) => [p.match_id, p.pick]));
        const savedStages = Object.fromEntries(mine.bracketPicks.map((p) => [p.team_id, p.predicted_stage]));
        setFixtures(fx);
        setPicks(loadedPicks);
        // Rebuild the bracket choices from the saved per-team stages.
        const q = computeQualifiers(computeGroupStandings(loadedPicks, fx));
        if (q) setBracketWinners(winnersFromStages(q, savedStages));
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
      // SaveStatus shows "enter a display name" derived from displayName.
      return;
    }
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

  if (!fixtures) {
    return (
      <div className="max-w-4xl mx-auto space-y-3">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={`sk-${i}`} className="h-28 w-full" />)
        )}
      </div>
    );
  }

  const matchCount = Object.keys(picks).length;
  const progress = nodes ? bracketProgress(nodes) : { decided: 0, total: 31 };
  const locked = me.locked;

  return (
    <div className="space-y-4 pb-8">
      <Toc
        items={[
          { id: 'predictions', label: 'My Predictions' },
          ...(!locked ? [{ id: 'players', label: "Who's in" }] : []),
          'Groups:',
          ...GROUP_LETTERS.map((g) => ({ id: `group-${g.toLowerCase()}`, label: g })),
          { id: 'bracket', label: 'Bracket' },
        ]}
      />
      <div className="max-w-4xl mx-auto space-y-4">
        <Card id="predictions" className="scroll-mt-14">
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
                Pick a result for all 72 group matches (correct win = 1 pt, correct draw = 2 pts).{' '}
                <strong className="text-foreground">How teams reach the Round of 32:</strong> the top 2 of each group
                qualify, joined by the 8 best third-placed teams across the 12 groups. Your qualifiers are derived from
                your match picks (win 3 pts, draw 1; ties broken by head-to-head, then draw seeding) and seeded into the
                knockout bracket below, where you click winners round by round (bracket scoring: R32 1, R16 2, QF 3, SF
                5, Final 8, Champion 12, cumulative). Changes save automatically until the pool is locked.
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
              Progress: <strong>{matchCount}/72</strong> matches · bracket{' '}
              <strong>
                {progress.decided}/{progress.total}
              </strong>{' '}
              decided
              {!locked && (
                <SaveStatus state={saveState} needName={!displayName.trim()} savedAt={savedAt} error={error} />
              )}
            </p>
          </CardContent>
        </Card>

        {!locked && (
          <Card id="players" className="scroll-mt-14">
            <CardHeader>
              <CardTitle>
                Who&apos;s in ({participants.length} player{participants.length === 1 ? '' : 's'})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No players yet — you&apos;ll appear here as soon as you make your first pick.
                </p>
              ) : (
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
              )}
            </CardContent>
          </Card>
        )}

        {GROUP_LETTERS.map((g) => (
          <GroupCard
            key={g}
            group={g}
            matches={fixtures.matches.filter((m) => m.group_letter === g)}
            teamById={teamById}
            picks={picks}
            standing={standings[g] ?? null}
            locked={locked}
            onPick={(matchId, pick) => setPicks((prev) => ({ ...prev, [matchId]: pick }))}
          />
        ))}
      </div>

      <div id="bracket" className="max-w-[1180px] mx-auto scroll-mt-14">
        <BracketCard
          nodes={nodes}
          teamById={teamById}
          locked={locked}
          decided={progress.decided}
          onPickWinner={(matchNo, teamId) => setBracketWinners((prev) => ({ ...prev, [matchNo]: teamId }))}
        />
      </div>
    </div>
  );
}

function SaveStatus({
  state,
  needName,
  savedAt,
  error,
}: {
  state: SaveState;
  needName: boolean;
  savedAt: Date | null;
  error: string | null;
}) {
  if (needName) {
    return <span className="ml-2 text-amber-600">— enter a display name to save</span>;
  }
  if (state === 'idle') return null;
  if (state === 'saving') {
    return <span className="ml-2 text-muted-foreground">— saving…</span>;
  }
  if (state === 'error') {
    return <span className="ml-2 text-destructive">— save failed: {error}</span>;
  }
  return (
    <span className="ml-2 text-muted-foreground">
      — all changes saved
      {savedAt ? ` at ${savedAt.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET` : ''}
    </span>
  );
}

function GroupCard(props: {
  group: string;
  matches: Match[];
  teamById: Map<number, Team>;
  picks: Record<number, Pick>;
  standing: GroupStandingRow[] | null;
  locked: boolean;
  onPick: (matchId: number, pick: Pick) => void;
}) {
  const { group, matches, teamById, picks, standing, locked, onPick } = props;
  return (
    <Card id={`group-${group.toLowerCase()}`} className="scroll-mt-14">
      <CardHeader>
        <CardTitle>Group {group}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {matches.map((m) => {
            const home = teamById.get(m.home_team_id)?.name ?? '?';
            const away = teamById.get(m.away_team_id)?.name ?? '?';
            const current = picks[m.id];
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-b-0">
                <span className="text-xs text-muted-foreground w-14 shrink-0">{formatDate(m.match_date)}</span>
                <div className="flex gap-1 flex-1 min-w-0 sm:min-w-[260px]">
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
        <p className="text-xs text-muted-foreground">
          {standing ? (
            <>
              Predicted finish:{' '}
              {standing.map((row, i) => (
                <span key={row.teamId}>
                  {i > 0 && ' · '}
                  {i + 1}.{' '}
                  <span className={i < 2 ? 'font-medium text-foreground' : ''}>
                    {teamById.get(row.teamId)?.name ?? '?'}
                  </span>
                  {i === 2 && ' (best-thirds race)'}
                </span>
              ))}
            </>
          ) : (
            'Predicted finish appears once all 6 matches are picked.'
          )}
        </p>
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
      className={`flex-1 px-2 py-2.5 md:py-1.5 rounded-md text-sm border transition-colors truncate ${
        props.active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted disabled:opacity-60'
      }`}
    >
      {props.label}
    </button>
  );
}

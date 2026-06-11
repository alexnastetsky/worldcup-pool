import { Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import type { BracketNode } from '../lib/bracket';
import { FEEDS, ROUND_ORDER } from '../lib/bracket';
import type { Team } from '../lib/pool';

const ROUND_TITLES = ['Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];
const COLUMN_MIN_HEIGHT = '56rem';

export function BracketCard(props: {
  nodes: BracketNode[] | null; // null until all 72 group picks are made
  teamById: Map<number, Team>;
  locked: boolean;
  decided: number;
  onPickWinner: (matchNo: number, teamId: number) => void;
  title?: string;
  description?: string;
  emptyText?: string;
}) {
  const { nodes, teamById, locked, decided, onPickWinner, title, description, emptyText } = props;
  const nodeByMatch = new Map((nodes ?? []).map((n) => [n.matchNo, n]));
  const champion = nodeByMatch.get(104)?.winner ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title ?? 'Knockout Bracket'}{' '}
          {nodes && <span className="text-sm font-normal text-muted-foreground">— {decided}/31 decided</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!nodes ? (
          <p className="text-sm text-muted-foreground">
            {emptyText ??
              'Complete all 72 group-stage picks above to unlock the bracket — your 32 qualifiers will be seeded into the Round of 32 automatically.'}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-3">
              {description ??
                (locked
                  ? 'Your bracket is locked.'
                  : 'Click a team to advance it to the next round. Changing a group pick re-seeds the bracket and clears any affected choices.')}
            </p>
            <div className="overflow-x-auto">
              <div className="flex gap-2 min-w-[1000px]">
                {ROUND_ORDER.map((matchNos, roundIdx) => (
                  <div key={ROUND_TITLES[roundIdx]} className="flex flex-col w-[165px] shrink-0 grow">
                    <p className="text-xs font-medium text-center mb-2">{ROUND_TITLES[roundIdx]}</p>
                    <div className="flex flex-col justify-around grow gap-2" style={{ minHeight: COLUMN_MIN_HEIGHT }}>
                      {matchNos.map((matchNo) => {
                        const node = nodeByMatch.get(matchNo);
                        if (!node) return null;
                        return (
                          <div key={matchNo} className="border rounded-md overflow-hidden bg-background">
                            <SlotButton
                              node={node}
                              side="home"
                              teamById={teamById}
                              locked={locked}
                              onPickWinner={onPickWinner}
                            />
                            <div className="border-t" />
                            <SlotButton
                              node={node}
                              side="away"
                              teamById={teamById}
                              locked={locked}
                              onPickWinner={onPickWinner}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="flex flex-col w-[165px] shrink-0 grow">
                  <p className="text-xs font-medium text-center mb-2">Champion</p>
                  <div className="flex flex-col justify-center grow" style={{ minHeight: COLUMN_MIN_HEIGHT }}>
                    <div className="border rounded-md p-3 text-center">
                      <div className="text-2xl">🏆</div>
                      <div className="text-sm font-semibold mt-1">
                        {champion !== null ? (teamById.get(champion)?.name ?? '?') : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SlotButton(props: {
  node: BracketNode;
  side: 'home' | 'away';
  teamById: Map<number, Team>;
  locked: boolean;
  onPickWinner: (matchNo: number, teamId: number) => void;
}) {
  const { node, side, teamById, locked, onPickWinner } = props;
  const teamId = side === 'home' ? node.home : node.away;
  const feed = FEEDS[node.matchNo];
  const placeholder = feed ? `Winner of M${feed[side === 'home' ? 0 : 1]}` : 'TBD';
  const isWinner = teamId !== null && node.winner === teamId;
  const isLoser = teamId !== null && node.winner !== null && node.winner !== teamId;
  return (
    <button
      type="button"
      disabled={locked || teamId === null}
      onClick={() => teamId !== null && onPickWinner(node.matchNo, teamId)}
      aria-label={`Match ${node.matchNo} ${side}`}
      className={`w-full text-left px-2 py-1 text-xs truncate transition-colors disabled:cursor-default ${
        isWinner
          ? 'bg-primary text-primary-foreground font-medium'
          : isLoser
            ? 'text-muted-foreground line-through'
            : teamId === null
              ? 'text-muted-foreground/60 italic'
              : 'hover:bg-muted'
      }`}
    >
      {teamId !== null ? (teamById.get(teamId)?.name ?? '?') : placeholder}
    </button>
  );
}

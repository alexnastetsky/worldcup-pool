import { Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import type { BracketNode } from '../lib/bracket';
import { FEEDS, ROUND_ORDER } from '../lib/bracket';
import type { Team } from '../lib/pool';
import { teamCode } from '../lib/pool';

const ROUND_TITLES = ['Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];
const COLUMN_MIN_HEIGHT = '56rem';

interface LayoutProps {
  nodeByMatch: Map<number, BracketNode>;
  teamById: Map<number, Team>;
  locked: boolean;
  champion: number | null;
  onPickWinner: (matchNo: number, teamId: number) => void;
}

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
  const layout: LayoutProps = { nodeByMatch, teamById, locked, champion, onPickWinner };

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
                  : 'Tap a team to advance it to the next round. Changing a group pick re-seeds the bracket and clears any affected choices.')}
            </p>
            {/* Desktop: left-to-right columns (unchanged). */}
            <div className="hidden md:block">
              <DesktopBracket {...layout} />
            </div>
            {/* Mobile: mirrored / converging layout that fits the screen width.
                Negative margins reclaim the card's horizontal padding so the
                3-letter codes have room; restored at sm+. */}
            <div className="md:hidden -mx-4 sm:mx-0">
              <MobileBracket {...layout} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DesktopBracket({ nodeByMatch, teamById, locked, champion, onPickWinner }: LayoutProps) {
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-2 min-w-[1000px]">
        {ROUND_ORDER.map((matchNos, roundIdx) => (
          <div key={ROUND_TITLES[roundIdx]} className="flex flex-col w-[165px] shrink-0 grow">
            <p className="text-xs font-medium text-center mb-2">{ROUND_TITLES[roundIdx]}</p>
            <div className="flex flex-col justify-around grow gap-2" style={{ minHeight: COLUMN_MIN_HEIGHT }}>
              {matchNos.map((matchNo) => {
                const node = nodeByMatch.get(matchNo);
                return node ? (
                  <NodeBox key={matchNo} node={node} teamById={teamById} locked={locked} onPickWinner={onPickWinner} />
                ) : null;
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
  );
}

function MobileBracket({ nodeByMatch, teamById, locked, champion, onPickWinner }: LayoutProps) {
  const [r32, r16, qf, sf] = ROUND_ORDER;
  // Tree order: first half of each round feeds SF 101 (left), second half feeds
  // SF 102 (right). Rounds converge inward toward the central Final.
  const leftCols = [
    { label: 'R32', matchNos: r32.slice(0, 8) },
    { label: 'R16', matchNos: r16.slice(0, 4) },
    { label: 'QF', matchNos: qf.slice(0, 2) },
    { label: 'SF', matchNos: sf.slice(0, 1) },
  ];
  const rightCols = [
    { label: 'SF', matchNos: sf.slice(1, 2) },
    { label: 'QF', matchNos: qf.slice(2, 4) },
    { label: 'R16', matchNos: r16.slice(4, 8) },
    { label: 'R32', matchNos: r32.slice(8, 16) },
  ];
  const finalNode = nodeByMatch.get(104) ?? null;

  const column = (label: string, matchNos: number[], align: 'left' | 'right') => (
    <div key={`${label}-${align}-${matchNos[0] ?? ''}`} className="flex flex-1 min-w-0 flex-col">
      <p className="text-[9px] font-medium text-center mb-1 text-muted-foreground">{label}</p>
      <div className="flex grow flex-col justify-around gap-1">
        {matchNos.map((matchNo) => {
          const node = nodeByMatch.get(matchNo);
          return node ? (
            <NodeBox
              key={matchNo}
              node={node}
              teamById={teamById}
              locked={locked}
              onPickWinner={onPickWinner}
              compact
              align={align}
            />
          ) : null;
        })}
      </div>
    </div>
  );

  return (
    <div className="overflow-x-auto px-1">
      <div className="flex items-stretch gap-px" style={{ minHeight: '21rem' }}>
        {leftCols.map((c) => column(c.label, c.matchNos, 'left'))}
        <div className="flex flex-1 min-w-0 flex-col justify-center">
          <p className="text-[9px] font-medium text-center mb-1 text-muted-foreground">Final</p>
          <div className="flex grow flex-col justify-center gap-1">
            {finalNode && (
              <NodeBox
                node={finalNode}
                teamById={teamById}
                locked={locked}
                onPickWinner={onPickWinner}
                compact
                align="left"
              />
            )}
            <div className="border rounded-md p-1 text-center">
              <div className="text-base leading-none">🏆</div>
              <div className="text-[10px] font-semibold leading-tight truncate">
                {champion !== null ? teamCode(teamById.get(champion)?.name ?? '?') : '—'}
              </div>
            </div>
          </div>
        </div>
        {rightCols.map((c) => column(c.label, c.matchNos, 'right'))}
      </div>
    </div>
  );
}

function NodeBox(props: {
  node: BracketNode;
  teamById: Map<number, Team>;
  locked: boolean;
  onPickWinner: (matchNo: number, teamId: number) => void;
  compact?: boolean;
  align?: 'left' | 'right';
}) {
  const { compact, align } = props;
  return (
    <div className="border rounded-md overflow-hidden bg-background">
      <SlotButton {...props} side="home" compact={compact} align={align} />
      <div className="border-t" />
      <SlotButton {...props} side="away" compact={compact} align={align} />
    </div>
  );
}

function SlotButton(props: {
  node: BracketNode;
  side: 'home' | 'away';
  teamById: Map<number, Team>;
  locked: boolean;
  onPickWinner: (matchNo: number, teamId: number) => void;
  compact?: boolean;
  align?: 'left' | 'right';
}) {
  const { node, side, teamById, locked, onPickWinner, compact, align } = props;
  const teamId = side === 'home' ? node.home : node.away;
  const feed = FEEDS[node.matchNo];
  const name = teamId !== null ? (teamById.get(teamId)?.name ?? '?') : null;
  const label =
    name !== null
      ? compact
        ? teamCode(name)
        : name
      : compact
        ? '·'
        : feed
          ? `Winner of M${feed[side === 'home' ? 0 : 1]}`
          : 'TBD';
  const isWinner = teamId !== null && node.winner === teamId;
  const isLoser = teamId !== null && node.winner !== null && node.winner !== teamId;
  return (
    <button
      type="button"
      disabled={locked || teamId === null}
      onClick={() => teamId !== null && onPickWinner(node.matchNo, teamId)}
      aria-label={`Match ${node.matchNo} ${side}`}
      title={name ?? undefined}
      className={`w-full truncate transition-colors disabled:cursor-default ${
        compact ? 'px-0.5 py-1 text-[10px] leading-tight' : 'px-2 py-1 text-xs'
      } ${align === 'right' ? 'text-right' : 'text-left'} ${
        isWinner
          ? 'bg-primary text-primary-foreground font-medium'
          : isLoser
            ? 'text-muted-foreground line-through'
            : teamId === null
              ? 'text-muted-foreground/60 italic'
              : 'hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

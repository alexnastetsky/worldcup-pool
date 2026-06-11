import type { Fixtures, Match, Pick, Team } from './pool';
import { CUM_POINTS } from './pool';

export interface BreakdownMatchRow {
  match: Match;
  pick: Pick;
  points: number; // 0 if wrong or unresolved
  resolved: boolean;
}

export interface BreakdownTeamRow {
  team: Team;
  predictedStage: number;
  earned: number;
  // 'done' = earned everything predicted; 'out' = eliminated short of the
  // prediction; 'alive' = still able to earn more
  status: 'alive' | 'out' | 'done';
}

export interface PlayerBreakdown {
  matchRows: BreakdownMatchRow[];
  teamRows: BreakdownTeamRow[];
  groupPoints: number;
  bracketPoints: number;
  correctMatches: number;
  resolvedMatches: number;
}

export function playerBreakdown(
  email: string,
  fixtures: Fixtures,
  matchPicks: { email: string; match_id: number; pick: Pick }[],
  bracketPicks: { email: string; team_id: number; predicted_stage: number }[]
): PlayerBreakdown {
  const matchById = new Map(fixtures.matches.map((m) => [m.id, m]));
  const teamById = new Map(fixtures.teams.map((t) => [t.id, t]));

  const matchRows: BreakdownMatchRow[] = [];
  let groupPoints = 0;
  let correctMatches = 0;
  let resolvedMatches = 0;
  for (const p of matchPicks) {
    if (p.email !== email) continue;
    const match = matchById.get(p.match_id);
    if (!match) continue;
    const resolved = match.actual_result !== null;
    let points = 0;
    if (resolved) {
      resolvedMatches += 1;
      if (p.pick === match.actual_result) {
        points = match.actual_result === 'D' ? 2 : 1;
        correctMatches += 1;
      }
    }
    groupPoints += points;
    matchRows.push({ match, pick: p.pick, points, resolved });
  }
  matchRows.sort((a, b) => a.match.id - b.match.id);

  const teamRows: BreakdownTeamRow[] = [];
  let bracketPoints = 0;
  for (const p of bracketPicks) {
    if (p.email !== email) continue;
    const team = teamById.get(p.team_id);
    if (!team) continue;
    const actual = team.actual_stage ?? 0;
    const earned = CUM_POINTS[Math.min(p.predicted_stage, actual)];
    const terminal = team.eliminated || team.actual_stage === 6;
    const status: BreakdownTeamRow['status'] = actual >= p.predicted_stage ? 'done' : terminal ? 'out' : 'alive';
    bracketPoints += earned;
    teamRows.push({ team, predictedStage: p.predicted_stage, earned, status });
  }
  teamRows.sort((a, b) => b.predictedStage - a.predictedStage || a.team.name.localeCompare(b.team.name));

  return { matchRows, teamRows, groupPoints, bracketPoints, correctMatches, resolvedMatches };
}

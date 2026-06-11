import type { Fixtures, Match, Pick, Team } from './pool';
import { CUM_POINTS, GROUP_LETTERS } from './pool';

// Real-bracket capacity per stage code 1..6 (R32..Champion).
const STAGE_CAPACITY = [
  { stage: 6, max: 1, label: 'Champion' },
  { stage: 5, max: 2, label: 'the Final' },
  { stage: 4, max: 4, label: 'the Semifinals' },
  { stage: 3, max: 8, label: 'the Quarterfinals' },
  { stage: 2, max: 16, label: 'the Round of 16' },
  { stage: 1, max: 32, label: 'the Round of 32' },
];

// Soft sanity checks on bracket picks — never blocks saving.
export function bracketWarnings(stages: Record<number, number>, teams: Team[]): string[] {
  const warnings: string[] = [];
  const picked = Object.entries(stages).map(([teamId, stage]) => ({
    teamId: parseInt(teamId, 10),
    stage,
  }));
  const allPicked = picked.length === teams.length;

  for (const { stage, max, label } of STAGE_CAPACITY) {
    const count = picked.filter((p) => p.stage >= stage).length;
    if (count > max) {
      warnings.push(`${count} teams reach ${label} — only ${max} can.`);
    } else if (allPicked && count < max) {
      warnings.push(`Only ${count} of your teams reach ${label} — exactly ${max} will.`);
    }
  }

  const teamGroup = new Map(teams.map((t) => [t.id, t.group_letter]));
  for (const g of GROUP_LETTERS) {
    const inGroup = picked.filter((p) => teamGroup.get(p.teamId) === g);
    const advancing = inGroup.filter((p) => p.stage >= 1).length;
    if (inGroup.length === 4 && advancing === 4) {
      warnings.push(`Group ${g}: all 4 teams advance — at most 3 can (top 2 + best thirds).`);
    } else if (inGroup.length === 4 && advancing < 2) {
      warnings.push(`Group ${g}: only ${advancing} team(s) advance — at least 2 will.`);
    }
  }

  return warnings;
}

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

import { Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';

export function RulesPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>How the Pool Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <section className="space-y-1">
            <h3 className="font-semibold text-foreground">Submitting predictions</h3>
            <p className="text-muted-foreground">
              Everyone fills out their picks once, before the pool is locked: the outcome of all 72 group-stage matches,
              plus the full knockout bracket. Your picks save automatically and can be edited until the commissioner
              locks submissions — after that they&apos;re final and everyone can see each other&apos;s picks and the
              standings.
            </p>
          </section>

          <section className="space-y-1">
            <h3 className="font-semibold text-foreground">Group-stage scoring</h3>
            <p className="text-muted-foreground">Pick each match as a home win, away win, or draw.</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>
                Correct win (home or away): <strong className="text-foreground">1 point</strong>
              </li>
              <li>
                Correct draw: <strong className="text-foreground">2 points</strong> (draws are harder to call)
              </li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="font-semibold text-foreground">How teams reach the Round of 32</h3>
            <p className="text-muted-foreground">
              The top 2 teams in each of the 12 groups advance, joined by the 8 best third-placed teams across all
              groups (32 qualifiers total). Group order is derived from your match picks: a win is worth 3 points and a
              draw 1. Because the picks don&apos;t include scores, ties are broken by head-to-head result, then by the
              draw seeding — a simplification that only affects which bracket slot a team lands in, never your points.
            </p>
          </section>

          <section className="space-y-1">
            <h3 className="font-semibold text-foreground">Bracket scoring</h3>
            <p className="text-muted-foreground">
              You earn points cumulatively for every stage a team reaches, up to how far you predicted it would go:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>
                Round of 32: <strong className="text-foreground">1</strong> pt per team
              </li>
              <li>
                Round of 16: <strong className="text-foreground">2</strong> pts
              </li>
              <li>
                Quarterfinals: <strong className="text-foreground">3</strong> pts
              </li>
              <li>
                Semifinals: <strong className="text-foreground">5</strong> pts
              </li>
              <li>
                Final: <strong className="text-foreground">8</strong> pts
              </li>
              <li>
                Champion: <strong className="text-foreground">12</strong> pts
              </li>
            </ul>
            <p className="text-muted-foreground">
              Example: you predict a team to be Champion but it loses in the quarterfinals — you still collect 1 + 2 + 3
              = 6 points for the rounds it did reach.
            </p>
          </section>

          <section className="space-y-1">
            <h3 className="font-semibold text-foreground">Results &amp; standings</h3>
            <p className="text-muted-foreground">
              Match results and team progress fill in automatically from ESPN as games finish, so the standings update
              on their own. The <strong className="text-foreground">Max</strong> column on Standings shows the most
              points you could still reach given which of your teams are already out.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

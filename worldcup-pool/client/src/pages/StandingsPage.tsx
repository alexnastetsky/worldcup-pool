import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import type { Me, StandingRow } from '../lib/pool';
import { fetchJson } from '../lib/pool';

export function StandingsPage({ me }: { me: Me }) {
  const [rows, setRows] = useState<StandingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me.locked) return;
    fetchJson<StandingRow[]>('/api/standings')
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load standings'));
  }, [me.locked]);

  if (!me.locked) {
    return <p className="text-center text-muted-foreground mt-12">Standings appear once submissions are locked.</p>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Standings</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-destructive">{error}</p>}
          {!rows && !error && <Skeleton className="h-40 w-full" />}
          {rows && rows.length === 0 && <p className="text-muted-foreground">No participants yet.</p>}
          {rows && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-2 w-8">#</th>
                  <th className="py-2 pr-2">Player</th>
                  <th className="py-2 pr-2 text-right">Group</th>
                  <th className="py-2 pr-2 text-right">Bracket</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.email}
                    className={`border-b last:border-b-0 ${r.email === me.email ? 'font-semibold' : ''}`}
                  >
                    <td className="py-2 pr-2">{i + 1}</td>
                    <td className="py-2 pr-2">{r.display_name}</td>
                    <td className="py-2 pr-2 text-right">{r.group_points}</td>
                    <td className="py-2 pr-2 text-right">{r.bracket_points}</td>
                    <td className="py-2 text-right font-medium">{r.total_points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

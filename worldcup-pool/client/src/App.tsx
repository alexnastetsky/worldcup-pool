import { createBrowserRouter, RouterProvider, Link, NavLink, Outlet } from 'react-router';
import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@databricks/appkit-ui/react';
import type { Me } from './lib/pool';
import { fetchJson } from './lib/pool';
import { PicksPage } from './pages/PicksPage';
import { StandingsPage } from './pages/StandingsPage';
import { AllPicksPage } from './pages/AllPicksPage';
import { AdminPage } from './pages/AdminPage';
import { RulesPage } from './pages/RulesPage';
import { TodayPage } from './pages/TodayPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

function Layout({ me, refreshMe }: { me: Me; refreshMe: () => void }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-3 md:px-6 py-2.5 md:py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-base md:text-lg font-semibold text-foreground">
          <Link to="/" className="hover:opacity-80 transition-opacity">
            ⚽ World Cup 2026 Pool
          </Link>
        </h1>
        <nav className="flex gap-1 overflow-x-auto">
          <NavLink to="/" end className={navLinkClass}>
            Today
          </NavLink>
          <NavLink to="/my-picks" className={navLinkClass}>
            My Picks
          </NavLink>
          <NavLink to="/standings" className={navLinkClass}>
            Standings
          </NavLink>
          <NavLink to="/picks" className={navLinkClass}>
            Everyone&apos;s Picks
          </NavLink>
          <NavLink to="/rules" className={navLinkClass}>
            Rules
          </NavLink>
          {me.isAdmin && (
            <NavLink to="/admin" className={navLinkClass}>
              Admin
            </NavLink>
          )}
        </nav>
        <span className="ml-auto text-xs text-muted-foreground hidden sm:inline">{me.email}</span>
      </header>

      <div
        className={`px-4 py-1.5 text-center text-sm ${
          me.locked
            ? 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
            : 'bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100'
        }`}
      >
        {me.locked
          ? 'Submissions are locked — standings and all picks are live.'
          : 'Submissions are open — make your picks before the pool locks!'}
      </div>

      <main className="flex-1 p-4 md:p-6">
        <Outlet context={{ me, refreshMe }} />
      </main>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = useCallback(() => {
    fetchJson<Me>('/api/me')
      .then(setMe)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load user'));
  }, []);

  useEffect(refreshMe, [refreshMe]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Skeleton className="h-32 w-80" />
      </div>
    );
  }

  const router = createBrowserRouter([
    {
      element: <Layout me={me} refreshMe={refreshMe} />,
      children: [
        { path: '/', element: <TodayPage me={me} /> },
        { path: '/my-picks', element: <PicksPage me={me} /> },
        { path: '/standings', element: <StandingsPage me={me} /> },
        { path: '/picks', element: <AllPicksPage me={me} /> },
        { path: '/rules', element: <RulesPage /> },
        { path: '/admin', element: <AdminPage me={me} onStateChange={refreshMe} /> },
      ],
    },
  ]);

  return <RouterProvider router={router} />;
}

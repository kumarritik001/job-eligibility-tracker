/**
 * Authenticated application shell: sidebar on desktop, collapsible drawer and a
 * bottom bar on mobile.
 */

import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bell,
  Briefcase,
  Building2,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useUnreadCount } from '../hooks/useData';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/jobs', label: 'Eligible Jobs', icon: Sparkles, status: 'ELIGIBLE' },
  { to: '/jobs?status=ALL', label: 'All Jobs', icon: Briefcase, status: 'ALL' },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

function NavItems({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const unread = useUnreadCount(true);
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-3">
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.label}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive && (!item.to.includes('?') || window.location.search.includes(item.to.split('=')[1]))
                  ? 'bg-brand-soft font-semibold text-brand-ink'
                  : 'text-ink-2 hover:bg-surface-2'
              }`
            }
          >
            <Icon aria-hidden className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.label === 'Notifications' && unread > 0 ? (
              <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                {unread > 99 ? '99+' : unread}
                <span className="sr-only"> unread notifications</span>
              </span>
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}

function Wordmark(): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
      <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">
        JE
      </span>
      <span className="text-sm font-semibold leading-tight">Job Eligibility Tracker</span>
    </div>
  );
}

export function AppLayout(): JSX.Element {
  const { user, signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setDrawerOpen(false), [location.pathname, location.search]);

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <Wordmark />
        <div className="flex-1 overflow-y-auto">
          <NavItems />
        </div>
        <div className="border-t border-line p-3">
          <p className="truncate px-3 pb-2 text-xs text-muted" title={user?.email}>
            {user?.email}
          </p>
          <button type="button" onClick={signOut} className="btn btn-secondary w-full">
            <LogOut aria-hidden className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-3 py-2.5 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="btn btn-secondary px-2"
        >
          <Menu aria-hidden className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold">Job Eligibility Tracker</span>
      </header>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between">
              <Wordmark />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="btn btn-secondary mr-3 px-2"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavItems onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="border-t border-line p-3">
              <button type="button" onClick={signOut} className="btn btn-secondary w-full">
                <LogOut aria-hidden className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 pb-20 lg:px-8 lg:pb-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

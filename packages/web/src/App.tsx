/**
 * Route table and the authentication gate.
 *
 * A 401 from any request clears the session (see useAuth), so the guard is a
 * single decision: is there a session, or send the user to /login and remember
 * where they were headed.
 *
 * The router is deliberately NOT mounted here -- main.tsx supplies the
 * BrowserRouter in the app and a MemoryRouter in tests, so the same tree can be
 * rendered at an arbitrary route.
 */

import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CompaniesPage } from './pages/CompaniesPage';
import { CompanyDetailPage } from './pages/CompanyDetailPage';
import { JobsPage } from './pages/JobsPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { Spinner, ErrorState } from './components/StateViews';

function RequireAuth({ children }: { children: React.ReactNode }): JSX.Element {
  const { status, restoreError, refresh } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    // The session could not be verified (network or 5xx). Offer a retry
    // instead of bouncing to the login screen.
    if (restoreError) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-md">
            <ErrorState error={restoreError} onRetry={() => void refresh()}>
              <p className="mt-1 text-xs text-muted">
                You are still signed in on this device; we just could not reach the server to confirm.
              </p>
            </ErrorState>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Restoring your session…" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:companyId" element={<CompanyDetailPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}

/**
 * Sign in / create account. Uses the backend's local auth only.
 */

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../api/client';

export function LoginPage(): JSX.Element {
  const { login, signup, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await signup(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('server', 0, 'Sign in failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span
            aria-hidden
            className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white"
          >
            JE
          </span>
          <h1 className="text-xl font-semibold">Job Eligibility Tracker</h1>
          <p className="mt-1 text-sm text-muted">See which openings you actually qualify for.</p>
        </div>

        <form onSubmit={submit} className="card space-y-3 p-5">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {mode === 'signup' ? (
              <span className="mt-1 block text-xs text-muted">Use at least 10 characters.</span>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-ineligible/30 bg-ineligible-soft p-2.5 text-sm text-ineligible">
              {error.message}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>

          <p className="text-center text-sm text-muted">
            {mode === 'login' ? "Don't have an account? " : 'Already registered? '}
            <button
              type="button"
              className="font-medium text-brand hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError(null);
              }}
            >
              {mode === 'login' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}

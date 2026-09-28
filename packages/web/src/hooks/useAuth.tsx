/**
 * Authentication state.
 *
 * Uses the backend's existing auth only. The token is a JWT issued by
 * POST /api/auth/login; nothing here adds a second mechanism.
 *
 * A 401 from anywhere in the app funnels into `signOut`, so an expired token
 * cannot leave the UI in a half-authenticated state.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, getToken, onUnauthorized, setToken, setTokenOverride } from '../api/client';
import type { AuthUser, UserProfile } from '../types/api';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  profile: UserProfile | null;
  /** Set when the stored session could not be verified (network/5xx). */
  restoreError: ApiError | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Re-reads GET /api/auth/me; used after profile edits. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>(() => (getToken() ? 'loading' : 'anonymous'));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [restoreError, setRestoreError] = useState<ApiError | null>(null);

  const signOut = useCallback(() => {
    setToken(null);
    setTokenOverride(null);
    setUser(null);
    setProfile(null);
    setRestoreError(null);
    setStatus('anonymous');
  }, []);

  const adopt = useCallback((token: string, next: AuthUser) => {
    setToken(token);
    setTokenOverride(token);
    setUser(next);
    setRestoreError(null);
    setStatus('authenticated');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setUser({ id: me.userId, email: me.profile?.email ?? '' });
      setProfile(me.profile);
      setRestoreError(null);
      setStatus('authenticated');
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) {
        // The server explicitly rejected the token: it really is signed out.
        signOut();
        return;
      }
      // A network or 5xx failure says nothing about the token. Keep waiting
      // rather than bouncing the user to the login screen for a blip.
      setRestoreError(
        err instanceof ApiError ? err : new ApiError('server', 0, 'Could not verify your session.'),
      );
      setStatus('loading');
    }
  }, [signOut]);

  // Restore the session on first paint when a token already exists.
  useEffect(() => {
    if (!getToken()) {
      setStatus('anonymous');
      return;
    }
    void refresh();
  }, [refresh]);

  useEffect(() => onUnauthorized(signOut), [signOut]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      adopt(res.token, res.user);
    },
    [adopt],
  );

  const signup = useCallback(
    async (email: string, password: string) => {
      const res = await api.signup(email, password);
      adopt(res.token, res.user);
    },
    [adopt],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, profile, restoreError, login, signup, signOut, refresh }),
    [status, user, profile, restoreError, login, signup, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setTokenOverride } from '../api/client';

/**
 * Every test gets a clean DOM, no stored token, and a stubbed fetch. Nothing
 * reaches the network, so the suite is deterministic and offline-safe.
 */
beforeEach(() => {
  setTokenOverride(null);
  try {
    localStorage.clear();
  } catch {
    /* storage unavailable */
  }
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Add Company dialog.
 *
 * Submits the name, lets the backend resolve the careers URL, then starts a
 * research run. The caller owns the run polling so the same panel is reused on
 * the company page.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAddCompany } from '../hooks/useData';
import { ErrorState } from './StateViews';

export function AddCompanyModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  /** Receives the created company so the caller can attach the research run. */
  onAdded: (companyId: string) => void;
}): JSX.Element | null {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const { add, busy, error } = useAddCompany();

  useEffect(() => {
    if (open) {
      setName('');
      // Focus the first field so the dialog is immediately usable.
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    const res = await add(name.trim());
    if (res) onAdded(res.company.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 bg-ink/45" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-t-xl bg-surface shadow-xl sm:rounded-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold">
            Add a company
          </h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="btn btn-secondary px-2">
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-4">
          <label className="block">
            <span className="label">Company name</span>
            <input
              ref={inputRef}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ExxonMobil"
              disabled={busy}
              required
            />
          </label>
          <p className="mt-2 text-xs text-muted">
            We will try to locate the official careers page automatically, then research its openings.
          </p>

          {error ? (
            <div className="mt-3">
              <ErrorState error={error} />
            </div>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              {busy ? 'Starting…' : 'Add & Research'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

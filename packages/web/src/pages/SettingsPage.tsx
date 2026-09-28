/** Settings: email digest preferences and data export. */

import { useEffect, useState } from 'react';
import { Download, Mail, Send } from 'lucide-react';
import { PageHeader, Field, Section } from '../components/Primitives';
import { ErrorState, LoadingState } from '../components/StateViews';
import { useAuth } from '../hooks/useAuth';
import { ApiError, api, download } from '../api/client';
import { useResource } from '../hooks/useResource';
import type { EmailSettingsResponse } from '../types/api';

const FREQUENCIES = [
  { value: 'IMMEDIATELY', label: 'Immediately' },
  { value: 'DAILY', label: 'Daily digest' },
  { value: 'WEEKLY', label: 'Weekly digest' },
] as const;

export function SettingsPage(): JSX.Element {
  const { status } = useAuth();
  const enabled = status === 'authenticated';
  const settings = useResource<EmailSettingsResponse>((signal) => api.emailSettings(signal), [], { enabled });

  const [email, setEmail] = useState('');
  const [frequency, setFrequency] = useState<'IMMEDIATELY' | 'DAILY' | 'WEEKLY'>('DAILY');
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setEmail(settings.data.prefs.email ?? '');
    setFrequency(settings.data.prefs.frequency);
    setOn(settings.data.prefs.enabled);
  }, [settings.data]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.saveEmailSettings({ enabled: on, frequency, email: email.trim() || null });
      setMessage('Preferences saved.');
      settings.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('server', 0, 'Could not save preferences.'));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.sendTestEmail();
      setMessage('Test email sent.');
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('server', 0, 'Could not send the test email.'));
    } finally {
      setBusy(false);
    }
  };

  const exportAs = async (format: string) => {
    setError(null);
    try {
      await download(`/api/export/${format}`, `job-tracker.${format}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('server', 0, 'Export failed.'));
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Notification preferences and data export." />

      {settings.loading ? <LoadingState rows={2} /> : null}
      {settings.error ? <ErrorState error={settings.error} onRetry={settings.refetch} /> : null}

      {settings.data ? (
        <>
          {!settings.data.configured ? (
            <div className="card mb-4 border-uncertain/30 bg-uncertain-soft p-4">
              <h2 className="text-sm font-semibold text-uncertain">Email is not configured</h2>
              <p className="mt-1 text-sm text-ink-2">
                This server has no email provider set up, so digests cannot be delivered. You can still save your
                preferences.
              </p>
            </div>
          ) : null}

          <Section title="Email digest" description="Get an email when new eligible jobs appear.">
            <form onSubmit={save} className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
              <Field label="Send to">
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Frequency">
                <select
                  className="input"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as typeof frequency)}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
                  Send me email digests
                </label>
              </div>

              {error ? (
                <div className="sm:col-span-2">
                  <ErrorState error={error} />
                </div>
              ) : null}
              {message ? (
                <p role="status" className="text-sm text-eligible sm:col-span-2">
                  {message}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Mail aria-hidden className="h-4 w-4" />
                  Save preferences
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={sendTest}
                  disabled={busy || !settings.data.configured}
                >
                  <Send aria-hidden className="h-3.5 w-3.5" />
                  Send test email
                </button>
              </div>
            </form>
          </Section>

          <Section title="Export" description="Download your tracked jobs.">
            <div className="card flex flex-wrap gap-2 p-4">
              {['csv', 'xlsx', 'pdf'].map((format) => (
                <button
                  key={format}
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => exportAs(format)}
                >
                  <Download aria-hidden className="h-3.5 w-3.5" />
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}

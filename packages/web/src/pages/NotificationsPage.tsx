/** Notifications list with a mark-as-read action. */

import { Link } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import { PageHeader } from '../components/Primitives';
import { AsyncBoundary, EmptyState } from '../components/StateViews';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useData';
import { relativeTime } from '../lib/format';

export function NotificationsPage(): JSX.Element {
  const { status } = useAuth();
  const { data, loading, error, refetch, markRead } = useNotifications(status === 'authenticated');

  const unread = data?.notifications.filter((n) => !n.readAt) ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description={data ? `${data.unread} unread` : 'Updates from your research runs.'}
        actions={
          unread.length ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => markRead(unread.map((n) => n.id))}
            >
              <CheckCheck aria-hidden className="h-4 w-4" />
              Mark all read
            </button>
          ) : null
        }
      />

      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={refetch}
        loadingRows={4}
        isEmpty={!loading && !error && (data?.notifications.length ?? 0) === 0}
        empty={
          <EmptyState
            title="No notifications"
            description="You will be told when research finds new eligible jobs or a deadline is approaching."
          />
        }
      >
        {data?.notifications.length ? (
          <ul className="card divide-y divide-line">
            {data.notifications.map((n) => (
              <li key={n.id} className={`px-4 py-3 ${n.readAt ? '' : 'bg-brand-soft/40'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {!n.readAt ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />
                      ) : null}
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-2">{n.body}</p>
                    {n.jobId ? (
                      <Link to={`/jobs/${n.jobId}`} className="mt-1 inline-block text-xs text-brand hover:underline">
                        View job
                      </Link>
                    ) : n.companyId ? (
                      <Link to={`/companies/${n.companyId}`} className="mt-1 inline-block text-xs text-brand hover:underline">
                        View company
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs whitespace-nowrap text-muted">{relativeTime(n.createdAt)}</span>
                    {!n.readAt ? (
                      <button
                        type="button"
                        className="btn btn-secondary px-2 py-1 text-xs"
                        onClick={() => markRead([n.id])}
                      >
                        Mark read
                        <span className="sr-only">: {n.title}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </AsyncBoundary>
    </>
  );
}

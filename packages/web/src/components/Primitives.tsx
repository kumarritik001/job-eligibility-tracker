/** Small shared presentational pieces. */

import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatTile({
  label,
  value,
  hint,
  to,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  hint?: string;
  to?: string;
  tone?: 'default' | 'eligible' | 'uncertain' | 'ineligible';
}): JSX.Element {
  const toneClass =
    tone === 'eligible'
      ? 'text-eligible'
      : tone === 'uncertain'
        ? 'text-uncertain'
        : tone === 'ineligible'
          ? 'text-ineligible'
          : 'text-ink';

  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </>
  );

  const className = 'card p-4';
  if (!to) return <div className={className}>{body}</div>;
  return (
    <a href={to} className={`${className} block transition-colors hover:bg-surface-2`}>
      {body}
    </a>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A labelled row of filter controls. */
export function FilterBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function DescriptionList({ rows }: { rows: Array<[string, ReactNode]> }): JSX.Element {
  const visible = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!visible.length) return <p className="text-sm text-muted">Not specified.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {visible.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
          <dd className="mt-0.5 text-sm break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TagList({ items, empty }: { items: string[]; empty?: string }): JSX.Element {
  if (!items.length) return <span className="text-sm text-muted">{empty ?? 'None listed.'}</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-md border border-line-strong bg-surface-2 px-2 py-0.5 text-xs text-ink-2"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * Profile editor.
 *
 * Edits the server's UserProfile via PUT /api/profile. Nothing is cached in
 * localStorage -- the only persisted copy is the server's.
 *
 * Field names match the zod schema in routes/api.ts exactly.
 */

import { useEffect, useState } from 'react';
import { Check, Save } from 'lucide-react';
import { PageHeader, Field, Section } from '../components/Primitives';
import { AsyncBoundary, EmptyState, ErrorState } from '../components/StateViews';
import { useAuth } from '../hooks/useAuth';
import { useProfile } from '../hooks/useData';
import { linesToList } from '../lib/format';
import type { UserProfile } from '../types/api';

type Draft = {
  name: string;
  degree: string;
  branch: string;
  college: string;
  graduationYear: string;
  cgpa: string;
  cgpaScale: string;
  gateScore: string;
  gateRank: string;
  gateYear: string;
  gateBranch: string;
  yearsOfExperience: string;
  minDesiredExperience: string;
  maxDesiredExperience: string;
  internships: string;
  certifications: string;
  skills: string;
  workAuthorization: string;
  preferredLocations: string;
  preferredJobTypes: string;
  willingToRelocate: boolean;
};

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

function toDraft(p: UserProfile): Draft {
  return {
    name: p.name ?? '',
    degree: p.degree ?? '',
    branch: p.branch ?? '',
    college: p.college ?? '',
    graduationYear: String(p.graduationYear ?? ''),
    cgpa: p.cgpa === null || p.cgpa === undefined ? '' : String(p.cgpa),
    cgpaScale: String(p.cgpaScale ?? 10),
    gateScore: p.gateScore == null ? '' : String(p.gateScore),
    gateRank: p.gateRank == null ? '' : String(p.gateRank),
    gateYear: p.gateYear == null ? '' : String(p.gateYear),
    gateBranch: p.gateBranch ?? '',
    yearsOfExperience: String(p.yearsOfExperience ?? 0),
    minDesiredExperience: String(p.minDesiredExperience ?? 0),
    maxDesiredExperience: String(p.maxDesiredExperience ?? 0),
    internships: p.internships ?? '',
    certifications: (p.certifications ?? []).join('\n'),
    skills: (p.skills ?? []).join('\n'),
    workAuthorization: (p.workAuthorization ?? []).join('\n'),
    preferredLocations: (p.preferredLocations ?? []).join('\n'),
    preferredJobTypes: (p.preferredJobTypes ?? []).join('\n'),
    willingToRelocate: Boolean(p.willingToRelocate),
  };
}

export function ProfilePage(): JSX.Element {
  const { status, refresh } = useAuth();
  const profile = useProfile(status === 'authenticated');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-seed the form whenever the server sends a new profile.
  useEffect(() => {
    if (profile.data?.profile) setDraft(toDraft(profile.data.profile));
  }, [profile.data]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setSaved(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const patch = {
      name: draft.name,
      degree: draft.degree,
      branch: draft.branch,
      college: draft.college.trim() || null,
      graduationYear: draft.graduationYear ? Number(draft.graduationYear) : undefined,
      cgpa: num(draft.cgpa),
      cgpaScale: draft.cgpaScale ? Number(draft.cgpaScale) : undefined,
      gateScore: num(draft.gateScore),
      gateRank: num(draft.gateRank),
      gateYear: num(draft.gateYear),
      gateBranch: draft.gateBranch.trim() || null,
      yearsOfExperience: draft.yearsOfExperience ? Number(draft.yearsOfExperience) : undefined,
      minDesiredExperience: draft.minDesiredExperience ? Number(draft.minDesiredExperience) : undefined,
      maxDesiredExperience: draft.maxDesiredExperience ? Number(draft.maxDesiredExperience) : undefined,
      internships: draft.internships,
      certifications: linesToList(draft.certifications),
      skills: linesToList(draft.skills),
      workAuthorization: linesToList(draft.workAuthorization),
      preferredLocations: linesToList(draft.preferredLocations),
      preferredJobTypes: linesToList(draft.preferredJobTypes),
      willingToRelocate: draft.willingToRelocate,
    };
    const res = await profile.save(patch);
    if (res) {
      setSaved(true);
      void refresh();
    }
  };

  if (profile.error) return <ErrorState error={profile.error} onRetry={profile.refetch} />;

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your details drive every eligibility verdict. The more complete this is, the more precise the results."
        actions={
          <button type="submit" form="profile-form" className="btn btn-primary" disabled={profile.saving || !draft}>
            <Save aria-hidden className="h-4 w-4" />
            {profile.saving ? 'Saving…' : 'Save profile'}
          </button>
        }
      />

      <AsyncBoundary loading={profile.loading} error={null} loadingRows={5}>
        {profile.data && !draft ? (
          <EmptyState title="No profile yet" description="This account has no profile. Reload to create one." />
        ) : draft ? (
          <>
            {profile.data?.gaps.length ? (
              <div className="card mb-4 border-uncertain/30 bg-uncertain-soft p-4">
                <h2 className="text-sm font-semibold text-uncertain">Still missing</h2>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                  {profile.data.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {profile.saveError ? (
              <div className="mb-4">
                <ErrorState error={profile.saveError} />
              </div>
            ) : null}

            {saved ? (
              <p role="status" className="card mb-4 flex items-center gap-2 border-eligible/30 bg-eligible-soft p-3 text-sm text-eligible">
                <Check aria-hidden className="h-4 w-4" />
                Profile saved. Existing verdicts are re-analysed when you next open a company.
              </p>
            ) : null}

            <form id="profile-form" onSubmit={submit} className="space-y-5">
              <Panel title="Personal information">
                <Field label="Full name">
                  <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label="Years of experience">
                  <input
                    type="number"
                    min={0}
                    max={60}
                    className="input"
                    value={draft.yearsOfExperience}
                    onChange={(e) => set('yearsOfExperience', e.target.value)}
                  />
                </Field>
                <Field label="Willing to relocate">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.willingToRelocate}
                      onChange={(e) => set('willingToRelocate', e.target.checked)}
                    />
                    Yes, I can relocate
                  </label>
                </Field>
              </Panel>

              <Panel title="Education">
                <Field label="Degree">
                  <input
                    className="input"
                    value={draft.degree}
                    onChange={(e) => set('degree', e.target.value)}
                    placeholder="B.Tech"
                  />
                </Field>
                <Field label="Branch">
                  <input
                    className="input"
                    value={draft.branch}
                    onChange={(e) => set('branch', e.target.value)}
                    placeholder="Chemical Engineering"
                  />
                </Field>
                <Field label="College">
                  <input className="input" value={draft.college} onChange={(e) => set('college', e.target.value)} />
                </Field>
                <Field label="Graduation year">
                  <input
                    type="number"
                    className="input"
                    value={draft.graduationYear}
                    onChange={(e) => set('graduationYear', e.target.value)}
                  />
                </Field>
                <Field label="CGPA">
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={draft.cgpa}
                    onChange={(e) => set('cgpa', e.target.value)}
                  />
                </Field>
                <Field label="CGPA scale" hint="Usually 10.">
                  <input
                    type="number"
                    className="input"
                    value={draft.cgpaScale}
                    onChange={(e) => set('cgpaScale', e.target.value)}
                  />
                </Field>
              </Panel>

              <Panel title="Experience">
                <Field label="Minimum desired experience (years)">
                  <input
                    type="number"
                    className="input"
                    value={draft.minDesiredExperience}
                    onChange={(e) => set('minDesiredExperience', e.target.value)}
                  />
                </Field>
                <Field label="Maximum desired experience (years)">
                  <input
                    type="number"
                    className="input"
                    value={draft.maxDesiredExperience}
                    onChange={(e) => set('maxDesiredExperience', e.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Internships" hint="One per line.">
                    <textarea
                      className="input min-h-20"
                      value={draft.internships}
                      onChange={(e) => set('internships', e.target.value)}
                    />
                  </Field>
                </div>
              </Panel>

              <Panel title="Skills">
                <div className="sm:col-span-2">
                  <Field label="Skills" hint="One per line, e.g. Aspen Plus, MATLAB.">
                    <textarea
                      className="input min-h-28"
                      value={draft.skills}
                      onChange={(e) => set('skills', e.target.value)}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Certifications" hint="One per line.">
                    <textarea
                      className="input min-h-20"
                      value={draft.certifications}
                      onChange={(e) => set('certifications', e.target.value)}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Work authorization" hint="One per line.">
                    <textarea
                      className="input min-h-20"
                      value={draft.workAuthorization}
                      onChange={(e) => set('workAuthorization', e.target.value)}
                    />
                  </Field>
                </div>
              </Panel>

              <Panel title="GATE">
                <Field label="GATE score">
                  <input
                    type="number"
                    className="input"
                    value={draft.gateScore}
                    onChange={(e) => set('gateScore', e.target.value)}
                  />
                </Field>
                <Field label="GATE rank">
                  <input
                    type="number"
                    className="input"
                    value={draft.gateRank}
                    onChange={(e) => set('gateRank', e.target.value)}
                  />
                </Field>
                <Field label="GATE year">
                  <input
                    type="number"
                    className="input"
                    value={draft.gateYear}
                    onChange={(e) => set('gateYear', e.target.value)}
                  />
                </Field>
                <Field label="GATE branch">
                  <input
                    className="input"
                    value={draft.gateBranch}
                    onChange={(e) => set('gateBranch', e.target.value)}
                    placeholder="Chemical Engineering"
                  />
                </Field>
              </Panel>

              <Panel title="Preferences">
                <div className="sm:col-span-2">
                  <Field label="Preferred locations" hint="One per line.">
                    <textarea
                      className="input min-h-20"
                      value={draft.preferredLocations}
                      onChange={(e) => set('preferredLocations', e.target.value)}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Preferred job types" hint="One per line, e.g. Full time, Internship.">
                    <textarea
                      className="input min-h-20"
                      value={draft.preferredJobTypes}
                      onChange={(e) => set('preferredJobTypes', e.target.value)}
                    />
                  </Field>
                </div>
              </Panel>
            </form>
          </>
        ) : null}
      </AsyncBoundary>
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <Section title={title}>
      <div className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">{children}</div>
    </Section>
  );
}

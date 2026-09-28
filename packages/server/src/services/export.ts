/**
 * Exports.
 *
 * Every exported row carries its source URL and last-verified timestamp, so a
 * spreadsheet is as traceable as the UI. Missing values are written as an
 * explicit "Not specified in posting" rather than left blank, because a blank
 * cell reads as "no requirement" and that is exactly the kind of quiet
 * inaccuracy this app exists to avoid.
 */

import type { UserProfile } from '@jet/shared';
import type { JobListItem } from './store.js';

const NOT_STATED = 'Not specified in posting';

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return NOT_STATED;
  const s = String(value).trim();
  return s === '' ? NOT_STATED : s;
}

const COLUMNS = [
  'Company', 'Role', 'Verdict', 'Match score (%)', 'Location', 'Work arrangement', 'Employment type',
  'Posted', 'Closing date', 'Experience (min yrs)', 'Experience (max yrs)', 'Education requirement',
  'Required skills', 'Preferred skills', 'Salary', 'Status', 'Verification', 'Source',
  'Source is official', 'Also seen at', 'First seen', 'Last verified', 'Job ID',
] as const;

function row(j: JobListItem): string[] {
  return [
    cell(j.companyName),
    cell(j.title),
    cell(j.eligibilityStatus),
    j.matchScore === null ? NOT_STATED : String(j.matchScore),
    cell(j.location),
    cell(j.workArrangement),
    cell(j.employmentType),
    cell(j.postedAt),
    cell(j.closingAt),
    j.experienceMin === null ? NOT_STATED : String(j.experienceMin),
    j.experienceMax === null ? NOT_STATED : String(j.experienceMax),
    cell(j.educationRequirement),
    j.requiredSkills.length ? j.requiredSkills.join('; ') : NOT_STATED,
    j.preferredSkills.length ? j.preferredSkills.join('; ') : NOT_STATED,
    cell(j.salary),
    cell(j.status),
    cell(j.verification),
    j.sourceUrl,
    j.isOfficialSource ? 'Yes' : 'No (third-party listing)',
    j.alsoSeenAt.length ? j.alsoSeenAt.join('; ') : 'Only one source found',
    cell(j.firstSeenAt),
    cell(j.lastVerifiedAt),
    cell(j.externalJobId),
  ];
}

function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(jobs: JobListItem[]): string {
  const lines = [COLUMNS.map(escapeCsv).join(',')];
  for (const j of jobs) lines.push(row(j).map(escapeCsv).join(','));
  return lines.join('\r\n');
}

export async function buildExcel(jobs: JobListItem[], ownerName: string): Promise<Buffer> {
  // exceljs is CommonJS, so under ESM the named export is absent and the real
  // constructor hangs off `default` -- same interop as pdfkit in buildPdf.
  // Importing `{ Workbook }` directly yields undefined and `new Workbook()`
  // throws "Workbook is not a constructor" at request time.
  const { Workbook } = (await import('exceljs')).default as unknown as typeof import('exceljs');
  const wb = new Workbook();
  const ws = wb.addWorksheet('Jobs');

  ws.addRow(['Job Eligibility Tracker export']);
  ws.addRow(['Owner', ownerName]);
  ws.addRow(['Exported', new Date().toISOString()]);
  ws.addRow(['Rows', jobs.length]);
  ws.addRow(['Note', 'ACTIVE source-verified openings only. Match score is informational; mandatory requirements decide the verdict.']);
  ws.addRow([]);

  const header = ws.addRow([...COLUMNS]);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  header.alignment = { vertical: 'middle' };

  for (const j of jobs) ws.addRow(row(j));

  ws.getRow(6).height = 22;
  ws.columns = COLUMNS.map((name) => ({ header: name, key: name, width: widthFor(name) }));
  ws.getRow(6).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  ws.views = [{ state: 'frozen', ySplit: 6 }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function widthFor(name: string): number {
  if (name === 'Source' || name === 'Also seen at') return 46;
  if (name === 'Required skills' || name === 'Preferred skills') return 34;
  if (name === 'Education requirement') return 30;
  return 20;
}

export async function buildPdf(jobs: JobListItem[], profile: UserProfile | null): Promise<Buffer> {
  // pdfkit is CommonJS and streams its output, so it is imported and awaited
  // rather than required.
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(16).text('Job Eligibility Tracker', { continued: false });
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor('#475569');
  doc.text(`Exported ${new Date().toISOString()}  |  ${jobs.length} job(s)`);
  if (profile) {
    doc.text(`${profile.degree} ${profile.branch}, graduating ${profile.graduationYear || 'n/a'}`);
  }
  doc.text('Counts include ACTIVE, source-verified openings only. Match score is informational.');
  doc.moveDown(1);
  doc.fillColor('#0f172a');

  for (const j of jobs) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.fontSize(11).text(`${j.title} — ${j.companyName}`, { continued: false });
    doc.fontSize(8.5).fillColor('#475569');
    const bits = [
      j.eligibilityStatus ? `Verdict: ${j.eligibilityStatus}` : 'Verdict: not analyzed',
      j.matchScore === null ? null : `Match: ${j.matchScore}%`,
      j.location ? `Location: ${j.location}` : 'Location: not specified in posting',
      j.postedAt ? `Posted: ${j.postedAt.slice(0, 10)}` : 'Posted: not specified in posting',
      j.closingAt ? `Closes: ${j.closingAt.slice(0, 10)}` : 'Closes: not specified in posting',
      `Last verified: ${j.lastVerifiedAt ? j.lastVerifiedAt.slice(0, 10) : 'never'}`,
    ].filter(Boolean) as string[];
    doc.text(bits.join('   |   '));
    doc.fontSize(8).fillColor('#2563eb').text(j.sourceUrl);
    doc.fillColor('#475569');
    if (!j.isOfficialSource) doc.text('Third-party listing — the official company page could not be confirmed.');
    doc.moveDown(0.7);
  }

  doc.end();
  return done;
}

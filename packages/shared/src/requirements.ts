/**
 * Deterministic requirement extraction.
 *
 * Everything the eligibility engine knows about a job comes from here. Two
 * rules govern this file:
 *
 *   1. Structured fields supplied by an ATS (schema.org / Greenhouse / Lever)
 *      are EXPLICIT and always beat anything inferred from prose.
 *   2. Anything we cannot actually find is recorded as a gap. We never
 *      substitute a plausible default -- that is what turns into fabricated
 *      "eligible" verdicts downstream.
 */

import type { DegreeLevel, FieldId, JobRequirements, RequirementOrigin } from './types.js';
import { classifyDegreeLevel, classifyField } from './degrees.js';
import { skillsInText } from './skills.js';
import { collapseWhitespace, comparable, evidenceAround } from './text.js';

export interface ExtractInput {
  title: string;
  description?: string | null;
  /** ATS-supplied structured education requirement, if any. */
  educationRequirement?: string | null;
  /** ATS-supplied numeric experience bounds, if any. */
  experienceMin?: number | null;
  experienceMax?: number | null;
  location?: string | null;
  employmentType?: string | null;
  titleRaw?: string | null;
  /** Free-form "requirements" / "responsibilities" bullets from the posting. */
  requirementsText?: string | null;
}

const PREFERRED_MARKERS = /\b(preferred|preferably|nice to have|nice-to-have|good to have|desirable|desirable to have|ideally|advantageous|an advantage|plus|bonus|would be a plus|is a plus|optional|favorable|favourable)\b/i;
const MANDATORY_MARKERS = /\b(required|requirement|requirements|must|mandatory|essential|at least|minimum|min\.?|need|needs|we require|only candidates|should have|basic qualification|basic qualifications|required qualification)\b/i;

const SENIORITY_MARKERS =
  /\b(senior|sr\.?|snr|lead|principal|staff|chief|manager|management|director|head of|vp|vice president|executive|experienced|expert|distinguished|grade\s*[a-z]\b|level\s*(ii|iii|iv|2|3|4)\b|ph\.?d|iii)\b/i;

const GRADUATE_MARKERS = /\b(fresher|freshers|fresh graduate|recent graduate|new graduate|newly graduate|no experience required|no experience needed|entry[- ]level|entry level|graduate trainee|management trainee|junior|0\s*[-–to]*\s*\d*\s*years?)\b/i;

const CURRENT_YEAR = new Date().getFullYear();

export function extractRequirements(input: ExtractInput): JobRequirements {
  const title = collapseWhitespace(input.title ?? '');
  const description = collapseWhitespace(input.description ?? '');
  const eduRaw = collapseWhitespace(input.educationRequirement ?? '');
  const reqText = collapseWhitespace(input.requirementsText ?? '');
  const locationRaw = collapseWhitespace(input.location ?? '');

  // The full evidence corpus, in priority order for quoted proof.
  const corpus = [eduRaw, reqText, description, title].filter(Boolean).join('\n');
  const evidence: Record<string, string> = {};
  const origin: Record<string, RequirementOrigin> = {};
  const gaps: string[] = [];

  // --- Education level -----------------------------------------------------
  const degreeLevel = resolveDegreeLevel(eduRaw, description, evidence, origin);
  const degreeLevelLabel: DegreeLevel = degreeLevel as DegreeLevel;

  // --- Fields (major / branch) --------------------------------------------
  const fieldResult = resolveFields(eduRaw, description, title, evidence, origin);

  // --- Experience ----------------------------------------------------------
  const exp = resolveExperience(
    { title, description, eduRaw, min: input.experienceMin ?? null, max: input.experienceMax ?? null },
    evidence,
    origin,
  );

  // --- Graduation year -----------------------------------------------------
  const grad = resolveGraduationYear(corpus, evidence, origin);

  // --- Skills --------------------------------------------------------------
  const skills = resolveSkills(reqText, description, title);

  // --- Certifications ------------------------------------------------------
  const certs = resolveCertifications(corpus);

  // --- Location & relocation ----------------------------------------------
  const loc = resolveLocation(corpus, locationRaw, evidence, origin);

  // --- Work authorization --------------------------------------------------
  const workAuth = resolveWorkAuthorization(corpus);

  // --- Gap bookkeeping -----------------------------------------------------
  if (degreeLevel === 'UNKNOWN') {
    gaps.push('The posting does not state a required degree level.');
  }
  if (fieldResult.fields.length === 0 && !fieldResult.generic) {
    gaps.push('The posting does not name a required field or major.');
  }
  if (!exp.stated && !exp.impliedSeniority) {
    // Not a gap: many postings simply have no experience gate. Recorded as
    // "no stated requirement" rather than missing information.
  } else if (!exp.stated && exp.impliedSeniority) {
    gaps.push('The title implies a senior role but the posting does not quantify the required experience.');
  }
  if (!locationRaw && loc.locations.length === 0) {
    gaps.push('The posting does not specify a location.');
  }

  return {
    degreeLevel: degreeLevelLabel,
    degreeLevelRaw: eduRaw || null,
    fields: fieldResult.fields,
    fieldsRaw: fieldResult.raw,
    acceptsEquivalent: fieldResult.acceptsEquivalent,

    experienceMin: exp.min,
    experienceMax: exp.max,
    experienceStated: exp.stated,
    experienceMandatory: exp.mandatory,
    experienceRaw: exp.raw,

    gradYearMin: grad.min,
    gradYearMax: grad.max,
    gradYearStated: grad.stated,
    gradYearRaw: grad.raw,

    skillsRequired: skills.required,
    skillsPreferred: skills.preferred,
    skillsRequiredRaw: skills.requiredRaw,
    certifications: certs,

    locations: loc.locations,
    locationRestricted: loc.restricted,
    locationRaw: locationRaw || loc.raw,
    requiresRelocation: loc.relocation,

    workAuthorization: workAuth.list,
    origin,
    evidence,
    gaps,
  };
}

// ---------------------------------------------------------------------------
// Degree level
// ---------------------------------------------------------------------------

function resolveDegreeLevel(
  eduRaw: string,
  description: string,
  evidence: Record<string, string>,
  origin: Record<string, RequirementOrigin>,
): DegreeLevel | 'UNKNOWN' {
  if (eduRaw) {
    const lv = classifyDegreeLevel(eduRaw);
    if (lv !== 'UNKNOWN') {
      evidence.DEGREE_LEVEL = eduRaw;
      origin.DEGREE_LEVEL = 'EXPLICIT';
      return lv as DegreeLevel;
    }
  }
  // Look for a sentence that talks about degree + field.
  const m =
    /(?:bachelor'?s?|b\.?sc|b\.?tech|b\.?e\.?|master'?s?|m\.?tech|m\.?sc|ph\.?d|doctorate|graduate|undergraduate)[^.]{0,120}(?:degree|diploma)?[^.]{0,120}(?:engineering|technology|science)?[^.]{0,80}/i.exec(
      description,
    );
  if (m) {
    const lv = classifyDegreeLevel(m[0]);
    if (lv !== 'UNKNOWN') {
      evidence.DEGREE_LEVEL = collapseWhitespace(m[0]);
      origin.DEGREE_LEVEL = 'INFERRED';
      return lv as DegreeLevel;
    }
  }
  origin.DEGREE_LEVEL = 'MISSING';
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Fields / majors
// ---------------------------------------------------------------------------

const EQUIVALENT_MARKERS =
  /\b(or equivalent|or an equivalent|or similar|or related|or equivalent discipline|or a related discipline|or any related|or comparable|or other related|equivalently)\b/i;

const FIELD_LIST_SPLIT = /\s*(?:,|\/|\||;|\bor\b|\band\b)\s*/i;

function resolveFields(
  eduRaw: string,
  description: string,
  title: string,
  evidence: Record<string, string>,
  origin: Record<string, RequirementOrigin>,
): { fields: FieldId[]; raw: string; generic: boolean; acceptsEquivalent: boolean } {
  // 1. Structured education requirement wins.
  const haystacks: Array<{ text: string; origin: RequirementOrigin }> = [];
  if (eduRaw) haystacks.push({ text: eduRaw, origin: 'EXPLICIT' });
  if (description) haystacks.push({ text: description, origin: 'INFERRED' });
  if (title) haystacks.push({ text: title, origin: 'INFERRED' });

  let acceptsEquivalent = false;
  for (const { text } of haystacks) {
    if (EQUIVALENT_MARKERS.test(text)) acceptsEquivalent = true;
  }

  for (const { text, origin: srcOrigin } of haystacks) {
    // Find the sentence(s) that mention a degree/field so we don't pick up
    // incidental mentions from responsibilities sections.
    const candidates = extractFieldSentences(text);
    const fields: FieldId[] = [];
    let matchedText = '';
    for (const sentence of candidates) {
      const c = comparable(sentence);
      if (!/\b(engineering|engineering|technology|technology|science|science|degree|b\.?tech|b\.?e|b\.?sc|m\.?tech|m\.?sc|bachelor|master|phd|graduat)\b/.test(c)) continue;
      for (const part of sentence.split(FIELD_LIST_SPLIT)) {
        const id = classifyField(part);
        if (id && id !== 'UNKNOWN_FIELD' && !fields.includes(id)) {
          fields.push(id);
          matchedText = matchedText ? `${matchedText}; ${collapseWhitespace(sentence)}` : collapseWhitespace(sentence);
        }
      }
    }

    if (fields.length > 0) {
      evidence.FIELD = matchedText;
      origin.FIELD = srcOrigin;
      const generic = fields.length === 1 && (fields[0] === 'GENERAL_ENGINEERING' || fields[0] === 'TECHNOLOGY_GENERIC' || fields[0] === 'SCIENCE_GENERIC');
      return {
        fields,
        raw: matchedText,
        generic,
        acceptsEquivalent,
      };
    }
  }

  origin.FIELD = 'MISSING';
  return { fields: [], raw: '', generic: false, acceptsEquivalent };
}

function extractFieldSentences(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\n+|•+|·+/)
    .map((s) => collapseWhitespace(s))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

interface ExperienceResult {
  min: number | null;
  max: number | null;
  stated: boolean;
  mandatory: boolean;
  raw: string | null;
  impliedSeniority: boolean;
}

function resolveExperience(
  ctx: { title: string; description: string; eduRaw: string; min: number | null; max: number | null },
  evidence: Record<string, string>,
  origin: Record<string, RequirementOrigin>,
): ExperienceResult {
  // 1. Structured ATS bounds are authoritative.
  if (ctx.min !== null || ctx.max !== null) {
    evidence.EXPERIENCE = `ATS structured experience: ${ctx.min ?? 0}${ctx.max !== null ? `-${ctx.max}` : '+'} years`;
    origin.EXPERIENCE = 'EXPLICIT';
    return {
      min: ctx.min ?? 0,
      max: ctx.max,
      stated: true,
      mandatory: true,
      raw: `${ctx.min ?? 0}${ctx.max !== null ? `-${ctx.max}` : '+'} years`,
      impliedSeniority: false,
    };
  }

  const corpus = [ctx.eduRaw, ctx.description, ctx.title].filter(Boolean).join('\n');

  // 2. "Fresher" / "no experience" markers.
  const fresh = GRADUATE_MARKERS.exec(corpus);
  if (fresh) {
    evidence.EXPERIENCE = evidenceAround(corpus, fresh.index, fresh[0].length);
    origin.EXPERIENCE = 'INFERRED';
    return { min: 0, max: 0, stated: true, mandatory: false, raw: fresh[0], impliedSeniority: false };
  }

  // 3. Explicit ranges: "3-5 years", "0 to 2 years", "3 - 5 yrs"
  const range = /\b(\d{1,2})\s*(?:-|–|—|to|~)\s*(\d{1,2})\s*(?:years?|yrs?)\b(?:\s*(?:of|in)\s+(?:relevant\s+|hands[- ]on\s+|industrial\s+)?experience)?/i.exec(corpus);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    evidence.EXPERIENCE = evidenceAround(corpus, range.index, range[0].length);
    origin.EXPERIENCE = 'INFERRED';
    return {
      min: Math.min(lo, hi),
      max: Math.max(lo, hi),
      stated: true,
      mandatory: hasMandatoryNearby(corpus, range.index, range[0].length),
      raw: range[0],
      impliedSeniority: false,
    };
  }

  // 4. "5+ years", "10 + years of experience"
  const plus = /\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i.exec(corpus);
  if (plus) {
    evidence.EXPERIENCE = evidenceAround(corpus, plus.index, plus[0].length);
    origin.EXPERIENCE = 'INFERRED';
    return { min: Number(plus[1]), max: null, stated: true, mandatory: true, raw: plus[0], impliedSeniority: false };
  }

  // 5. "at least N years", "minimum N years", "N years of experience required"
  const atLeast = /\b(?:at\s+least|minimum|min\.?|more\s+than|over|no\s+less\s+than|require[sd]?\s+(?:at\s+least\s+)?)\s*(\d{1,2})\s*(?:years?|yrs?)/i.exec(corpus);
  if (atLeast) {
    evidence.EXPERIENCE = evidenceAround(corpus, atLeast.index, atLeast[0].length);
    origin.EXPERIENCE = 'INFERRED';
    return { min: Number(atLeast[1]), max: null, stated: true, mandatory: true, raw: atLeast[0], impliedSeniority: false };
  }

  // 6. "up to N years", "N years or less"
  const upTo = /\b(?:up\s+to|less\s+than|within|maximum|max\.?)\s*(\d{1,2})\s*(?:years?|yrs?)/i.exec(corpus);
  if (upTo) {
    evidence.EXPERIENCE = evidenceAround(corpus, upTo.index, upTo[0].length);
    origin.EXPERIENCE = 'INFERRED';
    return { min: 0, max: Number(upTo[1]), stated: true, mandatory: false, raw: upTo[0], impliedSeniority: false };
  }

  // 7. Bare "N years of experience" -- capture but do not assume it gates.
  const bare = /\b(\d{1,2})\s*(?:\+\s*)?(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+|hands[- ]on\s+|industry\s+|industrial\s+)?experience\b/i.exec(corpus);
  if (bare) {
    evidence.EXPERIENCE = evidenceAround(corpus, bare.index, bare[0].length);
    origin.EXPERIENCE = 'INFERRED';
    const n = Number(bare[1]);
    return { min: n, max: null, stated: true, mandatory: hasMandatoryNearby(corpus, bare.index, bare[0].length), raw: bare[0], impliedSeniority: false };
  }

  // 8. Nothing stated. If the title screams seniority, that is an implied but
  //    unquantified requirement -> information gap, not a licence to guess.
  const seniority = SENIORITY_MARKERS.exec(ctx.title);
  if (seniority) {
    evidence.EXPERIENCE = `Title contains a seniority marker ("${seniority[0]}") but no experience requirement is stated.`;
    origin.EXPERIENCE = 'INFERRED';
    return { min: null, max: null, stated: false, mandatory: false, raw: null, impliedSeniority: true };
  }

  origin.EXPERIENCE = 'MISSING';
  return { min: null, max: null, stated: false, mandatory: false, raw: null, impliedSeniority: false };
}

/** Does a mandatory marker appear within ~120 chars before or after the match? */
function hasMandatoryNearby(corpus: string, index: number, length: number): boolean {
  const before = corpus.slice(Math.max(0, index - 130), index);
  const after = corpus.slice(index + length, index + length + 90);
  return MANDATORY_MARKERS.test(before) || MANDATORY_MARKERS.test(after);
}

// ---------------------------------------------------------------------------
// Graduation year
// ---------------------------------------------------------------------------

function resolveGraduationYear(
  corpus: string,
  evidence: Record<string, string>,
  origin: Record<string, RequirementOrigin>,
): { min: number | null; max: number | null; stated: boolean; raw: string | null } {
  const year = `(?:19|20)\\d{2}`;

  // "graduating in 2026", "batch of 2026", "class of 2026", "2026 batch"
  const m1 = new RegExp(
    `\\b(?:graduat\\w*|batch|class|cohort|promot\\w*)[^.\\n]{0,40}?\\b(${year})\\b|\\b(${year})\\s*(?:batch|graduat\\w*|batch)\\b`,
    'i',
  ).exec(corpus);
  if (m1) {
    const y = Number(m1[1] ?? m1[2]);
    if (y >= 2000 && y <= CURRENT_YEAR + 10) {
      evidence.GRADUATION_YEAR = evidenceAround(corpus, m1.index, m1[0].length);
      origin.GRADUATION_YEAR = 'INFERRED';
      return { min: y, max: y, stated: true, raw: m1[0] };
    }
  }

  // Range: "2026 - 2027 batch", "between 2025 and 2027"
  const m2 = new RegExp(`\\b(${year})\\s*(?:-|–|—|to)\\s*(${year})\\s*(?:batch|graduat|passing|out)?`, 'i').exec(corpus);
  if (m2) {
    const a = Number(m2[1]);
    const b = Number(m2[2]);
    if (a >= 2000 && b <= CURRENT_YEAR + 10) {
      evidence.GRADUATION_YEAR = evidenceAround(corpus, m2.index, m2[0].length);
      origin.GRADUATION_YEAR = 'INFERRED';
      return { min: Math.min(a, b), max: Math.max(a, b), stated: true, raw: m2[0] };
    }
  }

  // "graduated in 2025 or earlier" / "before 2025" -> hard upper bound
  const m3 = new RegExp(
    `\\b(?:graduat\\w*|pass(?:ing|ed)?)[^.\\n]{0,30}?(?:on\\s+or\\s+before|before|no\\s+later\\s+than|or\\s+earlier|prior\\s+to)\\s+(${year})\\b`,
    'i',
  ).exec(corpus);
  if (m3) {
    const y = Number(m3[1]);
    if (y >= 2000 && y <= CURRENT_YEAR + 10) {
      evidence.GRADUATION_YEAR = evidenceAround(corpus, m3.index, m3[0].length);
      origin.GRADUATION_YEAR = 'INFERRED';
      return { min: null, max: y, stated: true, raw: m3[0] };
    }
  }

  // "2024 or earlier graduates"
  const m4 = new RegExp(`\\b(${year})\\s*(?:or\\s+)?(?:earlier|before|and\\s+prior)`, 'i').exec(corpus);
  if (m4) {
    const y = Number(m4[1]);
    evidence.GRADUATION_YEAR = evidenceAround(corpus, m4.index, m4[0].length);
    origin.GRADUATION_YEAR = 'INFERRED';
    return { min: null, max: y, stated: true, raw: m4[0] };
  }

  origin.GRADUATION_YEAR = 'MISSING';
  return { min: null, max: null, stated: false, raw: null };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function resolveSkills(
  reqText: string,
  description: string,
  title: string,
): { required: string[]; preferred: string[]; requiredRaw: string[] } {
  const required = new Set<string>();
  const preferred = new Set<string>();
  const requiredRaw: string[] = [];
  // Skills named in the posting but in neither a requirement nor a preference
  // context. They are recorded, but they never gate eligibility.
  const mentioned = new Set<string>();

  const scan = (text: string, assumeMandatory: boolean) => {
    if (!text) return;
    for (const sentence of extractFieldSentences(text)) {
      const isPreferred = PREFERRED_MARKERS.test(sentence);
      const isMandatory = assumeMandatory || MANDATORY_MARKERS.test(sentence);
      const found = skillsInText(sentence);
      if (found.length === 0) continue;
      for (const s of found) {
        // A skill framed as preferred anywhere is never required.
        if (isPreferred) {
          preferred.add(s);
          required.delete(s);
        } else if (isMandatory) {
          required.add(s);
          requiredRaw.push(collapseWhitespace(sentence));
        } else {
          // A duty or context mention ("you will support distillation") is not
          // a requirement, so it must not become a disqualifying condition.
          mentioned.add(s);
        }
      }
    }
  };

  // The structured requirements block is mandatory by construction; the free
  // description is scanned for explicit markers only.
  scan(reqText, true);
  scan(description, false);
  // A skill in the title ("Process Engineer") names the discipline, not a
  // requirement, so it is a mention.
  for (const s of skillsInText(title)) mentioned.add(s);

  return {
    required: [...required],
    preferred: [...preferred],
    requiredRaw: [...new Set(requiredRaw)].slice(0, 12),
  };
}

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

const CERT_PATTERNS: Array<[string, RegExp]> = [
  ['GATE', /\bgate\s*(?:score|rank|qualif\w*)?\b/i],
  ['NPTEL', /\bnptel\b/i],
  ['Six Sigma', /\bsix\s*sigma\b/i],
  ['Safety certification', /\b(?:hse|adsp|oshms|industrial safety)\s*(?:certificat\w*|diploma|course)?\b/i],
  ['CISSP', /\bcissp\b/i],
  ['PMP', /\bpmp\b/i],
  ['CFA', /\bcfa\b/i],
];

function resolveCertifications(corpus: string): string[] {
  const out: string[] = [];
  for (const [label, re] of CERT_PATTERNS) {
    if (re.test(corpus)) out.push(label);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Location & relocation
// ---------------------------------------------------------------------------

const RELOCATION_RE = /\b(will\s+need\s+to\s+relocate|relocation\s+(?:is\s+)?(?:required|mandatory|assistance|support)|must\s+relocate|readily\s+available\s+to\s+relocate|willing\s+to\s+relocate)\b/i;
const LOCATION_RESTRICTED_RE = /\b(must\s+(?:be\s+)?(?:based|located|reside)\s+in|should\s+be\s+(?:based|located)\s+in|only\s+candidates\s+(?:based|located)|work\s+from\s+our\s+\w+\s+office|onsite\s+only)\b/i;

function resolveLocation(
  corpus: string,
  locationRaw: string,
  evidence: Record<string, string>,
  origin: Record<string, RequirementOrigin>,
): { locations: string[]; restricted: boolean; relocation: boolean; raw: string | null } {
  const relocation = RELOCATION_RE.test(corpus);
  const restricted = LOCATION_RESTRICTED_RE.test(corpus) || relocation;

  const locations: string[] = [];
  if (locationRaw) locations.push(locationRaw);
  const m = /\b(?:based|located)\s+in\s+([A-Za-z .'-]{2,40})/i.exec(corpus);
  if (m) {
    const v = collapseWhitespace(m[1]);
    if (v && !locations.includes(v)) locations.push(v);
    evidence.LOCATION = evidenceAround(corpus, m.index, m[0].length);
    origin.LOCATION = 'INFERRED';
  } else if (locationRaw) {
    evidence.LOCATION = locationRaw;
    origin.LOCATION = 'EXPLICIT';
  } else {
    origin.LOCATION = 'MISSING';
  }

  if (relocation) {
    evidence.LOCATION = evidenceAround(corpus, corpus.search(RELOCATION_RE), 40);
  }

  return { locations, restricted, relocation, raw: locations[0] ?? null };
}

// ---------------------------------------------------------------------------
// Work authorization
// ---------------------------------------------------------------------------

function resolveWorkAuthorization(corpus: string): { list: string[] | null } {
  const re =
    /\b((?:must|should)\s+(?:be\s+)?(?:authorized|authorised|legally\s+authorized|eligible)\s+to\s+work|require[sd]?\s+work\s+authorization|Indian\s+citizen(?:ship)?|citizen\s+of\s+India|no\s+visa\s+sponsorship|unable\s+to\s+sponsor|security\s+clearance|Permanent\s+Resident\s+of\s+\w+|must\s+be\s+US\s+citizen)\b/i;
  if (!re.test(corpus)) return { list: null };
  const hits: string[] = [];
  if (/\b(?:Indian\s+citizen(?:ship)?|citizen\s+of\s+India)\b/i.test(corpus)) hits.push('Indian citizenship');
  if (/\b(?:authorized|authorised|eligible)\s+to\s+work\b/i.test(corpus)) hits.push('Work authorization');
  if (/\bno\s+visa\s+sponsorship|unable\s+to\s+sponsor\b/i.test(corpus)) hits.push('No visa sponsorship');
  if (/\bsecurity\s+clearance\b/i.test(corpus)) hits.push('Security clearance');
  return { list: hits };
}

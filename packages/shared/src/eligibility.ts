/**
 * The eligibility engine.
 *
 * Design rules (from the product spec, enforced here):
 *
 *  - A verdict is derived ONLY from deterministic checks. An LLM may write
 *    prose about the result but can never change ELIGIBLE/INELIGIBLE/UNCERTAIN.
 *  - Precedence is INELIGIBLE > UNCERTAIN > ELIGIBLE.
 *  - Missing information is never interpreted as "eligible" and never as
 *    "ineligible" -- it produces UNCERTAIN, or is recorded as an explicit gap.
 *  - Location alone never makes a job ineligible.
 *  - The match score is informational. Mandatory requirements always win.
 */

import type {
  CheckFactor,
  CheckOutcome,
  EligibilityCheck,
  EligibilityResult,
  EligibilityStatus,
  Job,
  JobRequirements,
  MatchBreakdown,
  UserProfile,
} from './types.js';
import {
  DEGREE_RANK,
  classifyDegreeLevel,
  classifyField,
  degreeLabel,
  fieldLabel,
  relateFields,
} from './degrees.js';
import { skillLabel } from './skills.js';
import { collapseWhitespace } from './text.js';

export const ENGINE_VERSION = 'rule-engine/1.0.0';

/** Weighting for the informational match score. Mandatory checks ignore this. */
const SCORE_WEIGHTS: Record<keyof MatchBreakdown, number> = {
  education: 0.35,
  experience: 0.25,
  skills: 0.2,
  location: 0.1,
  other: 0.1,
};

const FRESHER_FRIENDLY_RE =
  /\b(freshers?|recent\s+graduates?|final\s+year\s+(?:students?|engineers?)|graduating\s+(?:in\s+)?\d{4}|campus|entry[- ]level|graduate\s+trainee|management\s+trainee|no\s+experience\s+(?:required|needed))\b/i;

const BATCH_GATE_RE = /\b(batch|graduating\s+in|class\s+of|only\s+students\s+who\s+graduate)\b/i;

export function analyzeEligibility(
  job: Pick<Job, 'id' | 'title' | 'description' | 'sourceUrl' | 'status' | 'verification' | 'location'>,
  profile: UserProfile,
  requirements: JobRequirements,
): EligibilityResult {
  const checks: EligibilityCheck[] = [];
  const matched: string[] = [];
  const missing: string[] = [];
  const concerns: string[] = [];
  const unknownInfo: string[] = [...requirements.gaps];

  const userField = classifyField(profile.branch) || classifyField(`${profile.degree} ${profile.branch}`);

  // --- 0. Can we even read the posting? ------------------------------------
  const readable = Boolean(
    (job.description && job.description.length > 120) ||
      requirements.origin.EDUCATION_LEVEL === 'EXPLICIT' ||
      requirements.origin.FIELD === 'EXPLICIT' ||
      requirements.experienceStated,
  );
  if (!readable) {
    checks.push({
      factor: 'OTHER',
      label: 'Posting content',
      outcome: 'UNKNOWN',
      mandatory: true,
      detail:
        'The posting content could not be read in full, so requirements could not be verified. Open the original posting to confirm.',
    });
    unknownInfo.push('Posting text was not retrievable or was too short to extract requirements from.');
  }

  // --- 1. Education: degree level ------------------------------------------
  const eduCheck = checkDegreeLevel(requirements, profile);
  checks.push(eduCheck.check);
  collect(eduCheck, matched, missing, concerns, unknownInfo);

  // --- 2. Education: field / major -----------------------------------------
  const fieldCheck = checkField(requirements, userField);
  checks.push(fieldCheck.check);
  collect(fieldCheck, matched, missing, concerns, unknownInfo);

  // --- 3. Experience -------------------------------------------------------
  const expCheck = checkExperience(requirements, job, profile);
  checks.push(expCheck.check);
  collect(expCheck, matched, missing, concerns, unknownInfo);

  // --- 4. Graduation year --------------------------------------------------
  const gradCheck = checkGraduationYear(requirements, profile);
  checks.push(gradCheck.check);
  collect(gradCheck, matched, missing, concerns, unknownInfo);

  // --- 5. Skills -----------------------------------------------------------
  const skillCheck = checkSkills(requirements, profile);
  checks.push(skillCheck.check);
  collect(skillCheck, matched, missing, concerns, unknownInfo);

  // --- 6. Location ---------------------------------------------------------
  const locCheck = checkLocation(requirements, job, profile);
  checks.push(locCheck.check);
  collect(locCheck, matched, missing, concerns, unknownInfo);

  // --- 7. Work authorization ----------------------------------------------
  const authCheck = checkWorkAuthorization(requirements, profile);
  checks.push(authCheck.check);
  collect(authCheck, matched, missing, concerns, unknownInfo);

  // --- 8. Certifications ---------------------------------------------------
  const certCheck = checkCertifications(requirements, profile);
  checks.push(certCheck.check);
  collect(certCheck, matched, missing, concerns, unknownInfo);

  // --- Verdict -------------------------------------------------------------
  const status = decide(checks);
  const scores = computeScores(checks);
  const matchScore = computeMatchScore(scores);
  const explanation = narrate(status, checks);

  return {
    jobId: job.id,
    userId: profile.userId,
    status,
    matchScore,
    scores,
    checks,
    matchedRequirements: dedupe(matched),
    missingRequirements: dedupe(missing),
    concerns: dedupe(concerns),
    missingInformation: dedupe(unknownInfo),
    explanation,
    engine: ENGINE_VERSION,
    analyzedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export function decide(checks: EligibilityCheck[]): EligibilityStatus {
  // 1. Any hard, mandatory failure is disqualifying.
  if (checks.some((c) => c.mandatory && c.outcome === 'MISMATCH')) return 'INELIGIBLE';
  // 2. Otherwise, any unresolvable mandatory requirement means we cannot decide.
  if (checks.some((c) => c.mandatory && c.outcome === 'UNKNOWN')) return 'UNCERTAIN';
  return 'ELIGIBLE';
}

function computeScores(checks: EligibilityCheck[]): MatchBreakdown {
  const byFactor = new Map<CheckFactor, number[]>();
  for (const c of checks) {
    const arr = byFactor.get(c.factor) ?? [];
    arr.push(outcomeToScore(c.outcome));
    byFactor.set(c.factor, arr);
  }
  const agg = (factors: CheckFactor[], fallback: number): number => {
    const vals: number[] = [];
    for (const f of factors) vals.push(...(byFactor.get(f) ?? []));
    if (vals.length === 0) return fallback;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };
  return {
    education: agg(['EDUCATION', 'DEGREE_LEVEL'], 0),
    experience: agg(['EXPERIENCE'], 0),
    skills: agg(['SKILLS'], 0),
    location: agg(['LOCATION'], 100),
    other: agg(['WORK_AUTHORIZATION', 'OTHER'], 100),
  };
}

function outcomeToScore(o: CheckOutcome): number {
  switch (o) {
    case 'MATCH': return 100;
    case 'PARTIAL': return 55;
    case 'UNKNOWN': return 40;
    case 'MISMATCH': return 0;
  }
}

function computeMatchScore(s: MatchBreakdown): number {
  const total = Object.entries(SCORE_WEIGHTS).reduce(
    (acc, [k, w]) => acc + (s[k as keyof MatchBreakdown] ?? 0) * w,
    0,
  );
  return Math.max(0, Math.min(100, Math.round(total)));
}

function collect(
  r: { check: EligibilityCheck; matched: string[]; missing: string[]; concerns: string[]; unknown: string[] },
  matched: string[],
  missing: string[],
  concerns: string[],
  unknownInfo: string[],
): void {
  matched.push(...r.matched);
  missing.push(...r.missing);
  concerns.push(...r.concerns);
  unknownInfo.push(...r.unknown);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function narrate(status: EligibilityStatus, checks: EligibilityCheck[]): string {
  const order: CheckOutcome[] = ['MISMATCH', 'UNKNOWN', 'PARTIAL', 'MATCH'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.outcome) - order.indexOf(b.outcome));
  const icon: Record<CheckOutcome, string> = { MATCH: '✓', PARTIAL: '~', UNKNOWN: '?', MISMATCH: '✗' };
  const lines = sorted.map((c) => `${icon[c.outcome]} ${c.detail}`);
  const head =
    status === 'ELIGIBLE'
      ? 'You appear to satisfy the stated mandatory requirements.'
      : status === 'INELIGIBLE'
        ? 'At least one mandatory requirement is not satisfied.'
        : 'The posting does not provide enough information to decide reliably.';
  return `${head}\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

interface CheckResult {
  check: EligibilityCheck;
  matched: string[];
  missing: string[];
  concerns: string[];
  unknown: string[];
}

function checkDegreeLevel(req: JobRequirements, profile: UserProfile): CheckResult {
  const userLevel = classifyDegreeLevel(`${profile.degree} ${profile.branch}`) || 'BACHELOR';
  const userRank = DEGREE_RANK[userLevel] ?? 3;

  if (req.degreeLevel === 'UNKNOWN' || req.degreeLevel === 'ANY') {
    return {
      check: {
        factor: 'DEGREE_LEVEL',
        label: 'Degree level',
        outcome: 'UNKNOWN',
        mandatory: false,
        detail: 'The posting does not state a required degree level.',
        evidence: req.evidence.DEGREE_LEVEL ?? null,
      },
      matched: [],
      missing: [],
      concerns: [],
      unknown: ['Required degree level is not specified in the posting.'],
    };
  }

  const jobRank = DEGREE_RANK[req.degreeLevel] ?? 0;
  if (jobRank > userRank) {
    return {
      check: {
        factor: 'DEGREE_LEVEL',
        label: 'Degree level',
        outcome: 'MISMATCH',
        mandatory: true,
        detail: `Requires ${degreeLabel(req.degreeLevel)}; your profile is ${degreeLabel(userLevel)}.`,
        evidence: req.evidence.DEGREE_LEVEL ?? null,
      },
      matched: [],
      missing: [`${degreeLabel(req.degreeLevel)} required`],
      concerns: [],
      unknown: [],
    };
  }

  return {
    check: {
      factor: 'DEGREE_LEVEL',
      label: 'Degree level',
      outcome: 'MATCH',
      mandatory: true,
      detail: `Requires ${degreeLabel(req.degreeLevel)}; you have ${degreeLabel(userLevel)}.`,
      evidence: req.evidence.DEGREE_LEVEL ?? null,
    },
    matched: [`${degreeLabel(req.degreeLevel)} requirement satisfied`],
    missing: [],
    concerns: [],
    unknown: [],
  };
}

function checkField(req: JobRequirements, userField: string): CheckResult {
  if (req.fields.length === 0) {
    return {
      check: {
        factor: 'EDUCATION',
        label: 'Field of study',
        outcome: 'UNKNOWN',
        mandatory: false,
        detail: 'The posting does not name a required field or major.',
        evidence: req.evidence.FIELD ?? null,
      },
      matched: [],
      missing: [],
      concerns: [],
      unknown: ['Required field of study is not specified in the posting.'],
    };
  }

  // Exact / generic match.
  if (req.fields.includes(userField)) {
    const generic = req.fields.length === 1 && (userField === 'GENERAL_ENGINEERING' || userField === 'TECHNOLOGY_GENERIC');
    return {
      check: {
        factor: 'EDUCATION',
        label: 'Field of study',
        outcome: 'MATCH',
        mandatory: true,
        detail: generic
          ? `The posting asks for a general engineering degree; your ${fieldLabel(userField)} qualifies.`
          : `${fieldLabel(userField)} matches the required field.`,
        evidence: req.evidence.FIELD ?? null,
      },
      matched: [`${fieldLabel(userField)} degree matches`],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  const best = bestRelation(userField, req.fields);

  // EQUIVALENT and STRONG relations are accepted outright. This covers the
  // common case of a posting asking for a generic "B.Tech in Technology" or
  // "degree in Engineering" while the candidate holds a specific B.Tech
  // branch: a generic requirement is satisfied by any branch of that degree.
  if (best.rel.strength === 'EQUIVALENT' || best.rel.strength === 'STRONG') {
    return {
      check: {
        factor: 'EDUCATION',
        label: 'Field of study',
        outcome: 'MATCH',
        mandatory: true,
        detail: `The posting asks for ${req.fields.map(fieldLabel).join(' or ')}. ${best.rel.why}`,
        evidence: req.evidence.FIELD ?? null,
      },
      matched: [`${fieldLabel(userField)} satisfies the required field`],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  if (best.rel.strength === 'ADJACENT') {
    return {
      check: {
        factor: 'EDUCATION',
        label: 'Field of study',
        outcome: 'UNKNOWN',
        mandatory: true,
        detail: `The posting requires ${req.fields.map(fieldLabel).join(' or ')}. ${best.rel.why} ${
          req.acceptsEquivalent
            ? 'The posting does accept equivalent disciplines, so this is likely fine but worth confirming with the recruiter.'
            : 'The posting does not state that equivalent disciplines are accepted, so this needs human review.'
        }`,
        evidence: req.evidence.FIELD ?? null,
      },
      matched: [],
      missing: [],
      concerns: [`Adjacent field: ${fieldLabel(userField)} vs required ${best.field}`],
      unknown: ['Field of study is related but not identical to the stated requirement.'],
    };
  }

  if (best.rel.strength === 'WEAK') {
    return {
      check: {
        factor: 'EDUCATION',
        label: 'Field of study',
        outcome: 'UNKNOWN',
        mandatory: true,
        detail: `The posting requires ${req.fields.map(fieldLabel).join(' or ')}. ${best.rel.why} This is a borderline case that needs human review.`,
        evidence: req.evidence.FIELD ?? null,
      },
      matched: [],
      missing: [],
      concerns: [`Weakly related field: ${fieldLabel(userField)} vs required ${best.field}`],
      unknown: [],
    };
  }

  return {
    check: {
      factor: 'EDUCATION',
      label: 'Field of study',
      outcome: 'MISMATCH',
      mandatory: true,
      detail: `The posting requires ${req.fields.map(fieldLabel).join(' or ')}; your degree is ${fieldLabel(userField)}. ${best.rel.why}`,
      evidence: req.evidence.FIELD ?? null,
    },
    matched: [],
    missing: [`Requires ${req.fields.map(fieldLabel).join(' or ')}`],
    concerns: [],
    unknown: [],
  };
}

function bestRelation(userField: string, fields: string[]): { field: string; rel: ReturnType<typeof relateFields> } {
  let bestField = fields[0];
  let best = relateFields(userField, fields[0]);
  for (const f of fields.slice(1)) {
    const r = relateFields(userField, f);
    if (r.score > best.score) {
      best = r;
      bestField = f;
    }
  }
  return { field: bestField, rel: best };
}

function checkExperience(req: JobRequirements, job: Pick<Job, 'title' | 'description'>, profile: UserProfile): CheckResult {
  const userYears = profile.yearsOfExperience ?? 0;
  const corpus = `${job.title}\n${job.description ?? ''}`;

  if (req.experienceStated && req.experienceMin !== null) {
    const min = req.experienceMin;
    const max = req.experienceMax;

    if (userYears >= min) {
      if (max !== null && userYears > max + 1) {
        return {
          check: {
            factor: 'EXPERIENCE',
            label: 'Experience',
            outcome: 'PARTIAL',
            mandatory: false,
            detail: `Posting targets ${min}–${max} years and you have ${userYears}. You are more experienced than the band; some employers treat over-qualification as a fit risk, but it is not a disqualification.`,
            evidence: req.evidence.EXPERIENCE ?? null,
          },
          matched: [`Experience requirement (${min}–${max} yrs) satisfied`],
          missing: [],
          concerns: ['You appear more senior than the advertised band.'],
          unknown: [],
        };
      }
      return {
        check: {
          factor: 'EXPERIENCE',
          label: 'Experience',
          outcome: 'MATCH',
          mandatory: true,
          detail: `Posting requires ${min}${max !== null ? `–${max}` : '+'} years and you have ${userYears}.`,
          evidence: req.evidence.EXPERIENCE ?? null,
        },
        matched: [`Experience requirement (${min}${max !== null ? `–${max}` : '+'} yrs) satisfied`],
        missing: [],
        concerns: [],
        unknown: [],
      };
    }

    const gap = min - userYears;
    const fresherFriendly = FRESHER_FRIENDLY_RE.test(corpus) || /\b(fresher|graduate trainee|final year)\b/i.test(job.title);

    if (gap <= 1 && fresherFriendly) {
      return {
        check: {
          factor: 'EXPERIENCE',
          label: 'Experience',
          outcome: 'UNKNOWN',
          mandatory: true,
          detail: `Posting states a minimum of ${min} year(s) but also explicitly welcomes freshers, recent graduates or final-year students. You have ${userYears}. Whether the hard minimum is waived is not stated, so this needs a human decision.`,
          evidence: req.evidence.EXPERIENCE ?? null,
        },
        matched: [],
        missing: [],
        concerns: [`Short by ${gap} year(s), but the posting welcomes graduates.`],
        unknown: ['The posting sets a minimum experience yet also targets freshers; the waiver policy is not stated.'],
      };
    }

    return {
      check: {
        factor: 'EXPERIENCE',
        label: 'Experience',
        outcome: 'MISMATCH',
        mandatory: true,
        detail: `Requires a minimum of ${min} year(s) of experience; you have ${userYears}.`,
        evidence: req.evidence.EXPERIENCE ?? null,
      },
      matched: [],
      missing: [`Minimum ${min} year(s) of experience`],
      concerns: [],
      unknown: [],
    };
  }

  if (req.experienceStated && req.experienceMax !== null) {
    return {
      check: {
        factor: 'EXPERIENCE',
        label: 'Experience',
        outcome: 'MATCH',
        mandatory: false,
        detail: `Posting caps experience at ${req.experienceMax} year(s) and sets no minimum; you have ${userYears}.`,
        evidence: req.evidence.EXPERIENCE ?? null,
      },
      matched: ['No minimum experience requirement stated'],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  if (req.experienceMin === null && !req.experienceStated) {
    if (req.gaps.some((g) => g.includes('senior'))) {
      return {
        check: {
          factor: 'EXPERIENCE',
          label: 'Experience',
          outcome: 'UNKNOWN',
          mandatory: true,
          detail: 'The job title implies a senior level but the posting does not state how many years of experience are required.',
          evidence: req.evidence.EXPERIENCE ?? null,
        },
        matched: [],
        missing: [],
        concerns: ['Seniority implied by the title with no stated experience requirement.'],
        unknown: ['Experience requirement is not specified for a role whose title implies seniority.'],
      };
    }
    return {
      check: {
        factor: 'EXPERIENCE',
        label: 'Experience',
        outcome: 'MATCH',
        mandatory: false,
        detail: 'The posting does not gate this role on years of experience.',
        evidence: null,
      },
      matched: ['No minimum experience requirement stated'],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  return {
    check: {
      factor: 'EXPERIENCE',
      label: 'Experience',
      outcome: 'UNKNOWN',
      mandatory: false,
      detail: 'The experience requirement could not be interpreted reliably.',
      evidence: req.evidence.EXPERIENCE ?? null,
    },
    matched: [],
    missing: [],
    concerns: [],
    unknown: ['Experience requirement could not be parsed.'],
  };
}

function checkGraduationYear(req: JobRequirements, profile: UserProfile): CheckResult {
  if (!req.gradYearStated) {
    return {
      check: {
        factor: 'GRADUATION_YEAR',
        label: 'Graduation year',
        outcome: 'MATCH',
        mandatory: false,
        detail: 'The posting does not restrict candidates to a specific graduation batch.',
        evidence: null,
      },
      matched: [],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  const y = profile.graduationYear;
  const inRange =
    (req.gradYearMin === null || y >= req.gradYearMin) && (req.gradYearMax === null || y <= req.gradYearMax);
  const isBatchGate = BATCH_GATE_RE.test(req.gradYearRaw ?? '');

  if (inRange) {
    return {
      check: {
        factor: 'GRADUATION_YEAR',
        label: 'Graduation year',
        outcome: 'MATCH',
        mandatory: true,
        detail: `Posting targets the ${req.gradYearRaw} batch and you are a ${y} graduate.`,
        evidence: req.evidence.GRADUATION_YEAR ?? null,
      },
      matched: [`Graduation year ${y} matches the posting`],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  const tooLate = req.gradYearMin !== null && y < req.gradYearMin;
  const detail = tooLate
    ? `Posting targets candidates graduating in ${req.gradYearMin}; you graduated in ${y}.`
    : `Posting requires graduation by ${req.gradYearMax}; you graduated in ${y}.`;

  if (isBatchGate) {
    return {
      check: {
        factor: 'GRADUATION_YEAR',
        label: 'Graduation year',
        outcome: 'MISMATCH',
        mandatory: true,
        detail,
        evidence: req.evidence.GRADUATION_YEAR ?? null,
      },
      matched: [],
      missing: [`Graduation batch ${req.gradYearRaw}`],
      concerns: [],
      unknown: [],
    };
  }

  return {
    check: {
      factor: 'GRADUATION_YEAR',
      label: 'Graduation year',
      outcome: 'UNKNOWN',
      mandatory: true,
      detail: `${detail} The posting does not say whether earlier graduates are accepted.`,
      evidence: req.evidence.GRADUATION_YEAR ?? null,
    },
    matched: [],
    missing: [],
    concerns: [],
    unknown: ['Graduation year requirement is ambiguous for candidates outside the stated batch.'],
  };
}

function checkSkills(req: JobRequirements, profile: UserProfile): CheckResult {
  const have = new Set(profile.skills.map((s) => s.toUpperCase()));
  const has = (s: string) => have.has(s.toUpperCase());

  if (req.skillsRequired.length === 0 && req.skillsPreferred.length === 0) {
    return {
      check: {
        factor: 'SKILLS',
        label: 'Skills',
        outcome: 'UNKNOWN',
        mandatory: false,
        detail: 'The posting does not list specific skills.',
      },
      matched: [],
      missing: [],
      concerns: [],
      unknown: ['No explicit skill list in the posting.'],
    };
  }

  const matchedSkills = req.skillsRequired.filter(has);
  const missingSkills = req.skillsRequired.filter((s) => !has(s));
  const matchedPref = req.skillsPreferred.filter(has);
  const missingPref = req.skillsPreferred.filter((s) => !has(s));

  const parts: string[] = [];
  if (req.skillsRequired.length > 0) {
    parts.push(
      `Required skills matched: ${matchedSkills.length}/${req.skillsRequired.length}` +
        (matchedSkills.length ? ` (${matchedSkills.map(skillLabel).join(', ')})` : ''),
    );
    if (missingSkills.length) {
      parts.push(`Required skills missing: ${missingSkills.map(skillLabel).join(', ')}`);
    }
  }
  if (req.skillsPreferred.length > 0) {
    parts.push(`Preferred skills matched: ${matchedPref.length}/${req.skillsPreferred.length}`);
    if (missingPref.length) parts.push(`Preferred skills missing: ${missingPref.map(skillLabel).join(', ')}`);
  }

  const requiredRatio =
    req.skillsRequired.length === 0 ? 1 : matchedSkills.length / req.skillsRequired.length;

  let outcome: CheckOutcome;
  let detail = parts.join(' | ');
  if (requiredRatio === 1) outcome = 'MATCH';
  else if (requiredRatio >= 0.6) outcome = 'PARTIAL';
  else outcome = 'PARTIAL';

  // A large, specific gap is a real risk -> push to UNCERTAIN for human review.
  if (req.skillsRequired.length >= 3 && requiredRatio < 0.5) {
    outcome = 'UNKNOWN';
    detail += '. Most of the required skills are not in your profile, so this needs a manual read before you spend time on it.';
  }

  return {
    check: {
      factor: 'SKILLS',
      label: 'Skills',
      outcome,
      mandatory: outcome === 'UNKNOWN',
      detail,
    },
    matched: matchedSkills.map((s) => `Skill matched: ${skillLabel(s)}`),
    missing: missingSkills.map((s) => `Skill not in profile: ${skillLabel(s)}`),
    concerns: missingPref.map((s) => `Preferred skill not in profile: ${skillLabel(s)}`),
    unknown: outcome === 'UNKNOWN' ? ['A majority of the required skills are absent from your profile.'] : [],
  };
}

function checkLocation(
  req: JobRequirements,
  job: Pick<Job, 'location'>,
  profile: UserProfile,
): CheckResult {
  const jobLoc = collapseWhitespace(job.location ?? req.locations[0] ?? '');
  const remote = /remote|anywhere|virtual|global|worldwide|work from home/i.test(jobLoc);
  const preferred = profile.preferredLocations.map((l) => l.toLowerCase());

  if (!jobLoc && req.locations.length === 0) {
    return {
      check: {
        factor: 'LOCATION',
        label: 'Location',
        outcome: 'UNKNOWN',
        mandatory: false,
        detail: 'The posting does not specify a location.',
      },
      matched: [],
      missing: [],
      concerns: [],
      unknown: ['Job location is not specified in the posting.'],
    };
  }

  if (remote) {
    return {
      check: {
        factor: 'LOCATION',
        label: 'Location',
        outcome: 'MATCH',
        mandatory: false,
        detail: `Listed as "${jobLoc}" -- remote or location-flexible.`,
      },
      matched: ['Remote / location-flexible'],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  const isPreferred = preferred.some((p) => jobLoc.toLowerCase().includes(p) || p.includes(jobLoc.toLowerCase()));

  if (isPreferred) {
    return {
      check: { factor: 'LOCATION', label: 'Location', outcome: 'MATCH', mandatory: false, detail: `LOCATION MATCH -- ${jobLoc} is in your preferred locations.` },
      matched: ['Location matches your preferences'],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  // Location alone never disqualifies. It only matters when the posting
  // explicitly restricts where you must be based and you cannot satisfy it.
  if (req.locationRestricted && !profile.willingToRelocate) {
    return {
      check: {
        factor: 'LOCATION',
        label: 'Location',
        outcome: 'MISMATCH',
        mandatory: true,
        detail: `The posting requires the candidate to be based in a specific location (${jobLoc}) and your profile says you are not willing to relocate.`,
        evidence: req.evidence.LOCATION ?? null,
      },
      matched: [],
      missing: [`Must be based in ${jobLoc}`],
      concerns: [],
      unknown: [],
    };
  }

  return {
    check: {
      factor: 'LOCATION',
      label: 'Location',
      outcome: profile.willingToRelocate ? 'MATCH' : 'PARTIAL',
      mandatory: false,
      detail: `LOCATION DIFFERENT -- the role is in ${jobLoc}, which is not in your preferred locations.${
        profile.willingToRelocate ? ' You have indicated you are willing to relocate, so this does not disqualify the application.' : ' Location alone never makes a job ineligible.'
      }`,
      evidence: req.evidence.LOCATION ?? null,
    },
    matched: [],
    missing: [],
    concerns: [`Location differs from your preferences: ${jobLoc}`],
    unknown: [],
  };
}

function checkWorkAuthorization(req: JobRequirements, profile: UserProfile): CheckResult {
  if (req.workAuthorization === null) {
    return {
      check: {
        factor: 'WORK_AUTHORIZATION',
        label: 'Work authorization',
        outcome: 'MATCH',
        mandatory: false,
        detail: 'The posting does not state a work-authorization or citizenship requirement.',
      },
      matched: [],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  const mine = profile.workAuthorization.map((w) => w.toLowerCase());
  const needed = req.workAuthorization;

  const satisfied = needed.filter((n) =>
    mine.some((m) => n.toLowerCase().includes(m) || m.includes(n.toLowerCase())),
  );

  if (satisfied.length === needed.length) {
    return {
      check: {
        factor: 'WORK_AUTHORIZATION',
        label: 'Work authorization',
        outcome: 'MATCH',
        mandatory: true,
        detail: `Requires ${needed.join(', ')}; your profile states ${profile.workAuthorization.join(', ')}.`,
      },
      matched: ['Work authorization requirement satisfied'],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  if (mine.length === 0) {
    return {
      check: {
        factor: 'WORK_AUTHORIZATION',
        label: 'Work authorization',
        outcome: 'UNKNOWN',
        mandatory: true,
        detail: `The posting requires ${needed.join(', ')} but your profile does not state your work authorization, so this cannot be decided.`,
      },
      matched: [],
      missing: [],
      concerns: [],
      unknown: ['Your work authorization is not filled in on your profile, and this posting requires it.'],
    };
  }

  return {
    check: {
      factor: 'WORK_AUTHORIZATION',
      label: 'Work authorization',
      outcome: 'MISMATCH',
      mandatory: true,
      detail: `Requires ${needed.join(', ')}; your profile states ${profile.workAuthorization.join(', ')}.`,
    },
    matched: [],
    missing: [`Requires ${needed.join(', ')}`],
    concerns: [],
    unknown: [],
  };
}

function checkCertifications(req: JobRequirements, profile: UserProfile): CheckResult {
  if (req.certifications.length === 0) {
    return {
      check: {
        factor: 'OTHER',
        label: 'Certifications',
        outcome: 'MATCH',
        mandatory: false,
        detail: 'The posting does not name a required certification.',
      },
      matched: [],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  const mine = [...profile.certifications, ...profile.skills].map((c) => c.toLowerCase());
  const missing = req.certifications.filter((c) => !mine.some((m) => m.includes(c.toLowerCase())));

  if (missing.length === 0) {
    return {
      check: { factor: 'OTHER', label: 'Certifications', outcome: 'MATCH', mandatory: true, detail: `Required certifications (${req.certifications.join(', ')}) appear in your profile.` },
      matched: ['Certification requirements satisfied'],
      missing: [],
      concerns: [],
      unknown: [],
    };
  }

  return {
    check: {
      factor: 'OTHER',
      label: 'Certifications',
      outcome: 'UNKNOWN',
      mandatory: true,
      detail: `The posting mentions ${req.certifications.join(', ')}, which is not listed in your profile. Confirm whether it is mandatory.`,
    },
    matched: [],
    missing: [],
    concerns: [`Certification not in profile: ${missing.join(', ')}`],
    unknown: ['Posting mentions certifications that are not in your profile.'],
  };
}

/**
 * Field (major/branch) ontology.
 *
 * The engine never treats every engineering degree as interchangeable. It knows
 * which fields are genuinely interchangeable, which are adjacent, and which are
 * unrelated -- and it must be able to say *why* in the explanation.
 */

import { comparable, collapseWhitespace } from './text.js';

export type RelationStrength = 'EQUIVALENT' | 'STRONG' | 'ADJACENT' | 'WEAK' | 'NONE';

export interface FieldDef {
  id: string;
  label: string;
  group: 'CHEMICAL' | 'MECHANICAL' | 'ELECTRICAL' | 'CIVIL' | 'PRODUCTION' | 'MATERIALS' | 'SCIENCE' | 'GENERAL' | 'OTHER';
  aliases: string[];
}

export const FIELDS: FieldDef[] = [
  // --- Chemical engineering family -----------------------------------------
  {
    id: 'CHEMICAL_ENGINEERING',
    label: 'Chemical Engineering',
    group: 'CHEMICAL',
    aliases: [
      'chemical engineering', 'chemical engineer', 'chem eng', 'cheme', 'chemical engg',
      'b tech chemical engineering', 'b e chemical engineering', 'btech chemical',
      'be chemical', 'b tech chemical', 'chemical engineering technology',
      'chemical and biochemical engineering', 'chemical process engineering',
    ],
  },
  {
    id: 'PETROCHEMICAL_ENGINEERING',
    label: 'Petrochemical Engineering',
    group: 'CHEMICAL',
    aliases: [
      'petrochemical engineering', 'petrochemical technology', 'petroleum engineering',
      'petroleum and petrochemical engineering', 'petrochemical engg',
    ],
  },
  {
    id: 'CHEMICAL_TECHNOLOGY',
    label: 'Chemical Technology',
    group: 'CHEMICAL',
    aliases: [
      'chemical technology', 'chemical tech', 'chemical technology and polymer science',
      'chemical technology and plastic technology', 'chemical and polymer technology',
    ],
  },
  {
    id: 'PROCESS_ENGINEERING',
    label: 'Process Engineering',
    group: 'CHEMICAL',
    aliases: [
      'process engineering', 'process engineer', 'process technology', 'process engineering technology',
    ],
  },
  {
    id: 'POLYMER_ENGINEERING',
    label: 'Polymer / Plastics Engineering',
    group: 'CHEMICAL',
    aliases: [
      'polymer engineering', 'polymer science and engineering', 'polymer technology',
      'plastic technology', 'plastics engineering', 'polymer science',
    ],
  },
  {
    id: 'BIOCHEMICAL_ENGINEERING',
    label: 'Biochemical / Biotechnology Engineering',
    group: 'CHEMICAL',
    aliases: [
      'biochemical engineering', 'biotechnology engineering', 'biotech engineering',
      'biotechnology', 'bioprocess engineering', 'fermentation technology',
    ],
  },
  {
    id: 'FOOD_PROCESS_ENGINEERING',
    label: 'Food Process / Food Technology',
    group: 'CHEMICAL',
    aliases: [
      'food processing engineering', 'food technology', 'food engineering',
      'food process engineering', 'food and nutrition',
    ],
  },
  {
    id: 'ENERGY_ENGINEERING',
    label: 'Energy / Power Engineering',
    group: 'CHEMICAL',
    aliases: [
      'energy engineering', 'energy technology', 'power engineering', 'power plant engineering',
      'thermal engineering', 'energy and environment engineering',
    ],
  },
  {
    id: 'ENVIRONMENTAL_ENGINEERING',
    label: 'Environmental Engineering',
    group: 'CHEMICAL',
    aliases: [
      'environmental engineering', 'environmental science and engineering',
      'environmental technology', 'pollution control engineering', 'waste water engineering',
    ],
  },
  {
    id: 'PROCESS_SAFETY_ENGINEERING',
    label: 'Process Safety / Loss Prevention',
    group: 'CHEMICAL',
    aliases: [
      'process safety engineering', 'loss prevention', 'process safety',
      'industrial safety engineering', 'safety engineering',
    ],
  },
  // --- Adjacent engineering ------------------------------------------------
  {
    id: 'MATERIALS_ENGINEERING',
    label: 'Materials / Metallurgical Engineering',
    group: 'MATERIALS',
    aliases: [
      'materials engineering', 'materials science and engineering', 'metallurgical engineering',
      'metallurgy', 'materials engineering and technology',
    ],
  },
  {
    id: 'MECHANICAL_ENGINEERING',
    label: 'Mechanical Engineering',
    group: 'MECHANICAL',
    aliases: [
      'mechanical engineering', 'mechanical engg', 'mech eng', 'mechanical and automobile',
      'mechanical engineering technology',
    ],
  },
  {
    id: 'PRODUCTION_ENGINEERING',
    label: 'Production / Manufacturing / Industrial Engineering',
    group: 'PRODUCTION',
    aliases: [
      'production engineering', 'manufacturing engineering', 'industrial engineering',
      'production and industrial engineering', 'manufacturing technology', 'operations research',
    ],
  },
  {
    id: 'ELECTRICAL_ENGINEERING',
    label: 'Electrical / Electronics Engineering',
    group: 'ELECTRICAL',
    aliases: [
      'electrical engineering', 'electronics engineering', 'electrical and electronics',
      'electrical electronics and communication', 'electronics and communication engineering',
      'electrical engineering technology',
    ],
  },
  {
    id: 'INSTRUMENTATION_ENGINEERING',
    label: 'Instrumentation / Control Engineering',
    group: 'ELECTRICAL',
    aliases: [
      'instrumentation engineering', 'instrumentation and control engineering',
      'electronics and instrumentation engineering', 'control systems engineering',
    ],
  },
  {
    id: 'CIVIL_ENGINEERING',
    label: 'Civil / Environmental Infrastructure Engineering',
    group: 'CIVIL',
    aliases: [
      'civil engineering', 'structural engineering', 'construction engineering',
      'transportation engineering', 'geotechnical engineering',
    ],
  },
  // --- Science ------------------------------------------------------------
  {
    id: 'CHEMISTRY',
    label: 'Chemistry',
    group: 'SCIENCE',
    aliases: [
      'chemistry', 'b sc chemistry', 'bsc chemistry', 'industrial chemistry',
      'chemical engineering chemistry', 'applied chemistry',
    ],
  },
  { id: 'MATHEMATICS', label: 'Mathematics', group: 'SCIENCE', aliases: ['mathematics', 'maths', 'applied mathematics', 'statistics', 'mathematical sciences'] },
  { id: 'PHYSICS', label: 'Physics', group: 'SCIENCE', aliases: ['physics', 'applied physics'] },
  { id: 'BIOLOGY', label: 'Biology / Life Sciences', group: 'SCIENCE', aliases: ['biology', 'life sciences', 'microbiology', 'biotechnology science', 'botany', 'zoology'] },
  { id: 'SCIENCE_GENERIC', label: 'Science (unspecified branch)', group: 'SCIENCE', aliases: ['science', 'b sc', 'bsc', 'bachelor of science', 'pure science', 'undergraduate degree in science'] },
  // --- Generic ------------------------------------------------------------
  {
    id: 'GENERAL_ENGINEERING',
    label: 'Engineering (any discipline)',
    group: 'GENERAL',
    aliases: [
      'engineering', 'engineering degree', 'bachelor of engineering', 'bachelor degree in engineering',
      'b e b tech', 'btech', 'b tech', 'b e', 'be btech', 'degree in engineering',
      'engineering or technology', 'b e b tech in engineering',
    ],
  },
  {
    id: 'TECHNOLOGY_GENERIC',
    label: 'Technology (any discipline)',
    group: 'GENERAL',
    aliases: ['technology', 'bachelor of technology', 'degree in technology', 'technical education'],
  },
  { id: 'UNKNOWN_FIELD', label: 'Unrecognized field', group: 'OTHER', aliases: [] },
];

/**
 * Relatedness between fields, expressed as a directed "user has U, job asks F"
 * judgement. `why` is surfaced verbatim in the eligibility explanation, so the
 * user can audit the reasoning instead of trusting a score.
 */
const RELATED: Record<string, { to: string; strength: RelationStrength; why: string }[]> = {
  CHEMICAL_ENGINEERING: [
    { to: 'GENERAL_ENGINEERING', strength: 'EQUIVALENT', why: 'Chemical Engineering is a Bachelor of Engineering / B.Tech degree, so a generic "degree in Engineering" requirement is satisfied.' },
    { to: 'TECHNOLOGY_GENERIC', strength: 'EQUIVALENT', why: 'B.Tech Chemical Engineering satisfies a generic "degree in Technology" requirement.' },
    { to: 'CHEMICAL_TECHNOLOGY', strength: 'STRONG', why: 'Chemical Technology shares the same unit-operations, thermodynamics and separations curriculum; the difference is industrial-chemistry emphasis.' },
    { to: 'PETROCHEMICAL_ENGINEERING', strength: 'STRONG', why: 'Petrochemical Engineering is a specialisation within the chemical engineering discipline.' },
    { to: 'PROCESS_ENGINEERING', strength: 'STRONG', why: 'Process Engineering is the applied-design arm of Chemical Engineering and shares balances, thermodynamics, unit operations and equipment design.' },
    { to: 'POLYMER_ENGINEERING', strength: 'ADJACENT', why: 'Polymer processing sits in the chemical engineering materials track and shares heat/mass transfer, but adds polymer chemistry.' },
    { to: 'BIOCHEMICAL_ENGINEERING', strength: 'ADJACENT', why: 'Biochemical Engineering shares reactors, separations and mass transfer with Chemical Engineering, but adds bioscience coursework.' },
    { to: 'FOOD_PROCESS_ENGINEERING', strength: 'ADJACENT', why: 'Food Process Engineering shares the unit-operations core, but adds microbiology and food chemistry.' },
    { to: 'ENERGY_ENGINEERING', strength: 'ADJACENT', why: 'Energy Engineering overlaps on thermodynamics, separations and heat transfer, but is not a unit-operations degree.' },
    { to: 'ENVIRONMENTAL_ENGINEERING', strength: 'ADJACENT', why: 'Environmental Engineering overlaps on separations, mass transfer and process control, but is not a process-design degree.' },
    { to: 'PROCESS_SAFETY_ENGINEERING', strength: 'ADJACENT', why: 'Process Safety is a sub-discipline of Chemical Engineering practice rather than a separate degree.' },
    { to: 'CHEMISTRY', strength: 'WEAK', why: 'Chemistry is a prerequisite science, not an engineering degree; some lab/R&D roles accept it but design and operations roles generally do not.' },
    { to: 'SCIENCE_GENERIC', strength: 'WEAK', why: 'A generic science degree is broader than a B.Tech in Engineering for most engineering postings.' },
    { to: 'MATERIALS_ENGINEERING', strength: 'WEAK', why: 'Shared heat/mass transfer and kinetics, but no unit-operations or process-systems core.' },
    { to: 'MECHANICAL_ENGINEERING', strength: 'NONE', why: 'Mechanical Engineering is a distinct discipline with a different core (solid mechanics, fluid machines, thermal design).' },
    { to: 'PRODUCTION_ENGINEERING', strength: 'NONE', why: 'Production/Industrial Engineering is centred on manufacturing systems and operations research, not chemical process design.' },
    { to: 'ELECTRICAL_ENGINEERING', strength: 'NONE', why: 'Electrical/Electronics is a distinct discipline; overlaps only superficially.' },
    { to: 'INSTRUMENTATION_ENGINEERING', strength: 'NONE', why: 'Instrumentation is a distinct discipline; a Chemical Engineering degree does not satisfy it.' },
    { to: 'CIVIL_ENGINEERING', strength: 'NONE', why: 'Civil Engineering is a distinct discipline with no substantive overlap.' },
  ],
};

export const STRENGTH_SCORE: Record<RelationStrength, number> = {
  EQUIVALENT: 100,
  STRONG: 88,
  ADJACENT: 62,
  WEAK: 30,
  NONE: 0,
};

export function fieldById(id: string): FieldDef {
  return FIELDS.find((f) => f.id === id) ?? FIELDS[FIELDS.length - 1];
}

export function fieldLabel(id: string): string {
  return fieldById(id).label;
}

/** Build an alias -> id lookup, longest alias first so greedy matching works. */
const ALIAS_INDEX: Array<{ alias: string; id: string }> = FIELDS.flatMap((f) =>
  f.aliases.map((a) => ({ alias: a, id: f.id })),
).sort((a, b) => b.alias.length - a.alias.length);

/**
 * Generic fields are a fallback, not a target. A specific branch named in the
 * same text always wins, so "Bachelor of Technology in Chemical Engineering"
 * resolves to CHEMICAL_ENGINEERING rather than the longer "bachelor of
 * technology" alias.
 */
const GENERIC_FIELD_IDS = new Set(['GENERAL_ENGINEERING', 'TECHNOLOGY_GENERIC', 'SCIENCE_GENERIC']);

/** Map a free-text branch string to a FieldId. */
export function classifyField(input: string | null | undefined): string {
  if (!input) return 'UNKNOWN_FIELD';
  const s = comparable(input);
  if (!s) return 'UNKNOWN_FIELD';
  // Specific branches first, then generic degree families.
  for (const { alias, id } of ALIAS_INDEX) {
    if (GENERIC_FIELD_IDS.has(id)) continue;
    if (s.includes(alias)) return id;
  }
  for (const { alias, id } of ALIAS_INDEX) {
    if (s.includes(alias)) return id;
  }
  return 'UNKNOWN_FIELD';
}

export interface FieldRelation {
  strength: RelationStrength;
  score: number;
  why: string;
  related: boolean;
}

export function relateFields(userField: string, jobField: string): FieldRelation {
  if (!userField || userField === 'UNKNOWN_FIELD') {
    return { strength: 'NONE', score: 0, why: 'Your branch could not be mapped to a known field.', related: false };
  }
  if (userField === jobField) {
    return {
      strength: 'EQUIVALENT',
      score: 100,
      why: `Exact match: the posting asks for ${fieldLabel(jobField)} and your degree is ${fieldLabel(userField)}.`,
      related: true,
    };
  }
  const rel = RELATED[userField]?.find((r) => r.to === jobField);
  if (!rel) {
    return {
      strength: 'NONE',
      score: 0,
      why: `${fieldLabel(userField)} is not recognised as equivalent to ${fieldLabel(jobField)}.`,
      related: false,
    };
  }
  return {
    strength: rel.strength,
    score: STRENGTH_SCORE[rel.strength],
    why: rel.why,
    related: rel.strength === 'EQUIVALENT' || rel.strength === 'STRONG' || rel.strength === 'ADJACENT',
  };
}

// ---------------------------------------------------------------------------
// Degree levels
// ---------------------------------------------------------------------------

const DEGREE_PATTERNS: Array<{ level: string; re: RegExp }> = [
  { level: 'DOCTORATE', re: /\b(ph\.?d|doctorate|doctoral)\b/i },
  { level: 'MASTER', re: /\b(m\.?sc|m\.?tech|master'?s?|mba|pg\s?degree|postgraduate|post graduate|m\.phil)\b/i },
  { level: 'BACHELOR', re: /\b(b\.?sc|b\.?tech|b\.?e\.?|bachelor'?s?|b\.?pharm|b\.?arch|b\.?planning|undergraduate|ug\s?degree|graduat\w*)\b/i },
  { level: 'DIPLOMA', re: /\b(diploma|polytechnic|ITI)\b/i },
  { level: 'HIGH_SCHOOL', re: /\b(10\+2|10\+3|12th|high school|secondary school|intermediate|senior secondary)\b/i },
];

export const DEGREE_RANK: Record<string, number> = {
  HIGH_SCHOOL: 1,
  DIPLOMA: 2,
  BACHELOR: 3,
  MASTER: 4,
  DOCTORATE: 5,
  ANY: 0,
  UNKNOWN: 0,
};

export function classifyDegreeLevel(text: string | null | undefined): string {
  if (!text) return 'UNKNOWN';
  const s = collapseWhitespace(text);
  // Master/Doctorate must be tested before Bachelor because "Master's degree in
  // Engineering" also contains "Engineering", not "Bachelor" -- but
  // "B.Tech" and "Bachelor" both map to BACHELOR, so ordering is safe.
  for (const { level, re } of DEGREE_PATTERNS) {
    if (re.test(s)) return level;
  }
  return 'UNKNOWN';
}

export function degreeLabel(level: string): string {
  switch (level) {
    case 'HIGH_SCHOOL': return 'High school / secondary';
    case 'DIPLOMA': return 'Diploma / Polytechnic';
    case 'BACHELOR': return "Bachelor's degree";
    case 'MASTER': return "Master's degree";
    case 'DOCTORATE': return 'Doctorate';
    case 'ANY': return 'Any degree';
    default: return 'Unspecified degree level';
  }
}

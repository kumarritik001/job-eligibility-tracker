/**
 * Skill taxonomy. Canonical skill ids with alias lists so that "MS Excel",
 * "Excel", "MS Excel Advanced" and "spreadsheets" collapse to one skill.
 */

import { comparable } from './text.js';

export interface SkillDef {
  id: string;
  label: string;
  category: 'LANGUAGE' | 'DATA' | 'DOMAIN' | 'TOOLS' | 'SOFT' | 'CERTIFICATION';
  aliases: string[];
}

export const SKILLS: SkillDef[] = [
  // --- Languages -----------------------------------------------------------
  { id: 'PYTHON', label: 'Python', category: 'LANGUAGE', aliases: ['python', 'python3', 'py'] },
  { id: 'SQL', label: 'SQL', category: 'LANGUAGE', aliases: ['sql', 't-sql', 'pl sql', 'plsql', 'ansi sql'] },
  { id: 'R', label: 'R', category: 'LANGUAGE', aliases: ['r programming', 'r language'] },
  { id: 'MATLAB', label: 'MATLAB / Simulink', category: 'LANGUAGE', aliases: ['matlab', 'simulink'] },
  { id: 'VBA', label: 'VBA', category: 'LANGUAGE', aliases: ['vba', 'visual basic for applications', 'macro'] },
  { id: 'JAVASCRIPT', label: 'JavaScript / TypeScript', category: 'LANGUAGE', aliases: ['javascript', 'typescript', 'node js', 'nodejs', 'react'] },

  // --- Data / analytics ----------------------------------------------------
  { id: 'EXCEL', label: 'Excel', category: 'DATA', aliases: ['excel', 'ms excel', 'microsoft excel', 'advanced excel', 'spreadsheets', 'pivot tables'] },
  { id: 'POWER_BI', label: 'Power BI', category: 'DATA', aliases: ['power bi', 'powerbi', 'microsoft power bi'] },
  { id: 'TABLEAU', label: 'Tableau', category: 'DATA', aliases: ['tableau'] },
  { id: 'DATA_ANALYSIS', label: 'Data Analysis', category: 'DATA', aliases: ['data analysis', 'data analytics', 'data interpretation', 'statistical analysis', 'data analysis and interpretation'] },
  { id: 'MACHINE_LEARNING', label: 'Machine Learning', category: 'DATA', aliases: ['machine learning', 'ml', 'deep learning', 'artificial intelligence', 'ai', 'predictive modelling'] },
  { id: 'DATA_SCIENCE', label: 'Data Science', category: 'DATA', aliases: ['data science', 'data scientist'] },
  { id: 'ETL', label: 'ETL / Data Pipelines', category: 'DATA', aliases: ['etl', 'data pipeline', 'data pipelines', 'data warehousing'] },

  // --- Domain: chemical engineering ---------------------------------------
  { id: 'THERMODYNAMICS', label: 'Thermodynamics', category: 'DOMAIN', aliases: ['thermodynamics', 'chemical thermodynamics', 'applied thermodynamics', 'first law', 'second law'] },
  { id: 'FLUID_MECHANICS', label: 'Fluid Mechanics', category: 'DOMAIN', aliases: ['fluid mechanics', 'fluid flow', 'hydraulics', 'multiphase flow', 'computational fluid dynamics', 'cfd'] },
  { id: 'HEAT_TRANSFER', label: 'Heat Transfer', category: 'DOMAIN', aliases: ['heat transfer', 'thermal engineering', 'heat exchanger', 'heat exchangers'] },
  { id: 'MASS_TRANSFER', label: 'Mass Transfer', category: 'DOMAIN', aliases: ['mass transfer', 'mass transfer operations', 'diffusion', 'separations'] },
  { id: 'SEPARATION_PROCESSES', label: 'Separation Processes', category: 'DOMAIN', aliases: ['separation processes', 'separation process', 'distillation', 'absorption', 'extraction', 'membrane separation', 'drying'] },
  { id: 'REACTION_ENGINEERING', label: 'Chemical Reaction Engineering', category: 'DOMAIN', aliases: ['reaction engineering', 'chemical reaction engineering', 'reaction kinetics', 'kinetics', 'catalysis', 'catalytic reaction'] },
  { id: 'PROCESS_CONTROL', label: 'Process Control / Instrumentation', category: 'DOMAIN', aliases: ['process control', 'process control and instrumentation', 'pci', 'pid control', 'plc', 'dcs', 'distributed control', 'instrumentation'] },
  { id: 'PROCESS_DESIGN', label: 'Process Design', category: 'DOMAIN', aliases: ['process design', 'process calculation', 'process calculations', 'process simulation', 'process engineering design', 'flowsheet', 'flow sheet', 'process development'] },
  { id: 'PLANT_DESIGN', label: 'Plant Design', category: 'DOMAIN', aliases: ['plant design', 'plant layout', 'equipment design', 'capital cost estimation', 'process plant design'] },
  { id: 'PROCESS_SAFETY', label: 'Process Safety', category: 'DOMAIN', aliases: ['process safety', 'industrial safety', 'hazard and operability', 'haazop', 'risk assessment', 'process hazard analysis', 'safety', 'loss prevention'] },
  { id: 'CHEMICAL_TECHNOLOGY', label: 'Chemical Technology / Industrial Processes', category: 'DOMAIN', aliases: ['chemical technology', 'unit operations', 'industrial chemistry', 'chemical plant operations'] },
  { id: 'MATERIALS', label: 'Materials / Polymers', category: 'DOMAIN', aliases: ['materials science', 'polymer science', 'polymers', 'composites', 'characterization', 'material characterization'] },
  { id: 'QUALITY_CONTROL', label: 'Quality Control / Lab', category: 'DOMAIN', aliases: ['quality control', 'qc', 'quality assurance', 'laboratory', 'analytical chemistry', 'lab testing', 'hse', 'laboratory safety'] },
  { id: 'PROCESS_OPTIMIZATION', label: 'Process Optimization', category: 'DOMAIN', aliases: ['process optimization', 'optimization', 'linear programming', 'process improvement', 'debottlenecking', 'troubleshooting'] },
  { id: 'MODELLING_SIMULATION', label: 'Process Modelling & Simulation', category: 'DOMAIN', aliases: ['process modelling', 'process modeling', 'aspen plus', 'aspen hysys', 'hysys', 'aspentech', 'process simulator', 'digital twin', 'monte carlo'] },
  { id: 'CHEMICAL_REACTION_ENGINEERING_DESIGN', label: 'Reactor Design', category: 'DOMAIN', aliases: ['reactor design', 'reactor engineering', 'scale up', 'scale-up'] },
  { id: 'WASTE_WATER', label: 'Waste Water / Environmental', category: 'DOMAIN', aliases: ['waste water treatment', 'wastewater', 'water treatment', 'effluent treatment', 'environmental engineering', 'pollution control', 'emissions control'] },

  // --- Tools ---------------------------------------------------------------
  { id: 'GIT', label: 'Git / GitHub', category: 'TOOLS', aliases: ['git', 'github', 'gitlab', 'bitbucket', 'version control'] },
  { id: 'AUTOCAD', label: 'AutoCAD', category: 'TOOLS', aliases: ['autocad', 'auto cad', 'drafting', 'cad'] },
  { id: 'PLC_PROGRAMMING', label: 'PLC Programming', category: 'TOOLS', aliases: ['plc programming', 'ladder logic', 'scada'] },
  { id: 'SAP', label: 'SAP', category: 'TOOLS', aliases: ['sap', 'sap pm', 'sap mm', 'erp'] },

  // --- Certifications ------------------------------------------------------
  { id: 'GATE', label: 'GATE', category: 'CERTIFICATION', aliases: ['gate', 'graduate aptitude test in engineering', 'gate score', 'gate rank'] },
  { id: 'NPTEL', label: 'NPTEL', category: 'CERTIFICATION', aliases: ['nptel'] },
  { id: 'SIX_SIGMA', label: 'Six Sigma', category: 'CERTIFICATION', aliases: ['six sigma', 'green belt', 'black belt', 'le six sigma'] },
  { id: 'HSE_CERT', label: 'HSE / Safety Certification', category: 'CERTIFICATION', aliases: ['hse certification', 'nptel safety', 'diploma in industrial safety', 'adsp', 'oshms'] },
  { id: 'CFI', label: 'CFA / Financial Certification', category: 'CERTIFICATION', aliases: ['cfa', 'cpa', 'ca inter'] },

  // --- Soft ----------------------------------------------------------------
  { id: 'COMMUNICATION', label: 'Communication', category: 'SOFT', aliases: ['communication', 'communication skills', 'written communication', 'verbal communication', 'presentation skills', 'presentation'] },
  { id: 'TEAMWORK', label: 'Teamwork', category: 'SOFT', aliases: ['teamwork', 'team work', 'collaboration', 'cross functional collaboration', 'cross-functional collaboration'] },
  { id: 'PROBLEM_SOLVING', label: 'Problem Solving', category: 'SOFT', aliases: ['problem solving', 'analytical thinking', 'critical thinking', 'attention to detail'] },
  { id: 'LEADERSHIP', label: 'Leadership', category: 'SOFT', aliases: ['leadership', 'team lead', 'supervision', 'mentoring'] },
  { id: 'PROJECT_MANAGEMENT', label: 'Project Management', category: 'SOFT', aliases: ['project management', 'project planning', 'programme management', 'program management'] },
];

const SKILL_INDEX: Array<{ alias: string; id: string }> = SKILLS.flatMap((s) =>
  s.aliases.map((a) => ({ alias: a, id: s.id })),
).sort((a, b) => b.alias.length - a.alias.length);

export function skillLabel(id: string): string {
  return SKILLS.find((s) => s.id === id)?.label ?? id;
}

/** Normalise a free-text skill into a canonical id, or null if unknown. */
export function canonicalizeSkill(input: string): string | null {
  const s = comparable(input);
  if (!s) return null;
  for (const { alias, id } of SKILL_INDEX) {
    // Word-boundary-ish check to avoid "r" matching inside "process".
    if (alias.length <= 2) {
      if (new RegExp(`\\b${escapeRe(alias)}\\b`).test(s)) return id;
    } else if (s.includes(alias)) {
      return id;
    }
  }
  return null;
}

/** Find every canonical skill mentioned in a block of text. */
export function skillsInText(text: string): string[] {
  const s = ` ${comparable(text)} `;
  const found = new Set<string>();
  for (const { alias, id } of SKILL_INDEX) {
    if (alias.length <= 2) {
      if (new RegExp(`\\b${escapeRe(alias)}\\b`).test(s)) found.add(id);
    } else if (s.includes(alias)) {
      found.add(id);
    }
  }
  return [...found];
}

/** Canonicalise a list of user-entered skills, keeping unknown ones verbatim. */
export function canonicalizeSkillList(inputs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of inputs) {
    const t = raw.trim();
    if (!t) continue;
    const id = canonicalizeSkill(t) ?? t;
    const key = comparable(id);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(id);
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

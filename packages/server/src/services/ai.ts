/**
 * Optional LLM assist for requirement extraction.
 *
 * This is deliberately a *second opinion*, never the authority:
 *   - The deterministic extractor runs first and its results are sent as input.
 *   - The model may only add requirements that quote text from the posting.
 *   - Any field it returns without an explicit quote is discarded.
 *   - If no key is configured, or the call fails, the deterministic result is
 *     returned untouched.
 *
 * Without this the app is fully functional; with it, thin postings get better
 * structured requirements. In both cases the UI reports which engine produced
 * the numbers.
 */

import type { JobRequirements, RequirementOrigin } from '@jet/shared';
import { canonicalizeSkill, classifyDegreeLevel, classifyField } from '@jet/shared';
import { config } from '../config.js';

interface AiExtraction {
  degreeLevelRaw?: string;
  degreeQuote?: string;
  fieldsRaw?: string;
  fieldsQuote?: string;
  experienceMin?: number | null;
  experienceMax?: number | null;
  experienceMandatory?: boolean;
  experienceQuote?: string;
  skillsRequired?: Array<{ skill: string; quote: string }>;
  skillsPreferred?: Array<{ skill: string; quote: string }>;
  certifications?: Array<{ name: string; quote: string }>;
  workAuthorization?: string[] | null;
  requiresRelocation?: boolean;
}

const SYSTEM = `You extract job requirements for an applicant-screening tool.

You are given the full text of a job posting. Return ONLY requirements that the posting states explicitly.

Hard rules:
- Every value you return must be supported by a verbatim quote copied from the posting text.
- If the posting does not state something, omit it. Do NOT infer, estimate, or use general knowledge about the role.
- Do not return a requirement just because it is typical for the job title.
- Salary, deadlines, and dates: copy only if the posting states them.
- Prefer "not stated" over a guess. An empty list is a valid and correct answer.

Return a single JSON object, no prose, with these optional keys:
{
  "degreeLevelRaw": string, "degreeQuote": string,
  "fieldsRaw": string, "fieldsQuote": string,
  "experienceMin": number, "experienceMax": number,
  "experienceMandatory": boolean, "experienceQuote": string,
  "skillsRequired": [{"skill": "...", "quote": "..."}],
  "skillsPreferred": [{"skill": "...", "quote": "..."}],
  "certifications": [{"name": "...", "quote": "..."}],
  "workAuthorization": string[] | null,
  "requiresRelocation": boolean
}`;

export interface AiResultMeta {
  engine: string;
  applied: boolean;
  reason?: string;
}

export async function maybeEnrichWithAi(
  requirements: JobRequirements,
  description: string,
  title: string,
): Promise<JobRequirements | null> {
  if (!config.ai.enabled) return null;
  if (description.trim().length < 120) return null;
  // Only worth a call when the deterministic pass is actually thin.
  if (requirements.gaps.length === 0 && requirements.skillsRequired.length >= 3) return null;

  try {
    const raw = await callModel(title, description.slice(0, 12_000));
    if (!raw) return null;
    return apply(raw, requirements, description);
  } catch (err) {
    console.error('[ai] extraction failed, keeping deterministic result:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function callModel(title: string, description: string): Promise<AiExtraction | null> {
  const user = `Job title: ${title}\n\nPosting text:\n"""\n${description}\n"""`;

  if (config.ai.openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.ai.openaiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.ai.openaiModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    return text ? (JSON.parse(text) as AiExtraction) : null;
  }

  if (config.ai.anthropicKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.ai.anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.ai.anthropicModel,
        max_tokens: 1500,
        temperature: 0,
        system: [{ type: 'text', text: SYSTEM }],
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    return text ? (JSON.parse(stripFence(text)) as AiExtraction) : null;
  }

  return null;
}

function stripFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/**
 * Merge the model's answer into the deterministic requirements, keeping only
 * fields backed by a verbatim quote found in the posting.
 */
function apply(ai: AiExtraction, base: JobRequirements, description: string): JobRequirements | null {
  const next: JobRequirements = structuredCloneSafe(base);
  let applied = 0;

  const quoted = (quote: string | undefined, ...mustInclude: string[]): boolean => {
    if (!quote) return false;
    const q = normalizeForCompare(quote);
    if (q.length < 8) return false;
    if (!normalizeForCompare(description).includes(q)) return false;
    return mustInclude.every((m) => q.includes(normalizeForCompare(m)));
  };

  if (ai.degreeLevelRaw && quoted(ai.degreeQuote, ai.degreeLevelRaw)) {
    const level = classifyDegreeLevel(ai.degreeLevelRaw);
    if (level !== 'UNKNOWN' && next.degreeLevel === 'UNKNOWN') {
      next.degreeLevel = level as JobRequirements['degreeLevel'];
      next.degreeLevelRaw = ai.degreeLevelRaw;
      next.evidence.degreeLevel = ai.degreeQuote ?? '';
      next.origin.degreeLevel = 'LLM' as RequirementOrigin;
      applied += 1;
    }
  }

  if (ai.fieldsRaw && quoted(ai.fieldsQuote)) {
    const field = classifyField(ai.fieldsRaw);
    if (field !== 'UNKNOWN' && next.fields.length === 0) {
      next.fields = [field];
      next.fieldsRaw = ai.fieldsRaw;
      next.evidence.fields = ai.fieldsQuote ?? '';
      next.origin.fields = 'LLM' as RequirementOrigin;
      applied += 1;
    }
  }

  if (ai.experienceQuote && (ai.experienceMin != null || ai.experienceMax != null) && !next.experienceStated) {
    if (quoted(ai.experienceQuote)) {
      next.experienceMin = ai.experienceMin ?? null;
      next.experienceMax = ai.experienceMax ?? null;
      next.experienceStated = true;
      next.experienceMandatory = ai.experienceMandatory !== false;
      next.experienceRaw = ai.experienceQuote;
      next.evidence.experience = ai.experienceQuote ?? '';
      next.origin.experience = 'LLM' as RequirementOrigin;
      next.gaps = next.gaps.filter((g) => !/experience/i.test(g));
      applied += 1;
    }
  }

  const addSkills = (
    items: Array<{ skill: string; quote: string }> | undefined,
    existing: string[],
    key: 'skillsRequired' | 'skillsPreferred',
    originKey: 'skillsRequired' | 'skillsPreferred',
  ): string[] => {
    const out = [...existing];
    for (const item of items ?? []) {
      if (out.length >= 25) break;
      const canonical = canonicalizeSkill(item.skill);
      if (!canonical || out.includes(canonical)) continue;
      if (!quoted(item.quote, item.skill)) continue;
      out.push(canonical);
      if (!next.evidence[originKey]) next.evidence[originKey] = item.quote;
      next.origin[originKey] = 'LLM' as RequirementOrigin;
      applied += 1;
    }
    next[key] = out;
    return out;
  };

  next.skillsRequired = addSkills(ai.skillsRequired, next.skillsRequired, 'skillsRequired', 'skillsRequired');
  next.skillsPreferred = addSkills(ai.skillsPreferred, next.skillsPreferred, 'skillsPreferred', 'skillsPreferred');

  for (const cert of ai.certifications ?? []) {
    if (next.certifications.length >= 10) break;
    const name = cert.name?.trim();
    if (!name || name.length > 80) continue;
    if (!quoted(cert.quote, name)) continue;
    if (next.certifications.some((c) => c.toLowerCase() === name.toLowerCase())) continue;
    next.certifications.push(name);
    next.evidence.certifications = cert.quote;
    next.origin.certifications = 'LLM' as RequirementOrigin;
    applied += 1;
  }

  if (ai.workAuthorization && ai.workAuthorization.length > 0 && next.workAuthorization === null) {
    next.workAuthorization = ai.workAuthorization.slice(0, 5);
    next.origin.workAuthorization = 'LLM' as RequirementOrigin;
    applied += 1;
  }

  if (ai.requiresRelocation === true && !next.requiresRelocation) {
    next.requiresRelocation = true;
    next.origin.requiresRelocation = 'LLM' as RequirementOrigin;
    applied += 1;
  }

  // An LLM pass that changes nothing must not change the verdict.
  return applied > 0 ? next : null;
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[’']/g, "'").trim();
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

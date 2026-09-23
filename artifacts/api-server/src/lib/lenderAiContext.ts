/**
 * The contract between lender matching and the AI assistant.
 *
 * This module deliberately contains no database or provider code. Keeping the
 * context contract pure makes it possible to test that the model cannot rank
 * on unknown values and that every recommendation is traceable to a criterion
 * and (when applicable) a document gap.
 */

export interface AiCriterion {
  criterion: string;
  passed: boolean;
  detail?: string | null;
  skipped?: boolean;
  value?: unknown;
  provenance?: string | null;
}

export interface LenderAiCandidate {
  lenderId: number | string;
  lenderName: string;
  criteriaBreakdown: readonly AiCriterion[];
  provenance?: readonly string[] | null;
  stipulations?: readonly string[] | null;
  points?: number | null;
  /** Optional document gaps identified by matching/package readiness. */
  documentGaps?: readonly string[] | null;
  /** Other dimensions may be supplied, but null/undefined dimensions are hidden. */
  dimensions?: Readonly<Record<string, unknown>> | null;
}

export interface LenderAiContext {
  candidates: Array<{
    lenderId: number | string;
    lenderName: string;
    criteriaBreakdown: AiCriterion[];
    provenance: string[];
    stipulations: string[];
    points?: number;
    documentGaps: string[];
    dimensions: Record<string, unknown>;
  }>;
}

export interface LenderAiRecommendation {
  lenderId: number | string;
  recommendation: string;
  criterion: string;
  documentGap?: string;
}

/** Adapts the persisted lender-match shape without coupling this module to Drizzle types. */
export function buildLenderAiCandidatesFromMatches(
  matches: readonly {
    lenderId: number;
    lender: {
      name: string;
      guidelineSource?: string | null;
      requiredDocuments?: readonly string[] | null;
      compensation?: { type?: string; min?: number; max?: number } | null;
    };
    criteriaBreakdown?: unknown;
  }[],
  uploadedDocuments: readonly { category?: string | null; label?: string | null; accountType?: string | null }[] = [],
): LenderAiCandidate[] {
  const uploadedCategories = new Set(uploadedDocuments.map((document) => document.category).filter(Boolean));
  const uploaded = uploadedDocuments.flatMap((document) => [document.category, document.label])
    .filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
  const personalOrJoint = uploadedDocuments.some((document) => /personal|joint/i.test(document.accountType ?? ""));
  const requiredCategory = (stipulation: string): string | null => {
    if (/bank|account|statement/i.test(stipulation)) return "bank_statement";
    if (/invoice|quote/i.test(stipulation)) return "invoice_quote";
    if (/cdl|driver|license/i.test(stipulation)) return "drivers_license";
    if (/tax/i.test(stipulation)) return "tax_return";
    if (/application/i.test(stipulation)) return "signed_application";
    return null;
  };
  return matches.map((match) => {
    const criteria = Array.isArray(match.criteriaBreakdown)
      ? match.criteriaBreakdown.filter((item): item is AiCriterion => Boolean(item && typeof item === "object" && "criterion" in item))
      : [];
    const stipulations = match.lender.requiredDocuments ?? [];
    return {
      lenderId: match.lenderId,
      lenderName: match.lender.name,
      criteriaBreakdown: criteria,
      provenance: match.lender.guidelineSource ? [match.lender.guidelineSource] : [],
      stipulations,
      points: match.lender.compensation?.type === "points"
        ? match.lender.compensation.max ?? match.lender.compensation.min ?? null
        : null,
      documentGaps: stipulations.filter((document) => {
        const category = requiredCategory(document);
        // A recognized upload category satisfies a stipulation even when the
        // lender's prose uses different wording (e.g. "business statements").
        return category ? !uploadedCategories.has(category) : !uploaded.includes(document.toLowerCase());
      }).concat(
        personalOrJoint && stipulations.some((document) => /bank|account|statement/i.test(document))
          ? ["Document Gap: business bank statements are flagged personal/joint"]
          : [],
      ),
    };
  });
}

const SENSITIVE_TEXT = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED-EMAIL]"],
  [/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED-PHONE]"],
  [/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[REDACTED-SSN]"],
  [/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "[REDACTED-DATE]"],
  [/\b\d{8,}\b/g, "[REDACTED-NUMBER]"],
  [/\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s){1,4}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Way|Court|Ct|Circle|Cir|Place|Pl|Terrace|Ter|Highway|Hwy|Parkway|Pkwy)\.?\b[^,.\n]*/gi, "[REDACTED-ADDRESS]"],
  [/\bP\.?\s*O\.?\s+Box\s+\d+\b/gi, "[REDACTED-ADDRESS]"],
  [/\b\d{5}(?:-\d{4})?\b/g, "[REDACTED-ZIP]"],
] as const;

function redact(value: string): string {
  return SENSITIVE_TEXT.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function textList(value: readonly string[] | null | undefined): string[] {
  return (value ?? []).filter((item): item is string => typeof item === "string").map(redact);
}

function visibleDimensions(dimensions: Readonly<Record<string, unknown>> | null | undefined) {
  return Object.fromEntries(
    Object.entries(dimensions ?? {}).filter(([, value]) => value !== null && value !== undefined),
  );
}

function visibleCriterion(criterion: AiCriterion): AiCriterion {
  const visible: AiCriterion = {
    criterion: redact(criterion.criterion),
    passed: criterion.passed,
    ...(criterion.value !== undefined ? { value: criterion.value } : {}),
    ...(criterion.skipped !== undefined ? { skipped: criterion.skipped } : {}),
  };
  if (criterion.detail != null) visible.detail = redact(criterion.detail);
  if (criterion.provenance != null) visible.provenance = redact(criterion.provenance);
  return visible;
}

export function buildLenderAiContext(candidates: readonly LenderAiCandidate[]): LenderAiContext {
  return {
    candidates: candidates.map((candidate) => {
      const criteriaBreakdown = candidate.criteriaBreakdown
        .filter((criterion) => !criterion.skipped)
        // Existing matcher criteria do not always carry a separate `value`;
        // their detail is still useful evidence. Hide only dimensions that
        // explicitly declare a null/undefined value.
        .filter((criterion) => !("value" in criterion) || (criterion.value !== null && criterion.value !== undefined))
        .map(visibleCriterion);
      const item: LenderAiContext["candidates"][number] = {
        lenderId: candidate.lenderId,
        lenderName: redact(candidate.lenderName),
        criteriaBreakdown,
        provenance: textList(candidate.provenance),
        stipulations: textList(candidate.stipulations),
        documentGaps: textList(candidate.documentGaps),
        dimensions: visibleDimensions(candidate.dimensions),
      };
      if (candidate.points != null) item.points = candidate.points;
      return item;
    }),
  };
}

export const LENDER_AI_SYSTEM_PROMPT = `You are a commercial-lending decision support assistant.
Use only the supplied lender context. Null or omitted dimensions are unknown: never rank,
score, compare, or infer a lender using an unknown dimension, and do not mention hidden
dimensions. Every recommendation MUST include a criterion citation from that lender's
criteriaBreakdown. If a document gap exists, cite the exact document gap; never imply the
gap is satisfied. Cite provenance when explaining a criterion or stipulation. Do not claim
approval, eligibility, pricing, or funding. Return JSON only:
{"recommendations":[{"lenderId":"<id>","recommendation":"<grounded guidance>",
"criterion":"<exact criterion name>","documentGap":"<exact gap, only when present>"}]}`;

export function buildLenderAiPrompt(candidates: readonly LenderAiCandidate[]): string {
  return `${LENDER_AI_SYSTEM_PROMPT}\n\nLender context:\n${JSON.stringify(buildLenderAiContext(candidates))}`;
}

/**
 * Validates provider output at the boundary. Recommendations without a
 * criterion citation are discarded rather than presented as unsupported advice.
 */
export function filterLenderAiRecommendations(
  recommendations: readonly LenderAiRecommendation[],
  context: LenderAiContext,
): LenderAiRecommendation[] {
  const byId = new Map(context.candidates.map((candidate) => [String(candidate.lenderId), candidate]));
  return recommendations.filter((recommendation) => {
    const candidate = byId.get(String(recommendation.lenderId));
    if (!candidate || !recommendation.recommendation?.trim() || !recommendation.criterion?.trim()) return false;
    const criterion = candidate.criteriaBreakdown.find((item) => item.criterion === recommendation.criterion);
    if (!criterion) return false;
    if (recommendation.documentGap != null && !candidate.documentGaps.includes(recommendation.documentGap)) return false;
    return true;
  });
}

export function validateLenderRecommendationText(
  actions: readonly string[],
  context: LenderAiContext,
): string[] | null {
  if (actions.length < 2) return null;
  const criteria = context.candidates.flatMap((candidate) => candidate.criteriaBreakdown.map((item) => item.criterion));
  const gaps = context.candidates.flatMap((candidate) => candidate.documentGaps);
  const valid = actions.filter((action) => {
    const hasCriterion = criteria.some((criterion) => action.includes(criterion));
    const hasGapWhenPresent = gaps.length === 0 || gaps.some((gap) => action.includes(gap));
    return action.length <= 600 && hasCriterion && hasGapWhenPresent;
  });
  return valid.length === actions.length ? valid : null;
}
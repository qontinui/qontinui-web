import type { VerificationData, TaskRunKnowledge, Finding } from "@/lib/runner";

export function transformVerification(raw: unknown): VerificationData {
  const obj = raw as Record<string, unknown>;
  if (
    obj &&
    typeof obj === "object" &&
    "results" in obj &&
    Array.isArray(obj.results)
  ) {
    return {
      results: obj.results as import("@/lib/runner").VerificationResult[],
      summary:
        (obj.summary as import("@/lib/runner").VerificationSummary) ?? null,
    };
  }
  if (Array.isArray(raw))
    return {
      results: raw as import("@/lib/runner").VerificationResult[],
      summary: null,
    };
  return { results: [], summary: null };
}

export function transformKnowledge(raw: unknown): TaskRunKnowledge {
  const obj = raw as Record<string, unknown>;
  if (
    obj &&
    typeof obj === "object" &&
    "knowledge" in obj &&
    Array.isArray(obj.knowledge)
  ) {
    const items = obj.knowledge as Array<Record<string, unknown>>;
    return {
      findings: items.filter(
        (k) => k.category === "finding"
      ) as unknown as Finding[],
      observations: items
        .filter((k) => k.category === "observation")
        .map((k) => String(k.content || k.title || "")),
      hypotheses: items
        .filter((k) => k.category === "hypothesis")
        .map((k) => String(k.content || k.title || "")),
    };
  }
  if (obj && "findings" in obj) return obj as unknown as TaskRunKnowledge;
  return { findings: [], observations: [], hypotheses: [] };
}

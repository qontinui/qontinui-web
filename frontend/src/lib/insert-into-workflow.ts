import type { UnifiedStep } from "@/types/unified-workflow";

export function buildInsertWorkflowUrl(stepData: Partial<UnifiedStep>): string {
  const encoded = encodeURIComponent(JSON.stringify(stepData));
  return `/build/workflows?insertStep=${encoded}`;
}

export function parseInsertStepParam(
  param: string | null,
): Partial<UnifiedStep> | null {
  if (!param) return null;
  try {
    return JSON.parse(decodeURIComponent(param));
  } catch {
    return null;
  }
}

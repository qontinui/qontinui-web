import type { DiscoveredSpec } from "@/lib/spec-prompt-builder";

export function filterSelectedGroups(
  specs: DiscoveredSpec[]
): DiscoveredSpec[] {
  return specs.filter((spec) => (spec.config?.groups ?? []).length > 0);
}

export function getSpecPageUrl(spec: DiscoveredSpec): string {
  return spec.config?.metadata?.pageUrl || spec.specId;
}

/**
 * spec-prompt-builder.ts
 *
 * Builds a structured AI prompt from discovered UI Bridge spec data.
 * Used by AiGeneratePanel to create spec-driven workflow generation requests.
 */

// =============================================================================
// Types (mirrors the spec JSON structure)
// =============================================================================

export interface SpecAssertion {
  id: string;
  description: string;
  category: string;
  severity: "critical" | "warning" | "info";
  enabled: boolean;
  target?: Record<string, unknown>;
  assertionType?: string;
  condition?: Record<string, unknown>;
}

export interface SpecGroup {
  id: string;
  name: string;
  description: string;
  category: string;
  assertions: SpecAssertion[];
  source?: string;
}

export interface SpecConfig {
  version: string;
  description: string;
  groups: SpecGroup[];
  metadata?: {
    component?: string;
    pageUrl?: string;
    tags?: string[];
    [key: string]: unknown;
  };
}

export interface DiscoveredSpec {
  specId: string;
  config: SpecConfig;
}

// =============================================================================
// Prompt builder
// =============================================================================

export interface BuildSpecPromptOptions {
  discoveredSpecs: DiscoveredSpec[];
  selectedGroupIds: Set<string>;
}

export interface SpecPromptResult {
  prompt: string;
  totalGroups: number;
  totalAssertions: number;
  pageCount: number;
}

export function buildSpecPrompt({
  discoveredSpecs,
  selectedGroupIds,
}: BuildSpecPromptOptions): SpecPromptResult {
  const lines: string[] = [
    "Create a verification workflow based on UI Bridge page specifications.",
    "",
  ];

  let totalGroups = 0;
  let totalAssertions = 0;
  const pageUrls = new Set<string>();

  for (const spec of discoveredSpecs) {
    const { config } = spec;
    const pageUrl = config.metadata?.pageUrl || spec.specId;
    pageUrls.add(pageUrl);

    const selectedGroups = config.groups.filter((g) =>
      selectedGroupIds.has(g.id)
    );
    if (selectedGroups.length === 0) continue;

    lines.push(`## Page: ${pageUrl}`);
    if (config.description) {
      lines.push(`Spec: ${config.description}`);
    }
    lines.push("");

    for (const group of selectedGroups) {
      totalGroups++;
      const enabledAssertions = group.assertions.filter((a) => a.enabled);

      lines.push(`### ${group.name} (${group.category})`);
      if (group.description) {
        lines.push(group.description);
      }
      lines.push("Assertions:");

      for (const assertion of enabledAssertions) {
        totalAssertions++;
        lines.push(
          `- [${assertion.severity.toUpperCase()}] ${assertion.description}`
        );
      }
      lines.push("");
    }
  }

  const pageCount = pageUrls.size;

  lines.push(
    `Summary: ${totalGroups} spec group${totalGroups !== 1 ? "s" : ""}, ${totalAssertions} assertion${totalAssertions !== 1 ? "s" : ""} across ${pageCount} page${pageCount !== 1 ? "s" : ""}.`,
    "",
    "Create verification steps using UI Bridge SDK assertions for each spec group.",
    "Include setup (navigate + connect), agentic (fix failures), and completion (summary) steps."
  );

  return {
    prompt: lines.join("\n"),
    totalGroups,
    totalAssertions,
    pageCount,
  };
}

/**
 * semantic-spec-registry.ts
 *
 * Static registry of all semantic page specs.
 * Imports spec JSON files directly so they're available without
 * runtime UI Bridge discovery or SPA navigation.
 */

import type { DiscoveredSpec } from "./spec-prompt-builder";

// Import all spec JSON files
import inspectorSpec from "@/app/(app)/tools/inspector/inspector.spec.uibridge.json";
import workflowsSpec from "@/app/(app)/build/workflows/workflows.spec.uibridge.json";
import templatesSpec from "@/app/(app)/build/templates/templates.spec.uibridge.json";
import executeSpec from "@/app/(app)/execute/execute.spec.uibridge.json";
import runsSpec from "@/app/(app)/runs/runs.spec.uibridge.json";
import activeRunsSpec from "@/app/(app)/runs/active/active-runs.spec.uibridge.json";
import runnersSpec from "@/app/(app)/runners/runners.spec.uibridge.json";
import errorMonitorSpec from "@/app/(app)/tools/error-monitor/error-monitor.spec.uibridge.json";
import aiSettingsSpec from "@/app/(app)/settings/ai/ai-settings.spec.uibridge.json";
import contextsSpec from "@/app/(app)/build/contexts/contexts.spec.uibridge.json";
import findingsSpec from "@/app/(app)/runs/findings/findings.spec.uibridge.json";
import statisticsSpec from "@/app/(app)/runs/statistics/statistics.spec.uibridge.json";

interface RawSpec {
  specId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

const ALL_SPECS: RawSpec[] = [
  { specId: "inspector", json: inspectorSpec },
  { specId: "workflows", json: workflowsSpec },
  { specId: "templates", json: templatesSpec },
  { specId: "execute", json: executeSpec },
  { specId: "runs", json: runsSpec },
  { specId: "active-runs", json: activeRunsSpec },
  { specId: "runners", json: runnersSpec },
  { specId: "error-monitor", json: errorMonitorSpec },
  { specId: "ai-settings", json: aiSettingsSpec },
  { specId: "contexts", json: contextsSpec },
  { specId: "findings", json: findingsSpec },
  { specId: "statistics", json: statisticsSpec },
];

/**
 * Get all semantic page specs as DiscoveredSpec[].
 * Filters to only include groups with category "semantic".
 */
export function getAllSemanticSpecs(): DiscoveredSpec[] {
  const result: DiscoveredSpec[] = [];

  for (const { specId, json } of ALL_SPECS) {
    const groups = (json.groups ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g: any) => g.category === "semantic"
    );
    if (groups.length === 0) continue;

    result.push({
      specId,
      config: {
        version: json.version ?? "1.0.0",
        description: json.description ?? "",
        groups,
        metadata: json.metadata,
      },
    });
  }

  return result;
}

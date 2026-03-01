import {
  isValidUIBridgeConfig,
  type ElementFingerprint,
  type UIBridgeConfig,
  type UIBridgeState,
  type UIBridgeTransition,
} from "./types";

export interface ExportOptions {
  configName: string;
  includeGlobalStates: boolean;
  includeModalStates: boolean;
  includeElementDetails: boolean;
  description?: string;
}

export function getDefaultExportOptions(): ExportOptions {
  return {
    configName: "Untitled State Machine",
    includeGlobalStates: true,
    includeModalStates: true,
    includeElementDetails: true,
  };
}

/** Build UIBridgeConfig JSON from builder state */
export function buildUIBridgeConfig(
  states: UIBridgeState[],
  transitions: UIBridgeTransition[],
  fingerprintDetails: Record<string, ElementFingerprint>,
  options: ExportOptions
): UIBridgeConfig {
  const filteredStates = states.filter((s) => {
    if (s.isGlobal && !options.includeGlobalStates) return false;
    if (s.isModal && !options.includeModalStates) return false;
    return true;
  });

  const filteredStateIds = new Set(filteredStates.map((s) => s.id));

  const filteredTransitions = transitions.filter(
    (t) => filteredStateIds.has(t.from) && filteredStateIds.has(t.to)
  );

  const exportedStates = filteredStates.map((s) => {
    const exported: UIBridgeState = { ...s };
    if (!options.includeElementDetails) {
      delete exported.elements;
    }
    return exported;
  });

  return {
    name: options.configName,
    version: "1.0.0",
    description: options.description,
    exportedAt: new Date().toISOString(),
    source: "state-discovery",
    metadata: {
      totalFingerprints: Object.keys(fingerprintDetails).length,
    },
    states: exportedStates,
    transitions: filteredTransitions,
    fingerprintDetails: options.includeElementDetails
      ? fingerprintDetails
      : undefined,
  };
}

/** Download config as JSON file */
export function downloadConfig(config: UIBridgeConfig): void {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Copy config JSON to clipboard */
export async function copyConfigToClipboard(
  config: UIBridgeConfig
): Promise<void> {
  const json = JSON.stringify(config, null, 2);
  await navigator.clipboard.writeText(json);
}

/** Validate and parse an imported JSON config */
export function validateAndParseConfig(
  json: string
): { config: UIBridgeConfig } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "Invalid JSON format" };
  }

  if (!isValidUIBridgeConfig(parsed)) {
    return {
      error:
        "Invalid config: must have a 'states' array where each state has 'id', 'name', and 'fingerprints'",
    };
  }

  // Validate transition references
  const stateIds = new Set(parsed.states.map((s) => s.id));
  const transitions = parsed.transitions ?? [];
  for (const t of transitions) {
    if (!stateIds.has(t.from)) {
      return {
        error: `Transition '${t.id}' references unknown source state '${t.from}'`,
      };
    }
    if (!stateIds.has(t.to)) {
      return {
        error: `Transition '${t.id}' references unknown target state '${t.to}'`,
      };
    }
  }

  return { config: parsed };
}

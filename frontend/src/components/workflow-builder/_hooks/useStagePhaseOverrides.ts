import { useCallback, useMemo } from "react";
import type {
  ModelOverrideConfig,
  ModelOverrides,
} from "@/types/unified-workflow";
import { MODEL_OVERRIDE_PHASES } from "@qontinui/workflow-utils";

/**
 * Manages per-phase model override state for a stage.
 * Encapsulates the logic for detecting, updating, and resetting phase-level overrides.
 */
export function useStagePhaseOverrides(
  stageOverridesRaw: ModelOverrides | undefined,
  onUpdate: (updates: Record<string, unknown>) => void
) {
  const stageOverrides: ModelOverrides = useMemo(
    () => (stageOverridesRaw as ModelOverrides) ?? {},
    [stageOverridesRaw]
  );

  const hasPhaseOverrides = useMemo(
    () =>
      MODEL_OVERRIDE_PHASES.some((phase) => {
        const cfg = stageOverrides[phase.key as keyof ModelOverrides];
        return cfg?.provider || cfg?.model;
      }),
    [stageOverrides]
  );

  const updatePhaseOverride = useCallback(
    (phaseKey: string, field: "provider" | "model", value: string) => {
      const current = { ...stageOverrides };
      const phaseCfg: ModelOverrideConfig = {
        ...(current[phaseKey as keyof ModelOverrides] ?? {}),
      };
      if (value) {
        phaseCfg[field] = value;
      } else {
        delete phaseCfg[field];
      }
      if (!phaseCfg.provider && !phaseCfg.model) {
        delete current[phaseKey as keyof ModelOverrides];
      } else {
        (current as Record<string, ModelOverrideConfig>)[phaseKey] = phaseCfg;
      }
      onUpdate({
        modelOverrides: Object.keys(current).length > 0 ? current : undefined,
      });
    },
    [stageOverrides, onUpdate]
  );

  const resetOverrides = useCallback(() => {
    onUpdate({ modelOverrides: undefined });
  }, [onUpdate]);

  return {
    stageOverrides,
    hasPhaseOverrides,
    updatePhaseOverride,
    resetOverrides,
  };
}

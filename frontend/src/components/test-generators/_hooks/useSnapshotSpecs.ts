import { useState, useCallback, useMemo } from "react";
import {
  generateSpecsFromSnapshot,
  type SnapshotData,
  type SnapshotElement,
} from "../shared/spec-generators";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import type {
  SpecGroup,
  NonVisualState,
  GeneratorSpecMetadata,
} from "../types";

type Tab = "elements" | "annotations" | "specs" | "output";

interface UseSnapshotSpecsArgs {
  snapshotData: SnapshotData | null;
  elements: SnapshotElement[];
  specs: SpecGroup[];
  setSpecs: (specs: SpecGroup[]) => void;
  setActiveTab: (tab: Tab) => void;
}

export function useSnapshotSpecs({
  snapshotData,
  elements,
  specs,
  setSpecs,
  setActiveTab,
}: UseSnapshotSpecsArgs) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = useCallback(() => {
    if (!snapshotData) return;
    setIsGenerating(true);
    const stateId = `state-${Date.now()}`;
    const generated = generateSpecsFromSnapshot(snapshotData, stateId);
    setSpecs(generated);
    setIsGenerating(false);
    setActiveTab("specs");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotData]);

  const output: SpecConfig | null = useMemo(() => {
    if (specs.length === 0 || !snapshotData) return null;
    const now = new Date().toISOString();
    const state: NonVisualState = {
      id: specs[0]?.stateId || "state-default",
      name: snapshotData.pageTitle || "Page Snapshot",
      description: `Snapshot of ${snapshotData.pageUrl || "unknown page"}`,
      elementIds: elements.map((e) => e.id),
      pageUrl: snapshotData.pageUrl,
      pageTitle: snapshotData.pageTitle,
      confidence: 1.0,
    };
    const metadata: GeneratorSpecMetadata = {
      generatorType: "snapshot",
      pageUrl: snapshotData.pageUrl,
      states: [state],
      transitions: [],
      snapshotMetadata: {
        snapshotId: `snapshot-${Date.now()}`,
        pageUrl: snapshotData.pageUrl || "",
        pageTitle: snapshotData.pageTitle || "",
        capturedAt: now,
        elementCount: elements.length,
        formCount: snapshotData.forms.length,
        modalCount: snapshotData.modals.length,
      },
      createdAt: now,
      updatedAt: now,
    };
    return {
      version: "1.0.0" as const,
      description: `Snapshot specs for ${snapshotData.pageTitle || snapshotData.pageUrl || "page"}`,
      groups: specs,
      metadata,
    };
  }, [specs, snapshotData, elements]);

  return {
    isGenerating,
    output,
    handleGenerate,
  };
}

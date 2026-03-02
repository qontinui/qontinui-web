import { useMemo } from "react";
import type { SnapshotElement } from "../shared/spec-generators";
import type { BrowsableElement } from "../snapshot/SnapshotElementBrowser";
import type { ElementDetail } from "../snapshot/ElementDetailPanel";
import type { AnnotationData } from "../snapshot/AnnotationEditor";
import type { SpecGroup } from "../types";

interface UseSnapshotDerivedDataArgs {
  elements: SnapshotElement[];
  annotations: Map<string, AnnotationData>;
  specs: SpecGroup[];
  selectedElementId: string | null;
}

export function useSnapshotDerivedData({
  elements,
  annotations,
  specs,
  selectedElementId,
}: UseSnapshotDerivedDataArgs) {
  const browsableElements: BrowsableElement[] = useMemo(
    () =>
      elements.map((el) => ({
        id: el.id,
        type: el.type,
        label: el.label || el.id,
        isInteractive: el.isInteractive,
        isAnnotated: annotations.has(el.id),
        hasSpecs: specs.some((s) =>
          s.assertions.some(
            (a) => a.target.type === "elementId" && a.target.elementId === el.id
          )
        ),
      })),
    [elements, annotations, specs]
  );

  const selectedDetail: ElementDetail | null = useMemo(() => {
    if (!selectedElementId) return null;
    const el = elements.find((e) => e.id === selectedElementId);
    if (!el) return null;
    const ann = annotations.get(el.id);
    return {
      id: el.id,
      type: el.type,
      label: el.label || el.id,
      role: el.role,
      ariaLabel: el.ariaLabel,
      isVisible: el.isVisible,
      isEnabled: el.isEnabled,
      isInteractive: el.isInteractive,
      value: el.value,
      checked: el.checked,
      actions: el.isInteractive ? ["click", "type", "focus"] : ["focus"],
      annotation: ann
        ? {
            description: ann.description,
            purpose: ann.purpose,
            notes: ann.notes,
            tags: ann.tags,
          }
        : undefined,
      attributes: el.attributes,
    };
  }, [selectedElementId, elements, annotations]);

  return {
    browsableElements,
    selectedDetail,
  };
}

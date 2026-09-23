import { useState, useCallback } from "react";
import type { AnnotationData } from "../snapshot/AnnotationEditor";
import { runnerRequest } from "@/lib/runner/api-client";
import { useRunnerTarget } from "@/contexts/active-runner-context";

interface UseSnapshotAnnotationsArgs {
  setAnnotations: (
    updater: (prev: Map<string, AnnotationData>) => Map<string, AnnotationData>
  ) => void;
}

export function useSnapshotAnnotations({
  setAnnotations,
}: UseSnapshotAnnotationsArgs) {
  const target = useRunnerTarget();
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);

  const handleSaveAnnotation = useCallback(
    async (annotation: AnnotationData) => {
      setIsSavingAnnotation(true);
      try {
        await runnerRequest(
          target,
          `/ui-bridge/annotations/${annotation.elementId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(annotation),
          }
        );
        setAnnotations((prev) => {
          const next = new Map(prev);
          next.set(annotation.elementId, annotation);
          return next;
        });
      } catch (err) {
        console.error("Failed to save annotation:", err);
      } finally {
        setIsSavingAnnotation(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target]
  );

  return {
    isSavingAnnotation,
    handleSaveAnnotation,
  };
}

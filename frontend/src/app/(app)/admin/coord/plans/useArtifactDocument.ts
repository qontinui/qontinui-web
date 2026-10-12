"use client";

/**
 * The plan-library document behind a `/admin/coord/plans` row — read in full,
 * and the one write the detail panel offers (the kind correction).
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 1:
 * folded here from the retired `/admin/coord/plan-library` list, whose
 * `usePlanLibrary` owned these two calls. `ArtifactDetailPanel` takes them as
 * props, so the panel is reused unchanged.
 */

import { useCallback } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  WorkArtifactDetail,
  WorkArtifactKind,
  WorkArtifactSummary,
} from "../plan-library/types";

const API = "/api/v1/plan-library";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * @param onKindCorrected — re-read whatever lists the artifact: a kind is part
 *   of the artifact's identity, so the reconciliation row may change with it.
 */
export function useArtifactDocument(onKindCorrected: () => unknown) {
  const fetchDetail = useCallback(
    async (id: string): Promise<WorkArtifactDetail | null> => {
      try {
        return await httpClient.get<WorkArtifactDetail>(`${API}/${id}`);
      } catch (err) {
        toast.error(message(err, "Failed to load the artifact"));
        return null;
      }
    },
    []
  );

  /**
   * Correct one artifact's kind. The write also LOCKS the kind, so the next
   * runner scan cannot silently put its guess back. A 409 is a genuine
   * identity collision — merging is an operator decision, so it is surfaced,
   * never guessed around.
   */
  const correctKind = useCallback(
    async (id: string, kind: WorkArtifactKind): Promise<boolean> => {
      try {
        await httpClient.patch<WorkArtifactSummary>(
          `${API}/${id}/kind`,
          { kind },
          // Safe to re-issue: the route SETS kind and kind_locked.
          { idempotent: true }
        );
        toast.success(`Kind set to "${kind}" and locked against re-scans.`);
        await onKindCorrected();
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to correct the kind"));
        return false;
      }
    },
    [onKindCorrected]
  );

  return { fetchDetail, correctKind };
}

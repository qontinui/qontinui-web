"use client";

/** The source document an estimate is being built from (Phase 2c of plan
 *  `2026-09-20-overview-authoring-layer`). */

import { useEffect, useState } from "react";
import { ResourceError, getResource } from "@/components/overview/editing/api";
import { extractGanttChart } from "../../../_lib/gantt";
import type { PageRecord } from "../../../_lib/pages";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The delivery-plan document an estimate is being built from
 *  (`?from_document=`, set by a document's "Use as the project estimate"). */
export interface SourceDocument {
  id: string;
  title: string;
  /** Its mermaid gantt chart, when it carries one. */
  gantt: string | null;
}

export type SourceState =
  | { kind: "none" }
  | { kind: "loading" }
  /** `?from_document=` named nothing this project has as a document. */
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; source: SourceDocument };

/**
 * The document named by `?from_document=`, read once the project is known and
 * again whenever it changes: a document of the previous project is not this
 * one's, so under a new project it reads `missing` rather than lingering.
 */
export function useSourceDocument(
  id: string | null,
  hold: boolean,
  projectId: string | null
): SourceState {
  const [state, setState] = useState<SourceState>(
    id ? { kind: "loading" } : { kind: "none" }
  );
  useEffect(() => {
    if (!id) {
      setState({ kind: "none" });
      return;
    }
    if (hold) return;
    let live = true;
    setState({ kind: "loading" });
    getResource<PageRecord>("pages", id).then(
      ({ item }) =>
        live &&
        setState(
          item.kind === "document"
            ? {
                kind: "ready",
                source: {
                  id: item.id,
                  title: item.title,
                  gantt: extractGanttChart(item.body_md ?? ""),
                },
              }
            : { kind: "missing" }
        ),
      (err: unknown) =>
        live &&
        setState(
          err instanceof ResourceError && err.status === 404
            ? { kind: "missing" }
            : { kind: "error", message: errorText(err) }
        )
    );
    return () => {
      live = false;
    };
  }, [id, hold, projectId]);
  return state;
}

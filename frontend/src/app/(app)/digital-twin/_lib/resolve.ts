/**
 * Join the static taxonomy manifest (denominator) with the live per-tenant
 * probe (numerator) into the rows the matrix renders.
 *
 * - `snapshot` rows take their status from the live probe (implemented /
 *   partial / blind / error). While the probe is loading they show `probing`.
 * - `parameterized` rows are interactive-only (Phase 2): they show
 *   `interactive` when built, else their research status. No live verdict here.
 * - `none` rows (core/internal or not built) show their research status
 *   directly — these are manifest claims, not live-verified.
 */

import manifestJson from "./subspaces.manifest.json";
import type {
  CellStatus,
  ResolvedSubspace,
  ResearchStatus,
  SubspaceManifest,
  SubspaceManifestEntry,
  SubspaceProbe,
} from "./types";

export const manifest = manifestJson as unknown as SubspaceManifest;

function researchStatusToCell(status: ResearchStatus): CellStatus {
  switch (status) {
    case "implemented":
      return "implemented";
    case "partial":
      return "partial";
    case "planned":
      return "planned";
    case "not-yet":
      return "not-built";
  }
}

function resolveOne(
  entry: SubspaceManifestEntry,
  probesById: Map<string, SubspaceProbe>,
  isProbing: boolean,
): ResolvedSubspace {
  if (entry.query_kind === "snapshot") {
    const probe = probesById.get(entry.id);
    if (!probe) {
      return { ...entry, cellStatus: isProbing ? "probing" : "error" };
    }
    // no_snapshot_tool on a row the manifest marks `snapshot` means the manifest
    // and coord's map have drifted — surface it as an error, not a silent ok.
    const cellStatus: CellStatus =
      probe.status === "no_snapshot_tool" ? "error" : probe.status;
    return {
      ...entry,
      cellStatus,
      metrics: probe.metrics,
      error: probe.error,
    };
  }

  if (entry.query_kind === "parameterized") {
    // Built but needs arguments — answerable in the Phase 2 explorer, not the
    // matrix. Unbuilt parameterized tools fall back to their research status.
    if (
      entry.research_status === "implemented" ||
      entry.research_status === "partial"
    ) {
      return { ...entry, cellStatus: "interactive" };
    }
    return { ...entry, cellStatus: researchStatusToCell(entry.research_status) };
  }

  // query_kind === "none": static manifest status.
  return { ...entry, cellStatus: researchStatusToCell(entry.research_status) };
}

export function resolveSubspaces(
  probes: SubspaceProbe[] | undefined,
  isProbing: boolean,
): ResolvedSubspace[] {
  const probesById = new Map((probes ?? []).map((p) => [p.id, p]));
  return manifest.subspaces.map((e) => resolveOne(e, probesById, isProbing));
}

/** Header summary numbers for the completeness gauge. */
export interface CompletenessSummary {
  /**
   * Live snapshot observers ANSWERING (implemented OR partial). We count
   * "responding" rather than only full-coverage, because several observers are
   * narrow-by-design (e.g. infra reports coverage < 1 even when perfectly
   * healthy) — counting only `implemented` would systematically undercount a
   * working twin. Blind / error / probing are NOT counted.
   */
  responding: number;
  /** Total snapshot observers probed. */
  snapshotTotal: number;
  /** Sub-spaces the research roadmap considers built (implemented or partial). */
  built: number;
  /** Total sub-spaces in the taxonomy. */
  total: number;
}

export function summarize(rows: ResolvedSubspace[]): CompletenessSummary {
  let responding = 0;
  let snapshotTotal = 0;
  let built = 0;
  for (const r of rows) {
    if (r.query_kind === "snapshot") {
      snapshotTotal += 1;
      if (r.cellStatus === "implemented" || r.cellStatus === "partial") {
        responding += 1;
      }
    }
    if (r.research_status === "implemented" || r.research_status === "partial") {
      built += 1;
    }
  }
  return { responding, snapshotTotal, built, total: rows.length };
}

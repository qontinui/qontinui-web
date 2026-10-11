/**
 * Join the static taxonomy manifest (denominator) with the live per-tenant
 * probe (numerator) into the rows the matrix and the lifecycle view render.
 *
 * - `snapshot` rows take their status from the live probe (implemented /
 *   partial / blind / error). While the probe is loading they show `probing`.
 *   These are the only live verdicts on the page.
 * - Built (implemented / partial) rows this page does not probe show a CLAIM
 *   status, never the live vocabulary: `interactive` when a coord tool answers
 *   them (a `parameterized` row — ask it in Ask the Twin), `unprobed` when no
 *   coord tool does (a `none` row).
 * - Unbuilt rows show their research status (`planned` / `not-built`) whatever
 *   their query kind.
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

/** Whether the manifest claims the observer is built (implemented or partial). */
export function claimsBuilt(
  status: ResearchStatus
): status is "implemented" | "partial" {
  return status === "implemented" || status === "partial";
}

function resolveOne(
  entry: SubspaceManifestEntry,
  probesById: Map<string, SubspaceProbe>,
  isProbing: boolean
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

  if (!claimsBuilt(entry.research_status)) {
    return {
      ...entry,
      cellStatus: entry.research_status === "planned" ? "planned" : "not-built",
    };
  }

  // Built, but nothing on this page probes it — a manifest claim either way.
  // A coord tool answers a parameterized row on demand (Ask the Twin); a `none`
  // row has no coord tool at all.
  return {
    ...entry,
    cellStatus:
      entry.query_kind === "parameterized" ? "interactive" : "unprobed",
  };
}

export function resolveSubspaces(
  probes: SubspaceProbe[] | undefined,
  isProbing: boolean
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
  /**
   * Sub-spaces the manifest CLAIMS are built (implemented or partial) — a
   * static claim across every row, not a live verdict.
   */
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
    if (claimsBuilt(r.research_status)) {
      built += 1;
    }
  }
  return { responding, snapshotTotal, built, total: rows.length };
}

/**
 * Join the static taxonomy manifest (denominator) with coord's served catalog
 * and the live per-tenant probe (numerator) into the rows the matrix and the
 * lifecycle view render.
 *
 * - A row is LIVE-PROBED when coord's catalog declares it probeable — joined
 *   by sub-space id, whatever the manifest's `query_kind` says (plan
 *   `2026-10-11-twin-honesty-and-reachability` Phase 9: the page probes what
 *   coord declares). Its status comes from the live probe (implemented /
 *   partial / blind / served / error / restricted); while the probe is
 *   loading it shows `probing`. These are the only live verdicts on the page.
 * - A manifest `snapshot` row coord's catalog does NOT declare shows
 *   `not-served`: the manifest and coord have drifted, and the cell says so
 *   instead of reading as an observer error.
 * - With no catalog read (loading, coord unreachable, or a coord predating the
 *   declaration) the manifest's `snapshot` rows, and any row a probe came back
 *   for, are the live-probed ones.
 * - Built (implemented / partial) rows this page does not probe show a CLAIM
 *   status, never the live vocabulary: `interactive` when a coord tool answers
 *   them (a `parameterized` row, whose `ask_via` says where on this page it can
 *   be asked — Ask the Twin, the Delivery tab, or nowhere, because coord
 *   withholds some tools from device sessions), `unprobed` when no coord tool
 *   does (a `none` row).
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
  SubspacesProbeResponse,
  TwinCatalogEntry,
  TwinCatalogResponse,
} from "./types";

export const manifest = manifestJson as unknown as SubspaceManifest;

/** Whether the manifest claims the observer is built (implemented or partial). */
export function claimsBuilt(
  status: ResearchStatus
): status is "implemented" | "partial" {
  return status === "implemented" || status === "partial";
}

/**
 * Whether the backend probes a catalog entry: coord serves it as a no-argument
 * snapshot, or its declared door is an `envelope` door (the admin outbound
 * door, a blank GET that coord keeps off the twin door). The same rule as the
 * backend's `_declared_probes`.
 */
export function isDeclaredProbe(entry: TwinCatalogEntry): boolean {
  return (
    typeof entry.door === "string" &&
    (entry.snapshot === true || entry.door_shape === "envelope")
  );
}

/**
 * The catalog entries coord declares probeable, keyed by sub-space id — or
 * `null` when there is no declaration to join against: no catalog yet, coord
 * unavailable (`coord_error`), or a catalog served by a coord predating the
 * declaration (no entry carries a `snapshot` flag). `null` is UNKNOWN, never
 * "coord declares nothing".
 */
export function declaredProbes(
  catalog: TwinCatalogResponse | undefined
): Map<string, TwinCatalogEntry> | null {
  if (!catalog || catalog.coord_error || !Array.isArray(catalog.entries)) {
    return null;
  }
  if (!catalog.entries.some((e) => typeof e.snapshot === "boolean")) {
    return null;
  }
  const declared = new Map<string, TwinCatalogEntry>();
  for (const entry of catalog.entries) {
    if (isDeclaredProbe(entry) && !declared.has(entry.subspace)) {
      declared.set(entry.subspace, entry);
    }
  }
  return declared;
}

/**
 * Whether the views should replace themselves with the whole-view access
 * notice: only when EVERY probe was refused (the coarse twin gate armed
 * against this operator). A single refused sub-space renders as its own
 * `restricted` cell instead.
 */
export function allProbesRestricted(
  data: SubspacesProbeResponse | undefined
): boolean {
  return (
    data?.restricted === true &&
    data.subspaces.every((s) => s.status === "restricted")
  );
}

function resolveOne(
  entry: SubspaceManifestEntry,
  probesById: Map<string, SubspaceProbe>,
  declared: Map<string, TwinCatalogEntry> | null,
  isProbing: boolean
): ResolvedSubspace {
  const declaredEntry = declared?.get(entry.id);
  const liveProbed = declared
    ? declaredEntry !== undefined
    : entry.query_kind === "snapshot" || probesById.has(entry.id);

  if (liveProbed) {
    const probe = probesById.get(entry.id);
    const doorShape = probe?.door_shape ?? declaredEntry?.door_shape ?? null;
    if (!probe) {
      return {
        ...entry,
        liveProbed,
        doorShape,
        cellStatus: isProbing ? "probing" : "error",
      };
    }
    // no_snapshot_tool means coord declared a door that does not answer — its
    // catalog and its router disagree. An error, not a silent ok.
    const cellStatus: CellStatus =
      probe.status === "no_snapshot_tool" ? "error" : probe.status;
    return {
      ...entry,
      liveProbed,
      doorShape,
      cellStatus,
      metrics: probe.metrics,
      error: probe.error,
    };
  }

  if (declared && entry.query_kind === "snapshot") {
    // The manifest expects a live probe coord does not declare: drift, shown
    // as drift rather than as an observer error.
    return { ...entry, liveProbed, cellStatus: "not-served" };
  }

  if (!claimsBuilt(entry.research_status)) {
    return {
      ...entry,
      liveProbed,
      cellStatus: entry.research_status === "planned" ? "planned" : "not-built",
    };
  }

  // Built, but this page's twin probe does not cover it — a manifest claim
  // either way. A coord tool answers a parameterized row on demand (its
  // `ask_via` says where on this page, if anywhere); a `none` row has no coord
  // tool at all.
  return {
    ...entry,
    liveProbed,
    cellStatus:
      entry.query_kind === "parameterized" ? "interactive" : "unprobed",
  };
}

/**
 * Resolve every manifest row. `catalog` is coord's served catalog; without it
 * (or before it loads) the manifest's own `snapshot` rows stand in for coord's
 * declaration.
 */
export function resolveSubspaces(
  probes: SubspaceProbe[] | undefined,
  isProbing: boolean,
  catalog?: TwinCatalogResponse
): ResolvedSubspace[] {
  const probesById = new Map((probes ?? []).map((p) => [p.id, p]));
  const declared = declaredProbes(catalog);
  return manifest.subspaces.map((e) =>
    resolveOne(e, probesById, declared, isProbing)
  );
}

/**
 * The sub-spaces coord declares probeable that this page's manifest has no
 * row for, sorted. The matrix is drawn from the manifest, so without this a
 * probe coord added would be fetched and never shown; the views name them
 * instead. Empty with no declaration (`declaredProbes` null).
 */
export function unlistedDeclaredProbes(
  catalog: TwinCatalogResponse | undefined
): string[] {
  const declared = declaredProbes(catalog);
  if (!declared) return [];
  const listed = new Set(manifest.subspaces.map((s) => s.id));
  return [...declared.keys()].filter((id) => !listed.has(id)).sort();
}

/** Header summary numbers for the completeness gauge. */
export interface CompletenessSummary {
  /**
   * Live-probed observers ANSWERING (implemented OR partial). We count
   * "responding" rather than only full-coverage, because several observers are
   * narrow-by-design (e.g. infra reports coverage < 1 even when perfectly
   * healthy) — counting only `implemented` would systematically undercount a
   * working twin. Blind / served / error / restricted / probing are NOT
   * counted: a `served` report is an answer, but not a verdict to grade.
   */
  responding: number;
  /**
   * Live-probed observers whose probe is still in flight (`probing`) — no
   * verdict yet, so while any are pending the gauge says "probing…" instead of
   * a count that would read as "not responding".
   */
  pending: number;
  /** Live-probed observers coord answered with a report (`served`). */
  served: number;
  /** Live-probed observers coord refused to this operator (`restricted`). */
  restricted: number;
  /** Total live-probed observers. */
  snapshotTotal: number;
  /**
   * Of `snapshotTotal`: the observers that could answer this operator with a
   * verdict — neither `served` nor `restricted`. The live gauge's
   * denominator, so a report door or a Qontinui-internal sub-space never
   * reads as an observer that is not responding.
   */
  graded: number;
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
  let pending = 0;
  let served = 0;
  let restricted = 0;
  let snapshotTotal = 0;
  let built = 0;
  for (const r of rows) {
    if (r.liveProbed) {
      snapshotTotal += 1;
      if (r.cellStatus === "implemented" || r.cellStatus === "partial") {
        responding += 1;
      } else if (r.cellStatus === "probing") {
        pending += 1;
      } else if (r.cellStatus === "served") {
        served += 1;
      } else if (r.cellStatus === "restricted") {
        restricted += 1;
      }
    }
    if (claimsBuilt(r.research_status)) {
      built += 1;
    }
  }
  return {
    responding,
    pending,
    served,
    restricted,
    snapshotTotal,
    graded: snapshotTotal - served - restricted,
    built,
    total: rows.length,
  };
}

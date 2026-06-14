/**
 * Digital Twin Explorer — shared types for the completeness matrix.
 *
 * The manifest (`subspaces.manifest.json`) is the denominator (full taxonomy);
 * the backend `/api/v1/digital-twin/subspaces` probe is the numerator (live
 * per-tenant observer status). They are joined by `id`.
 */

/** How a sub-space can be queried — drives whether the matrix live-probes it. */
export type QueryKind = "snapshot" | "parameterized" | "none";

/** Research-side maturity, from the qontinui-research roadmap. */
export type ResearchStatus = "implemented" | "partial" | "planned" | "not-yet";

/** One row of the checked-in taxonomy manifest. */
export interface SubspaceManifestEntry {
  id: string;
  symbol: string;
  tier: 1 | 2 | 3;
  layer: "coord" | "ui-bridge";
  description: string;
  research_status: ResearchStatus;
  research_doc: string;
  query_kind: QueryKind;
  coord_query_tool: string | null;
  observer_module: string | null;
}

export interface SubspaceManifest {
  version: string;
  subspaces: SubspaceManifestEntry[];
}

/** The credibility/usefulness envelope surfaced per snapshot probe (goals #3/#4). */
export interface VerdictMetrics {
  coverage: number | null;
  credibility: number | null;
  posterior: number | null;
  staleness_seconds: number | null;
  provenance: string | null;
  drift_class: string | null;
}

/** A live probe result for one snapshot sub-space, as returned by the backend. */
export interface SubspaceProbe {
  id: string;
  status:
    | "implemented"
    | "partial"
    | "blind"
    | "error"
    | "no_snapshot_tool";
  tool?: string;
  metrics?: VerdictMetrics;
  error?: string;
  http_status?: number;
  detail?: unknown;
}

export interface SubspacesProbeResponse {
  subspaces: SubspaceProbe[];
  probed: number;
}

/**
 * The display status the matrix renders per cell. Combines the live probe
 * (snapshot rows) with the manifest's static status (parameterized / none rows).
 */
export type CellStatus =
  | "implemented"
  | "partial"
  | "blind"
  | "planned"
  | "not-built"
  | "interactive"
  | "error"
  | "probing";

/** A manifest row joined with its resolved display status + any live metrics. */
export interface ResolvedSubspace extends SubspaceManifestEntry {
  cellStatus: CellStatus;
  metrics?: VerdictMetrics;
  error?: string;
}

/**
 * The full DriftVerdict envelope coord returns (the exact JSON an AI agent's
 * tools/call receives). The matrix uses only the top-level metrics; the raw
 * viewer + summary use `components` too. Fields are defensively optional — the
 * envelope evolves per instance.
 */
export interface DriftVerdict {
  instance?: string;
  drift_class?: string;
  drift_subclass?: string | null;
  d3_outcome?: string | null;
  posterior?: number | null;
  coverage?: number | null;
  staleness_seconds?: number | null;
  provenance?: string | null;
  credibility?: number | null;
  carve_out?: string[];
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The body of GET /api/v1/digital-twin/subspace/{id}/raw (coord route shape). */
export interface RawVerdictResponse {
  subspace: string;
  tool: string;
  verdict: DriftVerdict;
}

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
    | "no_snapshot_tool"
    | "restricted";
  tool?: string;
  metrics?: VerdictMetrics;
  error?: string;
  http_status?: number;
  detail?: unknown;
}

export interface SubspacesProbeResponse {
  subspaces: SubspaceProbe[];
  probed: number;
  /**
   * True when coord's twin tenant gate denied this operator (home tenant outside
   * COORD_TWIN_ALLOWED_TENANT_IDS) — the UI shows a friendly access message
   * instead of an all-error grid.
   */
  restricted?: boolean;
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
  | "probing"
  | "restricted";

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

/** One cited PR in a delivery verdict's components. */
export interface DeliveryPr {
  repo: string;
  pr: number | null;
  merged: boolean;
  branch: string | null;
}

/** One observed deploy/serving env in a delivery verdict's components. */
export interface DeliveryEnv {
  surface: string | null;
  target: string | null;
  repo: string | null;
  in_sync: boolean | null;
  lag_seconds: number | null;
  drift_class: string | null;
  deployed_sha: string | null;
  observed_age_seconds: number | null;
}

/**
 * Which kind of work anchor a delivery verdict resolved against. Additive
 * field (coord generic-unit generalization): `plan` is the legacy path
 * (`plan_id` populated), `work_unit` is the generic work-unit path (`plan_id`
 * is `null`, `work_unit_id` populated), `none` when no anchor resolved.
 */
export type DeliveryAnchorKind = "plan" | "work_unit" | "none";

/**
 * The well-known `components` shape of an `instance="delivery"` DriftVerdict
 * (coord `delivery_view.rs`). All fields defensively optional — the card reads
 * what is present and degrades gracefully.
 */
export interface DeliveryComponents {
  slug?: string;
  /**
   * Which anchor resolved — drives generic vs plan-specific rendering. The card
   * never hard-codes a status vocabulary word; it keys display off this and the
   * opaque `status` / `drift_class` the API returns.
   */
  anchor_kind?: DeliveryAnchorKind;
  plan_id?: string | null;
  /** Generic work-unit anchor id (populated on the `work_unit` path). */
  work_unit_id?: string | null;
  status?: string | null;
  ingested_status?: string | null;
  registered?: boolean;
  prs?: DeliveryPr[];
  all_merged?: boolean;
  unmerged_prs?: DeliveryPr[];
  deployed_envs?: DeliveryEnv[];
  staleness_inputs?: {
    live_refreshed?: boolean;
    oldest_cited_age_seconds?: number | null;
    deploy_staleness_seconds?: number | null;
    refresh_errors?: string[];
  };
}

/** The body of GET /api/v1/digital-twin/delivery/verdict (coord route shape). */
export interface DeliveryVerdictResponse {
  plan_slug: string | null;
  tool: string;
  verdict: DriftVerdict;
}

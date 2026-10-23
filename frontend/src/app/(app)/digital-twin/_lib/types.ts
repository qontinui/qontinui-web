/**
 * Digital Twin Explorer — shared types for the completeness matrix and the
 * lifecycle view.
 *
 * The manifest (`subspaces.manifest.json`) is the denominator (full taxonomy);
 * the backend `/api/v1/digital-twin/subspaces` probe is the numerator (live
 * per-tenant observer status). They are joined by `id`.
 */

/**
 * How this page can read a sub-space:
 *  - `snapshot` — a row this page expects coord to declare probeable. The
 *    backend probes exactly what coord's served catalog declares
 *    (`backend/app/api/v1/endpoints/digital_twin.py` `_declared_probes`), and
 *    `resolve.ts` joins the manifest to that catalog by id: a `snapshot` row
 *    coord does not declare renders `not-served`, and a row coord declares is
 *    live-probed whatever its `query_kind`.
 *  - `parameterized` — a coord tool answers it (with or without arguments),
 *    but this page does not probe it. The row's `ask_via` says where on this
 *    page it can be asked: Ask the Twin, the Delivery tab, or nowhere (coord
 *    withholds some tools from the device session Ask the Twin runs on).
 *  - `none` — no coord query tool.
 *
 * Statuses on `parameterized` and `none` rows are manifest claims, not live
 * verdicts.
 */
export type QueryKind = "snapshot" | "parameterized" | "none";

/**
 * Where on this page a `parameterized` row's coord tool can be asked:
 *  - `ask-the-twin` — Ask the Twin (coord grants the tool to device sessions);
 *  - `delivery-tab` — the Delivery tab (coord's SSO delivery-verdict route);
 *  - `not-on-this-page` — nowhere: coord withholds the tool from the device
 *    session Ask the Twin runs on, and no other door here asks it.
 */
export type AskVia = "ask-the-twin" | "delivery-tab" | "not-on-this-page";

/** Research-side maturity, from the qontinui-research roadmap. */
export type ResearchStatus = "implemented" | "partial" | "planned" | "not-yet";

/**
 * The three coupled twins of the software-development process. `environment`
 * is the system being built and run (code, deps, schema, infra, releases,
 * runtime health); `process` is the work in flight (CI runs, the merge train,
 * gates, sessions, work units, plans, findings, the cost of work); `intent` is
 * what the operator wants (policy, intent documents, spec claims, operator
 * touches).
 */
export type TwinPlant = "environment" | "process" | "intent";

/** The lifecycle stages the twin observes, in order (see `lifecycle.ts`). */
export type LifecycleStage =
  | "intent"
  | "plan"
  | "implement"
  | "verify"
  | "integrate"
  | "release"
  | "operate"
  | "learn";

/** One row of the checked-in taxonomy manifest. */
export interface SubspaceManifestEntry {
  id: string;
  symbol: string;
  tier: 1 | 2 | 3;
  /** Where the observer runs: coord, the UI Bridge SDK, or the runner. */
  layer: "coord" | "ui-bridge" | "runner";
  /** Which of the three coupled twins this sub-space belongs to. */
  twin: TwinPlant;
  /** The lifecycle stages it observes — non-empty, in lifecycle order. */
  stages: LifecycleStage[];
  description: string;
  research_status: ResearchStatus;
  research_doc: string;
  query_kind: QueryKind;
  coord_query_tool: string | null;
  observer_module: string | null;
  /**
   * Set on every `parameterized` row, absent on the others. Ask the Twin runs
   * on the runner's DEVICE credential, and coord serves a device session only
   * its device allow set (`agent_tool_access.rs` `device_default_allow_set`),
   * so a built tool outside that set is answered by coord yet not askable from
   * Ask the Twin.
   */
  ask_via?: AskVia;
  /** The plan slug that builds a planned / partial row (shown in the drawer). */
  plan?: string | null;
  /**
   * The work-unit areas whose plans move this sub-space: values of coord's
   * canonical steering key `metadata.area` (kebab-case, matched exactly — the
   * same key coord's `area` list filter reads). The Twin map resolves a
   * sub-space's plans as its `plan` slug ∪ every work unit whose area is
   * listed here (`twin-plans.ts`). Absent = no area is mapped; an area here
   * that no work unit carries is shown as drift, never as "no plans".
   */
  areas?: readonly string[];
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

/**
 * How a coord door lays its answer out (coord `twin_probe_door.rs`
 * `DoorShape`):
 *  - `verdict_wrapper` — `{subspace, tool, verdict}`, the DriftVerdict under
 *    `verdict`;
 *  - `envelope` — the DriftVerdict fields at the top level (the admin outbound
 *    door);
 *  - `report` — `{subspace, tool, verdict}` where `verdict` is the tool's own
 *    report, not a DriftVerdict, so it is never graded.
 */
export type DoorShape = "verdict_wrapper" | "envelope" | "report";

/** A live probe result for one declared sub-space, as returned by the backend. */
export interface SubspaceProbe {
  id: string;
  /**
   * `served` — coord answered a `report` door: the answer is real, but it is
   * not a verdict, so it is neither healthy nor broken. `restricted` — coord
   * refused THIS sub-space to this operator (403).
   */
  status:
    | "implemented"
    | "partial"
    | "blind"
    | "served"
    | "error"
    | "no_snapshot_tool"
    | "restricted";
  tool?: string;
  metrics?: VerdictMetrics;
  error?: string;
  http_status?: number;
  detail?: unknown;
  /** The door shape coord declared for this sub-space. */
  door_shape?: DoorShape | null;
}

export interface SubspacesProbeResponse {
  subspaces: SubspaceProbe[];
  probed: number;
  /**
   * True only when EVERY probe was refused — coord's coarse twin tenant gate
   * is armed against this operator — and the views then show the whole-view
   * access notice. A single refused sub-space marks only its own cell
   * `restricted`.
   */
  restricted?: boolean;
  /**
   * Set when coord, the tenant or coord's catalog could not be read: the cells
   * are the ids coord last declared, each an `error`, or none at all.
   */
  degraded?: boolean;
}

/**
 * The display status the matrix renders per cell. Combines the live probe
 * (snapshot rows) with the manifest's static status (parameterized / none rows).
 *
 * Only a live-probed row can be `implemented` / `partial` / `blind` /
 * `served` / `error` / `probing` / `restricted` — those are probe results. A
 * built row this page does not probe is `interactive` (a coord tool answers
 * it) or `unprobed` (no coord tool): either way a manifest claim, never the
 * live vocabulary. `not-served` is a manifest `snapshot` row coord's catalog
 * does not declare: the manifest and coord have drifted.
 */
export type CellStatus =
  | "implemented"
  | "partial"
  | "blind"
  | "served"
  | "not-served"
  | "planned"
  | "not-built"
  | "interactive"
  | "unprobed"
  | "error"
  | "probing"
  | "restricted";

/** A manifest row joined with its resolved display status + any live metrics. */
export interface ResolvedSubspace extends SubspaceManifestEntry {
  cellStatus: CellStatus;
  /**
   * This page live-probes the row: coord's catalog declares it probeable (or,
   * with no catalog read, the manifest marks it `snapshot` or a probe for it
   * came back).
   */
  liveProbed: boolean;
  /** The declared door shape of a live-probed row, when known. */
  doorShape?: DoorShape | null;
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
  /**
   * The PR is CLOSED, was never merged, and carries no land stamp of any
   * provenance — so it can never merge and coord has RETIRED it from the
   * delivery predicate: it neither blocks delivery nor counts toward it.
   *
   * Read this before rendering anything off `merged`. A retired citation reads
   * `merged: false` permanently and is NOT a blocker, so labelling it
   * "unmerged" beside a no-drift verdict tells the operator the opposite of
   * what coord decided. Coord plan
   * `2026-08-18-closed-unmerged-citation-pins-shipped-forever`.
   *
   * Optional: absent on a verdict served by a coord build predating that plan.
   */
  terminal_unlanded?: boolean;
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
  /**
   * **The DELIVERY PREDICATE, not the literal its name suggests**: at least one
   * cited PR positively LANDED and none is still BLOCKING. Since coord plan
   * `2026-08-18-closed-unmerged-citation-pins-shipped-forever` a
   * closed-never-merged citation is retired rather than counted, so this can be
   * `true` while some entry in `prs` reads `merged: false`. Never render it as
   * the words "all merged" — use `landed_count` / `terminal_unlanded_count` if
   * you need the literal breakdown.
   */
  all_merged?: boolean;
  /** The BLOCKING citations only — the ones that actually pin the unit. */
  unmerged_prs?: DeliveryPr[];
  /** Citations retired as terminally unlanded (closed, never merged). */
  terminal_unlanded_prs?: DeliveryPr[];
  /** Numbered citations that positively landed. */
  landed_count?: number;
  /** Numbered citations that are neither landed nor terminally unlanded. */
  blocking_unmerged_count?: number;
  /** Numbered citations retired as terminally unlanded. */
  terminal_unlanded_count?: number;
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
  /** The work-unit slug the verdict was resolved for. Coord echoed this under
   *  the legacy `plan_slug` key until the wire-key retirement (plan
   *  `2026-07-30-coord-web-plan-slug-wire-key-retirement`, Phase 1); it
   *  dual-echoes both keys today and drops `plan_slug` in Phase 4. */
  work_unit_slug: string | null;
  tool: string;
  verdict: DriftVerdict;
}

/**
 * One entry of the coord-owned queryable-surface catalog, as coord SERVES it
 * (`twin_probe_door.rs` `served_entry`: the hand-declared
 * `twin_catalog::TwinCatalogEntry` plus every derived field). The
 * authoritative, fleet-global index of the `coord_query_*` twin observers —
 * the same surface list the agent Q&A meta-answer expands into its
 * `{{twin-catalog}}` token — and the list the matrix probes. Distinct from the
 * checked-in taxonomy manifest (which additionally carries the research-roadmap
 * denominator: tier / research_status / observer_module).
 */
export interface TwinCatalogEntry {
  /** Stable catalog id. */
  id: string;
  /** The twin sub-space id — what the manifest names the row by. */
  subspace: string;
  /** The sub-space's Ξ name. */
  symbol: string;
  twin: TwinPlant;
  stages: LifecycleStage[];
  description: string;
  /** The MCP tool that queries it (e.g. `coord_query_migration_state`). */
  query_tool: string;
  /**
   * Derived from the tool's `input_schema`: `"parameterized"` when it has a
   * required argument, else `"snapshot"`; `null` when coord's registry does not
   * serve the tool.
   */
  kind: "snapshot" | "parameterized" | null;
  /** What the catalog DECLARES about availability — `"live"` for a wired observer. */
  declared_status: string;
  /** The tool's parameter names, from its `input_schema`; `null` when unserved. */
  params: string[] | null;
  /** The twin door serves a no-argument read of it. */
  snapshot: boolean;
  /** Who may read it on the twin door; `null` when the twin door does not serve it. */
  access: string | null;
  /** The HTTP path that answers it, or `null`. */
  door: string | null;
  door_shape: DoorShape | null;
  /**
   * Whether the twin is actually seeing it, from coord's newest fidelity
   * report; `null` is UNKNOWN (no report, or the report does not measure it).
   */
  observed: boolean | null;
}

/** The body of GET /api/v1/digital-twin/catalog (coord `/coord/twin/catalog`). */
export interface TwinCatalogResponse {
  entries: TwinCatalogEntry[];
  total: number;
  /** Set (with an empty `entries`) when coord was unreachable — degraded read. */
  coord_error?: string;
}

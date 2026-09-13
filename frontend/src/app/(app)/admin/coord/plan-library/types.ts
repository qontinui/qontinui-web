/**
 * Wire types for the Plan & Prompt Library operator page.
 *
 * Mirrors `backend/app/schemas/plan_library.py` and the two fleet-policy
 * models in `backend/app/api/v1/endpoints/operations.py`. Hand-written rather
 * than generated, matching the sibling `prompt-documents/types.ts` — the
 * generated client covers a different slice of the API surface.
 *
 * Four of these encode a distinction the page must never collapse:
 *
 * * `CoordLinkState` separates a work unit that is genuinely absent
 *   (`dangling` — the soft link has no FK and MAY dangle, which is normal)
 *   from one we could not ask about (`unavailable`).
 * * `CoordPrState` does the same for PR citations. `unavailable` means the
 *   citation read did not happen — coord unreachable, the door refused, or
 *   coord itself reported it could not read the relation — so the empty list
 *   is "we could not ask", NOT "there are no PRs". (It no longer means "coord
 *   has no HTTP route for this": coord ships both citation GET doors and the
 *   backend reads them.)
 * * `CandidateLinkedPr.state` carries that SAME distinction one level down, on
 *   ONE row's merged state: `unknown` is what a `merged: false` becomes while
 *   coord's merged predicate runs degraded, and it must not be rendered as the
 *   fact "unmerged".
 * * `FleetPolicyView.resolved_scope` separates "off because nobody wrote a
 *   row" (`none`) from "off because someone turned it off".
 */

// ───────────────────────────── artifacts ─────────────────────────────

export const WORK_ARTIFACT_KINDS = [
  "investigation_prompt",
  "plan_authoring_prompt",
  "implementation_prompt",
  "investigation_report",
  "handoff",
  "plan",
  // An operator question answered by live measurement. Kept apart from
  // `investigation_report` (the `/chart` gap verdicts) so the two families
  // stay separable on the kind filter. `plan_library_04_diagnostic_refutes`.
  "diagnostic",
] as const;

export type WorkArtifactKind = (typeof WORK_ARTIFACT_KINDS)[number];

export const KIND_LABELS: Record<WorkArtifactKind, string> = {
  investigation_prompt: "Investigation prompt",
  plan_authoring_prompt: "Plan-authoring prompt",
  implementation_prompt: "Implementation prompt",
  investigation_report: "Investigation report",
  handoff: "Handoff",
  plan: "Plan",
  diagnostic: "Diagnostic",
};

/** Render an unrecognised kind as itself rather than as blank. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as WorkArtifactKind] ?? kind;
}

export const CAPTURE_DOORS = ["runner_scan", "agent", "operator"] as const;
export type CaptureDoor = (typeof CAPTURE_DOORS)[number];

export const CAPTURE_DOOR_LABELS: Record<CaptureDoor, string> = {
  runner_scan: "Runner scan",
  agent: "Agent write door",
  operator: "Operator",
};

export type WorkArtifactRelation =
  | "produced_report"
  | "feeds"
  | "authored_plan"
  | "supersedes"
  | "depends_on"
  /** One-ended: `to_id` is null until someone claims the surfaced work. */
  | "spawned_followup"
  /** A measurement that FALSIFIES the target claim. Two-ended. */
  | "refutes";

export interface WorkArtifactSummary {
  id: string;
  organization_id: string | null;
  created_by_user_id: string | null;
  kind: string;
  /** `true` when a human/agent asserted the kind and re-scans may not move it. */
  kind_locked: boolean;
  slug: string;
  title: string;
  /** Opaque free text mirroring plan front-matter. No vocabulary. */
  status: string;
  content_sha256: string;
  source_path: string | null;
  source_repo: string | null;
  /** Soft link to a coord work unit. No FK — it MAY dangle. */
  work_unit_slug: string | null;
  repos: string[];
  /**
   * Citations to served coord Intent documents (`success_metric/<name>`,
   * `domain_spec/<name>`). Soft links like `work_unit_slug` — they MAY dangle.
   */
  intent_refs: string[];
  authored_at: string | null;
  captured_by: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface WorkArtifactVersion {
  id: string;
  document_id: string;
  version_number: number;
  body: string;
  content_sha256: string;
  change_description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface WorkArtifactEdge {
  id: string;
  from_id: string;
  to_id: string;
  relation: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  /** Direction relative to the artifact being viewed. */
  direction: "outgoing" | "incoming";
  peer_kind: string | null;
  peer_slug: string | null;
  peer_title: string | null;
}

export interface WorkArtifactDetail extends WorkArtifactSummary {
  body: string;
  versions: WorkArtifactVersion[];
  edges: WorkArtifactEdge[];
  /**
   * The linked coord work unit and its PR citations. ALWAYS present — it
   * defaults to `work_unit_state: "unlinked"` — so a consumer never has to
   * distinguish "the field is missing" from "there is no link".
   */
  coord: CandidateCoordLink;
}

/**
 * What the corpus a page was drawn from actually holds — UNFILTERED by the
 * page's own query, org-scoped like it. `plan_count: 0` beside an empty page
 * reads "the corpus holds no plans", which is a different sentence from "no
 * such plan" (2026-08-27-plan-corpus-read-path-is-dark, D1).
 */
export interface CorpusHealth {
  artifact_count: number;
  plan_count: number;
  /** `max(updated_at)` in scope; `null` on an EMPTY corpus, never an epoch. */
  newest_updated_at: string | null;
  /** The `/capture-health` census from the same query — the two never disagree. */
  capture: CaptureHealthResponse;
  /**
   * `GET /plan-library/scan-roots`, from the same builder: how far each
   * feeding device's scan source is from its default branch. `state:
   * "unknown"` with no rows is "no device has reported", never "current".
   */
  scan_roots: ScanRootListResponse;
}

export interface WorkArtifactListResponse {
  items: WorkArtifactSummary[];
  /** This page's length (`items.length`); `total` is the unpaged total. */
  count: number;
  total: number;
  offset: number;
  limit: number;
  corpus_health: CorpusHealth;
}

// ───────────────────────────── divergence ─────────────────────────────

export interface DivergentVariant {
  id: string;
  kind: string;
  kind_locked: boolean;
  content_sha256: string;
  source_repo: string | null;
  source_path: string | null;
  title: string;
  status: string;
  current_version: number;
  updated_at: string;
}

/** Same `(kind, slug)`, different content digest. */
export interface DivergentGroup {
  kind: string;
  slug: string;
  variant_count: number;
  variants: DivergentVariant[];
}

/**
 * Same `(slug, source_repo)`, DIFFERENT kind — a fork whose whole
 * distinguishing feature is the kind, which grouping by `(kind, slug)`
 * structurally cannot see.
 *
 * `resolvable: false` means no single corrected (`kind_locked`) row exists to
 * prefer, so the scanner refuses to pick and an operator must correct one.
 */
export interface KindForkGroup {
  slug: string;
  source_repo: string | null;
  kinds: string[];
  variant_count: number;
  resolvable: boolean;
  variants: DivergentVariant[];
}

export interface DivergentResponse {
  groups: DivergentGroup[];
  total: number;
  kind_forks: KindForkGroup[];
  kind_fork_total: number;
}

// ─────────────────────────── capture health ───────────────────────────

export interface CaptureDoorHealth {
  captured_by: string;
  count: number;
  /** `false` = a door value this build does not recognise. Shown, not hidden. */
  known: boolean;
  first_at: string | null;
  /**
   * `max(updated_at)` — LAST TOUCHED, not last captured. A kind correction
   * bumps it without any capture having happened, so the UI must not label it
   * "last write".
   */
  last_touched_at: string | null;
}

export interface CaptureHealthResponse {
  total: number;
  doors: CaptureDoorHealth[];
  /** `max(updated_at)` across every door; `null` on an empty corpus. */
  newest_updated_at: string | null;
}

// ──────────────────── coord link (candidates read) ────────────────────

export type CoordLinkState = "linked" | "dangling" | "unavailable" | "unlinked";

export type CoordPrState = "available" | "unavailable" | "unlinked";

/**
 * Whether a candidate has a plan DOCUMENT, and where.
 *
 * `/candidates` selects from the UNION of both corpus layers, so a row may
 * exist only as a coord work unit. `present` is an `agent.work_artifacts` row
 * (and the only state with an `id` to fetch a body with); `unsynced` is a plan
 * FILE coord recorded a `source_path` for whose body was never synced;
 * `absent` is a work unit with no document anywhere.
 */
export type DocumentState = "present" | "unsynced" | "absent";

/**
 * Whether the union's work-unit arm was read at all.
 *
 * `unavailable` means `total` counts the document layer only — UNKNOWN,
 * never "coord has no work units". Distinct from `coord_available`, which
 * reports the page-wide circuit: a 4xx on the population door is coord
 * ANSWERING and leaves that flag true.
 */
export type WorkUnitPopulationState = "included" | "unavailable";

export interface CandidateLinkedPr {
  repo: string | null;
  pr_number: number | null;
  state: "merged" | "unmerged" | "unknown";
  merged: boolean | null;
  branch: string | null;
  cited_at: string | null;
  sources: string[];
}

export interface CandidateCoordLink {
  work_unit_slug: string | null;
  work_unit_state: CoordLinkState;
  work_unit_status: string | null;
  work_unit_title: string | null;
  linked_prs_state: CoordPrState;
  linked_prs: CandidateLinkedPr[];
  unavailable_reason: string | null;
}

export interface PlanCandidate {
  /** `null` for a candidate that exists only as a coord work unit. */
  id: string | null;
  kind: string;
  kind_locked: boolean;
  slug: string;
  title: string;
  status: string;
  repos: string[];
  /** Empty on a work-unit-only row — there is no artifact row to read it from. */
  intent_refs: string[];
  source_repo: string | null;
  source_path: string | null;
  work_unit_slug: string | null;
  authored_at: string | null;
  created_at: string;
  last_touched: string;
  age_days: number;
  unmet_depends_on: Array<{
    id: string;
    kind: string;
    slug: string;
    title: string;
    status: string;
  }>;
  prompt_chain: Array<{
    id: string;
    kind: string;
    slug: string;
    title: string;
    relation: string;
    depth: number;
  }>;
  coord: CandidateCoordLink;
  document_state: DocumentState;
}

export interface PlanCandidateResponse {
  items: PlanCandidate[];
  /** This page's length (`items.length`); `total` is the unpaged total. */
  count: number;
  total: number;
  offset: number;
  limit: number;
  ordering: "oldest_vetted_first";
  coord_available: boolean;
  work_unit_population_state: WorkUnitPopulationState;
  work_unit_population_reason: string | null;
  /** The whole corpus's health — the same block every list page carries. */
  corpus_health: CorpusHealth;
}

// ───────────────────────────── fleet policy ─────────────────────────────

/** The domain the capture toggle writes. Levels: `off` | `record`. */
export const PLAN_CAPTURE_DOMAIN = "plan_capture";

export const PLAN_CAPTURE_LEVELS = ["off", "record"] as const;
export type PlanCaptureLevel = (typeof PLAN_CAPTURE_LEVELS)[number];

// `FleetPolicyView` / `FleetPolicyWriteResult` moved to the shared module when
// the `policy_write` dial became a second consumer — one wire contract, one
// definition. Re-exported here so this file's public surface is unchanged.
export type {
  FleetPolicyView,
  FleetPolicyWriteResult,
} from "../_shared/fleetPolicy";

// ──────────────────── scan sources (per-device readings) ────────────────────

/**
 * The four states a device's runner can report for the directory its
 * plan-library body sync scans. Mirrors `ScanRootState` in
 * `backend/app/schemas/plan_library_scan_roots.py`, which mirrors the runner's
 * `ScanDivergenceState`.
 *
 * Pinned, not merely mirrored: `types.wire.test.ts` compares it with the
 * `state` and `reported_state` enums in the committed OpenAPI snapshots, which
 * backend CI regenerates from the live schema and refuses to let drift. A state
 * added on the backend therefore fails a frontend test, rather than reaching
 * this console as a value nothing here was written for.
 */
export const SCAN_ROOT_STATES = [
  "measured",
  "not_scanning",
  "not_a_git_work_tree",
  "unknown",
] as const;

export type ScanRootState = (typeof SCAN_ROOT_STATES)[number];

export const SCAN_ROOT_STATE_LABELS: Record<ScanRootState, string> = {
  measured: "Measured",
  not_scanning: "Not scanning",
  not_a_git_work_tree: "Not a git work tree",
  unknown: "Unknown",
};

/** Render an unrecognised state as itself rather than as blank. */
export function scanRootStateLabel(state: string): string {
  return SCAN_ROOT_STATE_LABELS[state as ScanRootState] ?? state;
}

/**
 * One device's latest reading, as the READ route renders it.
 *
 * The distinction this type must never collapse — the same one
 * `CoordLinkState` and `CoordPrState` carry above — is `state` vs
 * `reported_state`. `state` is the backend's VERDICT, and it is the field that
 * decides WHAT MAY BE CLAIMED: it is `"unknown"` whenever the reading cannot
 * support a claim about NOW, even though the device reported `"measured"`.
 * Three rules produce that, in precedence order, each naming itself in
 * `detail`:
 *
 * * `observation_stale:` — nothing received from the device inside
 *   `fresh_within_secs`. A device that went quiet has established nothing.
 * * `reading_superseded:` — its latest report was observed BEFORE the stored
 *   reading (a clock step-back, or a late delivery), so the stored reading may
 *   not be what it says now.
 * * `ref_stale:` — a `measured` reading whose counts are floors and whose
 *   `behind` is 0. Zero commits behind a ref that may itself be days old is a
 *   lower bound of nothing, never "in step".
 *
 * `reported_state` / `reported_detail` keep what the device actually sent, so
 * the panel can show both without a reader mistaking one for the other.
 *
 * A SECOND question has a different answer, and conflating the two is a live
 * defect rather than a nicety: what TENSE may a claim be made in? That is
 * decided by `observation_fresh` and `last_report_applied`, NOT by `state` —
 * because `ref_stale` is a verdict of `unknown` on a row that is perfectly
 * fresh. The device reported seconds ago; what is stale is the ref it measured
 * against. A reader that took `state` as the answer to both would write "when
 * last measured" over a live device and send an operator after the wrong box.
 * `ScanSourcesPanel`'s `readingIsCurrent` is the worked example.
 */
export interface ScanRootRow {
  device_id: string;
  /** The VERDICT. Key on this, never on `reported_state`. */
  state: ScanRootState;
  detail: string | null;
  /** What the device sent, verbatim. Never a verdict. */
  reported_state: ScanRootState;
  reported_detail: string | null;
  plans_dir: string | null;
  repo_root: string | null;
  source_repo: string | null;
  default_ref: string | null;
  ref_sha: string | null;
  head_sha: string | null;
  /** `null` is NOT MEASURED. Never render it as `0`. */
  behind: number | null;
  ahead: number | null;
  ref_age_secs: number | null;
  /** `true` = the counts are LOWER BOUNDS ("at least N"), not exact. */
  counts_are_floors: boolean;
  observed_at: string;
  received_at: string;
  last_report_applied: boolean;
  last_report_observed_at: string;
  observed_skew_secs: number;
  observation_age_secs: number;
  observation_fresh: boolean;
}

/**
 * Every reporting device's latest reading.
 *
 * `state: "unknown"` is the no-rows answer and it is load-bearing: an empty
 * list is NOT "every feeder is current". A runner whose build predates the
 * report, or whose body sync is off, sends nothing at all — indistinguishable
 * here from a fleet with no drift, which is why the backend refuses to render
 * the empty case as agreement and this panel must not either.
 */
export interface ScanRootListResponse {
  state: ScanRootListState;
  detail: string | null;
  fresh_within_secs: number;
  count: number;
  /** `count > 0` with `fresh_count === 0` means every feeder has gone quiet. */
  fresh_count: number;
  rows: ScanRootRow[];
  /** One roll-up per distinct `source_repo`; empty exactly when `rows` is. */
  by_source_repo: ScanRootSourceRollup[];
}

/**
 * A roll-up's verdict. `unknown` = no device feeding this source has a
 * `measured` verdict, so no distance is established — `min_behind` is `null`,
 * never `0`.
 */
export const SCAN_ROOT_ROLLUP_STATES = ["measured", "unknown"] as const;

export type ScanRootRollupState = (typeof SCAN_ROOT_ROLLUP_STATES)[number];

/**
 * Every device feeding ONE scan source, folded to the corpus's question: how
 * far behind is its least-behind CURRENT feeder?
 *
 * `min_behind` is drawn only from rows whose VERDICT (`state`) is `measured`,
 * so a silent, contradicted or 0-behind-floor device contributes no number.
 * `min_behind` is always a true lower bound; `min_behind_is_floor: false`
 * (exact) only when every measured device counted against the same `ref_sha`
 * and one of them fetched it fresh.
 *
 * The four id lists PARTITION the feeders, and a device is named least-behind
 * or lagging only when the readings PROVE it. Counts against different refs
 * do not order devices — exactly 3 behind a five-hour-old ref can be 13 behind
 * the ref another device is exactly 5 behind — so when the refs differ, every
 * measured device is `lag_unknown_device_ids`. Never render it as either.
 */
export interface ScanRootSourceRollup {
  source_repo: string | null;
  state: ScanRootRollupState;
  detail: string | null;
  device_count: number;
  measured_count: number;
  /** `null` is NOT ESTABLISHED. Never render it as `0`. */
  min_behind: number | null;
  /** `null` exactly when `min_behind` is. */
  min_behind_is_floor: boolean | null;
  /** Proven least behind: at `min_behind`, all devices on one `ref_sha`. */
  least_behind_device_ids: string[];
  /** Proven lagging: above `min_behind`, all devices on one `ref_sha`. */
  lagging_device_ids: string[];
  /** Measured, but on different or unknown refs, so not placeable. */
  lag_unknown_device_ids: string[];
  /** Verdict other than `measured`; each row's `detail` says why. */
  unmeasured_device_ids: string[];
}

/**
 * The list route's top-level verdict. `unknown` is the no-rows answer.
 *
 * A const rather than an inline union for the same reason
 * [`SCAN_ROOT_STATES`] is one: a union does not exist at runtime, so no test
 * could compare it with the backend's enum.
 */
export const SCAN_ROOT_LIST_STATES = ["reported", "unknown"] as const;

export type ScanRootListState = (typeof SCAN_ROOT_LIST_STATES)[number];

/**
 * Which fields of a wire type admit `null` — as a VALUE that tsc checks
 * against the type, so that a test can compare it with the backend's schema.
 *
 * `ScanRootRow`, `ScanRootListResponse` and `ScanRootSourceRollup` are
 * hand-written mirrors of the backend's response models, and an interface
 * does not exist at runtime, so no test can compare one with anything. This mapped type is the bridge. A
 * value annotated `WireNullability<T>` must name EVERY key of `T` (a missing
 * one is an error) and no other (the excess-property check), and must set each
 * to `true` exactly when the field admits `null`. An OPTIONAL field maps to
 * `never`, which no value satisfies: every field on these responses is
 * required on the wire, and `-?` would otherwise let a stray `?` through.
 *
 * `npm run type-check` holds each witness to its interface — and it only can
 * because the witnesses live HERE. That config excludes `*.test.ts`, so a
 * type-level assertion written in a test file is checked by nothing at all.
 * `types.wire.test.ts` then holds each witness to the committed OpenAPI
 * snapshots. The chain is interface = witness = snapshot = backend, each link
 * enforced by CI rather than by a reviewer noticing — for FIELD NAMES,
 * REQUIRED-NESS AND NULLABILITY, and nothing more. It does not pin base types:
 * `WireNullability<{ n: number }>` and `WireNullability<{ n: string }>` are
 * the same type. The closed vocabularies are pinned separately — the consts by
 * that test, and their use by the four verdict fields by
 * [`ScanRootVocabulariesPinned`] below.
 *
 * The witnesses are read by that test and nothing else; tree-shaking drops
 * them from every bundle.
 */
export type WireNullability<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K>
    ? never
    : null extends T[K]
      ? true
      : false;
};

/** `ScanRootRow`'s nullability, as a value. See [`WireNullability`]. */
export const SCAN_ROOT_ROW_NULLABLE: WireNullability<ScanRootRow> = {
  device_id: false,
  state: false,
  detail: true,
  reported_state: false,
  reported_detail: true,
  plans_dir: true,
  repo_root: true,
  source_repo: true,
  default_ref: true,
  ref_sha: true,
  head_sha: true,
  behind: true,
  ahead: true,
  ref_age_secs: true,
  counts_are_floors: false,
  observed_at: false,
  received_at: false,
  last_report_applied: false,
  last_report_observed_at: false,
  observed_skew_secs: false,
  observation_age_secs: false,
  observation_fresh: false,
};

/** `ScanRootListResponse`'s nullability, as a value. See [`WireNullability`]. */
export const SCAN_ROOT_LIST_NULLABLE: WireNullability<ScanRootListResponse> = {
  state: false,
  detail: true,
  fresh_within_secs: false,
  count: false,
  fresh_count: false,
  rows: false,
  by_source_repo: false,
};

/** `ScanRootSourceRollup`'s nullability, as a value. See [`WireNullability`]. */
export const SCAN_ROOT_ROLLUP_NULLABLE: WireNullability<ScanRootSourceRollup> = {
  source_repo: true,
  state: false,
  detail: true,
  device_count: false,
  measured_count: false,
  min_behind: true,
  min_behind_is_floor: true,
  least_behind_device_ids: false,
  lagging_device_ids: false,
  lag_unknown_device_ids: false,
  unmeasured_device_ids: false,
};

/** `true` exactly when `A` and `B` are the same type, not merely assignable. */
type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

/**
 * The four verdict fields carry the pinned vocabularies, not a wider
 * `string`.
 *
 * Widening one would pass every other check here: the wire test pins the
 * CONSTS, and a witness says nothing about base types. Meanwhile the panel
 * would lose exhaustiveness on the one field it keys every claim on.
 * Type-only, and exported solely so it is not an unused local;
 * `npm run type-check` is what evaluates it.
 */
export type ScanRootVocabulariesPinned = [
  Expect<Equal<ScanRootRow["state"], ScanRootState>>,
  Expect<Equal<ScanRootRow["reported_state"], ScanRootState>>,
  Expect<Equal<ScanRootListResponse["state"], ScanRootListState>>,
  Expect<Equal<ScanRootSourceRollup["state"], ScanRootRollupState>>,
];

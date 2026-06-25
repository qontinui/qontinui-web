// ============================================================================
// Operations Page Types
//
// Mirrors the backend `/api/v1/operations/fleet` and
// `/api/v1/operations/fleet/tasks` endpoints. The runner shape is the
// canonical {@link Runner} from `@qontinui/shared-types`; per-machine
// aggregation (`MachineGroup`) is presentation logic that lives here.
// ============================================================================

import type { Runner } from "@qontinui/shared-types";

export interface ClaudeSessionInfo {
  pid: number;
  working_directory: string | null;
  started_at: string | null;
}

/**
 * One row of `coord.device_status`, mirroring the wire shape coord
 * exposes on `GET /coord/status` (plan
 * `2026-05-21-coordination-improvements.md` Phase 1.1) and pushes
 * on `WS /ws/device-status` as `{kind: "device_status.changed", row}`.
 *
 * Phase 1.3 — the operations dashboard renders a per-machine
 * "currently doing" sub-line in `MachineCard` driven by these rows.
 * The frontend joins by hostname; `device_id` is also surfaced for
 * tooltips and fallback identification when hostname is null.
 *
 * This is the single device-status row shape — `DeviceStatusTile` and
 * `useDeviceStatusStream` both consume it (the legacy direct-coord
 * `coordTypes.ts` shape was retired when the tile moved onto the
 * authenticated stream).
 */
export interface DeviceStatus {
  device_id: string;
  hostname: string | null;
  current_task: string | null;
  current_repo: string | null;
  current_branch: string | null;
  free_text: string | null;
  /** Open JSON bag. Conventionally carries `phase: "N/M"` from
   *  `/implement-plan` (Phase 1.4) and may carry arbitrary
   *  caller-defined extras. */
  details: Record<string, unknown>;
  /** Optional tenant scope. NULL when posted by a pre-Phase-1.1
   *  writer; the dashboard renders only the caller-tenant rows so
   *  this is informational. */
  tenant_id: string | null;
  /** RFC 3339. Drives the "<age>s ago" sub-line. */
  updated_at: string;
  /**
   * Phase 5 (plan `2026-06-24-coord-session-progress-and-stall-detection`) —
   * count of stalled / dispatched-but-never-started sessions on this device,
   * joined fail-open from `coord.sessions` on coord's `GET /coord/status`.
   * Absent on a coord deploy that predates Phase 5 (defaults to no badge).
   */
  stalled_session_count?: number;
  /**
   * Phase 5 — the single most-stalled session on this device (largest
   * `stall_age_secs`), driving the tile's stalled badge + age and the
   * distinct "dispatched, never started" indicator
   * (`kind === "expected_unstarted"`). Absent / null when the device has no
   * stalled session or coord predates Phase 5.
   */
  most_stalled_session?: StalledSession | null;
}

/**
 * Phase 5 — a stalled (or dispatched-but-never-started) session, mirroring
 * coord's `StalledSessionSummary` (`sessions.rs`). Surfaced on the device tile.
 *
 * `kind` distinguishes the two stall shapes:
 * - `"stalled"` — an `active` session that heartbeats but stopped advancing
 *   `last_progress_at`.
 * - `"expected_unstarted"` — a dispatched continuation whose durable child
 *   session was never started; `continuation_gate_id` is the originating gate.
 *
 * Optional/loose tail on `kind` so a future coord variant the web hasn't been
 * taught about still renders (as a generic stalled badge) rather than crashing.
 */
export interface StalledSession {
  session_id: string;
  device_id: string;
  kind: "stalled" | "expected_unstarted" | string;
  /** `coord.sessions.state` (`active` | `expected` | ...). */
  state: string;
  session_status?: string | null;
  /** Age of the stall in seconds (since last progress, or since dispatch for
   *  an expected-unstarted continuation). Drives the "stalled <age>" label. */
  stall_age_secs: number;
  last_progress_at?: string | null;
  expected_at?: string | null;
  /** For `expected_unstarted`: the originating gate id. */
  continuation_gate_id?: string | null;
  correlation_topic?: string | null;
  plan_slug?: string | null;
}

/** Wire shape returned by `GET /api/v1/operations/device-status`. */
export interface DeviceStatusResponse {
  devices: DeviceStatus[];
  count: number;
}

/**
 * One row from `GET /coord/claims/list?kind=symbol` — a live symbol
 * claim held by a machine's tree-sitter `symbol_watcher` daemon
 * (qontinui-supervisor Phase 4.1). Plan
 * `2026-05-21-coordination-improvements.md` Phase 4.4 surfaces these as
 * a "currently editing" sub-line on each `MachineCard`.
 *
 * Wire shape mirrors coord's `ClaimHolder`:
 *
 * - `machine_id` — UUID of the holding machine. Joins to the
 *   `coord.devices` table; matches `DeviceStatus.device_id` for the
 *   same machine.
 * - `resource_key` — `<repo>:<file>:<symbol-name>` format set by the
 *   symbol_watcher daemon.
 * - `ttl_seconds` — remaining TTL on the Redis key. Coord defaults
 *   `Symbol` claims to 300s; the dashboard sorts top-N by this value
 *   so the freshest edit floats to the front.
 *
 * Coord does NOT echo `acquired_at`; the dashboard derives "how long
 * ago did this edit start?" via `(default_ttl - ttl_seconds)` if it
 * ever needs to render age.
 */
export interface SymbolClaim {
  kind: "symbol";
  resource_key: string;
  machine_id: string;
  ttl_seconds: number;
  /** Owning tenant of the holder's device, live-resolved by coord
   *  (plan 2026-05-24-symbol-claim-tenant-scoping). Informational —
   *  scoping is enforced upstream; absent on holders whose device
   *  couldn't be resolved and on pre-rollout coord responses. */
  tenant_id?: string | null;
}

/** Wire shape returned by `GET /api/v1/operations/symbol-claims` (which
 *  proxies coord's `/coord/claims/list?kind=symbol`). */
export interface SymbolClaimsResponse {
  kind: "symbol";
  prefix: string;
  holders: SymbolClaim[];
  truncated: boolean;
}

/**
 * Backend main-branch CI verdict for a repo. Mirrors coord's
 * `MainCiStatus` 3-state enum (`ci_baseline.rs` `main_ci_status`),
 * lowercased on the wire. There is intentionally **no** `amber` value
 * here — amber is a frontend-only derivation from open-PR-check counts
 * (see `CiStatusPanel`), never a backend verdict.
 */
export type MainCiVerdict = "green" | "red" | "unknown";

/**
 * Counts of open-PR check runs for a repo, bucketed by GitHub
 * `conclusion` (folded server-side from `coord.pr_check_runs`).
 * `pending` aggregates queued + in_progress (not-yet-concluded) checks.
 */
export interface OpenPrCheckCounts {
  success: number;
  failure: number;
  pending: number;
}

/**
 * One row of the CI Status Dashboard, one per repo in the caller's
 * `coord.tenant_repos`. Mirrors coord's `RepoCiRow` returned by
 * `GET /coord/ci/status` and pushed on the CI-status WS as
 * `{kind: "ci_status.changed", row}`.
 *
 * Plan `2026-05-25-ci-status-dashboard-plan.md` Phases 1–5.
 */
export interface RepoCiRow {
  /** `owner/name` GitHub slug — the per-repo map key. */
  repo: string;
  /** Main-branch health straight from `coord.ci_baselines`. */
  main_verdict: MainCiVerdict;
  /** Open-PR check counts by conclusion. */
  open_pr_checks: OpenPrCheckCounts;
  /** Newest `details_url` across the repo's checks, for deep-linking
   *  to the GitHub run. Null when no check has reported a URL. */
  latest_details_url: string | null;
  /** Current main-tip SHA (from `coord.repo_branches`). Null until the
   *  first push to main lands; gates the "Notify when green" action
   *  because the `CiGreen` predicate is SHA-keyed. */
  main_head_sha: string | null;
}

/** Wire shape returned by `GET /api/v1/operations/ci-status`. */
export interface CiStatusResponse {
  repos: RepoCiRow[];
}

/** Response from `POST /api/v1/operations/ci-status/notify-when-green`. */
export interface NotifyWhenGreenResponse {
  gate_id: string;
}

// ---------------------------------------------------------------------------
// Gates panel (plan 2026-06-05-plan-gate-web-surface-and-productization Ph2)
//
// Mirrors coord's `GateResponse` (`gate_routes.rs` — list/approve/reject
// endpoints) plus the observation/mute/snooze columns this plan adds
// (`coord_gates_observation_cols` alembic migration; coord PR
// `feat/gate-observation-predicates`). The web backend proxies
// `GET /operations/gates/list` (bare JSON array of these rows) and the
// `POST /operations/gates/{id}/{approve,mute,unmute,snooze}` actions.
// ---------------------------------------------------------------------------

/** A gate's evaluation verdict (coord `GateVerdict`). */
export type GateVerdict = "open" | "cleared" | "failed";

/**
 * The typed predicate JSON coord evaluates. Serde-tagged on `kind`
 * (snake_case). Variant-specific fields are optional here because a
 * single union of all variants is rendered defensively by `humanizePredicate`
 * — a future coord predicate the web hasn't been taught about still renders
 * as its raw `kind` rather than crashing the row (honesty-about-uncertainty:
 * never a bare/blank cell). The Phase-1 observation kinds (`metric_threshold`,
 * `time_elapsed`) land in the parallel coord PR; the web tolerates their
 * presence or absence.
 */
export interface GatePredicate {
  kind: string;
  // pr_merged
  repo?: string;
  pr_number?: number;
  // deploy_healthy
  service?: string;
  expected_rev?: string;
  // claim_terminal
  claim_kind?: string;
  resource_key?: string;
  // operator_approval
  prompt?: string;
  // ci_green
  head_sha?: string;
  // ref_exists
  ref_name?: string;
  expected_sha?: string | null;
  // metric_threshold (Phase 1)
  metric?: string;
  labels?: Record<string, string> | null;
  op?: "gt" | "gte" | "lt" | "lte";
  value?: number;
  window_secs?: number | null;
  // time_elapsed (Phase 1)
  since?: string;
  duration_secs?: number;
  // plan_ready (plan 2026-06-05-visible-gate-continuations-and-plan-ready-predicate)
  // Clears when the named plan reaches status `vetted` and all its sibling
  // gates are cleared. The slug lives in the predicate (the coord evaluator
  // signature is `(state, predicate)` only — it can't read its own gate row).
  plan_slug?: string;
}

/**
 * The spawn that fires when a gate's anchor fully clears. Mirrors coord's
 * `GateResponse.continuation_spawn` (`gate_routes.rs`), populated on the gates
 * LIST route by coord PR #356. Optional + every field defensive: a coord that
 * predates #356 omits the whole object (the panel renders no summary, never
 * crashes), and a malformed/partial object still renders what it can.
 *
 * Plan `2026-06-05-visible-gate-continuations-and-plan-ready-predicate.md` P3.
 */
export interface ContinuationSpawn {
  /** Device UUID the session opens on. */
  target_device_id?: string;
  /** Prompt fed to the spawned session. */
  initial_prompt?: string;
  /** Repos the spawned session checks out. */
  repos?: string[];
  /**
   * How the spawn surfaces. ABSENT means `"terminal"` (coord's serde default):
   * a visible terminal session the operator can watch + interrupt. `"headless"`
   * is a background agent with no interactive surface (fleet/CI continuations).
   */
  presentation?: "terminal" | "headless";
}

/**
 * One gate row returned by `GET /api/v1/operations/gates/list`. Mirrors
 * coord's `GateResponse` (`gate_routes.rs`), with the observation/mute/snooze
 * columns rendered defensively (optional) because a lagging coord deploy may
 * not yet emit them.
 */
export interface GateRow {
  gate_id: string;
  /** Claim-anchored gates carry `claim_kind` + `resource_key`. */
  claim_kind: string | null;
  resource_key: string | null;
  /** Plan-anchored gates carry `plan_id` + `phase_name`. */
  plan_id: string | null;
  phase_name: string | null;
  /** Human-readable plan slug (e.g. `2026-06-05-plan-gate-web-surface`),
   *  added by the parallel coord PR. Optional + nullable: a lagging coord
   *  deploy omits it, so the group header falls back to `plan_id`. */
  plan_slug?: string | null;
  predicate: GatePredicate;
  verdict: GateVerdict;
  verdict_reason: string | null;
  registered_by: string | null;
  tenant_id: string;
  created_at: string;
  evaluated_at: string | null;
  cleared_at: string | null;
  /** Mute/snooze columns — optional: a pre-deploy coord omits them. */
  muted?: boolean;
  snoozed_until?: string | null;
  /** Who clears this gate: `operator` (default, surfaces a primary
   *  `Mark met…` button) vs `agent` (cleared by the completing agent
   *  session; operator override only, behind the overflow menu). Optional:
   *  a lagging coord deploy omits it, and the panel defaults to `operator`. */
  clearance_audience?: "operator" | "agent";
  /**
   * What clearing this gate's anchor will spawn (coord PR #356, populated on
   * the list route). Optional + nullable: a coord predating #356 omits it, so
   * the continuation summary simply isn't rendered (no crash, no fake claim).
   */
  continuation_spawn?: ContinuationSpawn | null;

  // -------------------------------------------------------------------------
  // Continuation LIFECYCLE stamps (distinct from `continuation_spawn`, which is
  // the register-time spawn INTENT). Added by coord Phase 2 of plan
  // `2026-06-07-coord-continuation-cancel-and-outcome.md` onto the gates LIST
  // read-side (`GateResponse` ordinals 18+). Every field is optional + nullable:
  // a coord predating that deploy omits them entirely and the panel renders no
  // lifecycle chip (graceful degrade — never a crash, never a fabricated state).
  //
  // The honest signal here is AGE-OF-PENDING, not device liveness: the panel
  // wires no device-liveness feed, so a pending continuation is rendered with
  // its dispatch age (warning-accented past ~15m) and the operator judges
  // whether it has stalled — coord never claims "stalled" on the row's behalf.
  // -------------------------------------------------------------------------

  /** When coord emitted the gate continuation (RFC 3339). NULL = never
   *  dispatched → no lifecycle chip. The pending-age clock starts here. */
  continuation_dispatched_at?: string | null;
  /** When the runner acked consumption (RFC 3339). NULL while pending. */
  continuation_consumed_at?: string | null;
  /** Device UUID that consumed the continuation (audit). NULL while pending. */
  continuation_consumed_by?: string | null;
  /**
   * The runner's honest spawn result, recorded after the terminal/headless
   * session actually opened: `"spawned"` | `"spawn_failed: <detail>"`.
   * NULL = the runner acked the claim but has not yet reported an outcome
   * (a pre-outcome ack — older runner, or the window between claim and result).
   */
  continuation_consumed_outcome?: string | null;
  /** When the continuation was cancelled (RFC 3339). NULL = not cancelled.
   *  Takes precedence over every other lifecycle state in the chip. */
  continuation_cancelled_at?: string | null;
  /** Heterogeneous actor who cancelled — a session owner-token subject, an
   *  operator bearer subject, or the refresh path. Free-form TEXT by design
   *  (coord column is intentionally TEXT, not UUID). NULL = not cancelled. */
  continuation_cancelled_by?: string | null;
  /** Why the continuation was cancelled (free-form). NULL = not cancelled. */
  continuation_cancel_reason?: string | null;
}

// ---------------------------------------------------------------------------
// Dev-action ledger (plan 2026-06-07-twin-dev-event-cause-effect-ledger)
//
// Mirrors coord's `dev_action_snapshots` row exposed on
// `GET /coord/dev-actions/recent` (proxied via
// `GET /api/v1/operations/dev-actions/recent`) and the WS event
// `events.dev_actions.recorded`. Each action records the active dev-state
// set at execution time plus a D3 `category` outcome classification.
// ---------------------------------------------------------------------------

/**
 * The D3 cause→effect classification coord assigns to a recorded dev action.
 * Kept as a string union for color-coding, with `category` typed loosely on
 * the row (a future coord category the web hasn't been taught about still
 * renders as a neutral chip rather than crashing).
 */
export type DevActionCategory =
  | "confirmed"
  | "surprise"
  | "failure"
  | "contradiction"
  | "partial";

/**
 * One row of `coord.dev_action_snapshots`, mirroring the wire shape coord
 * exposes on `GET /coord/dev-actions/recent` and pushes on the coord `/ws`
 * channel as `events.dev_actions.recorded`.
 */
export interface DevAction {
  action_id: string;
  /** The dev action kind (e.g. a tool/command name). */
  kind: string;
  /** Device UUID the action ran on. May be null for pre-device rows. */
  device_id: string | null;
  /** Who requested the action (agent/operator subject). */
  requester_id: string | null;
  /** Digest of the action's params (opaque audit fingerprint). */
  params_digest: string | null;
  /** Active dev-state ids at execution time, rendered as chips. */
  state_ids: string[];
  /** State signatures that were active but not resolvable to a known id. */
  states_unknown: string[];
  /** RFC 3339 start time. Drives the relative-time label. */
  started_at: string | null;
  /** RFC 3339 end time. Null while the action is still in flight. */
  ended_at: string | null;
  /** D3 cause→effect classification — drives the color-coded badge. */
  category: DevActionCategory | string | null;
  /** Wall-clock duration in milliseconds, when coord computed it. */
  duration_ms: number | null;
  /** Opaque pointer to captured evidence (screenshot/log ref), if any. */
  evidence_ref: string | null;
  /** Optional tenant scope (informational). */
  tenant_id: string | null;
  /** Open JSON bag for caller-defined extras. */
  metadata: Record<string, unknown> | null;
}

/** Wire shape returned by `GET /api/v1/operations/dev-actions/recent`. */
export interface DevActionsResponse {
  actions: DevAction[];
  count: number;
}

/**
 * One outcome signature observed for a dev action, returned by the
 * per-action detail endpoint (`GET /coord/dev-actions/:action_id` →
 * `GET /api/v1/operations/dev-actions/:action_id`).
 */
export interface DevActionOutcome {
  /** The observed effect signature. */
  signature: string;
  /** RFC 3339 time the outcome was observed. */
  observed_at: string | null;
  /** True when the outcome arrived after the action's expected window. */
  late: boolean;
}

/** Wire shape returned by `GET /api/v1/operations/dev-actions/:action_id`. */
export interface DevActionDetail {
  action: DevAction;
  outcomes: DevActionOutcome[];
}

/**
 * Per-machine CI runner info returned by the backend in the `/fleet`
 * response. Keyed by hostname. Phase 4c of the self-hosted CI runners plan.
 */
export type CiRunnersByHost = Record<string, CiRunnerInfo>;

/**
 * Fleet status payload — directly serializes from the unified Runner
 * entity plus a hostname → Claude-session map.
 */
export interface FleetStatus {
  runners: Runner[];
  claude_sessions: Record<string, ClaudeSessionInfo[]>; // hostname -> sessions
  /** Per-hostname CI runner info, when the device has CI capability. */
  ci_runners?: CiRunnersByHost;
  /**
   * Operator-set friendly machine names, keyed by hostname, scoped to the
   * current user. Set via `PATCH /api/v1/operations/fleet/machines/{hostname}`.
   * May be `{}` / absent (no machine has been renamed). When present for a
   * hostname, the `MachineCard` title shows the alias instead of the raw
   * hostname; grouping and React keys still use the hostname.
   */
  machine_display_names?: Record<string, string>;
  total_runners: number;
  total_healthy: number;
  total_running_tasks: number;
  total_claude_sessions: number;
}

export interface RunnerTaskRun {
  id: string;
  runner_id: string;
  runner_hostname: string | null;
  runner_port: number | null;
  status: string;
  prompt: string | null;
  started_at: string | null;
  workflow_name: string | null;
}

export interface AggregatedTaskRuns {
  task_runs: RunnerTaskRun[];
  total: number;
}

/**
 * Group runners by hostname for the machine-card grid. Hostname-less
 * runners are bucketed under `"unknown"` so they still surface in the
 * grid.
 *
 * `currentActivity` is the joined `coord.device_status` row for this
 * hostname (Phase 1.3). Absent when no agent on this machine has
 * posted to `/coord/status` recently, or when the WS subscription
 * is offline AND the polling fallback hasn't caught up yet.
 */
/**
 * CI runner status for a machine, sourced from `coord.devices`
 * CI capability columns. Phase 4c of the self-hosted CI runners plan.
 *
 * - `idle`    — CI runner is registered and available for jobs.
 * - `busy`    — CI runner is currently executing a job.
 * - `offline` — CI runner is registered but not reachable / reporting.
 */
export type CiRunnerStatus = "idle" | "busy" | "offline";

export interface CiRunnerInfo {
  status: CiRunnerStatus;
  /** Labels the CI runner advertises (e.g. `["self-hosted", "linux", "x64"]`). */
  labels: string[];
  /** ISO 8601 timestamp of the last CI job execution, or `null` if never. */
  lastJobAt: string | null;
}

export interface MachineGroup {
  hostname: string;
  /**
   * Operator-set friendly name for this machine, joined from the fleet
   * payload's `machine_display_names[hostname]`. Absent when the machine has
   * not been renamed; the `MachineCard` then shows the raw `hostname`.
   * Grouping and React keys always use `hostname`, never this.
   */
  displayName?: string;
  runners: Runner[];
  claudeSessions: ClaudeSessionInfo[];
  currentActivity?: DeviceStatus;
  /**
   * Up to 5 live symbol claims for this machine, sorted by `ttl_seconds`
   * descending (freshest first). Plan
   * `2026-05-21-coordination-improvements.md` Phase 4.4. Joined from
   * `useSymbolClaimsStream()` by `machine_id ↔ DeviceStatus.device_id`.
   *
   * Empty array when no symbol_watcher daemon is reporting for this
   * machine; the `MachineCard` hides the sub-line entirely in that case.
   */
  currentlyEditing?: SymbolClaim[];
  /**
   * CI runner capability for this machine, sourced from `coord.devices`
   * CI columns. Phase 4c of the self-hosted CI runners plan. Absent
   * when the machine does not have CI runner capability.
   */
  ciRunner?: CiRunnerInfo;
}

// ============================================================================
// Migration reservation queue
//
// Mirrors coord's `Reservation` wire shape from
// `migration_reservations.rs` (`GET /coord/migrations/queue?repo=`),
// proxied through `GET /api/v1/operations/migrations/queue`. The
// coord-authoritative reservation queue replaced the alembic head-claim
// mutex: a client asks for a slot and coord assigns the `down_revision`
// (merged chain head or queue tail), stacking racing reserves into an
// ordered queue rather than forking the migration graph.
// ============================================================================

/**
 * One migration reservation row — the full read-side shape coord serializes
 * (every column). Timestamps are RFC 3339 strings.
 *
 * The lifecycle `state` is an open union: coord's CHECK constraint limits it
 * to the five known values today, but the `| string` tail keeps a future
 * coord state from crashing the render path (it just falls through to a
 * neutral chip).
 */
export interface MigrationReservation {
  id: string;
  repo: string;
  revision: string;
  down_revision: string;
  state: "queued" | "pr_bound" | "merged" | "expired" | "withdrawn" | string;
  pr_number: number | null;
  pr_url: string | null;
  requested_by_machine?: string | null;
  requested_by_session: string | null;
  tenant_id?: string | null;
  authoring_deadline: string | null;
  created_at: string;
  bound_at: string | null;
  merged_at: string | null;
  terminated_at: string | null;
  terminal_reason: string | null;
  /**
   * 1-based position in the live queue (created_at order), matching what
   * `POST /coord/migrations/reserve` returns to the author. Present only on
   * live rows (`queued` / `pr_bound`); absent on terminal rows and on older
   * coord deploys that predate the field — render falls back to the list
   * index in that case.
   */
  position?: number | null;
}

/**
 * The queue read response: the ordered live set plus the last few terminal
 * rows for the given repo.
 */
export interface MigrationQueueResponse {
  repo: string;
  live: MigrationReservation[];
  recent_terminal: MigrationReservation[];
}

/**
 * `/operations/pr-merge` settings routes: the tenant's merge profile, the
 * per-repo overrides, the SLO dashboard, and the two audited merge-enablement
 * writes (`merge-enabled`, `kill-switch`).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7a). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` (same-origin, D6) with its URL inline, states its retry
 * policy, and returns the PARSED body through `readJson`. A non-2xx rejects
 * with `<METHOD> <url> failed: <status> - <body>`: a caller reads the status
 * with `httpStatusOf` / `httpBodyOf`.
 *
 * The wire types below are hand-written and each names the handler it mirrors
 * in `backend/app/api/v1/endpoints/operations/__init__.py` (the backend proxies
 * coord's `pr_merge` routes): the settings-page routes (Phase 7a), and the
 * merge pipeline, train and recovery routes (Phase 7 batch 7).
 *
 * Writes whose result no caller reads resolve `null` for a 2xx whose body does
 * not parse (a 204 included): the 2xx is the fact that the change landed, and
 * failing it would invite a repeat of a write that already happened.
 *
 * A shared `request(path)` helper underneath would make every call site a
 * wrapper-of-a-wrapper, which `route-walker.test.ts` cannot resolve.
 */

import { httpClient } from "@/services/service-factory";
import type {
  BlastRadiusBlock,
  BlastRadiusBlocksResponse,
  MergeEnabledResponse,
  PrListResponse,
  PrRow,
  PrStateResponse,
  ProposalDetail,
  QueueResponse,
  SuggestionListResponse,
  SuggestionRow,
  TrainHealth,
} from "@/components/operations/mergeTypes";
import type { OperatorTouchSlo } from "@/components/operations/operatorTouchSlo";
import { OPERATIONS_BASE, readJson } from "./base";

// ----------------------------------------------------------------------------
// Wire types — mirror `qontinui-coord/src/pr_merge/settings.rs` (the resolved
// `EffectiveProfile`) + `settings_wire.rs` (the PATCH bodies).
// ----------------------------------------------------------------------------

// coord's resolved `EffectiveProfile` READS escalate config back as typed
// policies (a glob classified into a hazard category + disposition), NOT as the
// raw `escalate_paths` string[] that the PATCH body WRITES. The read/write
// asymmetry is intentional coord-side: you write raw globs, you read the
// classified result. Mirrors `EscalateCategory` / `EscalateDisposition` in
// `qontinui-coord/crates/coord/src/merge_settings_types.rs` — note the path:
// these moved out of `pr_merge/settings.rs` in the coord workspace split, and
// that file now only re-exports them.
//
// ⚠️ THIS UNION IS A MIRROR OF A RUST ENUM ACROSS A REPO BOUNDARY, so nothing
// compiles it against its source. It omitted `dependencies` for two days after
// coord added that variant (coord#2012, 2026-09-07). Nothing broke — TS erases
// at runtime and this component reads only `policy.glob` — but the type was
// false against the live wire, and the first lookup keyed on this union would
// have returned `undefined` for every dependency-gated repo. If you add a
// variant coord-side, add it here in the same change.
type EscalateCategory =
  | "secrets"
  | "migrations"
  | "infra"
  // Dependency manifests and lockfiles (package.json, Cargo.toml,
  // pyproject.toml, go.mod and their lockfiles). `block_soft` coord-side, which
  // today blocks identically to `block_hard`; it is a distinct category so a
  // deliberate dependency gate is not reported as the fail-closed `other`.
  | "dependencies"
  // The fail-closed tail: a configured glob that matched no known bucket.
  | "other";
type EscalateDisposition =
  | "block_hard"
  | "block_soft"
  | "auto_if_provably_safe";

interface EscalatePolicy {
  glob: string;
  category: EscalateCategory;
  disposition: EscalateDisposition;
}

export interface EffectiveProfile {
  tenant_id: string;
  repo: string;
  min_green_dwell: number; // seconds
  confidence_threshold: number;
  auto_merge_enabled: boolean;
  // The RESOLVED merge-enablement boolean — per-repo pin, else the tenant
  // value, else coord's `true` default, with the tenant-wide `merge_paused`
  // latch dominating all of it. Writes go through
  // POST /pr-merge/merge-enabled (never the settings PATCH).
  //
  // Resolved-only: it cannot tell you whether this repo is PINNED or merely
  // inheriting. That distinction lives in `merge_enabled_override` on the
  // per-repo reads below, and rendering only this field is exactly the bug
  // that made a whole fleet's pinned state invisible from this dashboard.
  merge_enabled: boolean;
  rulebook_overrides: Record<string, unknown> | null;
  // The resolved escalate config, read back as typed policies. coord returns
  // `[]` for a default/unconfigured tenant; still guarded with `?? []` at every
  // read site in case a future default omits it. The editor round-trips the
  // `.glob` of each policy against the `escalate_paths` PATCH field on save.
  escalate_policies?: EscalatePolicy[];
  audit_confidence_shadow_floor: number;
  preferred_auditor_device_id: string | null;
  auto_merge_label_budget: number | null;
  framework_signals: string[];
  profile_source: string | null;
  // Red-main auto-remediation Phase 3 (D6) — resolved opt-in for
  // auto-spawning a fix session when this repo's main goes red.
  auto_fix_red_main: boolean;
  // ff-land head-ref sync (plan
  // `2026-08-26-coord-ff-land-records-merged-on-github`, Phase 1) — resolved
  // opt-in for updating the PR's head ref to the rebased tip as part of the
  // land, so GitHub records the PR as **Merged** instead of grey Closed.
  //
  // OPTIONAL, and the `?` is load-bearing — see `ffLandHeadSyncSupported`.
  ff_land_head_sync_enabled?: boolean;
}

export interface TenantSettingsResponse {
  tenant_id: string;
  profile: EffectiveProfile;
  /**
   * The RAW tenant-tier expedited-land dials (plan
   * `2026-10-13-coord-expedited-land-lever-for-agents` §6, Phase 1b), as
   * stored in `coord.tenant_merge_settings`.
   *   - ABSENT  → this coord build does not carry the dials (the PATCH would
   *               400 on them, `deny_unknown_fields`) — see `expediteReadState`;
   *   - `null`  → coord could NOT read them: UNKNOWN, never "inheriting";
   *   - object  → each field's `null` = column NULL = inheriting.
   */
  expedite_tenant?: ExpediteDials | null;
}

/** The closed set coord accepts for `expedited_land` (column CHECK + PATCH 422). */
export type ExpeditedLandMode = "on" | "shadow" | "off";

/**
 * The four expedited-land dials as stored at ONE tier — mirrors
 * `ExpediteDials` in `qontinui-coord/crates/coord/src/pr_merge/settings_wire.rs`.
 * `null` on a field = inheriting the lower tier.
 *
 * `expedited_land` is the lever's off-switch and a KILL SWITCH coord-side: no
 * agent can write it over any door; only this operator page does. The sizes
 * are the S11 overrides (positive integers) and `expedite_review_arm` is the
 * S13 independence-review arm's off-switch — both operator-only too.
 */
export interface ExpediteDials {
  expedited_land: ExpeditedLandMode | null;
  expedite_max_files: number | null;
  expedite_max_changed_lines: number | null;
  expedite_review_arm: boolean | null;
}

/**
 * The expedite keys of either settings PATCH. An ABSENT key is left unchanged,
 * a value sets it, `null` clears it back to inherit. Sent only when edited:
 * re-sending a loaded value would silently revert another operator's change to
 * an off-switch.
 */
export interface ExpeditePatch {
  expedited_land?: ExpeditedLandMode | null;
  expedite_max_files?: number | null;
  expedite_max_changed_lines?: number | null;
  expedite_review_arm?: boolean | null;
}

export interface RepoProfileResponse {
  tenant_id: string;
  repo: string;
  profile: EffectiveProfile;
  // The RAW per-repo pin, alongside the resolved `profile.merge_enabled`:
  //   true  → pinned on
  //   false → pinned off
  //   null  → not pinned; this repo inherits
  //
  // Declared because it is part of this response and a reader needs to know
  // the pin is available here. The per-repo card nonetheless reads the pin off
  // the repo-LIST row (same value, refreshed after every save), because this
  // read is issued once per mount and would go stale — see RepoOverrideCard.
  merge_enabled_override: boolean | null;
  /**
   * The RAW per-repo override columns, beside the resolved `profile`. Each
   * field is the stored column: a value = overridden here, `null` = column
   * NULL = inheriting.
   *
   * REQUIREMENT on the paired qontinui-coord change (plan
   * 2026-07-22-merge-settings-repo-override-preload, Phase 1): serve this
   * field on the profile GET AND on the admin PATCH response. coord's
   * `patch_repo_profile` already returns the same `RepoProfileResponse`
   * struct as the GET, so adding the field to that struct covers both. Until
   * that change is deployed the field is ABSENT — hence OPTIONAL — and the
   * card falls back to write-only editing with a notice.
   */
  raw_override?: RawRepoOverride;
  /**
   * The RAW per-repo expedited-land dials (`coord.tenant_repo_profiles`), read
   * best-effort coord-side and so carried apart from `raw_override`:
   * ABSENT = an older coord build; `null` = UNKNOWN (unreadable); an object =
   * stored values, each `null` field inheriting the tenant tier.
   */
  expedite_override?: ExpediteDials | null;
}

export interface RawRepoOverride {
  framework_signals: string[] | null;
  confidence_threshold_override: number | null;
  escalate_paths_extra: string[] | null;
  auto_merge_label_budget: number | null;
  auto_fix_red_main: boolean | null;
  auto_fix_red_main_flaky: boolean | null;
}
export interface TenantRepoRow {
  repo: string;
  role: string;
  framework_signals: string[];
  profile_source: string | null;
  profile_version: number | null;
  /** Resolved merge enablement for this repo. */
  merge_enabled: boolean;
  /** Raw per-repo pin; `null` = inheriting. */
  merge_enabled_override: boolean | null;
}

export interface TenantReposResponse {
  repos: TenantRepoRow[];
  total: number;
}

// ----------------------------------------------------------------------------
// Phase 9 D9.6 — SLO dashboard wire types
// ----------------------------------------------------------------------------

/**
 * One repo's 7d/30d window. Two of these fields are STRUCTURALLY ZERO on
 * current coord (`operator_override_rate`, `escalation_rate` — no live writer
 * produces them); coord names them in {@link SloResponse.structurally_zero}
 * and `SloRepoCard` labels them so. The live interruption rate is tenant-level
 * ({@link SloResponse.operator_touch}), because touches carry no repo.
 */
interface SloWindowMetrics {
  auto_merge_success_rate: number | null;
  escalation_rate: number | null;
  post_merge_verification_lag_p95_seconds: number | null;
  operator_override_rate: number | null;
  total_decisions: number;
}

export interface RepoSlo {
  repo: string;
  /** RESOLVED merge enablement (pin → tenant → default `true`, with the
   *  tenant-wide pause dominating). */
  merge_enabled: boolean;
  /** RAW per-repo pin: `true`/`false` = pinned, `null` = inheriting. */
  merge_enabled_override: boolean | null;
  windows: {
    last_7d: SloWindowMetrics;
    last_30d: SloWindowMetrics;
  };
}

interface KillSwitchHistoryRow {
  fired_at: string;
  scope: string;
  reason: string | null;
  previous_state: string | null;
}

export interface SloResponse {
  tenant_id: string;
  repos: RepoSlo[];
  kill_switch_history_last_30d: KillSwitchHistoryRow[];
  generated_at: string;
  /**
   * Plan `2026-08-27-operator-touch-read-and-surface` C3: the tenant-level
   * operator-touch rate over the same 7d/30d windows. Optional because a coord
   * predating it omits it — which renders as unknown, never as zero.
   */
  operator_touch?: OperatorTouchSlo | null;
  /** `SloWindowMetrics` field names with no live writer (always 0). */
  structurally_zero?: string[] | null;
}

// `MergeEnabledResponse` (mergeTypes.ts) is the shared body of both
// `POST /pr-merge/merge-enabled` and `POST /pr-merge/kill-switch`.

/**
 * The body of `PATCH /pr-merge/settings` (`PatchTenantSettings`, which is
 * `deny_unknown_fields` coord-side — an unknown key 400s the whole save).
 */
export interface TenantSettingsPatch extends ExpeditePatch {
  min_green_dwell_secs: number;
  confidence_threshold: number;
  auto_merge_enabled: boolean;
  auto_fix_red_main: boolean;
  audit_confidence_shadow_floor: number;
  escalate_paths: string[];
  /** Only on a coord build that carries the dial; see `ffLandHeadSyncSupported`. */
  ff_land_head_sync_enabled?: boolean;
}

/**
 * The body of `PATCH /pr-merge/repos/{repo}/profile` (`PatchRepoProfile`,
 * also `deny_unknown_fields`). An ABSENT key leaves the column unchanged; a
 * value sets it; `null` clears it back to inherit.
 */
export interface RepoProfilePatch extends ExpeditePatch {
  confidence_threshold_override?: number | null;
  escalate_paths_extra?: string[];
  auto_merge_label_budget?: number | null;
  auto_fix_red_main?: boolean | null;
  ff_land_head_sync_enabled?: boolean | null;
}

/**
 * The body of `POST /pr-merge/merge-enabled`. `scope` is `"tenant"` or
 * `"repo:<name>"`; `enabled: null` clears a repo pin back to inherit.
 */
export interface MergeEnabledWrite {
  scope: string;
  enabled: boolean | null;
  reason: string;
}

/** The body of `POST /pr-merge/kill-switch` — the tenant-wide stop. */
export interface KillSwitchWrite {
  scope: string;
  reason: string;
}

/** `GET /pr-merge/settings` — `get_pr_merge_settings`. */
export async function fetchTenantSettings(): Promise<TenantSettingsResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/settings`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<TenantSettingsResponse>(res, `GET ${url}`);
}

/**
 * `PATCH /pr-merge/settings` — `patch_pr_merge_settings`. Not re-sent on a 5xx
 * (`idempotent: false`): every save re-stamps `profile_source='user_edit'`.
 */
export async function patchTenantSettings(
  patch: TenantSettingsPatch
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/settings`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(patch),
    idempotent: false,
  });
  // Nothing in the web app reads the echo; only the 2xx matters.
  return readJson<unknown>(res, `PATCH ${url}`, { unparseable: "null" });
}

/** `GET /pr-merge/repos` — `get_pr_merge_repos`. */
export async function fetchTenantRepos(): Promise<TenantReposResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/repos`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<TenantReposResponse>(res, `GET ${url}`);
}

/** `GET /pr-merge/slo` — `get_pr_merge_slo`. */
export async function fetchMergeSlo(): Promise<SloResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/slo`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<SloResponse>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/repos/{repo:path}/profile` — `get_pr_merge_repo_profile`.
 * `repo` is `owner/name` and the route's `:path` converter takes the slash, so
 * it is NOT percent-encoded (encoding it would send `%2F`).
 */
export async function fetchRepoProfile(
  repo: string
): Promise<RepoProfileResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/repos/${repo}/profile`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<RepoProfileResponse>(res, `GET ${url}`);
}

/**
 * `PATCH /pr-merge/repos/{repo:path}/profile` — `patch_pr_merge_repo_profile`.
 * Resolves `null` for a 2xx whose body does not parse: the write landed, and
 * the caller must treat that as "saved, response unusable" rather than as a
 * failure. Not re-sent on a 5xx (`idempotent: false`).
 */
export async function patchRepoProfile(
  repo: string,
  patch: RepoProfilePatch
): Promise<RepoProfileResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/repos/${repo}/profile`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(patch),
    idempotent: false,
  });
  return readJson<RepoProfileResponse>(res, `PATCH ${url}`, {
    unparseable: "null",
  });
}

/**
 * `POST /pr-merge/merge-enabled` — `post_pr_merge_merge_enabled`, the audited
 * enablement write (repo pin or tenant latch lift). Not re-sent on a 5xx
 * (`idempotent: false`): each write appends an audit row.
 */
export async function setMergeEnabled(
  write: MergeEnabledWrite
): Promise<MergeEnabledResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/merge-enabled`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      scope: write.scope,
      enabled: write.enabled,
      reason: write.reason,
    }),
    idempotent: false,
  });
  return readJson<MergeEnabledResponse>(res, `POST ${url}`, {
    unparseable: "null",
  });
}

/**
 * `POST /pr-merge/kill-switch` — `post_pr_merge_kill_switch`, the audited
 * tenant-wide stop (writes the alert row). Never re-sent on a 5xx
 * (`idempotent: false`): a repeat would write a second alert.
 */
export async function fireKillSwitch(
  write: KillSwitchWrite
): Promise<MergeEnabledResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/kill-switch`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ scope: write.scope, reason: write.reason }),
    idempotent: false,
  });
  return readJson<MergeEnabledResponse>(res, `POST ${url}`, {
    unparseable: "null",
  });
}

/**
 * `GET /pr-merge/merge-economics` — `get_pr_merge_merge_economics`, a proxy
 * of coord's per-repo merge economics (candidate-CI p90 and friends).
 * Resolves `unknown`: every caller normalizes it through
 * `normalizeMergeEconomics` (`components/operations/mergeEconomics.ts`),
 * which owns the shape. A dashboard poll: no client retries (`maxRetries: 0`).
 */
export async function fetchMergeEconomics(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/merge-economics`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

// ----------------------------------------------------------------------------
// Tenant `auto_fix_pr` dial — the settings-page fixer toggle
// ----------------------------------------------------------------------------

/**
 * `PATCH /pr-merge/settings` with ONLY `auto_fix_pr` — `patch_pr_merge_settings`.
 * `null` clears the tenant column back to "follow the default". The caller
 * confirms the write by reading the dial back out of the echoed profile, so
 * the body is parsed strictly. Not re-sent on a 5xx (`idempotent: false`).
 */
export async function patchTenantAutoFixPr(
  autoFixPr: boolean | null
): Promise<TenantSettingsResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/settings`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ auto_fix_pr: autoFixPr }),
    idempotent: false,
  });
  return readJson<TenantSettingsResponse>(res, `PATCH ${url}`);
}

/**
 * `PATCH /pr-merge/settings` with ONLY `auto_fix_red_main` — the tenant knob
 * coord checks before it consults the red-main fixer at all (gate 3 of
 * `stuck_pr_watcher::maybe_consult_red_main_fix`). `PatchTenantSettings` is
 * all-optional coord-side, so this body changes that one column and nothing
 * else (the merge settings card re-sends every field on its save). The caller
 * confirms the write by RE-READING the settings, not from this answer. Not
 * re-sent on a 5xx (`idempotent: false`).
 */
export async function patchTenantAutoFixRedMain(
  enabled: boolean
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/settings`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ auto_fix_red_main: enabled }),
    idempotent: false,
  });
  return readJson<unknown>(res, `PATCH ${url}`, { unparseable: "null" });
}

// ----------------------------------------------------------------------------
// Merge pipeline — the fleet hero's reads (`useMergePipelineData`)
// ----------------------------------------------------------------------------
//
// Every read here is a dashboard poll: one request, no client retries
// (`maxRetries: 0`, the `COORD_DASHBOARD_POLL_OPTIONS` policy) — the next poll
// is the retry. Each body is returned as served; the callers keep tolerating
// both the wrapped and the bare-array wire shapes.

/** `GET /merge/queue` — `get_merge_queue`, the proposal queue. */
export async function fetchMergeQueue(): Promise<
  QueueResponse | ProposalDetail[]
> {
  const url = `${OPERATIONS_BASE}/merge/queue`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<QueueResponse | ProposalDetail[]>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/prs?merged_count_hours=<h>` — `get_pr_merge_prs`, the OPEN
 * PR listing plus coord's cheap merged COUNT over the last `hours`.
 */
export async function fetchOpenPrsWithMergedCount(
  hours: number
): Promise<PrListResponse | PrRow[]> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs?merged_count_hours=${hours}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<PrListResponse | PrRow[]>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/prs?include_merged=<h>` — `get_pr_merge_prs` with the
 * recently-merged ROWS, an order of magnitude dearer than the open listing.
 * No client retry: each attempt is a full coord query.
 */
export async function fetchPrsIncludingMerged(
  hours: number
): Promise<PrListResponse | PrRow[]> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs?include_merged=${hours}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<PrListResponse | PrRow[]>(res, `GET ${url}`);
}

/** `GET /pr-merge/prs` — `get_pr_merge_prs`, the plain open-PR listing. */
export async function fetchOpenPrs(): Promise<PrListResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<PrListResponse>(res, `GET ${url}`);
}

/** `GET /pr-merge/suggestions` — `get_pr_merge_suggestions`. */
export async function fetchMergeSuggestions(): Promise<
  SuggestionListResponse | SuggestionRow[]
> {
  const url = `${OPERATIONS_BASE}/pr-merge/suggestions`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<SuggestionListResponse | SuggestionRow[]>(res, `GET ${url}`);
}

/**
 * `POST /pr-merge/suggestions/{alert_id}/{accept|reject|mute}` —
 * `post_pr_merge_suggestion_accept` / `_reject` / `_mute`. Nothing reads the
 * echo, so a 2xx whose body does not parse resolves `null` (the action
 * landed). Not re-sent on a 5xx (`idempotent: false`).
 */
export async function actOnMergeSuggestion(
  alertId: number,
  action: "accept" | "reject" | "mute",
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/suggestions/${alertId}/${action}`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `GET /pr-merge/blast-radius-blocks` — `get_pr_merge_blast_radius_blocks`. */
export async function fetchBlastRadiusBlocks(): Promise<
  BlastRadiusBlocksResponse | BlastRadiusBlock[]
> {
  const url = `${OPERATIONS_BASE}/pr-merge/blast-radius-blocks`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<BlastRadiusBlocksResponse | BlastRadiusBlock[]>(
    res,
    `GET ${url}`
  );
}

// ----------------------------------------------------------------------------
// Per-PR reads — train health, check breakdown, dependency graph
// ----------------------------------------------------------------------------

/** `GET /pr-merge/health` — `get_pr_merge_health`, merge-train liveness. */
export async function fetchTrainHealth(): Promise<TrainHealth> {
  const url = `${OPERATIONS_BASE}/pr-merge/health`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<TrainHealth>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/prs/{repo:path}/{pr_number}/checks` —
 * `get_pr_merge_pr_checks`, one PR's per-check breakdown. `repo` is
 * percent-encoded (`owner%2Fname`), as this read has always sent it.
 */
export async function fetchPrChecks(
  repo: string,
  prNumber: number
): Promise<PrStateResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs/${encodeURIComponent(repo)}/${prNumber}/checks`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PrStateResponse>(res, `GET ${url}`);
}

// Wire types — mirror `get_pr_merge_graph`, which proxies coord's
// `src/pr_merge/graph_routes.rs::GraphResponse` verbatim.

export interface GraphPrRef {
  repo: string;
  pr: number;
}

export interface GraphNode {
  repo: string;
  pr_number: number;
  tenant_id: string | null;
  outer_state: string | null;
  /**
   * The topological-merge predicate (`is_pr_ready_for_topo_merge`). It
   * requires review `APPROVED`, which agents on this fleet never give, so it
   * reads `false` for PRs the merge train will land. Secondary signal only —
   * never the "landable" colour.
   */
  topo_merge_ready?: boolean;
  /**
   * The merge predicate's latest verdict (the latest `predicate_eval`
   * `pr_events` row — the same verdict `coord_pr_status` serves). `"none"`
   * means the predicate passed; `null` means no verdict is recorded. Absent
   * on a coord that predates the field.
   */
  block_reason_code?: string | null;
  /**
   * LEGACY: the pre-rename wire name of `topo_merge_ready` (same predicate).
   * Served only by a coord predating plan
   * `2026-09-28-coord-pr-merge-ready-false-stall-and-events-tenant-mismatch`
   * Phase 2c; read only when `block_reason_code` is absent.
   */
  ready?: boolean;
  merge_state_status: string | null;
}

export interface GraphEdge {
  from: GraphPrRef;
  to: GraphPrRef;
  /** "upstream_of" | "stacked_on" — kept as string for forward-compat. */
  kind: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  topo_order: GraphPrRef[];
  cycle_detected: boolean;
  cycle_members: GraphPrRef[];
}

/**
 * `GET /pr-merge/graph?repo=<owner/name>&pr=<n>` — `get_pr_merge_graph`, the
 * dependency DAG of one PR's connected component. The query is built with
 * `URLSearchParams`, as it always was (`/` → `%2F`).
 */
export async function fetchPrGraph(
  repo: string,
  pr: number
): Promise<GraphResponse> {
  const params = new URLSearchParams({ repo, pr: String(pr) });
  const url = `${OPERATIONS_BASE}/pr-merge/graph?${params.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<GraphResponse>(res, `GET ${url}`);
}

// ----------------------------------------------------------------------------
// Tenant self-service merge recovery (plan
// `2026-07-30-coord-tenant-self-service-merge-recovery` Phase 4)
// ----------------------------------------------------------------------------
//
// Two reads that tell a tenant WHY their PR is wedged, and two Tier-2 writes
// that let them clear it themselves. All four proxy straight through the web
// backend to coord on the SAME paths coord's MCP tools drive, and the backend
// proxies coord's status code + JSON body VERBATIM, so coord's 409
// `land_in_flight` / `batch_in_flight` and its deliberate 404-not-403
// `*_not_found_in_tenant_scope` reach the caller intact. The bodies resolve
// `unknown`: `StuckPrRecoveryPanel`'s parsers own the shapes.

/**
 * `GET /pr-merge/{repo:path}/stuck-nudges` — `get_pr_merge_stuck_nudges`:
 * `{repo, enabled, cooldown_secs, max_nudges, nudges[], stuck_now[]}`.
 * `repo` is `owner/name`, inlined UNENCODED (the route's `:path` converter
 * takes the slash). A panel poll: no client retries.
 */
export async function fetchStuckNudges(repo: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/${repo}/stuck-nudges`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/verdict/{owner}/{name}/{pr_number}` —
 * `get_pr_merge_verdict`, coord's merge verdict for one PR (the recovery card
 * needs its `proposal.proposal_id`). A panel poll: no client retries.
 */
export async function fetchPrMergeVerdict(
  owner: string,
  name: string,
  prNumber: number
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/verdict/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${prNumber}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** The body of `POST /pr-merge/proposals/{proposal_id}/cancel`. */
export interface ProposalCancelWrite {
  /**
   * `false` STOPS (the cancelled prior stays on record and blocks a retry at
   * this commit); `true` clears the block AND re-enqueues a fresh attempt.
   * Genuinely different actions — never one button.
   */
  unblock: boolean;
  reason: string;
}

/**
 * `POST /pr-merge/proposals/{proposal_id}/cancel` —
 * `post_pr_merge_proposal_cancel`. Coord 409s `land_in_flight` /
 * `batch_in_flight` / already-terminal, and 404s
 * `proposal_not_found_in_tenant_scope` cross-tenant. A 2xx whose body does
 * not parse resolves `null`: the cancel landed. Not re-sent on a 5xx
 * (`idempotent: false`).
 */
export async function cancelMergeProposal(
  proposalId: string,
  write: ProposalCancelWrite
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/proposals/${encodeURIComponent(proposalId)}/cancel`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ unblock: write.unblock, reason: write.reason }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /pr-merge/prs/{owner}/{name}/{pr_number}/reevaluate` —
 * `post_pr_merge_reevaluate`: re-run coord's merge decision for one PR
 * against fresh GitHub truth. Sends `{}`. Returns `{repo, pr_number,
 * evaluated, result, outer_state, block_reason_code, block_payload}`, or 404
 * `pr_not_found_in_tenant_scope`. A 2xx whose body does not parse resolves
 * `null`. Not re-sent on a 5xx (`idempotent: false`).
 */
export async function reevaluatePr(
  owner: string,
  name: string,
  prNumber: number
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${prNumber}/reevaluate`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /prs/{owner}/{repo}/{number}/hold` — `set_pr_hold` (plan
 * `2026-10-04-coord-pr-hold-without-github-drafts`, Phase 4). `held: true`
 * places a coord hold with a REQUIRED `reason`; `held: false` releases this
 * caller's hold (or, for an admin operator, any hold). The backend forwards to
 * coord's `POST /coord/repos/{owner}/{repo}/pull-requests/{number}/hold`.
 * `reason` is omitted from the body when null. Nothing reads the echo, so a
 * 2xx whose body does not parse resolves `null`. Not re-sent on a 5xx
 * (`idempotent: false`).
 */
export async function setPrHold(
  owner: string,
  repo: string,
  prNumber: number,
  held: boolean,
  reason: string | null
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/prs/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${prNumber}/hold`;
  const body: { held: boolean; reason?: string } = { held };
  if (reason !== null) body.reason = reason;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

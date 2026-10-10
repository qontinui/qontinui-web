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
 * coord's `pr_merge` routes). Only the settings-page routes live here; the
 * merge pipeline and train routes are a later Phase 7 batch.
 *
 * Writes whose result no caller reads resolve `null` for a 2xx whose body does
 * not parse (a 204 included): the 2xx is the fact that the change landed, and
 * failing it would invite a repeat of a write that already happened.
 *
 * A shared `request(path)` helper underneath would make every call site a
 * wrapper-of-a-wrapper, which `route-walker.test.ts` cannot resolve.
 */

import { httpClient } from "@/services/service-factory";
import type { MergeEnabledResponse } from "@/components/operations/mergeTypes";
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
}

// `MergeEnabledResponse` (mergeTypes.ts) is the shared body of both
// `POST /pr-merge/merge-enabled` and `POST /pr-merge/kill-switch`.

/**
 * The body of `PATCH /pr-merge/settings` (`PatchTenantSettings`, which is
 * `deny_unknown_fields` coord-side — an unknown key 400s the whole save).
 */
export interface TenantSettingsPatch {
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
export interface RepoProfilePatch {
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

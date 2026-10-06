/**
 * Wire types for the Merge Orchestrator settings page
 * ({@link MergeOrchestrationSettings}). A leaf module: it imports nothing from
 * its siblings, so every other module under `merge-settings/` may import it.
 */

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

/** Edit-field values seeded from a stored raw override (`null` → blank / inherit). */
export interface RepoOverrideFields {
  confidence_threshold_override: string;
  auto_merge_label_budget: string;
  escalate_paths_extra: string;
  auto_fix_red_main: "inherit" | "true" | "false";
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

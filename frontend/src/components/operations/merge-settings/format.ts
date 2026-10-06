/**
 * Pure parse / format helpers for the Merge Orchestrator settings page.
 */

import { pinChoice } from "./pinChoice";
import type {
  EffectiveProfile,
  RawRepoOverride,
  RepoOverrideFields,
} from "./types";

/**
 * Whether the coord build behind this dashboard carries the ff-land head-sync
 * dial on its **settings wire** — i.e. whether the controls below may write it.
 *
 * The storage and the wire landed apart, and the gap is still open:
 * `qontinui-web#1092` added the two nullable BOOLEAN columns
 * (`coord.tenant_merge_settings.ff_land_head_sync_enabled` and
 * `coord.tenant_repo_profiles.ff_land_head_sync_enabled`), and
 * `qontinui-coord#1660` added the RESOLVER that reads them — but neither added
 * the field to `PatchTenantSettings` / `PatchRepoProfile` or to the
 * `EffectiveProfile` those routes serve. So for now the columns have **no
 * writer anywhere in the fleet** and this dial can only be set by hand-SQL.
 *
 * That is why this probe exists rather than an unconditional send, and why it
 * is a probe on the READ shape. Both PATCH structs carry
 * `#[serde(deny_unknown_fields)]` (`qontinui-coord/crates/coord/src/pr_merge/
 * settings_wire.rs`), so posting a field coord does not know **400s the entire
 * save** — every other field on the card with it, not just this dial. The
 * `line_budget_override` note in `RepoOverrideCard.handleSave` is the same trap,
 * already paid for once.
 *
 * The probe is the field's PRESENCE in the profile coord serves back, because a
 * coord build that serves it is by construction one that accepts it: the two
 * halves live in the same struct pair, and the sibling dial `auto_fix_red_main`
 * shipped them together. Until such a build is deployed the controls render
 * disabled and say why, and the moment one is, they go live with no further
 * change here.
 */
export function ffLandHeadSyncSupported(
  profile: EffectiveProfile | null
): boolean {
  return typeof profile?.ff_land_head_sync_enabled === "boolean";
}

export function overrideFieldsFrom(raw: RawRepoOverride): RepoOverrideFields {
  return {
    confidence_threshold_override:
      raw.confidence_threshold_override === null
        ? ""
        : // Round away f64 widening of an f32 column (0.8999999761581726 → "0.9").
          String(Number(raw.confidence_threshold_override.toPrecision(6))),
    auto_merge_label_budget:
      raw.auto_merge_label_budget === null
        ? ""
        : String(raw.auto_merge_label_budget),
    // `null` and `[]` both render blank: both mean "no extra paths" (the list
    // is UNIONed with the tenant's). The column is NOT NULL, so the paired
    // coord change reports its stored `'{}'` as `null`; an older shape may
    // send `[]`. A blank save writes `[]` back — see handleSave.
    escalate_paths_extra: (raw.escalate_paths_extra ?? []).join("\n"),
    auto_fix_red_main: pinChoice(raw.auto_fix_red_main),
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

export function parseIntOrThrow(field: string, raw: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${field}: not a valid integer`);
  return n;
}

export function parseFloatOrThrow(field: string, raw: string): number {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) throw new Error(`${field}: not a valid number`);
  return n;
}

// ----------------------------------------------------------------------------
// Phase 9 D9.6 — SLO Dashboard
// ----------------------------------------------------------------------------

/// Color a metric based on threshold bands (green=good, yellow=warn,
/// red=alarm). The plan's §8 success metrics drive the thresholds.
export function ratingColor(
  value: number | null,
  goodAtOrAbove: number,
  warnAtOrAbove: number
): string {
  if (value == null) return "text-muted-foreground";
  if (value >= goodAtOrAbove) return "text-green-400";
  if (value >= warnAtOrAbove) return "text-amber-300";
  return "text-red-300";
}

/// Inverse coloring — lower is better (override rate, escalation rate).
export function ratingColorInverse(
  value: number | null,
  goodAtOrBelow: number,
  warnAtOrBelow: number
): string {
  if (value == null) return "text-muted-foreground";
  if (value <= goodAtOrBelow) return "text-green-400";
  if (value <= warnAtOrBelow) return "text-amber-300";
  return "text-red-300";
}

export function fmtRate(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function fmtSecs(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}s`;
}

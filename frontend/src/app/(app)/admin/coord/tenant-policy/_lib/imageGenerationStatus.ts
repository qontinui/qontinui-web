/**
 * Image generation on the tenant-policy page — every PURE derivation the panel
 * renders from (R8: the derivation lives here, not in JSX), and the palette
 * its per-repo override rows are painted with.
 *
 * Plan `2026-10-13-image-generation-and-visual-judgment` Phase 12 step 2. The
 * setting is the fleet-policy domain `image_generation`: a tenant level
 * (`on` | `local_only` | `off`) plus per-repo overrides (the same three, or
 * `inherit` to clear one). One read serves both halves — the tenant-wide
 * `GET /api/v1/operations/fleet-policy?domain=image_generation`, whose
 * `repo_overrides` lists every repo carrying its own row — and every write is
 * `PUT /api/v1/operations/fleet-policy`.
 *
 * The rules this module holds:
 *
 * - **No row reads `on` only when coord SAYS so.** coord declares `on` as this
 *   domain's no-row default, so an answer with `resolved_scope: "none"` and
 *   level `on` is that default — named as a default, not as a decision. A
 *   no-row answer with ANY other level is UNKNOWN: it is what a coord that
 *   predates the domain serves (its generic no-row `off`), and what the
 *   backend floors a coord answer that carried no level to. Showing `on` there
 *   would claim studio may generate when the coord it reads says otherwise;
 *   showing `off` would claim somebody turned it off.
 * - **An unrecognised level is UNKNOWN**, named, and never mapped onto a
 *   button.
 * - **An absent `repo_overrides` is UNKNOWN**, never "no overrides" — an
 *   override that is in force but not shown is the surprise the list exists to
 *   prevent.
 * - **A level in effect is calm** (style guide §3.4): `off` and `local_only`
 *   are settings somebody chose, reflected back, not alarms. Only UNKNOWN is
 *   amber.
 */

import {
  INERT,
  UNKNOWN_AMBER,
  type AttentionMap,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";
import {
  IMAGE_GENERATION_DEFAULT_LEVEL,
  parseImageGenerationLevel,
  type ImageGenerationLevel,
  type ImageGenerationRepoChoice,
} from "../types";

/** The dash an unknown value renders as — never a guessed level. */
export const UNKNOWN_DASH = "–";

/** Operator words for a KNOWN level. */
export const IMAGE_GENERATION_LEVEL_LABEL: Record<
  ImageGenerationLevel,
  string
> = {
  on: "On",
  local_only: "Local only",
  off: "Off",
};

/** Operator words for what a repo-override control writes. */
export const IMAGE_GENERATION_REPO_CHOICE_LABEL: Record<
  ImageGenerationRepoChoice,
  string
> = {
  inherit: "Inherit",
  ...IMAGE_GENERATION_LEVEL_LABEL,
};

/** What an override row's badge shows. */
export type ImageGenerationKind = ImageGenerationLevel | "unknown";

/**
 * Who must act on an override row.
 *
 * - `on` / `local_only` / `off` — nobody. Each is a setting somebody wrote,
 *   reflected back; nothing is waiting on anyone.
 * - `unknown` — WAITING, the ignorance floor (R3): coord serves a level this
 *   console does not know, or the row's read-back failed, so whose move it is
 *   cannot be told.
 */
export const IMAGE_GENERATION_ATTENTION_BY_KIND = {
  on: "none",
  local_only: "none",
  off: "none",
  unknown: "waiting",
} satisfies AttentionMap<ImageGenerationKind>;

export const IMAGE_GENERATION_BADGE_CLASS: Record<ImageGenerationKind, string> =
  {
    on: INERT,
    local_only: INERT,
    off: INERT,
    unknown: UNKNOWN_AMBER,
  };

export const IMAGE_GENERATION_AUTHOR_GLYPH_KINDS: ReadonlySet<ImageGenerationKind> =
  new Set<ImageGenerationKind>();

export const IMAGE_GENERATION_PALETTE: StatusPalette<ImageGenerationKind> = {
  badgeClass: IMAGE_GENERATION_BADGE_CLASS,
  authorGlyphKinds: IMAGE_GENERATION_AUTHOR_GLYPH_KINDS,
};

// ───────────────────────────────── the tenant row ─────────────────────────────────

/** What the tenant-wide read says image generation resolves to. */
export type TenantImageGeneration =
  /** A level in force. `defaulted`: no row answered — coord's declared default. */
  | { state: "known"; level: ImageGenerationLevel; defaulted: boolean }
  /** A row answered with a level that is none of the three. */
  | { state: "unrecognised"; raw: string }
  /**
   * No row answered, and the level is not this domain's declared default — a
   * coord predating the domain, or an answer with no level at all.
   */
  | { state: "no_declared_default"; raw: string };

export function readTenantImageGeneration(
  policy: FleetPolicyView
): TenantImageGeneration {
  const level = parseImageGenerationLevel(policy.effective_level);
  if (policy.resolved_scope.trim() === "none") {
    return level === IMAGE_GENERATION_DEFAULT_LEVEL
      ? { state: "known", level, defaulted: true }
      : { state: "no_declared_default", raw: policy.effective_level };
  }
  return level === null
    ? { state: "unrecognised", raw: policy.effective_level }
    : { state: "known", level, defaulted: false };
}

/** The level in force, or `null` when it is UNKNOWN for any reason. */
export function knownLevel(
  reading: TenantImageGeneration | null
): ImageGenerationLevel | null {
  return reading?.state === "known" ? reading.level : null;
}

// ──────────────────────────────── the repo overrides ────────────────────────────────

/** One repo that carries its own row. */
export interface ImageGenerationOverride {
  /** `owner/name`, as coord stored it (lower case for this domain). */
  repo: string;
  /** What a reader of this repo resolves, or `null` when it is none of the three. */
  level: ImageGenerationLevel | null;
  /** coord's resolved level, verbatim — named on screen when `level` is null. */
  raw: string;
}

/**
 * The repos carrying an override, or `null` — UNKNOWN — when the read carried
 * no list (a coord that predates `repo_overrides`, or one the backend could
 * not read whole) or there is no read at all.
 */
export function readRepoOverrides(
  policy: FleetPolicyView | null
): ImageGenerationOverride[] | null {
  const list = policy?.repo_overrides;
  if (!Array.isArray(list)) return null;
  return list.map((o) => ({
    repo: o.repo,
    level: parseImageGenerationLevel(o.effective_level),
    raw: o.effective_level,
  }));
}

/** Whether `repo` already carries an override, compared as coord compares it. */
export function findOverride(
  overrides: readonly ImageGenerationOverride[] | null,
  repo: string
): ImageGenerationOverride | null {
  const want = repo.trim().toLowerCase();
  return overrides?.find((o) => o.repo.toLowerCase() === want) ?? null;
}

/**
 * The row status for one override.
 *
 * `stale` — the latest read FAILED and this row comes from an earlier one: the
 * value is kept (it is still the best evidence), the reason says it may be
 * old, and the row's accent is raised to `waiting` while the badge keeps its
 * value's own calm hue — a retained value may not look like a re-confirmed one
 * (R6). `readbackError` — this repo's last write landed but reading it back
 * failed, so what it resolves now is UNKNOWN.
 */
export function overrideStatus(
  override: ImageGenerationOverride,
  opts: {
    tenant: TenantImageGeneration | null;
    stale?: boolean;
    readbackError?: string | null;
  }
): RowStatus<ImageGenerationKind> {
  if (opts.readbackError) {
    return {
      kind: "unknown",
      label: UNKNOWN_DASH,
      reason: `written, but reading it back failed (${opts.readbackError}) — refresh to re-check`,
      attention: IMAGE_GENERATION_ATTENTION_BY_KIND.unknown,
    };
  }
  const staleNote = opts.stale
    ? " · the last refresh failed, so this may be stale"
    : "";
  if (override.level === null) {
    return {
      kind: "unknown",
      label: UNKNOWN_DASH,
      reason: `coord serves "${override.raw}", which is not a level this console knows${staleNote}`,
      attention: IMAGE_GENERATION_ATTENTION_BY_KIND.unknown,
    };
  }
  const tenant = knownLevel(opts.tenant);
  return {
    kind: override.level,
    label: IMAGE_GENERATION_LEVEL_LABEL[override.level],
    reason:
      (tenant === null
        ? "overrides the tenant setting"
        : `overrides the tenant setting (${IMAGE_GENERATION_LEVEL_LABEL[tenant]})`) +
      staleNote,
    attention: opts.stale
      ? "waiting"
      : IMAGE_GENERATION_ATTENTION_BY_KIND[override.level],
  };
}

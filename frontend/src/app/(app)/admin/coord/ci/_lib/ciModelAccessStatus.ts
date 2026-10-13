/**
 * Model access for CI steps on the Dev Ops ▸ CI page — every PURE derivation
 * the panel renders from (style guide R8: the derivation lives here, not in
 * JSX).
 *
 * Plan `2026-10-13-ci-node-runs-model-dependent-eval-steps` D6 / D12, Phase 4.
 * The setting is coord's fleet-policy domain `ci_model_access`: a tenant band
 * (`on` | `off`) plus per-repo overrides (`on` | `off`, or `inherit` to clear
 * one). The no-row default is `on`. Coord reads it per dispatch and, when it
 * resolves `off`, withholds model access with one of D12's refusal words —
 * `preference_off_repo` when the repo's own override decided it,
 * `preference_off_tenant` otherwise, `preference_unknown` when coord could not
 * read it at all. The steps still run; their rows read UNKNOWN.
 *
 * Reads are the generic fleet-policy read (`GET /operations/fleet-policy`,
 * with `?repo=` per repo); writes are the generic fleet-policy PUT. The rules
 * this module holds:
 *
 * - **An unreadable value is UNKNOWN, never `on`.** `level: null` renders `–`
 *   in amber with the reason.
 * - **`off` with no row behind it is not a reading.** The domain's default is
 *   `on`, so a resolve that found no row (`resolved_scope: "none"`) and still
 *   says `off` is a coord that does not know this domain yet (it answers the
 *   generic off-by-default) or a coord answer missing its level, which the web
 *   proxy floors to `off`. Either way nothing chose `off`, so it is UNKNOWN.
 * - **`off` is a setting in effect, not an alarm** (style guide §3.4). Both
 *   levels are calm; only UNKNOWN is amber.
 */

import {
  INERT,
  UNKNOWN_AMBER,
  type AttentionMap,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";

/** The fleet-policy domain coord stores this setting under. */
export const CI_MODEL_ACCESS_DOMAIN = "ci_model_access";

export type ModelAccessLevel = "on" | "off";
export const MODEL_ACCESS_LEVELS: readonly ModelAccessLevel[] = ["on", "off"];

/** The repo-band control. `inherit` clears the repo's override. */
export type ModelAccessRepoChoice = "inherit" | ModelAccessLevel;
export const MODEL_ACCESS_REPO_CHOICES: readonly ModelAccessRepoChoice[] = [
  "inherit",
  "on",
  "off",
];

export const MODEL_ACCESS_REPO_CHOICE_LABEL: Record<
  ModelAccessRepoChoice,
  string
> = {
  inherit: "Inherit",
  on: "On",
  off: "Off",
};

/** One resolved reading. `level === null` ⇒ UNKNOWN, with `unknown_reason`. */
export interface ModelAccessReading {
  level: ModelAccessLevel | null;
  /** `"repo" | "tenant" | "system" | "none"`, or `null` when not read. */
  resolved_scope: string | null;
  unknown_reason: string | null;
}

export interface ModelAccessRepoReading extends ModelAccessReading {
  /** `owner/name` — the repo-band `scope_key` spelling. */
  repo: string;
}

/** The reason recorded when coord resolved `off` with no row behind it. */
export const OFF_WITHOUT_ROW = "off_without_a_row";

/**
 * Turn one fleet-policy read into a reading. A level outside the domain's
 * vocabulary, and an `off` no row decided, are UNKNOWN (module doc).
 */
export function readingFromPolicy(view: FleetPolicyView): ModelAccessReading {
  const scope = view.resolved_scope;
  const level = view.effective_level;
  if (level !== "on" && level !== "off") {
    return {
      level: null,
      resolved_scope: scope,
      unknown_reason: `unrecognised_level:${level}`,
    };
  }
  if (level === "off" && scope === "none") {
    return {
      level: null,
      resolved_scope: scope,
      unknown_reason: OFF_WITHOUT_ROW,
    };
  }
  return { level, resolved_scope: scope, unknown_reason: null };
}

/** A reading for a read that did not land. */
export function unreadReading(reason: string): ModelAccessReading {
  return { level: null, resolved_scope: null, unknown_reason: reason };
}

/**
 * The D12 refusal word coord's grant carries for a dispatch resolving this
 * reading, or `null` when the preference does not refuse it (the grant then
 * depends on trust and the rate cap, not on this dial).
 */
export function refusalFor(reading: ModelAccessReading): string | null {
  if (reading.level === null) return "preference_unknown";
  if (reading.level === "on") return null;
  return reading.resolved_scope === "repo"
    ? "preference_off_repo"
    : "preference_off_tenant";
}

export type ModelAccessKind = "on" | "off" | "unknown";

/**
 * Who must act on a reading. `on` / `off` — none: a setting somebody chose (or
 * the default), reflected back. `unknown` — WAITING, the ignorance floor (R3).
 */
export const MODEL_ACCESS_ATTENTION_BY_KIND = {
  on: "none",
  off: "none",
  unknown: "waiting",
} satisfies AttentionMap<ModelAccessKind>;

export const MODEL_ACCESS_BADGE_CLASS: Record<ModelAccessKind, string> = {
  on: INERT,
  off: INERT,
  unknown: UNKNOWN_AMBER,
};

export const MODEL_ACCESS_AUTHOR_GLYPH_KINDS: ReadonlySet<ModelAccessKind> =
  new Set<ModelAccessKind>();

export const MODEL_ACCESS_PALETTE: StatusPalette<ModelAccessKind> = {
  badgeClass: MODEL_ACCESS_BADGE_CLASS,
  authorGlyphKinds: MODEL_ACCESS_AUTHOR_GLYPH_KINDS,
};

/** The dash an unknown value renders as — never a guessed `on`. */
export const MODEL_ACCESS_UNKNOWN_DASH = "–";

export function modelAccessLevelLabel(level: ModelAccessLevel): string {
  return level === "on" ? "On" : "Off";
}

export function modelAccessKind(reading: ModelAccessReading): ModelAccessKind {
  return reading.level ?? "unknown";
}

/** Operator words for an `unknown_reason`. The wire string stays in a title. */
export function modelAccessUnknownText(reason: string | null): string {
  if (reason === OFF_WITHOUT_ROW) {
    return "coord answered off with no setting behind it, but this setting defaults to on — this coord build may not know it yet";
  }
  if (reason === null || reason === "") return "coord could not read it";
  return `coord could not read it (${reason})`;
}

/**
 * Where a value comes from, in operator words. `none` means no row at any
 * band, so the domain default (`on`) applies — said in so many words, so "on
 * because nobody chose" is distinguishable from "on because somebody did".
 */
export function modelAccessSourceLabel(scope: string | null): string {
  switch (scope) {
    case "repo":
      return "repo override";
    case "tenant":
      return "tenant setting";
    case "system":
      return "fleet default";
    case "none":
      return "default (on)";
    case null:
      return MODEL_ACCESS_UNKNOWN_DASH;
    default:
      return scope;
  }
}

/** What off does, in operator words — shared by the panel copy and the rows. */
export const OFF_EFFECT_TEXT =
  "its steps still run, without model access, and their result rows read UNKNOWN";

/**
 * The row status for one repo. `stale` — the latest read failed and this is
 * an earlier read's value: kept, but the row is raised to `waiting` (R6).
 */
export function modelAccessRepoStatus(
  reading: ModelAccessRepoReading,
  opts: { stale?: boolean; readbackError?: string | null } = {}
): RowStatus<ModelAccessKind> {
  if (opts.readbackError) {
    return {
      kind: "unknown",
      label: MODEL_ACCESS_UNKNOWN_DASH,
      reason: `written, but reading it back failed (${opts.readbackError}) — refresh to re-check`,
      attention: MODEL_ACCESS_ATTENTION_BY_KIND.unknown,
    };
  }
  const kind = modelAccessKind(reading);
  const staleNote = opts.stale
    ? " · last refresh failed, this value may be stale"
    : "";
  if (kind === "unknown") {
    return {
      kind,
      label: MODEL_ACCESS_UNKNOWN_DASH,
      reason: modelAccessUnknownText(reading.unknown_reason) + staleNote,
      attention: MODEL_ACCESS_ATTENTION_BY_KIND.unknown,
    };
  }
  return {
    kind,
    label: modelAccessLevelLabel(kind),
    reason: `from ${modelAccessSourceLabel(reading.resolved_scope)}${staleNote}`,
    attention: opts.stale ? "waiting" : MODEL_ACCESS_ATTENTION_BY_KIND[kind],
  };
}

/**
 * Which repo-band choice is in force, or `null` when it cannot be told. A
 * value from the `repo` band is an override; any other band inherits.
 */
export function currentModelAccessChoice(
  reading: ModelAccessReading
): ModelAccessRepoChoice | null {
  if (reading.level === null) return null;
  return reading.resolved_scope === "repo" ? reading.level : "inherit";
}

export interface ModelAccessSummary {
  on: number;
  off: number;
  unknown: number;
}

export function summarizeModelAccess(
  repos: readonly ModelAccessRepoReading[]
): ModelAccessSummary {
  const s: ModelAccessSummary = { on: 0, off: 0, unknown: 0 };
  for (const r of repos) s[modelAccessKind(r)] += 1;
  return s;
}

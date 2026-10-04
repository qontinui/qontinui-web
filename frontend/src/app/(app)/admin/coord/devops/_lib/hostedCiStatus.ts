/**
 * GitHub-hosted CI on the Dev Ops page — the wire shapes coord's hosted-CI read
 * serves, and every PURE derivation the panel renders from (R8: no internal
 * vocabulary on a primary surface, and the derivation lives here, not in JSX).
 *
 * Plan `2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting` Phase 3
 * (D7). The setting is the fleet-policy domain `github_hosted_ci`: a tenant
 * default (`on` | `off`) plus per-repo overrides (`on` | `off`, or `inherit`
 * to clear one). The read is `GET /api/v1/operations/ci-hosting` (a proxy of
 * coord's `GET /coord/ci-hosting/effective`); writes reuse
 * `PUT /api/v1/operations/fleet-policy`.
 *
 * The rules this module holds:
 *
 * - **`level: null` is UNKNOWN and renders `–` in amber, never a guessed
 *   value.** Coord's typed read never collapses an unhappy path to a level,
 *   because this domain has two opposite "safe" sides (`off` is safe for
 *   spend; `on` is safe for a tenant with no self-hosted runners) — plan D5.
 * - **`owners_disagree` is its own kind.** A repo owned by several tenants
 *   resolves Unknown when their settings differ; the operator is told which
 *   unknown it is, in amber.
 * - **`off` is a setting in effect, not an alarm** (style guide §3.4: a
 *   deliberate operator setting reflected back never moves the level). Both
 *   `on` and `off` are calm.
 */

import {
  INERT,
  UNKNOWN_AMBER,
  type AttentionMap,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";

/** The fleet-policy domain coord stores this setting under. */
export const GITHUB_HOSTED_CI_DOMAIN = "github_hosted_ci";

/** The web proxy of coord's hosted-CI read. */
export const CI_HOSTING_API = "/api/v1/operations/ci-hosting";

export type HostedCiLevel = "on" | "off";
export const HOSTED_CI_LEVELS: readonly HostedCiLevel[] = ["on", "off"];

/** The repo-band control. `inherit` clears the repo's override (plan D4). */
export type RepoOverrideChoice = "inherit" | HostedCiLevel;
export const REPO_OVERRIDE_CHOICES: readonly RepoOverrideChoice[] = [
  "inherit",
  "on",
  "off",
];

/** One resolved reading. `level === null` ⇒ UNKNOWN, with `unknown_reason`. */
export interface CiHostingReading {
  level: HostedCiLevel | null;
  /** `"none" | "repo" | "tenant" | "system"` — the band that answered. */
  resolved_scope: string;
  unknown_reason: string | null;
}

export interface CiHostingRepoReading extends CiHostingReading {
  /** `owner/name` — the repo-band `scope_key` spelling. */
  repo: string;
}

export interface CiHostingView {
  domain: string;
  tenant_default: CiHostingReading;
  repos: CiHostingRepoReading[];
  /** Same effective-tenant rule as the fleet-policy read's `can_edit`. */
  can_edit: boolean;
}

/** The reason coord gives when a multi-owner repo's tenants disagree. */
export const OWNERS_DISAGREE = "owners_disagree";

export type HostedCiKind = "on" | "off" | "owners_disagree" | "unknown";

/**
 * Who must act on a hosted-CI reading.
 *
 * - `on` / `off` — none. Either is a setting somebody chose (or the default),
 *   reflected back; nothing is waiting on anyone.
 * - `owners_disagree` — WAITING. The repo is shared by tenants whose settings
 *   differ, so what coord does with it is not one answer.
 * - `unknown` — WAITING, the ignorance floor (R3): the read failed, or coord
 *   does not serve it, so whose move it is cannot be told.
 */
export const HOSTED_CI_ATTENTION_BY_KIND = {
  on: "none",
  off: "none",
  owners_disagree: "waiting",
  unknown: "waiting",
} satisfies AttentionMap<HostedCiKind>;

export const HOSTED_CI_BADGE_CLASS: Record<HostedCiKind, string> = {
  on: INERT,
  off: INERT,
  owners_disagree: UNKNOWN_AMBER,
  unknown: UNKNOWN_AMBER,
};

export const HOSTED_CI_AUTHOR_GLYPH_KINDS: ReadonlySet<HostedCiKind> =
  new Set<HostedCiKind>();

export const HOSTED_CI_PALETTE: StatusPalette<HostedCiKind> = {
  badgeClass: HOSTED_CI_BADGE_CLASS,
  authorGlyphKinds: HOSTED_CI_AUTHOR_GLYPH_KINDS,
};

/** The dash an unknown value renders as — never a guessed `on`. */
export const UNKNOWN_DASH = "–";

/** Operator words for a level. */
export function levelLabel(level: HostedCiLevel | null): string {
  if (level === "on") return "On";
  if (level === "off") return "Off";
  return UNKNOWN_DASH;
}

/** Operator words for an `unknown_reason`. The wire string stays in a title. */
export function unknownReasonText(reason: string | null): string {
  if (reason === OWNERS_DISAGREE) {
    return "this repo belongs to more than one tenant, and their settings disagree";
  }
  if (reason === null || reason === "") return "coord could not read it";
  return `coord could not read it (${reason})`;
}

/**
 * Where a REPO's effective value comes from, in operator words.
 *
 * `repo` — the repo's own override. `tenant` — the tenant's setting applies.
 * `system` / `none` — no tenant or repo row, so the fleet default applies.
 */
export function repoSourceLabel(scope: string): string {
  switch (scope) {
    case "repo":
      return "repo override";
    case "tenant":
      return "tenant";
    case "system":
      return "fleet default";
    case "none":
      return "default";
    default:
      return scope;
  }
}

/**
 * Where the TENANT's value comes from. `none` means nobody ever wrote a row,
 * and the domain default is `on` — said in so many words, so "on because
 * nobody chose" is distinguishable from "on because somebody chose it".
 */
export function tenantSourceLabel(scope: string | null): string {
  switch (scope) {
    case "none":
      return "default (on)";
    case "tenant":
      return "tenant setting";
    case "system":
      return "fleet default";
    case "repo":
      return "repo override";
    case null:
      return UNKNOWN_DASH;
    default:
      return scope;
  }
}

/** Narrow a fleet-policy `effective_level` string to a level, or UNKNOWN. */
export function asHostedCiLevel(
  level: string | null | undefined
): HostedCiLevel | null {
  return level === "on" || level === "off" ? level : null;
}

/** The kind of one reading. */
export function hostedCiKind(reading: CiHostingReading): HostedCiKind {
  if (reading.level === "on" || reading.level === "off") return reading.level;
  if (reading.unknown_reason === OWNERS_DISAGREE) return "owners_disagree";
  return "unknown";
}

/**
 * The row status for one repo.
 *
 * `stale` is set when the latest read FAILED and this reading is the one an
 * earlier read delivered: the value is kept (it is still the best evidence)
 * but the badge says it is old, and a stale row is at least amber — a retained
 * value may not look like a re-confirmed one (R6).
 */
export function repoStatus(
  reading: CiHostingRepoReading,
  opts: { stale?: boolean; readbackError?: string | null } = {}
): RowStatus<HostedCiKind> {
  if (opts.readbackError) {
    // The write landed, but what coord resolves for this repo now is not
    // known. Never paint the written value as though it were resolved.
    return {
      kind: "unknown",
      label: UNKNOWN_DASH,
      reason: `written, but reading it back failed (${opts.readbackError}) — refresh to re-check`,
      attention: HOSTED_CI_ATTENTION_BY_KIND.unknown,
    };
  }
  const kind = hostedCiKind(reading);
  const stale = opts.stale === true;
  const staleNote = stale
    ? " · last refresh failed, this value may be stale"
    : "";
  if (kind === "on" || kind === "off") {
    return {
      kind,
      label: levelLabel(reading.level),
      reason: `from ${repoSourceLabel(reading.resolved_scope)}${staleNote}`,
      attention: stale ? "waiting" : HOSTED_CI_ATTENTION_BY_KIND[kind],
    };
  }
  if (kind === "owners_disagree") {
    return {
      kind,
      label: "owners disagree",
      reason: unknownReasonText(reading.unknown_reason) + staleNote,
      attention: HOSTED_CI_ATTENTION_BY_KIND.owners_disagree,
    };
  }
  return {
    kind,
    label: UNKNOWN_DASH,
    reason: unknownReasonText(reading.unknown_reason) + staleNote,
    attention: HOSTED_CI_ATTENTION_BY_KIND.unknown,
  };
}

/**
 * Which repo-band choice is currently in force, or `null` when it cannot be
 * told. A repo whose value resolves from the `repo` band has an override; any
 * other band means it inherits. An UNKNOWN reading highlights nothing.
 */
export function currentRepoChoice(
  reading: CiHostingRepoReading
): RepoOverrideChoice | null {
  if (reading.level === null) return null;
  return reading.resolved_scope === "repo" ? reading.level : "inherit";
}

/** Plain words for what the repo-band control writes. */
export const REPO_CHOICE_LABEL: Record<RepoOverrideChoice, string> = {
  inherit: "Inherit",
  on: "On",
  off: "Off",
};

/** Counts for the collapsed panel header (R7: the signal stays visible). */
export interface HostedCiSummary {
  on: number;
  off: number;
  unknown: number;
}

export function summarizeRepos(
  repos: readonly CiHostingRepoReading[]
): HostedCiSummary {
  const s: HostedCiSummary = { on: 0, off: 0, unknown: 0 };
  for (const r of repos) {
    if (r.level === "on") s.on += 1;
    else if (r.level === "off") s.off += 1;
    else s.unknown += 1;
  }
  return s;
}

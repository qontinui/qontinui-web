/**
 * GitHub-hosted CI on the Dev Ops ▸ CI page — the wire shapes coord's hosted-CI read
 * serves, and every PURE derivation the panel renders from (R8: no internal
 * vocabulary on a primary surface, and the derivation lives here, not in JSX).
 *
 * Plan `2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting` Phase 3
 * (D7). The setting is the fleet-policy domain `github_hosted_ci`: a tenant
 * default (`on` | `off`) plus per-repo overrides (`on` | `off`, or `inherit`
 * to clear one). The read is `GET /api/v1/operations/ci-hosting` (a proxy of
 * coord's `GET /coord/ci-hosting/effective`, read by `fetchCiHosting` in
 * `lib/api/operations/ciStatus.ts`); writes reuse
 * `PUT /api/v1/operations/fleet-policy`.
 *
 * The rules this module holds:
 *
 * - **`level: null` is UNKNOWN and renders `–` in amber, never a guessed
 *   value.** Coord's typed read never collapses an unhappy path to a level,
 *   because this domain has two opposite "safe" sides (`off` is safe for
 *   spend; `on` is safe for a tenant with no self-hosted runners) — plan D5.
 * - **Only this tenant's own preference is shown.** Coord scopes the read to
 *   the caller's tenant and never exposes another tenant's setting for a
 *   shared repo, so there is no "owners disagree" state here; a repo the
 *   tenant does not own is UNKNOWN (`repo_not_in_tenant`), not a value.
 * - **`not watched`** (amber) marks an `off` repo coord's hosted-job detector
 *   does not poll (`watched: false`), so the panel never implies detection
 *   coverage coord does not have. An absent `watched` (older coord) adds
 *   nothing.
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
  /**
   * Whether coord's hosted-job detector polls this repo. `false` on an `off`
   * repo renders `not watched`; absent / `null` (an older coord) says nothing.
   */
  watched?: boolean | null;
}

export interface CiHostingView {
  domain: string;
  tenant_default: CiHostingReading;
  repos: CiHostingRepoReading[];
  /** Same effective-tenant rule as the fleet-policy read's `can_edit`. */
  can_edit: boolean;
}

/** The reason given for a `?repo=` this tenant does not own. */
export const REPO_NOT_IN_TENANT = "repo_not_in_tenant";

export type HostedCiKind = "on" | "off" | "unknown";

/**
 * Who must act on a hosted-CI reading.
 *
 * - `on` / `off` — none. Either is a setting somebody chose (or the default),
 *   reflected back; nothing is waiting on anyone.
 * - `unknown` — WAITING, the ignorance floor (R3): the read failed, or coord
 *   does not serve it, so whose move it is cannot be told.
 */
export const HOSTED_CI_ATTENTION_BY_KIND = {
  on: "none",
  off: "none",
  unknown: "waiting",
} satisfies AttentionMap<HostedCiKind>;

export const HOSTED_CI_BADGE_CLASS: Record<HostedCiKind, string> = {
  on: INERT,
  off: INERT,
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

/** Operator words for a KNOWN level. An unknown one is `UNKNOWN_DASH`. */
export function levelLabel(level: HostedCiLevel): string {
  return level === "on" ? "On" : "Off";
}

/** Operator words for an `unknown_reason`. The wire string stays in a title. */
export function unknownReasonText(reason: string | null): string {
  if (reason === REPO_NOT_IN_TENANT) {
    return "this repo is not one of this tenant's repos";
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
  return "unknown";
}

/**
 * The row status for one repo.
 *
 * `stale` is set when the latest read FAILED and this reading is the one an
 * earlier read delivered: the value is kept (it is still the best evidence)
 * but the reason says it is old, and the ROW is raised to `waiting` (an amber
 * left-edge accent) while the badge keeps its value's own calm hue — a
 * retained value may not look like a re-confirmed one (R6).
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
    const unwatched = isNotWatched(reading);
    return {
      kind,
      label: levelLabel(kind),
      reason:
        `from ${repoSourceLabel(reading.resolved_scope)}` +
        (unwatched ? ` · ${NOT_WATCHED_REASON}` : "") +
        staleNote,
      // Off itself is calm; what is amber is a coverage gap (`not watched`)
      // or a value the latest read did not re-confirm.
      attention:
        stale || unwatched ? "waiting" : HOSTED_CI_ATTENTION_BY_KIND[kind],
    };
  }
  return {
    kind,
    label: UNKNOWN_DASH,
    reason: unknownReasonText(reading.unknown_reason) + staleNote,
    attention: HOSTED_CI_ATTENTION_BY_KIND.unknown,
  };
}

/** Why `not watched` is shown, in operator words. */
export const NOT_WATCHED_REASON =
  "not watched: coord's hosted-job check does not poll this repo, so a job aimed at a GitHub-hosted runner here would go unflagged";

/**
 * An `off` repo coord's hosted-job detector does not poll. Only an explicit
 * `watched: false` counts — absent or `null` is an older coord that does not
 * report coverage, and says nothing either way.
 */
export function isNotWatched(reading: CiHostingRepoReading): boolean {
  return reading.level === "off" && reading.watched === false;
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

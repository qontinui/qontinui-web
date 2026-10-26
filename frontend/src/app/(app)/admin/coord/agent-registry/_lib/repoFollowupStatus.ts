/**
 * Per-repo follow-up dials — the display vocabulary and every PURE derivation
 * the panel renders from (R8: no internal vocabulary on a primary surface;
 * the derivation lives here, not in JSX).
 *
 * Plan `2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind`
 * Phase 4b. Two per-repo coord settings, each proxied by
 * `backend/app/api/v1/endpoints/repo_followup_dials.py` and called through
 * `@/lib/api/operations/repoFollowupDials` (which owns the wire types):
 *
 * - **Post-merge follow-up scope** (`/post-merge-followup-scope`)
 *   — whether a merged PR in this repo spawns its follow-up session: every
 *   merge (`all`, the default), only merges touching the repo's code globs
 *   (`code_only`), or never (`none`). The read also carries the fleet
 *   ROLLOUT MODE: under `shadow` coord computes the verdict and suppresses
 *   nothing, so a scope set here does not yet stop any spawn. That has to be
 *   on screen beside the setting, or an operator who sets `none` believes
 *   follow-ups stopped when they did not.
 * - **Continuation-delivery mode** (`/continuation-delivery-mode`)
 *   — how work is delivered back to an author session.
 *
 * The rules this module holds:
 *
 * - **An unreadable scope is UNKNOWN (`–`, amber), never `all`.** Coord
 *   answers an unreadable preference with a 503 precisely so no surface
 *   renders the permissive default for it (served policy
 *   `production-and-cost` `agent-spawn-authorization`).
 * - **`resolved_scope: "default"` is said in words** — "every merge (default)"
 *   is a different fact from "every merge, because an operator chose it".
 * - **The delivery mode's provenance is read, never guessed.** Coord says
 *   whether a row declares the mode (`repo`), none does (`default`) or the
 *   stored value is not understood (`unrecognized`); a missing field is
 *   UNKNOWN and renders "not confirmed".
 * - **A configured scope is a setting in effect, not an alarm** (style guide
 *   §3.4). `none` is calm; only UNKNOWN is amber.
 */

import {
  INERT,
  UNKNOWN_AMBER,
  isNotFoundError,
  type AttentionMap,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";
import type {
  ContinuationDeliveryModeView,
  DeliveryMode,
  DeliveryResolvedScope,
  FollowupScope,
  PostMergeFollowupScopeView,
  RolloutMode,
} from "@/lib/api/operations/repoFollowupDials";

export const FOLLOWUP_SCOPES: readonly FollowupScope[] = [
  "all",
  "code_only",
  "none",
];

export const DELIVERY_MODES: readonly DeliveryMode[] = [
  "in_session_with_spawn_fallback",
  "spawn_always",
  "notify_only",
];

/** What a repo row shows for the scope. */
export type FollowupScopeKind = FollowupScope | "unknown";

/**
 * Who must act on a scope reading.
 *
 * - `all` / `code_only` / `none` — nobody. Each is a setting (or the
 *   default) reflected back.
 * - `unknown` — WAITING, the ignorance floor (R3): the read failed or coord
 *   could not read the preference, so whose move it is cannot be told.
 */
export const FOLLOWUP_SCOPE_ATTENTION_BY_KIND = {
  all: "none",
  code_only: "none",
  none: "none",
  unknown: "waiting",
} satisfies AttentionMap<FollowupScopeKind>;

export const FOLLOWUP_SCOPE_BADGE_CLASS: Record<FollowupScopeKind, string> = {
  all: INERT,
  code_only: INERT,
  none: INERT,
  unknown: UNKNOWN_AMBER,
};

export const FOLLOWUP_SCOPE_AUTHOR_GLYPH_KINDS: ReadonlySet<FollowupScopeKind> =
  new Set<FollowupScopeKind>();

export const FOLLOWUP_SCOPE_PALETTE: StatusPalette<FollowupScopeKind> = {
  badgeClass: FOLLOWUP_SCOPE_BADGE_CLASS,
  authorGlyphKinds: FOLLOWUP_SCOPE_AUTHOR_GLYPH_KINDS,
};

/** The dash an unknown value renders as — never a guessed `all`. */
export const UNKNOWN_DASH = "–";

/** Operator words for a scope. */
export const SCOPE_LABEL: Record<FollowupScope, string> = {
  all: "Every merge",
  code_only: "Code changes only",
  none: "Never",
};

/** One-line explanation of each scope, for the control. */
export const SCOPE_HELP: Record<FollowupScope, string> = {
  all: "every merged PR spawns its follow-up session",
  code_only:
    "a merged PR spawns only when it changes a path matching the globs below; a docs-only merge is skipped, and a merge whose file list cannot be read still spawns",
  none: "merged PRs in this repo never spawn a follow-up session",
};

/** Operator words for a delivery mode. */
export const DELIVERY_LABEL: Record<DeliveryMode, string> = {
  in_session_with_spawn_fallback: "In the author's session",
  spawn_always: "Always a new session",
  notify_only: "Notify only",
};

export const DELIVERY_HELP: Record<DeliveryMode, string> = {
  in_session_with_spawn_fallback:
    "delivered into the author's live session, or a new session when it has ended (the default)",
  spawn_always: "always delivered by spawning a new session",
  notify_only: "nothing is spawned or delivered; the author is only notified",
};

/**
 * The delivery mode as displayed, qualified by where coord says it came from.
 * An absent `resolvedScope` (UNKNOWN) is "not confirmed", never a plain setting.
 */
export function deliveryCurrentLabel(
  mode: DeliveryMode | null,
  resolvedScope: DeliveryResolvedScope | null
): string {
  if (mode === null) return UNKNOWN_DASH;
  switch (resolvedScope) {
    case "repo":
      return `${DELIVERY_LABEL[mode]} (set for this repo)`;
    case "default":
      return `${DELIVERY_LABEL[mode]} (default)`;
    case "unrecognized":
      return `${DELIVERY_LABEL[mode]} (stored value not understood)`;
    default:
      return `${DELIVERY_LABEL[mode]} (not confirmed)`;
  }
}

/**
 * The note under the delivery editor. Its claim depends on what coord said:
 * "an unreadable setting is an error, not a default" holds only for an answer
 * that carries a provenance, so the UNKNOWN arm says less.
 */
export function deliveryProvenanceNote(
  resolvedScope: DeliveryResolvedScope | null,
  storedValue: string | null
): string {
  switch (resolvedScope) {
    case "repo":
    case "default":
      return "Coord reports whether a row sets this repo's delivery mode or none does (default). An unreadable setting is an error, not a default.";
    case "unrecognized":
      return `This repo stores ${storedValue === null ? "a value" : `"${storedValue}"`}, which coord does not understand, so dispatch uses the default shown. Choose a mode to replace it.`;
    default:
      return "Coord did not say where this value came from, so it may be the default rather than a setting for this repo.";
  }
}

/** One repo's two dials as the hook holds them. */
export interface RepoDialReading {
  /** Last value a read delivered. With `scopeError` set it is STALE. */
  scope: PostMergeFollowupScopeView | null;
  /** The newest completed scope read failed (message as `httpClient` formats it). */
  scopeError: string | null;
  /** A scope write landed but its read-back failed: UNKNOWN whatever is retained. */
  scopeReadbackError: string | null;
  delivery: ContinuationDeliveryModeView | null;
  deliveryError: string | null;
  deliveryReadbackError: string | null;
}

export const EMPTY_READING: RepoDialReading = {
  scope: null,
  scopeError: null,
  scopeReadbackError: null,
  delivery: null,
  deliveryError: null,
  deliveryReadbackError: null,
};

/**
 * The scope a reading may be COUNTED as — the same unknown rule as
 * {@link scopeStatus}: a failed write read-back makes the retained value
 * unusable, whatever it says. A stale value (read error, retained) still
 * counts; callers that headline it must say it is stale.
 */
export function knownScope(
  reading: RepoDialReading | undefined
): PostMergeFollowupScopeView | null {
  if (!reading || reading.scopeReadbackError) return null;
  return reading.scope;
}

/** Why the fleet rollout mode cannot be stated. */
export type RolloutUnknownCause =
  | "loading"
  | "no_repos"
  | "all_failed"
  | "missing"
  | "disagree";

export interface FleetRollout {
  mode: RolloutMode | null;
  /** Set exactly when `mode` is `null`. */
  unknownCause: RolloutUnknownCause | null;
  /** The mode comes only from values whose latest refresh FAILED. */
  stale: boolean;
}

/**
 * The single rollout mode across the repos read. Coord's mode is a fleet
 * switch, so every successful read reports the same value; if they disagree
 * (a deploy landed between two reads), one carries no mode, or none was
 * read, it is UNKNOWN — with the cause, so the copy never claims a read
 * failed while it is merely in flight. When fresh values exist, only they are
 * used; when only stale ones do, the mode is theirs and `stale` says so.
 */
export function fleetRolloutMode(
  readings: ReadonlyArray<RepoDialReading | undefined>,
  opts: { loading?: boolean } = {}
): FleetRollout {
  const known = readings
    .map((r) => ({ view: knownScope(r), stale: Boolean(r?.scopeError) }))
    .filter(
      (k): k is { view: PostMergeFollowupScopeView; stale: boolean } =>
        k.view !== null
    );
  const fresh = known.filter((k) => !k.stale);
  const used = fresh.length > 0 ? fresh : known;
  if (used.length === 0) {
    const cause: RolloutUnknownCause = opts.loading
      ? "loading"
      : readings.length === 0
        ? "no_repos"
        : "all_failed";
    return { mode: null, unknownCause: cause, stale: false };
  }
  if (used.some(({ view }) => view.mode === null)) {
    return { mode: null, unknownCause: "missing", stale: false };
  }
  let seen: RolloutMode | null = null;
  for (const { view } of used) {
    if (seen !== null && seen !== view.mode) {
      return { mode: null, unknownCause: "disagree", stale: false };
    }
    seen = view.mode;
  }
  return { mode: seen, unknownCause: null, stale: fresh.length === 0 };
}

const ROLLOUT_UNKNOWN_DETAIL: Record<RolloutUnknownCause, string> = {
  loading: "Reading whether coord acts on these scopes…",
  no_repos:
    "Whether coord acts on these scopes is unknown — this tenant has no repos to read it through.",
  all_failed:
    "Whether coord acts on these scopes is unknown — no repo's scope could be read. Do not assume a scope set here stops anything.",
  missing:
    "Whether coord acts on these scopes is unknown — coord answered without saying which rollout mode is in force. Do not assume a scope set here stops anything.",
  disagree:
    "Whether coord acts on these scopes is unknown — the reads did not report one consistent mode (coord may have just been redeployed). Refresh to re-check, and do not assume a scope set here stops anything.",
};

/**
 * The rollout mode, as a headline the operator cannot misread. UNKNOWN says
 * why; a mode carried only by stale values says it is from the last good read.
 */
export function rolloutHeadline(rollout: FleetRollout): {
  label: string;
  detail: string;
  /** Unknown or stale: rendered in the amber ignorance family. */
  amber: boolean;
} {
  const staleNote = rollout.stale
    ? " (as of the last good read — the latest refresh failed)"
    : "";
  switch (rollout.mode) {
    case "shadow":
      return {
        label: `Shadow${rollout.stale ? " (stale)" : ""}`,
        detail:
          "Coord is in shadow mode: it works out what each scope would skip and records it, but suppresses nothing — every merged PR still spawns its follow-up, whatever is set below" +
          staleNote +
          ".",
        amber: rollout.stale,
      };
    case "enforce":
      return {
        label: `Enforced${rollout.stale ? " (stale)" : ""}`,
        detail:
          "Coord enforces these scopes: a merged PR that a repo's scope excludes does not spawn a follow-up session" +
          staleNote +
          ".",
        amber: rollout.stale,
      };
    case "off":
      return {
        label: `Off${rollout.stale ? " (stale)" : ""}`,
        detail:
          "Coord's scope check is switched off: every merged PR spawns its follow-up, whatever is set below" +
          staleNote +
          ".",
        amber: rollout.stale,
      };
    default:
      return {
        label: UNKNOWN_DASH,
        detail: ROLLOUT_UNKNOWN_DETAIL[rollout.unknownCause ?? "all_failed"],
        amber: true,
      };
  }
}

/** Operator words for a read error's message. */
export function readErrorText(message: string): string {
  if (message.includes("preference_unreadable")) {
    return "coord could not read this repo's preference";
  }
  if (message.includes("column_not_present")) {
    return "coord's database does not have this setting yet (a migration is pending)";
  }
  if (isNotFoundError(message)) {
    return "this server does not offer this setting yet";
  }
  if (/\b(422|400)\b/.test(message) && message.includes("owner/name")) {
    return "this repo is not named owner/name, so coord cannot key a setting to it";
  }
  return `the read failed (${message})`;
}

/**
 * The row status for one repo's scope.
 *
 * `error` set with a retained `view` is STALE: the value is kept (it is the
 * best evidence) but labelled, and the row is raised to `waiting`. `error`
 * with no `view` is UNKNOWN. `readbackError` (a write that landed but whose
 * read-back failed) is UNKNOWN whatever was written.
 */
export function scopeStatus(
  view: PostMergeFollowupScopeView | null,
  opts: { error?: string | null; readbackError?: string | null } = {}
): RowStatus<FollowupScopeKind> {
  if (opts.readbackError) {
    return {
      kind: "unknown",
      label: UNKNOWN_DASH,
      reason: `written, but reading it back failed (${opts.readbackError}) — refresh to re-check`,
      attention: FOLLOWUP_SCOPE_ATTENTION_BY_KIND.unknown,
    };
  }
  if (view === null) {
    return {
      kind: "unknown",
      label: UNKNOWN_DASH,
      reason: opts.error ? readErrorText(opts.error) : "not read yet",
      attention: FOLLOWUP_SCOPE_ATTENTION_BY_KIND.unknown,
    };
  }
  const kind = view.scope;
  const source =
    view.resolved_scope === "default"
      ? "default — nobody has set this repo"
      : view.resolved_scope === "repo"
        ? "set for this repo"
        : "whether it was set is unknown";
  const paths =
    kind === "code_only" ? ` · ${view.code_paths.length} glob(s)` : "";
  const stale = opts.error
    ? ` · last refresh failed (${readErrorText(opts.error)}), this value may be stale`
    : "";
  return {
    kind,
    label:
      view.resolved_scope === "default"
        ? `${SCOPE_LABEL[kind]} (default)`
        : SCOPE_LABEL[kind],
    reason: `${source}${paths}${stale}`,
    attention: opts.error ? "waiting" : FOLLOWUP_SCOPE_ATTENTION_BY_KIND[kind],
  };
}

/** Counts for the collapsed panel header (R7: the signal stays visible). */
export interface ScopeSummary {
  all: number;
  code_only: number;
  none: number;
  unknown: number;
  /** Counted values whose latest refresh failed. */
  stale: number;
}

/** Same unknown rule as the rows: a failed read-back is unknown, not its old value. */
export function summarizeScopes(
  readings: ReadonlyArray<RepoDialReading | undefined>
): ScopeSummary {
  const s: ScopeSummary = {
    all: 0,
    code_only: 0,
    none: 0,
    unknown: 0,
    stale: 0,
  };
  for (const r of readings) {
    const v = knownScope(r);
    if (v === null) {
      s.unknown += 1;
      continue;
    }
    s[v.scope] += 1;
    if (r?.scopeError) s.stale += 1;
  }
  return s;
}

/** Parse the one-glob-per-line editor: trimmed, blank lines dropped. */
export function parseGlobLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/**
 * The PUT body for a scope save, preserving coord's `code_paths` semantics:
 * `code_only` always carries its globs; `all` / `none` carry them only when
 * the operator CHANGED them (an omitted list keeps the stored globs; `[]`
 * clears). Returns an error string instead when the save cannot be valid.
 */
export function buildScopeWrite(
  repo: string,
  scope: FollowupScope,
  draftPaths: readonly string[],
  storedPaths: readonly string[]
):
  | { body: { repo: string; scope: FollowupScope; code_paths?: string[] } }
  | { error: string } {
  if (scope === "code_only") {
    if (draftPaths.length === 0) {
      return {
        error:
          "Code changes only needs at least one glob naming the paths that carry a build or test check, e.g. scripts/**",
      };
    }
    return { body: { repo, scope, code_paths: [...draftPaths] } };
  }
  const changed =
    draftPaths.length !== storedPaths.length ||
    draftPaths.some((p, i) => p !== storedPaths[i]);
  return changed
    ? { body: { repo, scope, code_paths: [...draftPaths] } }
    : { body: { repo, scope } };
}

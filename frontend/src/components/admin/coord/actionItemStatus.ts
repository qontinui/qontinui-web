/**
 * Operator action items → envelope types, status derivation and palette.
 *
 * Plan `2026-10-12-operator-action-items-pushed-to-the-phone` Phase 3. An
 * action item is a to-do the OPERATOR owes — created by coord when a gate with
 * a `notify_operator` continuation clears, by a work unit's dispatch, or by an
 * agent — with an `open → done | dismissed` lifecycle and a push-delivery
 * state coord records on the row (plan D4). This module is the pure half of
 * `/admin/coord/action-items`, in the shape `memoryStatus.ts` carries: the wire
 * types, an audited kind→attention table with a palette keyed off it (asserted
 * by `actionItemStatus.test.ts` through the shared `paletteDisagreements`),
 * and the derivations the row and the health strip render.
 *
 * ## The kinds, and why each lands where it does (R3)
 *
 * - `open` — **`author`, red.** An open item is the OPERATOR's own move: it
 *   exists because something is owed by him, and nothing else will resolve it.
 *   That is R3's definition of red. The plan's Phase 3 text said "amber for
 *   open", but amber means *something else will clear this*, which is false
 *   for an owed to-do; this follows R3 instead (review decision on head
 *   `eb26420c8`). It is red whether or not the push landed.
 * - Push delivery is a SEPARATE signal, not a kind: an open item whose push
 *   `failed`, was `undeliverable`, or had `no_recipients` / `no_devices` is
 *   counted in the health strip's "not on phone" badge and explained in the
 *   row's detail. It does not change the row's colour — the row is already red.
 * - `done` / `dismissed` — **`none`, calm.** Resolved; nothing is owed.
 * - `unknown` — **`waiting`, the ignorance floor.** A status this build has no
 *   meaning for (R3's stated exception: amber also covers "we do not know").
 */

import type { Attention } from "@/components/console/attention";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  type RowStatus,
  type StatusPalette,
} from "@/components/console/statusRow";
import { httpBodyOf, httpStatusOf } from "./httpStatus";

// ---------------------------------------------------------------------------
// Wire types — coord's Item JSON, passed through `/operations/action-items`.
// ---------------------------------------------------------------------------

export type ActionItemStatusValue = "open" | "done" | "dismissed";
export type ActionItemResolution = "done" | "dismissed";

export type ActionItemPushState =
  | "pending"
  | "accepted"
  | "no_recipients"
  | "no_devices"
  | "failed"
  | "undeliverable";

export interface ActionItemLink {
  label: string;
  url: string;
}

export interface ActionItemPush {
  /** Coord's push state; typed `string` because coord may grow the set. */
  state: string;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  detail: Record<string, unknown>;
}

export interface CoordActionItem {
  item_id: string;
  title: string;
  body: string;
  links: ActionItemLink[];
  status: string;
  source_kind: string;
  source_ref: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  push: ActionItemPush;
  deep_link?: string;
}

/** Server-computed per-status totals over the whole tenant, not the page. */
export interface ActionItemCounts {
  open: number;
  done: number;
  dismissed: number;
}

export interface ActionItemsResponse {
  items: CoordActionItem[];
  next_cursor: string | null;
  counts: ActionItemCounts;
}

export interface ResolveActionItemResponse {
  item: CoordActionItem;
}

// ---------------------------------------------------------------------------
// Request options.
// ---------------------------------------------------------------------------

/**
 * For the resolve POST, behind a clicked button. `429` fails fast rather than
 * hanging the button through the retry chain; `503` is the migration-pending
 * window, whose answer will not change on a retry.
 */
export const ACTION_ITEM_RESOLVE_OPTIONS: { noRetryStatuses: number[] } = {
  noRetryStatuses: [429, 503],
};

/**
 * Coord's typed refusal code from a client-function rejection, or null.
 *
 * The `/operations/action-items*` proxies forward coord's error object
 * (`structured_errors=True`), so the web envelope carries it as the top-level
 * `error`. A body whose `message` / `detail` is itself coord's JSON text (a
 * proxy hop that stringified it) is read one level deeper. Parsed as DATA from
 * the anchored body — never a substring test, which would match the token
 * quoted inside some other failure.
 */
export function coordErrorCode(err: unknown): string | null {
  const body = httpBodyOf(err);
  if (body === null) return null;
  const parse = (text: unknown): Record<string, unknown> | null => {
    if (typeof text !== "string") return null;
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const top = parse(body);
  if (!top) return null;
  const codeOf = (o: Record<string, unknown> | null) =>
    o && typeof o.error === "string" ? o.error : null;
  const nested = codeOf(parse(top.message)) ?? codeOf(parse(top.detail));
  const direct = codeOf(top);
  // A generic status-derived code at the top (`SERVICE_UNAVAILABLE`) yields to
  // coord's own code carried inside it.
  return nested ?? direct;
}

/**
 * Coord answers `503 {"error":"schema_migration_pending"}` until the
 * `coord.operator_action_items` revision deploys. Only that code on a 503 is
 * "not available yet"; any other 503 (a deadline, a down backend) is a read
 * failure and must be loud.
 */
export function isMigrationPending(err: unknown): boolean {
  return (
    httpStatusOf(err) === 503 &&
    coordErrorCode(err) === "schema_migration_pending"
  );
}

/**
 * Coord's 409 `already_resolved`: the item was resolved first, with the other
 * status, by someone else (the phone, an agent). Both the status and coord's
 * code must agree — a 409 with any other code is an ordinary refusal.
 */
export function isAlreadyResolved(err: unknown): boolean {
  return (
    httpStatusOf(err) === 409 && coordErrorCode(err) === "already_resolved"
  );
}

/** What the row says after an `already_resolved` refusal and the re-read. */
export const ALREADY_RESOLVED_SENTENCE =
  "Already resolved elsewhere — refreshed to show its current state.";

// ---------------------------------------------------------------------------
// Status → attention → palette.
// ---------------------------------------------------------------------------

export type ActionItemKind = "open" | "done" | "dismissed" | "unknown";

/** Push states that mean the phone was NOT told about an open item. */
export const UNDELIVERED_PUSH_STATES: ReadonlySet<string> = new Set([
  "failed",
  "undeliverable",
  "no_recipients",
  "no_devices",
]);

export const ACTION_ITEM_ATTENTION_BY_KIND: Record<ActionItemKind, Attention> =
  {
    open: "author",
    done: "none",
    dismissed: "none",
    unknown: "waiting",
  };

export const ACTION_ITEM_BADGE_CLASS: Record<ActionItemKind, string> = {
  open: AUTHOR_RED,
  done: INERT,
  dismissed: INERT,
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ `✕`: derived from the table so it cannot drift from it. */
export const ACTION_ITEM_AUTHOR_GLYPH_KINDS: ReadonlySet<ActionItemKind> =
  new Set(
    (Object.keys(ACTION_ITEM_ATTENTION_BY_KIND) as ActionItemKind[]).filter(
      (k) => ACTION_ITEM_ATTENTION_BY_KIND[k] === "author"
    )
  );

export const ACTION_ITEM_STATUS_PALETTE: StatusPalette<ActionItemKind> = {
  badgeClass: ACTION_ITEM_BADGE_CLASS,
  authorGlyphKinds: ACTION_ITEM_AUTHOR_GLYPH_KINDS,
  doneGlyphKinds: new Set<ActionItemKind>(["done"]),
};

/** Plain-language push state, for the row reason and the detail panel. */
const PUSH_LABEL: Record<ActionItemPushState, string> = {
  pending: "push not sent yet",
  accepted: "pushed to your phone",
  no_recipients: "no operator with a linked account to push to",
  no_devices: "no phone registered for push",
  failed: "push failed",
  undeliverable: "push is not configured on coord",
};

/** What the operator can do about each undelivered state. */
const PUSH_REMEDY: Partial<Record<ActionItemPushState, string>> = {
  no_recipients:
    "No operator of this project has signed in to the web app with single sign-on, so there is nobody to send it to.",
  no_devices:
    "Sign in to the mobile app on your phone and allow notifications; then new items reach it.",
  failed:
    "Coord could not hand the push to the web backend. It retries with backoff until it gives up.",
  undeliverable:
    "Coord is missing the web push address or service secret, so it cannot send pushes at all.",
};

export function isPushUndelivered(
  item: Pick<CoordActionItem, "push">
): boolean {
  return UNDELIVERED_PUSH_STATES.has(item.push?.state ?? "");
}

export function pushLabel(state: string | null | undefined): string {
  if (!state) return "push state unknown";
  return (
    (PUSH_LABEL as Record<string, string>)[state] ??
    `push state "${state}" (not recognised by this build)`
  );
}

export function pushRemedy(state: string | null | undefined): string | null {
  if (!state) return null;
  return (PUSH_REMEDY as Record<string, string>)[state] ?? null;
}

/** The row status `/action-items` renders. */
export function deriveActionItemStatus(
  item: Pick<CoordActionItem, "status" | "push">
): RowStatus<ActionItemKind> {
  if (item.status === "open") {
    return {
      kind: "open",
      label: isPushUndelivered(item) ? "Owed — not on your phone" : "Owed",
      reason: pushLabel(item.push?.state),
      attention: ACTION_ITEM_ATTENTION_BY_KIND.open,
    };
  }
  if (item.status === "done") {
    return {
      kind: "done",
      label: "Done",
      attention: ACTION_ITEM_ATTENTION_BY_KIND.done,
    };
  }
  if (item.status === "dismissed") {
    return {
      kind: "dismissed",
      label: "Dismissed",
      attention: ACTION_ITEM_ATTENTION_BY_KIND.dismissed,
    };
  }
  return {
    kind: "unknown",
    label: item.status || "no status",
    reason: "a status this build has no meaning for — shown verbatim",
    attention: ACTION_ITEM_ATTENTION_BY_KIND.unknown,
  };
}

/** The resolved-state sentence for a non-open item, its status verbatim when unrecognised. */
export function resolvedSentence(
  item: Pick<CoordActionItem, "status" | "resolved_by" | "resolution_note">
): string {
  const verb =
    item.status === "done"
      ? "Marked done"
      : item.status === "dismissed"
        ? "Dismissed"
        : `Status "${item.status || "none"}" (not recognised by this build)`;
  return (
    verb +
    (item.resolved_by ? ` by ${item.resolved_by}` : "") +
    (item.resolution_note ? ` — ${item.resolution_note}` : "")
  );
}

// ---------------------------------------------------------------------------
// Source, links.
// ---------------------------------------------------------------------------

/** The mono identity chip — where the item came from, in two words or fewer. */
export function sourceChip(sourceKind: string | null | undefined): string {
  switch (sourceKind) {
    case "gate":
      return "gate";
    case "work_unit":
      return "work unit";
    case "agent":
      return "agent";
    default:
      return sourceKind || "?";
  }
}

/** One plain sentence naming the producer. */
export function sourceSentence(sourceKind: string | null | undefined): string {
  switch (sourceKind) {
    case "gate":
      return "Raised when a gate it was waiting on cleared.";
    case "work_unit":
      return "Raised by a work unit's dispatch.";
    case "agent":
      return "Posted by an agent session.";
    default:
      return `Raised by an unrecognised source (${sourceKind || "none"}).`;
  }
}

/**
 * How a link renders. `https:` opens in a new tab; a `qontinui://` app route
 * only means something on the phone, so it is shown as text; anything else is
 * never made clickable (coord validates the scheme, but this hop does not
 * assume it).
 */
export type LinkPresentation =
  | { kind: "web"; href: string }
  | { kind: "app"; route: string }
  | { kind: "text" };

export function presentLink(url: string): LinkPresentation {
  const trimmed = url.trim();
  if (/^https:\/\//i.test(trimmed)) return { kind: "web", href: trimmed };
  if (/^qontinui:\/\//i.test(trimmed)) return { kind: "app", route: trimmed };
  return { kind: "text" };
}

// ---------------------------------------------------------------------------
// Health (R1) — derived from the envelope already on the page.
// ---------------------------------------------------------------------------

export type ActionItemsTab = "open" | "done" | "dismissed";

export interface ActionItemsHealth {
  level: "green" | "amber" | "red";
  headline: string;
  detail: string;
  /** Open items on the loaded Open page whose push did not land; null = not known. */
  undelivered: number | null;
  /** True when more open items exist than the page holds, so `undelivered` is a floor. */
  undeliveredIsFloor: boolean;
}

export function deriveActionItemsHealth(state: {
  loaded: boolean;
  migrationPending: boolean;
  readFailed: boolean;
  tab: ActionItemsTab;
  response: ActionItemsResponse | null;
  counts: ActionItemCounts | null;
}): ActionItemsHealth {
  const { loaded, migrationPending, readFailed, tab, response, counts } = state;
  if (migrationPending) {
    return {
      level: "amber",
      headline: "Action items are not available yet",
      detail:
        "coord's action-item table has not been migrated on this deployment",
      undelivered: null,
      undeliveredIsFloor: false,
    };
  }
  // A failed read makes everything on the page possibly stale, so it wins over
  // whatever the last answer said — amber, the ignorance floor, whether or not
  // an earlier read succeeded.
  if (readFailed) {
    const kept = loaded && counts !== null;
    return {
      level: "amber",
      headline: kept
        ? "Could not read action items — showing the last answer"
        : "Could not read action items",
      detail: kept
        ? "the rows and counts below may be out of date"
        : "the counts below are unknown, not zero",
      undelivered: null,
      undeliveredIsFloor: false,
    };
  }
  if (!loaded || counts === null) {
    return {
      level: "amber",
      headline: "Waiting for coord…",
      detail: "counts appear once the list arrives",
      undelivered: null,
      undeliveredIsFloor: false,
    };
  }
  const undelivered =
    tab === "open" && response
      ? response.items.filter(
          (i) => i.status === "open" && isPushUndelivered(i)
        ).length
      : null;
  const undeliveredIsFloor = tab === "open" && !!response?.next_cursor;
  const open = counts.open;
  if (open > 0) {
    const pushNote =
      undelivered === null
        ? "push delivery is counted on the Open tab"
        : undelivered > 0
          ? `${undelivered}${undeliveredIsFloor ? "+" : ""} did not reach your phone — read why on each row`
          : "every one reached your phone or is about to";
    return {
      level: "red",
      headline: `${open} action item${open === 1 ? "" : "s"} owed by you`,
      detail: pushNote,
      undelivered,
      undeliveredIsFloor,
    };
  }
  return {
    level: "green",
    headline: "Nothing owed",
    detail: `${counts.done} done · ${counts.dismissed} dismissed`,
    undelivered,
    undeliveredIsFloor,
  };
}

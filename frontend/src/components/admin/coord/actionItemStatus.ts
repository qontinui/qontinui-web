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
 * - `open_undelivered` — **`author`, red.** The item is open AND coord could
 *   not put it on the operator's phone (`failed`, `undeliverable`,
 *   `no_recipients`, `no_devices`). The whole point of the feature is that the
 *   operator is told; when the telling failed, this console is the only place
 *   left that says something is owed, and nothing else will clear it.
 * - `open` — **`waiting`, amber.** Open, and the push is pending or Expo
 *   accepted it. The plan specifies amber for an open item (Phase 3); the row
 *   says in words what is owed, and the item clears when the operator resolves
 *   it from the phone or here.
 * - `done` / `dismissed` — **`none`, calm.** Resolved; nothing is owed.
 * - `unknown` — **`waiting`, the ignorance floor.** A status this build has no
 *   meaning for (R3's stated exception: amber also covers "we do not know").
 */

import type { Attention } from "@/components/console/attention";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  type RowStatus,
  type StatusPalette,
} from "@/components/console/statusRow";
import { httpStatusOf } from "./httpStatus";

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
 * Coord answers `503 schema_migration_pending` until the
 * `coord.operator_action_items` revision deploys. Read from the anchored
 * STATUS field, never a body substring — same reasoning as
 * `notificationStatus.isMigrationPending`.
 */
export function isMigrationPending(err: unknown): boolean {
  return httpStatusOf(err) === 503;
}

// ---------------------------------------------------------------------------
// Status → attention → palette.
// ---------------------------------------------------------------------------

export type ActionItemKind =
  | "open_undelivered"
  | "open"
  | "done"
  | "dismissed"
  | "unknown";

/** Push states that mean the phone was NOT told about an open item. */
export const UNDELIVERED_PUSH_STATES: ReadonlySet<string> = new Set([
  "failed",
  "undeliverable",
  "no_recipients",
  "no_devices",
]);

export const ACTION_ITEM_ATTENTION_BY_KIND: Record<ActionItemKind, Attention> =
  {
    open_undelivered: "author",
    open: "waiting",
    done: "none",
    dismissed: "none",
    unknown: "waiting",
  };

export const ACTION_ITEM_BADGE_CLASS: Record<ActionItemKind, string> = {
  open_undelivered: AUTHOR_RED,
  open: WAITING_AMBER,
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
    const state = item.push?.state;
    if (isPushUndelivered(item)) {
      return {
        kind: "open_undelivered",
        label: "Owed — not on your phone",
        reason: pushLabel(state),
        attention: ACTION_ITEM_ATTENTION_BY_KIND.open_undelivered,
      };
    }
    return {
      kind: "open",
      label: "Owed",
      reason: pushLabel(state),
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
  if (!loaded || counts === null) {
    return {
      level: "amber",
      headline: readFailed
        ? "Could not read action items"
        : "Waiting for coord…",
      detail: readFailed
        ? "the counts below are unknown, not zero"
        : "counts appear once the list arrives",
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
  if (undelivered !== null && undelivered > 0) {
    return {
      level: "red",
      headline: `${undelivered}${undeliveredIsFloor ? "+" : ""} owed item${undelivered === 1 ? "" : "s"} did not reach your phone`,
      detail: `${open} open in total — read why on each red row`,
      undelivered,
      undeliveredIsFloor,
    };
  }
  if (open > 0) {
    return {
      level: "amber",
      headline: `${open} action item${open === 1 ? "" : "s"} owed by you`,
      detail:
        undelivered === null
          ? "push problems are counted on the Open tab"
          : "every open item reached your phone or is about to",
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

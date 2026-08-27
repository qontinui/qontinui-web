"use client";

/**
 * The `/admin/coord/notifications` health strip, derived.
 *
 * **R1** — every number here is one the page ALREADY holds. `total` and
 * `unread_count` are server-computed scalars that arrive with the page of
 * rows; this module takes them as arguments and cannot fetch. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 5.
 *
 * ## Why this strip is never red or amber for a BACKLOG
 *
 * The obvious instinct is "N unread → amber". R3 forbids it, and the reasoning
 * is the style guide's own third case (*a real decision that is not blocking
 * anyone*): notifications are an APPEND-ONLY EVENT feed, the deliberate
 * counterpart to `/alerts`'s condition feed. Nothing is blocked by an unread
 * event and nothing decays while it sits — the page's own module doc says so.
 * Amber promises "something else will clear this", which is false; red claims
 * "act now", which is also false. So the backlog is stated as a COUNT, in
 * words, and the hue is left alone.
 *
 * ## What it IS loud about
 *
 * Not knowing. `migrationPending` (coord answers `503
 * schema_migration_pending` until the `coord.notifications` revision deploys),
 * a failed read, and the pre-first-response state are all *we cannot tell you
 * what happened while you were away* — R3's ignorance floor, the same amber
 * `attentionOf` defaults to and the same discipline that makes an unfetched
 * count render `–` rather than `0`.
 */

import type { HealthBadge, HealthStripLevel } from "@/components/console";

export interface NotificationsHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
}

export interface NotificationsHealthInput {
  /** coord's server-computed unread scalar. `null` = not answered yet. */
  unreadCount: number | null;
  /** coord's server-computed total scalar. `null` = not answered yet. */
  total: number | null;
  /** True once a read has SUCCEEDED — never merely "a read finished". */
  loaded: boolean;
  /** coord has the routes but not the table yet. */
  migrationPending: boolean;
  /** The last read failed. */
  failed: boolean;
}

/**
 * `loaded=false`, `migrationPending` and `failed` each return EARLY with badge
 * labels that spell the dash literally. `<HealthStrip>` renders `badge.label`
 * verbatim, so a `null` label renders NOTHING rather than `–`; R6's
 * absence-is-not-zero rule is held by these early returns, not by any
 * null-coalescing below them.
 */
export function deriveNotificationsHealth(
  input: NotificationsHealthInput
): NotificationsHealth {
  const { unreadCount, total, loaded, migrationPending, failed } = input;
  /**
   * The two badges carry the page's FROZEN authored testids
   * (`coord-notifications-unread-count`, `coord-notifications-total`) — they
   * were on the `<Badge>`s in the deleted `<CardTitle>` and this is where those
   * counts moved (D4a). They are emitted in EVERY branch, including the
   * unknown ones, so a consumer that looks them up finds a dash rather than
   * nothing: an absent element and a `0` are the two answers this page must
   * never give for a count it does not have.
   *
   * The label reads `"137 unread"` rather than `"unread 137"` — the word order
   * the deleted `<CardTitle>` badges used, and the one
   * `notifications/page.test.tsx` asserts by text. The strip's own convention
   * is label-then-number, so this is a deliberate exception in service of a
   * frozen contract, not an oversight.
   */
  const unknownBadges: HealthBadge[] = [
    {
      key: "unread",
      label: <>– unread</>,
      tone: "muted",
      "data-testid": "coord-notifications-unread-count",
    },
    {
      key: "total",
      label: <>– total</>,
      tone: "muted",
      "data-testid": "coord-notifications-total",
    },
  ];

  if (migrationPending) {
    return {
      level: "amber",
      headline: "Notifications are not available yet",
      detail: "coord has the routes but not the table — this is not an error",
      badges: unknownBadges,
    };
  }
  if (failed) {
    return {
      level: "amber",
      headline: "Could not read the feed",
      detail: "what happened while you were away is UNKNOWN, not nothing",
      badges: unknownBadges,
    };
  }
  if (!loaded) {
    return {
      level: "amber",
      headline: "Waiting for coord…",
      detail: "counts appear once the feed answers",
      badges: unknownBadges,
    };
  }

  const unread = unreadCount ?? 0;
  return {
    // Green even with a backlog — see the module doc. An event nobody is
    // blocked on does not get to spend amber.
    level: "green",
    headline:
      unread > 0
        ? `${unread} unread event${unread === 1 ? "" : "s"}`
        : "Nothing unread",
    detail:
      unread > 0
        ? "nothing is blocked by these — they are what happened while you were away"
        : "you have seen everything coord recorded",
    badges: [
      {
        key: "unread",
        label: <>{unreadCount == null ? "–" : unreadCount} unread</>,
        tone: unread > 0 ? "default" : "muted",
        "data-testid": "coord-notifications-unread-count",
      },
      {
        key: "total",
        label: <>{total == null ? "–" : total} total</>,
        tone: "muted",
        "data-testid": "coord-notifications-total",
      },
    ],
  };
}

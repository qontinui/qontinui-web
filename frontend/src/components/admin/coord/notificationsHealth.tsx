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
 * a failed read, the pre-first-response state, **and a read that succeeded
 * without carrying `unread_count`** are all *we cannot tell you what happened
 * while you were away* — R3's ignorance floor, the same amber `attentionOf`
 * defaults to and the same discipline that makes an unfetched count render `–`
 * rather than `0`.
 *
 * That fourth case is the one this module originally missed: `loaded` and
 * `unreadCount === null` is a REACHABLE pair, not a contradiction, and
 * collapsing it with `?? 0` made the strip claim "Nothing unread" beside a
 * badge that said `–`. See the guard on `unreadCount === null` below.
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
 * The two badges, for any pair of scalars — including the pair we do not have.
 *
 * They carry the page's FROZEN authored testids
 * (`coord-notifications-unread-count`, `coord-notifications-total`) — they were
 * on the `<Badge>`s in the deleted `<CardTitle>` and this is where those counts
 * moved (D4a). Every branch below emits BOTH, including the unknown ones, so a
 * consumer that looks them up finds a dash rather than nothing: an absent
 * element and a `0` are the two answers this page must never give for a count
 * it does not have.
 *
 * `<HealthStrip>` renders `badge.label` verbatim, so a `null` label would
 * render NOTHING rather than `–` — which is why the dash is spelled into the
 * label here rather than left to the strip.
 *
 * The label reads `"137 unread"` rather than `"unread 137"` — the word order
 * the deleted `<CardTitle>` badges used, and the one
 * `notifications/page.test.tsx` asserts by text. The strip's own convention is
 * label-then-number, so this is a deliberate exception in service of a frozen
 * contract, not an oversight.
 *
 * The two scalars are INDEPENDENT: coord can answer with one and not the
 * other, and each renders what is known about itself. A shared "both are
 * unknown" badge pair would throw away a `total` we actually hold.
 */
function countBadges(
  unreadCount: number | null,
  total: number | null
): HealthBadge[] {
  return [
    {
      key: "unread",
      label: <>{unreadCount == null ? "–" : unreadCount} unread</>,
      tone: unreadCount != null && unreadCount > 0 ? "default" : "muted",
      "data-testid": "coord-notifications-unread-count",
    },
    {
      key: "total",
      label: <>{total == null ? "–" : total} total</>,
      tone: "muted",
      "data-testid": "coord-notifications-total",
    },
  ];
}

export function deriveNotificationsHealth(
  input: NotificationsHealthInput
): NotificationsHealth {
  const { unreadCount, total, loaded, migrationPending, failed } = input;
  /**
   * Nothing has been read, or what was read cannot be trusted — neither scalar
   * is reportable, so neither is reported.
   */
  const unknownBadges = countBadges(null, null);

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

  /**
   * A read SUCCEEDED and still did not carry `unread_count`.
   *
   * This is not the same state as `!loaded`, and it is the one the first cut of
   * this module got wrong: it wrote `unreadCount ?? 0`, so the badge said `–`
   * while the headline one element to its left said *"Nothing unread"* and the
   * detail said *"you have seen everything coord recorded"*. The strip made two
   * incompatible claims at once, and the confident one was the false one.
   *
   * It is reachable rather than theoretical. `notifications/page.tsx`'s
   * `applyEnvelope` writes each scalar only `if (typeof … === "number")` — it
   * treats an absent one as UNKNOWN and leaves the previous value standing —
   * while `setLoaded(true)` fires on any successful GET. An envelope missing
   * the scalar (a coord build that predates it, a partial degrade) therefore
   * lands here with `loaded` true and `unreadCount` still `null`.
   *
   * So it takes the same arm as every other *we cannot tell you what happened
   * while you were away* state: amber, and say which. `total` is reported if we
   * DO have it — one missing scalar does not make the other unknown.
   */
  if (unreadCount === null) {
    return {
      level: "amber",
      headline: "The unread count did not come back",
      detail:
        "the feed answered but without an unread count — how much you have not seen is UNKNOWN, not zero",
      badges: countBadges(null, total),
    };
  }

  return {
    // Green even with a backlog — see the module doc. An event nobody is
    // blocked on does not get to spend amber.
    level: "green",
    headline:
      unreadCount > 0
        ? `${unreadCount} unread event${unreadCount === 1 ? "" : "s"}`
        : "Nothing unread",
    detail:
      unreadCount > 0
        ? "nothing is blocked by these — they are what happened while you were away"
        : "you have seen everything coord recorded",
    badges: countBadges(unreadCount, total),
  };
}

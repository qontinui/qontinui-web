"use client";

/**
 * The `/admin/coord/plans` health strip, derived.
 *
 * Split out of `page.tsx` because a Next.js App Router page module may export
 * NOTHING but its default and the framework's own reserved names — an extra
 * export is a `.next/types` TS2344, not a lint nit. Living beside the page
 * (the convention `planSort.ts` already set on this route) also makes the
 * absence-is-not-zero rule below unit-testable without rendering the page.
 *
 * **R1** — every count here comes from the rows the page ALREADY fetched.
 * There is no second request, and there cannot be: this module takes the list
 * as an argument.
 */

import type { HealthBadge, HealthStripLevel } from "@/components/console";
import {
  UNKNOWN_COUNTS_DETAIL,
  readIsUnknown,
  staleDetail,
} from "@/components/console";
import { describePlanStatus } from "@/components/admin/coord/planStatus";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

export interface PlansHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
}

/**
 * The page's health, derived from the rows already on it (R1) — never a second
 * fetch.
 *
 * **`loaded=false` returns EARLY with a separate badge set whose labels spell
 * the dash literally.** That is worth stating precisely, because the obvious
 * reading is wrong in a way that would ship blank counts: `<HealthStrip>`
 * renders `badge.label` verbatim (`HealthStrip.tsx`), so a `null` label
 * renders NOTHING, not `–`. The `–`-not-`0` rule (R6) is therefore held here
 * by the early return and by the literal `–` in these labels — not by any
 * null-coalescing further down. Delete the early return and the counts go
 * blank, not dashed.
 *
 * The reason the rule matters at all: a page that has not heard from coord yet
 * must not claim there are no blocked plans.
 *
 * **`readFailed` is the other half of that rule**, and it is a separate
 * argument because `loaded` cannot express it. R6 covers "fetched and FAILED"
 * as well as "still in flight": a first load that errors leaves `loaded` false
 * and renders "Waiting for coord…" over a request that is never arriving,
 * while a poll that errors after a good load leaves `loaded` true and paints
 * "No plan is blocked" — the sentence that tells an operator to stop looking —
 * off a list of unknown age.
 *
 * A failed read from a page coord has NEVER answered is UNKNOWN and dashes its
 * counts. A failed read after any successful one is STALE: those rows are real
 * and still actionable — including a real, fetched count of ZERO — so they keep
 * rendering and the detail says they are old. `readIsUnknown` carries why the
 * split is `loaded` and not `plans.length`.
 *
 * **The two states differ in the COUNTS and agree about the DOT.** Stale counts
 * render; a stale verdict does not. Green is a claim about now, so it needs a
 * read that landed AND is current, and `readFailed` therefore reaches the level
 * as well as the detail. Blocked still outranks both: a red row is red whether
 * or not the window refreshed.
 *
 * @param readFailed the page's last fetch threw.
 */
export function derivePlansHealth(
  plans: CoordPlanRow[],
  loaded: boolean,
  readFailed = false
): PlansHealth {
  if (readIsUnknown(loaded, readFailed)) {
    return {
      level: "amber",
      headline: "Could not read the work-unit list — unknown, not empty",
      detail: UNKNOWN_COUNTS_DETAIL,
      badges: [
        { key: "total", label: <>plans –</>, tone: "muted" },
        { key: "blocked", label: <>blocked –</>, tone: "muted" },
      ],
    };
  }

  if (!loaded) {
    return {
      level: "amber",
      headline: "Waiting for coord…",
      detail: "counts appear once the work-unit list arrives",
      badges: [
        { key: "total", label: <>plans –</>, tone: "muted" },
        { key: "blocked", label: <>blocked –</>, tone: "muted" },
      ],
    };
  }

  let blocked = 0;
  let active = 0;
  let shipped = 0;
  let unrecognised = 0;
  for (const p of plans) {
    const tag = describePlanStatus(p.status);
    if (tag.tone === "blocked") blocked += 1;
    else if (tag.tone === "active") active += 1;
    else if (tag.tone === "shipped") shipped += 1;
    if (!tag.recognised) unrecognised += 1;
  }

  // A STALE verdict is not a GREEN verdict. The counts survive a failed
  // refresh — they were really measured — but the dot is a claim about NOW,
  // and the last good read is not now. `readFailed` used to reach only the
  // detail line, so `/plans` and `/spawn` pulsed the green all-clear under the
  // headline "No plan is blocked" — the sentence that tells an operator to
  // stop looking — off a list of unknown age, qualified by one line of small
  // print. UNKNOWN and STALE differ in what the COUNTS say and are alike in
  // disqualifying green; that is R6's third state, and this is the deriver
  // both routes get it from.
  const level: HealthStripLevel =
    blocked > 0
      ? "red"
      : unrecognised > 0 || readFailed
        ? "amber"
        : "green";
  const headline =
    blocked > 0
      ? `${blocked} plan${blocked === 1 ? "" : "s"} blocked on a human`
      : readFailed
        ? // Names the read that has not come back, and stops there. "No plan
          // was blocked at the last good read" would be the tempting phrasing
          // and is a claim about a moment, off counts this window may have
          // truncated (`FETCH_LIMIT`) — so it says the one thing that is
          // certainly true.
          "Last refresh failed — these counts are not current"
        : plans.length === 0
          ? "No work units in this window"
          : "No plan is blocked";
  const window =
    unrecognised > 0
      ? `${unrecognised} carry a status this build has no label for — shown verbatim`
      : `${active} in progress, ${shipped} shipped`;
  // Stale, not unknown: the rows are real, only their age is not.
  const detail = readFailed ? staleDetail(window) : window;

  return {
    level,
    headline,
    detail,
    badges: [
      { key: "total", label: <>plans {plans.length}</>, tone: "muted" },
      {
        key: "blocked",
        label: <>blocked {blocked}</>,
        tone: blocked > 0 ? "attention" : "muted",
        title: "work units whose status is blocked — nothing downstream clears these",
      },
      { key: "active", label: <>in progress {active}</>, tone: "default" },
      { key: "shipped", label: <>shipped {shipped}</>, tone: "muted" },
      ...(unrecognised > 0
        ? [
            {
              key: "unrecognised",
              label: <>unlabelled {unrecognised}</>,
              tone: "default" as const,
              title:
                "work-unit status is opaque text in coord; these values are not in this build's display vocabulary",
            },
          ]
        : []),
    ],
  };
}

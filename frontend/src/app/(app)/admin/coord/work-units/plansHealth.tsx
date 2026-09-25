"use client";

/**
 * The `/admin/coord/work-units` (and `/admin/coord/spawn`) health strip,
 * derived.
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

/**
 * What ONE row is, on the surface calling this deriver.
 *
 * Two routes share this strip and they are no longer two views of one
 * population: `/admin/coord/spawn` lists authored plans (it still excludes
 * `shepherd-*` at the wire), while `/admin/coord/work-units` lists coord's
 * work units INCLUDING the merge escalations. A badge reading `plans 500` over
 * a window that is 39% coord's own escalation units is the same class of
 * mislabel Phase 3 moved the route to fix, one level down — so the noun is the
 * caller's to state. The default keeps `/spawn`'s wording byte-identical.
 */
export interface PlansHealthNoun {
  one: string;
  many: string;
}

const DEFAULT_NOUN: PlansHealthNoun = { one: "plan", many: "plans" };

/** Sentence-cased for a headline. Both nouns here are ASCII lower-case. */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The optional trailing arguments to {@link derivePlansHealth}. */
export interface DerivePlansHealthOptions {
  noun?: PlansHealthNoun;
  incomplete?: boolean;
  /**
   * Where on the CALLING page the operator can read how much of the list was
   * read — appended to the `list INCOMPLETE` badge's title as "see …". Only a
   * caller that has such a place passes it: `/work-units` has its fetch-window
   * panel, `/spawn` has none, and a pointer baked into this shared deriver
   * sent `/spawn`'s operator to a panel that does not exist on that page.
   */
  incompleteDetailsAt?: string;
}

export interface PlansHealth {
  level: HealthStripLevel;
  headline: string;
  /** Absent when there is nothing to say that the badges do not already say. */
  detail?: string;
  badges: HealthBadge[];
}

/**
 * A `shepherd-*` slug is coord's OWN auto-generated unlandable-PR
 * merge-escalation tracking unit (`pr_merge/shepherd_reconcile.rs`), not a
 * plan any human or agent authored. It lives in `coord.work_units` because
 * that table is the generic work-unit primitive, but it carries an internal
 * status (`tier3_dispatched`) this page's vocabulary has no reason to know —
 * `describePlanStatus` correctly renders it as unrecognised, which is honest,
 * but the honest fix here is "this row doesn't belong on a PLANS page" rather
 * than "give it a label". `coord_work_unit_list`'s own `exclude_slug_prefix`
 * doc names shepherd rows for exactly this reason, and the web proxy already
 * forwards the parameter end-to-end (`operations.py` `list_coord_plans`).
 * Shared here because `/admin/coord/work-units` and `/admin/coord/spawn`
 * both fetch this list and both read `derivePlansHealth` off it. On
 * `/work-units` the exclusion is a CONTROL rather than a constant — see
 * {@link SHEPHERD_FILTERS} — and `/spawn` still applies it unconditionally.
 */
export const SHEPHERD_SLUG_PREFIX = "shepherd-";

/**
 * The `shepherd-*` control on `/admin/coord/work-units`, and why its default
 * is **include**.
 *
 * While this route was called `/admin/coord/plans` the exclusion above was a
 * hard-coded query parameter, which was right: a shepherd unit is not a plan.
 * Phase 3 of plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store`
 * moved the route to `/admin/coord/work-units`, and on a page whose subject IS
 * coord's work units — merge-escalation triage above all — carrying the
 * exclusion along would have left that population (measured 1,264 rows on
 * 2026-09-20, 39% of `coord.work_units`) with **no consumer on either page**:
 * the new `/admin/coord/plans` reads the plan-library corpus and never sees
 * them at all. That is the `capability-ships-enabled` failure the plan opens by
 * naming, and a triage page that cannot see the escalations it exists to triage
 * is a thin shim.
 *
 * So the exclusion became a control that defaults to INCLUDED. It stays
 * SERVER-side (`?exclude_slug_prefix=`) — `include` sends the parameter not at
 * all, `exclude` sends {@link SHEPHERD_SLUG_PREFIX} — so switching re-asks
 * coord rather than filtering the fetched window.
 */
export type ShepherdFilter = "include" | "exclude";

export const SHEPHERD_FILTERS: { value: ShepherdFilter; label: string }[] = [
  { value: "include", label: "Incl. merge escalations" },
  { value: "exclude", label: "Excl. merge escalations" },
];

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
 * **`incomplete` is the third thing `loaded` cannot express**, and it is the
 * same rule one level out. `loaded`/`readFailed` ask whether these rows are an
 * ANSWER; `incomplete` asks what they are an answer ABOUT. The corpus walk
 * (`planWalk.ts`) can stop early, and a single `limit=500` page can come back
 * full — either way the rows on the page are known NOT to be the whole corpus,
 * and counting them as if they were is how "No plan is blocked" gets painted
 * over a list that simply never reached the blocked plan. Until this argument
 * existed that was exactly what happened: the fetch-window badge said
 * INCOMPLETE while the strip above it rendered the partial rows as a
 * whole-corpus verdict, in bigger type and with a green dot.
 *
 * So an incomplete list: keeps its counts (they are real — those rows were
 * fetched), says in the detail line that they cover part of the list, carries a
 * `list INCOMPLETE` badge so the caveat survives the strip being read alone,
 * and — like a stale read — cannot be GREEN. A blocked row still outranks it:
 * one blocked plan found in half a list is still a blocked plan.
 *
 * **BOTH callers pass it, because neither of them fetches a whole window by
 * construction.** `/work-units` derives it from the walk's outcome; `/spawn` reads
 * ONE page and derives it from whether that page came back full. It briefly
 * looked as though `/spawn` needed nothing here — the argument shipped
 * defaulting false with a note saying so — and that was wrong twice over:
 * `/spawn` sent no `limit` at all, the proxy forwards none
 * (`operations.py` `list_coord_plans`), and coord's own default is
 * `q.limit.unwrap_or(100)` with no truncation signal in the body, so its strip
 * could paint the green "No plan is blocked" over the first 100 rows of a
 * ~1.8k-row corpus — the exact over-claim this argument exists to stop, on the
 * page that was assumed exempt. `/spawn` now asks for an explicit limit so that
 * a full page is a legible signal, and passes it. The default stays `false` for
 * a future caller that really does hold the whole list.
 *
 * @param readFailed the page's last fetch threw.
 * @param opts.noun what one row IS on the calling surface — see
 *   {@link PlansHealthNoun}. Defaults to plan/plans.
 * @param opts.incomplete these rows are known to be less than the whole
 *   corpus. Defaults to false.
 * @param opts.incompleteDetailsAt where the calling page says how much was
 *   read, for the `list INCOMPLETE` badge's title. Omitted, the title points
 *   nowhere rather than at a place the caller may not have.
 *
 * The two trailing arguments are an options object rather than positions
 * because they arrived from two independent changes that each claimed the
 * fourth slot; a bare `true` there could not say which of them it meant.
 */
export function derivePlansHealth(
  plans: CoordPlanRow[],
  loaded: boolean,
  readFailed = false,
  opts: DerivePlansHealthOptions = {}
): PlansHealth {
  const noun = opts.noun ?? DEFAULT_NOUN;
  const incomplete = opts.incomplete ?? false;
  if (readIsUnknown(loaded, readFailed)) {
    return {
      level: "amber",
      headline: "Could not read the work-unit list — unknown, not empty",
      detail: UNKNOWN_COUNTS_DETAIL,
      badges: [
        { key: "total", label: <>{noun.many} –</>, tone: "muted" },
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
        { key: "total", label: <>{noun.many} –</>, tone: "muted" },
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
      : unrecognised > 0 || readFailed || incomplete
        ? "amber"
        : "green";
  // **Every count is said ONCE, in the badges.** The headline and the detail
  // used to restate four of them beside the badges that already carried them
  // (plan `2026-09-09-coord-plans-page-controls-do-not-acknowledge-or-name-themselves`
  // F2). The badge cluster is the one place a number lives in EVERY arm of
  // this strip — the unknown and waiting arms above put `blocked –` there and
  // nowhere else — so the headline states the verdict and the badge the
  // measurement. What the detail line still says is everything that is NOT a
  // count: the staleness qualifier and why a status renders verbatim.
  const headline =
    blocked > 0
      ? blocked === 1
        ? `A ${noun.one} is blocked on a human`
        : `${capitalize(noun.many)} are blocked on a human`
      : readFailed
        ? // Names the read that has not come back, and stops there. "No plan
          // was blocked at the last good read" would be the tempting phrasing
          // and is a claim about a moment, off counts this window may have
          // truncated (`FETCH_LIMIT`) — so it says the one thing that is
          // certainly true.
          "Last refresh failed — these counts are not current"
        : incomplete
          ? // The all-clear, scoped to what was actually read. Unqualified,
            // "No plan is blocked" is a claim about the corpus, and this list
            // is not the corpus — the blocked plan may be on the part that
            // was never fetched.
            `No ${noun.one} is blocked in the part of the list that was read`
          : plans.length === 0
            ? "No work units in this window"
            : `No ${noun.one} is blocked`;
  // The headline above already scopes itself when it is the one doing the
  // scoping; where something else owns the headline (a blocked row, a failed
  // refresh) the qualifier has to be in the detail line or it is nowhere.
  const incompleteQualifies = incomplete && blocked === 0 && !readFailed;
  const window = [
    incomplete && !incompleteQualifies
      ? "These counts cover an incomplete list, not the whole corpus."
      : "",
    unrecognised > 0
      ? "A status this build has no label for is shown verbatim."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  // Stale, not unknown: the rows are real, only their age is not. The
  // qualifier is why the detail line is de-duplicated rather than deleted:
  // under a BLOCKED headline nothing else says the counts are old. Where the
  // headline is itself the failure sentence, the detail does not repeat it —
  // saying "Last refresh failed" twice side by side is the same duplication
  // this strip just removed for the numbers.
  const headlineQualifies = readFailed && blocked === 0;
  const detail =
    readFailed && !headlineQualifies
      ? staleDetail(window)
      : window || undefined;

  return {
    level,
    headline,
    detail,
    badges: [
      {
        key: "total",
        label: (
          <>
            {noun.many} {plans.length}
          </>
        ),
        tone: "muted",
      },
      {
        key: "blocked",
        label: <>blocked {blocked}</>,
        tone: blocked > 0 ? "attention" : "muted",
        title:
          "work units whose status is blocked — nothing downstream clears these",
      },
      { key: "active", label: <>in progress {active}</>, tone: "default" },
      { key: "shipped", label: <>shipped {shipped}</>, tone: "muted" },
      // Carried in the badge cluster as well as the detail line, because the
      // badges are the one part of this strip that is always on screen — and
      // an operator who reads "blocked 0" without "list INCOMPLETE" beside it
      // has been told something the page does not know. No number: the count
      // of what was NOT read is exactly what an incomplete list cannot state.
      ...(incomplete
        ? [
            {
              key: "incomplete",
              label: <>list INCOMPLETE</>,
              tone: "attention" as const,
              title: `these counts are derived from the rows that were read, which are not the whole corpus${
                opts.incompleteDetailsAt
                  ? ` — see ${opts.incompleteDetailsAt}`
                  : ""
              }`,
            },
          ]
        : []),
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

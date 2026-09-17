"use client";

/**
 * The Coord Console header's status row: where you are, and what needs you.
 *
 * The console's PAGE links live in the app sidebar now (built from
 * `coordNavModel.ts`, the same structure this file reads), so this row no
 * longer navigates between sections. What it keeps is what a sidebar item
 * cannot carry:
 *
 *   Work · Lands      ← wayfinding crumb for the current page
 *   Alerts(•N)  Notifications(•N)  Dev Ops(alarms)   ← live badges
 *
 * Wayfinding contract: the crumb carries `<page-testid>-active` (e.g.
 * `coord-nav-lands-active`) so Spec-CI "active section" assertions keep a
 * stable target.
 *
 * The Alerts link polls the unresolved-alerts rollup for a live count badge
 * (red when any unresolved alert is critical) — the nav-level analogue of
 * the fleet page's traffic light. Notifications sits beside it because
 * conditions ("what is wrong now?") and events ("what happened while I was
 * away?") read as a pair, and an unread badge is only useful where it is
 * always visible (plan `2026-08-05-coord-notifications-type-and-tab.md`).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Bell, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { NOTIFICATIONS_REQUEST_OPTIONS } from "@/components/admin/coord/notificationStatus";
import { useFleetAlarmBadge } from "@/components/admin/coord/useFleetAlarmBadge";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { useRetainedValue } from "@/components/console";
import type { FleetAlarm } from "@/components/admin/coord/useFleetAlarmBadge";
import { findActiveLeaf, isLeafActive, type NavLeaf } from "./coordNavModel";

const log = createLogger("CoordNav");

const ALERTS_API = "/api/v1/operations/alerts";
/** Alerts churn at incident cadence — one poll a minute keeps the badge
 *  honest without adding meaningful load next to the page-level pollers. */
const ALERTS_POLL_MS = 60_000;

/** `?limit=1`: the badge wants the `unread_count` SCALAR, not the page.
 *  Asking for one row keeps a nav-wide 60s poll cheap on every console
 *  page while still carrying the count. */
const NOTIFICATIONS_API = "/api/v1/operations/notifications?limit=1";
/** Same nav-level cadence as the alerts badge, and deliberately NOT the
 *  page-level `POLL_INTERVAL_MS = 10_000`: the nav badge is a background
 *  hint rendered on every console page, the page poller is the foreground
 *  surface. Do not raise this to 10s. */
const NOTIFICATIONS_POLL_MS = ALERTS_POLL_MS;

interface AlertsRollupRow {
  severity?: string;
  resolved_at?: string | null;
}

interface AlertsRollup {
  /**
   * `resolved_at` is carried because the degraded arm below has to read it.
   * The row shape was `{ severity }` alone, which threw away the one field
   * that separates "a critical exists" from "a critical existed" — and the
   * degraded arm fires exactly on the build that may have dropped
   * `include_resolved=false` along with `severity`.
   */
  alerts?: AlertsRollupRow[];
  /** Rows MATCHING the query, unpaged. Absent on an un-upgraded coord. */
  total_count?: number;
}

/** `{alerts:[…]}` and a bare list are both accepted (two coord vintages). */
function readRollup(body: unknown): AlertsRollup {
  if (Array.isArray(body)) {
    return { alerts: body as AlertsRollupRow[] };
  }
  return (body ?? {}) as AlertsRollup;
}

/**
 * Live unresolved-alert count for the Alerts tab badge. Best-effort — a failed
 * poll renders no badge, never an error.
 *
 * Reads the API's `total_count`, NOT `alerts.length`. Measured 2026-08-14
 * (plan `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md`, § MEASURED):
 * the old code read the length of coord's hard-capped 500-row window, so the
 * badge displayed a constant **500** against 1643 unresolved rows, and
 * `critical` was unconditionally true because the served window happened to be
 * 100% critical — a flag that is always on carries no information. Both are
 * now counts, not samples, and each request asks for ONE row instead of
 * dragging 500 across the wire on every page every poll.
 *
 * `known: false` means the deployed coord served no `total_count`. The caller
 * renders `≥N` — the truncated length is a LOWER BOUND, never the truth —
 * except at zero, where "at least none" is true of every state there is and
 * the caller says the number is unknown instead.
 *
 * **Two axes, and each one answers for itself.** The number and the critical
 * accent come from two reads that FAIL INDEPENDENTLY, so they get two
 * `useRetainedValue`s rather than one flag between them. `Promise.all` had made
 * that impossible — it rejects on the first rejection, so a failed severity
 * read beside a succeeded count read staled a number from that very poll — and
 * `allSettled` alone was not enough either: splitting them and then reporting
 * only the count's currency left the ACCENT making an unqualified claim, which
 * is the same defect one axis over. A severity read that failed, or that has
 * never landed, is not evidence that nothing is critical.
 * `notificationsHealth.tsx` states the governing rule: *"The two scalars are
 * INDEPENDENT: coord can answer with one and not the other, and each renders
 * what is known about itself."*
 *
 * **One silence this badge still carries and cannot qualify.** The accent has
 * nothing to attach to without a count, so a CONFIRMED critical whose count
 * read has never landed renders nothing at all. Left that way deliberately:
 * inventing a badge would mean inventing a number, which is the fabrication
 * this surface is being fixed for, and the alerts PAGE is where an operator
 * goes for the condition itself. Recorded rather than implied, because it is
 * the last place a silence here means more than "nothing to show".
 */
function useAlertsBadge(): {
  count: number;
  critical: boolean;
  known: boolean;
  hasRead: boolean;
  stale: boolean;
  criticalKnown: boolean;
  criticalStale: boolean;
} {
  const [known, setKnown] = useState(false);
  const countAxis = useRetainedValue(0);
  const criticalAxis = useRetainedValue(false);
  const { issue: issueCount, settle: settleCount } = countAxis;
  const { issue: issueCritical, settle: settleCritical } = criticalAxis;

  const fetchCount = useCallback(async () => {
    // One ticket per axis, taken together before either read goes out. They
    // stay in lockstep because every poll settles both exactly once — six
    // branches, six settles, no early return — and each axis only ever compares
    // against its own sequence.
    //
    // ⚠️ Which makes CROSS-WIRING the hazard here, not divergence. A branch that
    // skipped one axis's settle would only leave a gap in that axis's own
    // numbering, and the next poll re-syncs. But `settleCritical(seq, …)` is
    // correct only while the counters march together: the moment some future
    // branch issues one ticket and not the other, a cross-wired call compares
    // against the wrong sequence and silently declines reads. Keep each
    // `settle*` on its own `*Seq`.
    const seq = issueCount();
    const critSeq = issueCritical();
    // Two `limit=1` reads: the unresolved total for the number, and a
    // severity-filtered total for the red flag. The flag cannot come from
    // the returned rows — that is precisely the truncated-slice bug.
    //
    // `allSettled`, not `all`: see the docblock. The two reads fail
    // independently and each axis settles on its own answer.
    const [all, criticals] = await Promise.allSettled([
      httpClient.get<unknown>(`${ALERTS_API}?include_resolved=false&limit=1`),
      httpClient.get<unknown>(
        `${ALERTS_API}?include_resolved=false&severity=critical&limit=1`
      ),
    ]);

    if (all.status === "fulfilled") {
      const allBody = readRollup(all.value);
      const total = allBody.total_count;
      const isTotal = typeof total === "number";
      // Degraded: an un-upgraded coord ignores `limit` and answers with the
      // capped window. Its length is a floor, and the badge says so.
      const applied = settleCount(seq, {
        value: isTotal ? total : (allBody.alerts?.length ?? 0),
      });
      // Only alongside the value it describes — a superseded reply that the
      // axis declined must not leave `known` describing a number it did not
      // deliver.
      if (applied) setKnown(isTotal);
    } else {
      log.warn("alerts badge fetch failed", all.reason);
      settleCount(seq, null);
    }

    if (criticals.status === "fulfilled") {
      const critBody = readRollup(criticals.value);
      const critTotal = critBody.total_count;
      if (typeof critTotal === "number") {
        settleCritical(critSeq, { value: critTotal > 0 });
      } else if (
        (critBody.alerts ?? []).some(
          (a) => a.severity === "critical" && !a.resolved_at
        )
      ) {
        // Degraded — an un-upgraded coord dropped `severity` too — but an
        // UNRESOLVED critical row in the sample proves an unresolved critical
        // exists. Existence survives sampling.
        //
        // `!a.resolved_at` is not belt-and-braces. This arm fires on exactly
        // the build that ignored `severity`, and `include_resolved=false` is a
        // filter on the same request; nothing in the response says which
        // filters were honoured. Reading severity alone therefore asserted an
        // UNRESOLVED critical off a row coord had already cleared.
        // `alertStatus.ts` draws the same line from the same field.
        //
        // Best-effort, and the residual is stated rather than implied: a build
        // that omits `resolved_at` entirely is trusted as unresolved. That is
        // the deliberate trade — `resolved_at` is a data column rather than a
        // request filter, so it is far likelier to be served than a filter is
        // to be honoured, and demanding its PRESENCE would turn a correct red
        // into silence for any build that drops null fields. Erring loud beats
        // erring calm on this axis.
        settleCritical(critSeq, { value: true });
      } else {
        // ...and absence does NOT. This arm used to answer `false` here, which
        // asserts a fleet-wide negative from a `limit=1` window: the 2026-08-14
        // defect above, inverted. That one was "a flag that is always on
        // carries no information"; answering `false` from an empty sample is
        // the same error pointed the other way, and it is worse, because it is
        // the reassuring direction. A read that did not answer the question
        // settles as a NON-delivery, and the badge says the accent is unknown.
        settleCritical(critSeq, null);
      }
    } else {
      log.warn("alerts badge severity fetch failed", criticals.reason);
      settleCritical(critSeq, null);
    }
  }, [issueCount, issueCritical, settleCount, settleCritical]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);
  useVisiblePoll(fetchCount, ALERTS_POLL_MS);

  return {
    count: countAxis.value,
    critical: criticalAxis.value,
    known,
    hasRead: countAxis.hasRead,
    stale: countAxis.stale,
    criticalKnown: criticalAxis.hasRead,
    criticalStale: criticalAxis.stale,
  };
}

/** Live UNREAD-notification count for the Notifications tab badge.
 *
 *  Best-effort, like `useAlertsBadge`: a failed poll (including coord's
 *  `503 schema_migration_pending` before the `coord.notifications` migration
 *  deploys) logs a warning and is otherwise ignored — never an error state in
 *  a nav that sits on every console page.
 *
 *  Concretely, "ignored" means the LAST KNOWN count keeps rendering rather
 *  than the badge disappearing. That is deliberate: the count is a hint, a
 *  poll failure is evidence about the network and not about the mailbox, and
 *  clearing the badge would assert "nothing unread" on no evidence — the
 *  silent-empty-is-unknown trap. Before the first successful poll the count is
 *  0 and no badge renders, so a route that has never answered stays quiet.
 *
 *  ⚠️ **Retaining is only HALF the rule, and this hook shipped the half that is
 *  silent.** R6's stale arm is "those numbers are real and still actionable,
 *  so they keep rendering *and the detail line says they are old*"; a retained
 *  count rendered with no qualification is indistinguishable from one a poll
 *  just confirmed. `/admin/coord/notifications` counted four consumers of this
 *  same `unread_count` and gave every one of them a way to decline to speak
 *  for an uncurrent read — the strip dashes its badges, the `empty=` slot says
 *  "unknown, not none", the `?ref=` banner names the failed read, and the
 *  mark-all tooltip drops the figure. This badge is the FIFTH, it is the only
 *  one rendered on EVERY console page, and it is the one that was not counted:
 *  the page's own module doc names it ("the nav badge polls at 60s — it is a
 *  background hint") while the sweep stayed inside the route.
 *
 *  So the count goes through `useRetainedValue`, which publishes `stale`
 *  alongside it. The number is still kept — the argument above is unchanged and
 *  correct — it is now labelled. Deliberately not a second lower bound: a stale
 *  unread count is not a floor, because the operator may have marked rows read
 *  in another tab, so it can be wrong in either direction and `≥` would be a
 *  fresh false claim rather than a hedge. It is `*`, the "see the note" marker,
 *  and the note is the `title` and the screen-reader text beside it.
 *
 *  **A 2xx carrying no `unread_count` is a read that refreshed nothing**, so it
 *  settles as a non-delivery and stales the badge exactly as a rejection does.
 *  That degrade is reachable rather than theoretical — `notificationsHealth.tsx`
 *  makes the argument, for a coord build that predates the scalar or a partial
 *  degrade — and without this a build that omits it permanently would render
 *  the first poll's number as current forever.
 *
 *  What `stale` deliberately does NOT cover: a poll that never RAN.
 *  `useVisiblePoll` skips ticks on a hidden tab, so a tab hidden for hours
 *  shows an hours-old count with `stale` false until the visibility handler's
 *  refetch lands. A poll that did not run is not a poll that failed, and this
 *  badge has no clock; giving it one would mean rendering an age, which is a
 *  different feature from the one this flag is. */
function useNotificationsBadge(): {
  count: number;
  hasRead: boolean;
  stale: boolean;
} {
  const countAxis = useRetainedValue(0);
  const { issue, settle } = countAxis;

  const fetchCount = useCallback(async () => {
    const seq = issue();
    try {
      const body = await httpClient.get<{ unread_count?: number }>(
        NOTIFICATIONS_API,
        NOTIFICATIONS_REQUEST_OPTIONS
      );
      const unread = body?.unread_count;
      // A response without the scalar is UNKNOWN, not zero — the previous
      // value stands, and settles as a NON-delivery so the badge says the most
      // recent read did not replace it.
      settle(
        seq,
        typeof unread === "number" && Number.isFinite(unread)
          ? { value: unread }
          : null
      );
    } catch (err) {
      log.warn("notifications badge fetch failed", err);
      settle(seq, null);
    }
  }, [issue, settle]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);
  useVisiblePoll(fetchCount, NOTIFICATIONS_POLL_MS);

  return {
    count: countAxis.value,
    hasRead: countAxis.hasRead,
    stale: countAxis.stale,
  };
}

/**
 * The fleet alarm, on the header's Dev Ops link.
 *
 * Moved here from the pipeline page's collapsed `System details` header by
 * Phase 4 of `2026-08-25-coord-console-intent-and-devops-sections`, along with
 * the two polls that fed it. A count of zero renders nothing at all — an
 * all-clear fleet should look like an all-clear, not like a surface reporting
 * "0".
 *
 * ⚠️ **`unknown` is not optional and is not red.** It is rendered even though
 * nothing is wrong-coloured about it, because a fleet whose telemetry has gone
 * entirely dark publishes no samples: a trigger that showed only breaches
 * would render that fleet exactly like a healthy one. That is a false-safe of
 * the same class as `[policy: silent-empty-is-unknown]`. Do not "tidy" this
 * badge away as noise; it is the one that says *we do not know*.
 *
 * The counts come straight from coord's own admission verdict (`headroom`) via
 * `summarizeFleetAdmission` — there is no client-side band here that could put
 * a machine in the red badge while the dispatcher is still happily electing
 * it.
 *
 * ## The retained counts carry the same four channels as the tab badges
 *
 * This cluster keeps its last good counts across a failed poll (the argument is
 * in `useFleetAlarmBadge`, and it is right). It used to render them with no
 * qualification whatsoever — no `*`, no `title` clause, no screen-reader note,
 * no `data-read-stale` — while the two tab badges beside it had all four. So
 * the same `*` marker, the same `STALE_TITLE_SUFFIX` and the same `sr-only`
 * note apply here, for the reasons argued at those constants.
 *
 * **Per badge, not per cluster.** `unhealthy` is the health read alone; the
 * four admission counts are health AND samples. Marking a fresh `unhealthy`
 * stale because the samples read failed would be the over-claim this lineage
 * has now corrected twice, and marking the admission counts fresh because the
 * health read landed would be the under-claim.
 *
 * ## ...and a retained ZERO is the one this trigger most needs
 *
 * Everywhere else a retained zero going dark is a badge disappearing. Here
 * silence IS the all-clear — the design decision three paragraphs up — so a
 * last-good all-clear whose next poll fails renders as a confident "nothing is
 * wrong", stated in the loudest medium the trigger has. That is the exact
 * false-safe the `unknown` count exists to prevent, reached one layer out
 * through the READ rather than through the payload.
 *
 * So an all-zero cluster we can no longer vouch for keeps ONE muted marker
 * rather than five `0*` pills: five would be an alarm's worth of visual weight
 * for the absence of alarms, on a nav trigger that has to stay scannable. A
 * cluster that has never READ still renders nothing — there is no retained fact
 * to qualify, and inventing one would be the same fabrication pointed the other
 * way.
 */
function FleetAlarmBadges({ alarm }: { alarm: FleetAlarm }) {
  const { counts, hasRead, healthStale, samplesStale } = alarm;
  // The admission counts are computed from BOTH reads, so either one failing
  // leaves them uncurrent. `unhealthy` never touches the samples.
  const admissionStale = healthStale || samplesStale;
  const badges: Array<{
    key: string;
    testId: string;
    count: number;
    label: string;
    tone: "critical" | "attention" | "muted";
    title: string;
    stale: boolean;
  }> = [
    {
      key: "unhealthy",
      testId: "coord-nav-devops-unhealthy-badge",
      count: counts.unhealthy,
      label: "unhealthy",
      tone: "critical",
      title: "machines coord reports in a state other than healthy",
      stale: healthStale,
    },
    {
      key: "breach",
      testId: "coord-nav-devops-breach-badge",
      count: counts.breach,
      label: "refusing work",
      tone: "critical",
      title: "lanes below the floor coord's admission actually enforces",
      stale: admissionStale,
    },
    {
      key: "warn",
      testId: "coord-nav-devops-warn-badge",
      count: counts.warn,
      label: "delaying work",
      tone: "attention",
      title: "lanes inside coord's amber band — work is deferred, not rejected",
      stale: admissionStale,
    },
    {
      key: "stale",
      testId: "coord-nav-devops-stale-badge",
      count: counts.stale,
      label: "stale",
      tone: "muted",
      // Two different clocks, and they are deliberately not merged: this count
      // is about the age of the SAMPLE coord served, while `data-read-stale` is
      // about whether our latest read replaced it. A lane can be either,
      // neither, or both.
      title: "lanes whose last sample is too old to be a claim about now",
      stale: admissionStale,
    },
    {
      key: "unknown",
      testId: "coord-nav-devops-unknown-badge",
      count: counts.unknown,
      label: "unknown",
      tone: "muted",
      title:
        "lanes coord reports no admission verdict for — not healthy, not red",
      stale: admissionStale,
    },
  ];
  const shown = badges.filter((b) => b.count > 0);
  // Nothing to show, something was once read, and the reads behind that
  // all-clear are no longer current — see the docblock. `admissionStale`
  // subsumes `healthStale`, so this covers a stale `unhealthy` zero too.
  const retainedAllClear = shown.length === 0 && hasRead && admissionStale;
  return (
    <>
      {shown.map((b) => (
        <span
          key={b.key}
          data-testid={b.testId}
          title={[b.title, b.stale ? STALE_TITLE_SUFFIX : null]
            .filter(Boolean)
            .join(" ")}
          // Emitted in both states: `"false"` is a real answer ("the latest read
          // replaced this number"), distinct from a badge that never asked.
          data-read-stale={b.stale}
          className={cn(
            "rounded-full px-1.5 text-[10px] font-bold leading-4 whitespace-nowrap",
            b.tone === "critical"
              ? "bg-red-500/25 text-red-200"
              : b.tone === "attention"
                ? "bg-amber-500/25 text-amber-200"
                : "bg-muted text-foreground"
          )}
        >
          {b.count}
          {/* Directly after the number, like the tab badges — the `*` qualifies
              the figure, not the label. */}
          {b.stale ? "*" : ""} {b.label}
          {/* `title` is not an accessible name here: the trigger's name is
              computed from its descendants' CONTENT, and this span has content,
              so the tooltip is never reached. Without this line the
              qualification is a sighted-mouse-user feature. */}
          {b.stale && <span className="sr-only"> {STALE_TITLE_SUFFIX}</span>}
        </span>
      ))}
      {retainedAllClear && (
        <span
          data-testid="coord-nav-devops-retained-all-clear-badge"
          data-read-stale="true"
          title={`no fleet alarms ${STALE_TITLE_SUFFIX}`}
          className="rounded-full px-1.5 text-[10px] font-bold leading-4 whitespace-nowrap bg-muted text-foreground"
        >
          0* alarms
          <span className="sr-only"> {STALE_TITLE_SUFFIX}</span>
        </span>
      )}
    </>
  );
}

/**
 * Appended to a badge's tooltip when the most recent read did not replace the
 * number it shows.
 *
 * One suffix rather than a fourth and fifth hand-written title, because both
 * badges already vary their base title on something else (`totalKnown` on
 * alerts) and spelling every combination out is how the two drift apart. The
 * qualification is the same sentence either way — it is a statement about the
 * READ, not about what was counted.
 *
 * It says *"the most recent read did not replace it"* and NOT *"the most recent
 * poll failed"*, which is what it said first and which is false in two
 * reachable states this file itself produces: a 2xx carrying no scalar (the
 * read landed), and — before `allSettled` — an alerts poll whose severity half
 * failed beside a count half that succeeded. A tooltip that diagnoses a cause
 * the flag does not carry is the same over-claim the flag exists to stop.
 */
const STALE_TITLE_SUFFIX =
  "— from an earlier read. The most recent read did not replace it, so what " +
  "has happened since is unknown. It is not a floor: it can be wrong in " +
  "either direction.";

/**
 * The accent's own qualification, on its own axis.
 *
 * The critical flag comes from a SECOND read that fails independently of the
 * count's, so "no red" has three causes and only one of them is *"nothing is
 * critical"*. The other two — that read failed, or it has never landed — are
 * unknowns, and rendering them as a calm badge is the established-negative
 * claim R6 exists to stop, made in the one place an operator most needs it not
 * to be.
 *
 * It is a `title` clause rather than a second glyph: the accent already has a
 * colour and the count already has `*`, and a 10px badge cannot carry a third
 * visual vocabulary without becoming unreadable. `data-critical-known` /
 * `data-critical-stale` carry it for a test.
 */
const CRITICAL_UNKNOWN_CLAUSE =
  "Whether any of them is critical is UNKNOWN: that is a separate read, and " +
  "it has not answered.";
const CRITICAL_STALE_CLAUSE =
  "Whether any of them is critical is from an earlier read — that is a " +
  "separate read, and the most recent one did not answer.";

/** The two event surfaces whose count badges live on the header. Their
 *  `testId`s match the sidebar model's leaves for the same pages. */
const STATUS_LINKS: NavLeaf[] = [
  {
    href: "/admin/coord/alerts",
    label: "Alerts",
    icon: AlertTriangle,
    testId: "coord-nav-alerts",
  },
  {
    href: "/admin/coord/notifications",
    label: "Notifications",
    icon: Bell,
    testId: "coord-nav-notifications",
  },
];

/** The fleet alarm links to the Dev Ops overview, where it is explained. */
const DEVOPS_OVERVIEW: NavLeaf = {
  href: "/admin/coord/devops",
  label: "Dev Ops",
  icon: Server,
  testId: "coord-nav-devops-overview",
};

const TAB_BASE =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap";
const TAB_IDLE = "text-muted-foreground hover:text-foreground hover:bg-muted";
const TAB_ACTIVE = "bg-primary text-primary-foreground";

export default function CoordNav() {
  const pathname = usePathname() ?? "";
  const alertsBadge = useAlertsBadge();
  const notificationsBadge = useNotificationsBadge();
  // The fleet alarm that used to live on the pipeline page's collapsed
  // `System details` header. It is read here, on the nav, so a red fleet is
  // visible from every console page instead of from one — and so the pipeline
  // page can stop polling `/fleet/health` and `/fleet/resource-samples`
  // altogether.
  const fleetAlarm = useFleetAlarmBadge();

  const renderDirect = (leaf: NavLeaf) => {
    const Icon = leaf.icon;
    const active = isLeafActive(pathname, leaf);
    // Per-tab count badge. Zero renders nothing at all — an empty surface
    // should look empty, not like a surface reporting "0".
    const badge =
      leaf.testId === "coord-nav-alerts"
        ? {
            testId: "coord-nav-alerts-badge",
            count: alertsBadge.count,
            // `false` means the deployed coord served no `total_count`, so
            // the number is a LOWER BOUND and gets the `≥` qualifier rather
            // than being printed as if it were the truth.
            totalKnown: alertsBadge.known,
            hasRead: alertsBadge.hasRead,
            stale: alertsBadge.stale,
            // A retained `critical` is not allowed to outrank a FRESHER count
            // that says zero. Before the retained-zero gate below, `count === 0`
            // could not render at all, so this was unreachable; the gate made
            // it reachable and it renders as `0*` in a red pill — the accent
            // claiming an unresolved critical, the number claiming none, and
            // the accent being both the loudest and the older of the two.
            critical: alertsBadge.critical && alertsBadge.count > 0,
            criticalKnown: alertsBadge.criticalKnown,
            criticalStale: alertsBadge.criticalStale,
            // Three arms, not two. Suppressing the `≥` glyph on a zero and
            // leaving the SENTENCE would have moved the vacuous claim into the
            // channel the fix routed everything else into: "at LEAST" zero is
            // true of every state there is. And the fresh-total sentence is not
            // the fallback either — saying "coord's unpaged total" about a
            // build that served no total would trade one false claim for a
            // worse one.
            title: alertsBadge.known
              ? "unresolved alerts (coord's unpaged total)"
              : alertsBadge.count > 0
                ? "this coord build does not report a total — at LEAST this many"
                : "this coord build does not report a total, and the window it served was empty — how many there are is UNKNOWN",
          }
        : leaf.testId === "coord-nav-notifications"
          ? {
              testId: "coord-nav-notifications-badge",
              count: notificationsBadge.count,
              // Notifications are events, not conditions — nothing about an
              // unread count is "critical", so it never takes the red accent.
              critical: false,
              // The unread count arrives as an exact scalar, so there is no
              // lower-bound concept here at all: `undefined` (not `true`)
              // keeps `data-total-known` off this badge entirely rather than
              // asserting a property the surface does not have.
              totalKnown: undefined as boolean | undefined,
              hasRead: notificationsBadge.hasRead,
              stale: notificationsBadge.stale,
              // Notifications have no severity axis at all, so these stay off
              // the badge entirely rather than asserting a property the
              // surface does not have — the same reasoning as `totalKnown`.
              criticalKnown: undefined as boolean | undefined,
              criticalStale: undefined as boolean | undefined,
              // It HAD no title at all, alone among the badges this nav
              // renders — so the one channel that could have carried the
              // staleness qualification was empty, and a hover over the
              // number said nothing about where it came from.
              title: "unread notifications (coord's per-principal scalar)",
            }
          : null;
    return (
      <Link
        key={leaf.href}
        href={leaf.href}
        data-testid={leaf.testId}
        className={cn(TAB_BASE, active ? TAB_ACTIVE : TAB_IDLE)}
      >
        <Icon className="h-3.5 w-3.5" />
        {leaf.label}
        {/* A count of zero renders nothing — an empty surface should look
            empty. The one exception is a zero we RETAINED: `hasRead && stale`
            means coord's last answer was 0 and we can no longer tell, and
            rendering nothing there states the absence in the loudest medium
            there is. A zero never read still renders nothing, having no
            retained fact to qualify. */}
        {badge && (badge.count > 0 || (badge.hasRead && badge.stale)) && (
          <span
            data-testid={badge.testId}
            className={cn(
              "rounded-full px-1.5 text-[10px] font-bold leading-4",
              badge.critical
                ? "bg-red-500/25 text-red-200"
                : active
                  ? "bg-primary-foreground/20"
                  : "bg-muted text-foreground"
            )}
            title={[
              badge.title,
              badge.stale ? STALE_TITLE_SUFFIX : null,
              // Ordered after the count's own clause: the number is what the
              // badge primarily says, and the accent qualifies it.
              badge.criticalKnown === false
                ? CRITICAL_UNKNOWN_CLAUSE
                : badge.criticalStale
                  ? CRITICAL_STALE_CLAUSE
                  : null,
            ]
              .filter(Boolean)
              .join(" ")}
            data-total-known={badge.totalKnown}
            data-critical-known={badge.criticalKnown}
            data-critical-stale={badge.criticalStale}
            // Emitted in both states — unlike `data-total-known` above, which
            // the notifications branch deliberately leaves `undefined` so React
            // omits it. Here `"false"` is a real answer ("the last read
            // replaced this number"), distinct from a badge that never asked.
            data-read-stale={badge.stale}
          >
            {/* `≥` only where it says something. "At least zero" is true of
                every state there is, and the degraded arm reaches exactly that
                whenever an un-upgraded coord answers with an empty window —
                so the lower bound would arrive information-free, and stacked
                with `*`, in the one place the design is trying to stay
                legible. */}
            {badge.totalKnown === false && badge.count > 0 ? "≥" : ""}
            {badge.count}
            {/* Visible, and not a colour or an opacity. Dimming the number was
                the first cut, and it makes the STALE state the hardest one to
                READ — 10px bold text at 60% — which inverts the point. `*` is
                the ordinary "see the note" marker, it survives at any contrast,
                and it composes with `≥` where both apply (`≥2*`). */}
            {badge.stale ? "*" : ""}
            {/* The note itself, for anyone not holding a mouse. `title` is not
                an accessible name here: the accessible name of the enclosing
                link is computed from its descendants' CONTENT, and this span
                has content, so a screen reader announces "Notifications 7"
                identically in both states and the tooltip is never reached.
                Nor is a `title` on a non-focusable span reachable by keyboard.
                Without this line the qualification is a sighted-mouse-user
                feature, which leaves everyone else with exactly the unqualified
                claim being fixed. */}
            {(badge.stale ||
              badge.criticalKnown === false ||
              badge.criticalStale) && (
              <span className="sr-only">
                {" "}
                {badge.stale ? STALE_TITLE_SUFFIX : ""}
                {badge.criticalKnown === false
                  ? ` ${CRITICAL_UNKNOWN_CLAUSE}`
                  : badge.criticalStale
                    ? ` ${CRITICAL_STALE_CLAUSE}`
                    : ""}
              </span>
            )}
          </span>
        )}
      </Link>
    );
  };

  const active = findActiveLeaf(pathname);

  return (
    <nav
      data-testid="coord-nav"
      className="flex items-center gap-1 flex-wrap min-w-0"
    >
      {active && (
        <span
          data-testid="coord-nav-crumb"
          className="flex items-center gap-1.5 px-1 text-sm font-medium whitespace-nowrap"
        >
          {active.group && (
            <>
              <span className="text-muted-foreground">{active.group.label}</span>
              <span className="opacity-60">·</span>
            </>
          )}
          {/* `-active` suffix: Spec-CI "active section" assertions match it. */}
          <span data-testid={`${active.leaf.testId}-active`}>
            {active.leaf.label}
          </span>
        </span>
      )}
      <div className="mx-1 h-5 w-px bg-border" aria-hidden />
      {STATUS_LINKS.map(renderDirect)}
      <Link
        href={DEVOPS_OVERVIEW.href}
        data-testid="coord-nav-devops-alarm"
        className={cn(
          TAB_BASE,
          isLeafActive(pathname, DEVOPS_OVERVIEW) ? TAB_ACTIVE : TAB_IDLE
        )}
      >
        <Server className="h-3.5 w-3.5" />
        Dev Ops
        <FleetAlarmBadges alarm={fleetAlarm} />
      </Link>
    </nav>
  );
}

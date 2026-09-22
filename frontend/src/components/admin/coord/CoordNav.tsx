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
 *   Notifications(•N)  Dev Ops(alarms)   ← live badges
 *
 * Wayfinding contract: the crumb carries `<page-testid>-active` (e.g.
 * `coord-nav-lands-active`) so Spec-CI "active section" assertions keep a
 * stable target.
 *
 * Notifications carries an unread badge because an unread badge is only
 * useful where it is always visible (plan
 * `2026-08-05-coord-notifications-type-and-tab.md`). The Alerts link and its
 * unresolved-alerts badge were removed by plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 8: the raw alert list is agents' work, and the operator's rollup of
 * it — which open conditions no agent is handling — is the Conditions panel
 * on the Dev Ops page this row's alarm links to.
 */

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Server } from "lucide-react";
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

/** `?limit=1`: the badge wants the `unread_count` SCALAR, not the page.
 *  Asking for one row keeps a nav-wide 60s poll cheap on every console
 *  page while still carrying the count. */
const NOTIFICATIONS_API = "/api/v1/operations/notifications?limit=1";
/** One poll a minute, deliberately NOT the page-level
 *  `POLL_INTERVAL_MS = 10_000`: the nav badge is a background hint rendered on
 *  every console page, the page poller is the foreground surface. Do not raise
 *  this to 10s. */
const NOTIFICATIONS_POLL_MS = 60_000;

/** Live UNREAD-notification count for the Notifications tab badge.
 *
 *  Best-effort: a failed poll (including coord's
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
 * One suffix shared by every badge on this row rather than a hand-written
 * title per badge, because spelling every combination out is how they drift
 * apart. The qualification is the same sentence either way — it is a statement
 * about the READ, not about what was counted.
 *
 * It says *"the most recent read did not replace it"* and NOT *"the most recent
 * poll failed"*, which is what it said first and which is false in a reachable
 * state this file itself produces: a 2xx carrying no scalar (the read landed).
 * A tooltip that diagnoses a cause the flag does not carry is the same
 * over-claim the flag exists to stop.
 */
const STALE_TITLE_SUFFIX =
  "— from an earlier read. The most recent read did not replace it, so what " +
  "has happened since is unknown. It is not a floor: it can be wrong in " +
  "either direction.";

/** The event surface whose count badge lives on the header. Its `testId`
 *  matches the sidebar model's leaf for the same page. */
const STATUS_LINKS: NavLeaf[] = [
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
      leaf.testId === "coord-nav-notifications"
        ? {
            testId: "coord-nav-notifications-badge",
            count: notificationsBadge.count,
            hasRead: notificationsBadge.hasRead,
            stale: notificationsBadge.stale,
            // Notifications are events, not conditions — nothing about an
            // unread count is "critical", so the badge never takes a red
            // accent, and the unread count arrives as an exact scalar, so it
            // carries no lower-bound qualifier either.
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
              active ? "bg-primary-foreground/20" : "bg-muted text-foreground"
            )}
            title={[badge.title, badge.stale ? STALE_TITLE_SUFFIX : null]
              .filter(Boolean)
              .join(" ")}
            // Emitted in both states: `"false"` is a real answer ("the last
            // read replaced this number"), distinct from a badge that never
            // asked.
            data-read-stale={badge.stale}
          >
            {badge.count}
            {/* Visible, and not a colour or an opacity. Dimming the number was
                the first cut, and it makes the STALE state the hardest one to
                READ — 10px bold text at 60% — which inverts the point. `*` is
                the ordinary "see the note" marker and it survives at any
                contrast. */}
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
            {badge.stale && (
              <span className="sr-only"> {STALE_TITLE_SUFFIX}</span>
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

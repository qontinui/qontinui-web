"use client";

/**
 * Top-level navigation for the /admin/coord/* console.
 *
 * Redesigned per qontinui-dev-notes/prompts/
 * coord-fleet-page-redesign-2026-07-14.md (nav follow-up): the previous nav
 * rendered every console page as a flat tab — 14 for a member, 24 for an
 * operator, wrapping to three rows. This version keeps the four
 * highest-frequency destinations as direct tabs and folds the rest into
 * persona-shaped dropdown groups, mirroring the fleet-page split
 * (developer / merge maintainer / fleet operator):
 *
 *   Pipeline · Pull Requests · Gates · Alerts(•N) · Notifications(•N)
 *                                                   ← direct, daily
 *   Work ▾    Plans / Plan Library / Questions / Agents / History / Lands
 *   Merge ▾   Pull Decisions / Automation Rules / Gate Clearance /
 *             Merge Settings°
 *   Intent ▾  Prompt Documents / Policies / Policy Edit Review
 *   Dev Ops ▾ Overview / Trees° / Spawn° / Test Targets° / Migrations° /
 *             Deploys° / Releases° / Git Ops° / Federation° / Memory° /
 *             Onboarding° / Onboarding Status°
 *   Access ▾  Members / Claims↗ / Sessions↗          (° = operator-only)
 *
 * `Dev Ops ▾` is the one group whose TRIGGER is member-visible while almost
 * every member of it is not: `Overview` (`/admin/coord/devops` — how the
 * system is functioning) is tenant-visible, everything else stays
 * operator-only. Plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 1, resolved Q3
 * — coord moved the CI-node write off the admin role precisely so a member
 * who OWNS a device can configure it, and gating this page on `is_superuser`
 * would rebuild that mistake in the console.
 *
 * Wayfinding contract: when the current page lives inside a group, the
 * group trigger highlights and appends the page name ("Work · Lands"). The
 * appended crumb carries `<page-testid>-active` (e.g. `coord-nav-lands-active`)
 * so Spec-CI "active section" assertions have a stable target even though
 * the menu items themselves unmount while a menu is closed; the canonical
 * `coord-nav-<x>` ids stay on the menu items.
 *
 * The Alerts tab polls the unresolved-alerts rollup for a live count badge
 * (red when any unresolved alert is critical) — the nav-level analogue of
 * the fleet page's traffic light.
 *
 * Notifications is the FIFTH direct tab, and that is a deliberate, argued
 * exception to the four-tab rule above rather than an oversight
 * (plan `2026-08-05-coord-notifications-type-and-tab.md`, Change 4).
 * Two reasons, in order:
 *
 *  1. Its unread badge is not satisfiable from inside a collapsed dropdown —
 *     a group trigger shows the GROUP name, not a per-item count, so an
 *     unread count on a menu item is invisible until the menu is opened,
 *     which defeats the point of the badge entirely.
 *  2. Notifications ("what happened while I was away?") is a daily-cadence
 *     surface by the type's own definition, which is the stated admission
 *     criterion for a direct tab. It sits immediately after Alerts so the
 *     two event surfaces read as a pair.
 *
 * The cost, said plainly: the direct row is now five wide. That still fits
 * one row at normal widths. If a SIXTH is ever proposed, revisit the group
 * split rather than appending again.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Anchor,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  ChevronDown,
  Compass,
  ExternalLink,
  FileText,
  Gauge,
  Gavel,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Hammer,
  History as HistoryIcon,
  Inbox,
  KeyRound,
  Layers,
  Library,
  MessageSquare,
  NotebookText,
  Package,
  Plug,
  Rocket,
  Scale,
  ScrollText,
  Server,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
  Workflow,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { NOTIFICATIONS_REQUEST_OPTIONS } from "@/components/admin/coord/notificationStatus";
import { useFleetAlarmBadge } from "@/components/admin/coord/useFleetAlarmBadge";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { createReadSequence } from "@/components/console";
import type { FleetAlarmBadge } from "@/components/admin/coord/useFleetAlarmBadge";

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

interface NavLeaf {
  href: string;
  label: string;
  icon: typeof Activity;
  testId: string;
  /** Renders in a new-tabish "cross-link" style (external observability page). */
  external?: boolean;
  /**
   * Operator-infrastructure-only — cross-tenant / fleet-wide surfaces with no
   * tenant-scoped meaning for a developer. Rendered only for operators
   * (`user.is_superuser`); the backend enforces tenant scoping on everything
   * a member can reach.
   */
  operatorOnly?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  icon: typeof Activity;
  items: NavLeaf[];
  /**
   * Group hidden entirely for non-operators — trigger and all.
   *
   * This is NOT "every item is operator-only", and has not been since
   * `Dev Ops ▾` (resolved Q3 of
   * `2026-08-25-coord-console-intent-and-devops-sections`): that group drops
   * this flag and marks every member except `Overview` instead, so a plain
   * member sees the trigger with one entry under it. The two flags are
   * independent by construction — `renderGroup` drops the group on THIS flag
   * and filters items on `NavLeaf.operatorOnly` separately — so set this one
   * only when the group has nothing a member may reach, and never as a
   * shorthand for "most of its items are operator-only".
   */
  operatorOnly?: boolean;
}

// The redesigned merge-pipeline view (one row per PR) is member-visible and
// named for what a developer comes for. The ROUTE now says so too:
// `/admin/coord/fleet` became `/admin/coord/pipeline` in Phase 4 of
// `2026-08-25-coord-console-intent-and-devops-sections`, because after that
// phase "fleet" means Dev Ops and one word cannot mean two things in one
// console. `next.config.mjs` 308s the old path.
const DIRECT_TABS: NavLeaf[] = [
  {
    href: "/admin/coord/pipeline",
    label: "Pipeline",
    icon: Activity,
    testId: "coord-nav-pipeline",
  },
  {
    href: "/admin/coord/prs",
    label: "Pull Requests",
    icon: GitPullRequest,
    testId: "coord-nav-prs",
  },
  {
    href: "/admin/coord/gates",
    label: "Gates",
    icon: Gauge,
    testId: "coord-nav-gates",
  },
  {
    href: "/admin/coord/alerts",
    label: "Alerts",
    icon: AlertTriangle,
    testId: "coord-nav-alerts",
  },
  {
    // Fifth direct tab by argued exception — see the header block. Placed
    // immediately after Alerts: conditions ("what is wrong now?") and
    // events ("what happened while I was away?") read as a pair.
    href: "/admin/coord/notifications",
    label: "Notifications",
    icon: Bell,
    testId: "coord-nav-notifications",
  },
];

const GROUPS: NavGroup[] = [
  {
    id: "work",
    label: "Work",
    icon: Hammer,
    items: [
      {
        href: "/admin/coord/plans",
        label: "Plans",
        icon: FileText,
        testId: "coord-nav-plans",
      },
      {
        // Sits beside Plans deliberately: Plans is coord's work units, this is
        // the prompt/plan CORPUS those units are authored from. Distinct path
        // (not /plans/library) so the Plans item's startsWith active-match
        // doesn't double-highlight — same reasoning as the Onboarding pair.
        href: "/admin/coord/plan-library",
        label: "Plan Library",
        icon: Library,
        testId: "coord-nav-plan-library",
      },
      {
        href: "/admin/coord/questions",
        label: "Questions",
        icon: Inbox,
        testId: "coord-nav-questions",
      },
      {
        href: "/admin/coord/agents",
        label: "Agents",
        icon: ScrollText,
        testId: "coord-nav-agents",
      },
      {
        href: "/admin/coord/prompt-injections",
        label: "Prompt Log",
        icon: MessageSquare,
        testId: "coord-nav-prompt-injections",
      },
      {
        href: "/admin/coord/history",
        label: "History",
        icon: HistoryIcon,
        testId: "coord-nav-history",
      },
      {
        href: "/admin/coord/lands",
        label: "Lands",
        icon: Anchor,
        testId: "coord-nav-lands",
      },
    ],
  },
  {
    id: "merge",
    label: "Merge",
    icon: GitMerge,
    items: [
      {
        href: "/admin/coord/pull-decisions",
        label: "Pull Decisions",
        icon: GitPullRequest,
        testId: "coord-nav-pull-decisions",
      },
      {
        href: "/admin/coord/automation-rules",
        label: "Automation Rules",
        icon: Workflow,
        testId: "coord-nav-automation-rules",
      },
      {
        // STAYS in Merge, and that is a decision rather than an oversight
        // (`2026-08-25-coord-console-intent-and-devops-sections` Phase 3,
        // resolved Q2). It shares the one coord-policy CRUD chain with
        // Automation Rules — both `gate-clearance/_hooks/useGateClearanceRules`
        // and `automation-rules/_hooks/useAutomationRules` build on
        // `_shared/useCoordPolicies` — so it authors `coord.policy_rules` rows
        // the way Automation Rules does. But what it authors rows ABOUT is who
        // may clear a **gate**, and a gate is merge-chain machinery: filing it
        // under `Intent ▾` on the strength of the word "policy" would be the
        // very conflation that moved Prompt Documents / Policies / Policy Edit
        // Review OUT of this group, run in reverse. The Gates page also links
        // across to it from the gate context — the direct row is already at its
        // five-tab cap, see the header note.
        href: "/admin/coord/gate-clearance",
        label: "Gate Clearance",
        icon: ShieldCheck,
        testId: "coord-nav-gate-clearance",
      },
      {
        href: "/admin/coord/merge-settings",
        label: "Merge Settings",
        icon: GitMerge,
        testId: "coord-nav-merge-settings",
        operatorOnly: true,
      },
    ],
  },
  {
    // What the tenant is BUILDING and the standing guidance agents read while
    // building it — the prompt-shaped document cluster that used to sit under
    // `Merge ▾` for no recorded reason. None of these three is read by the
    // merge train, gates a PR, or appears in a merge decision. Moved here by
    // `2026-08-25-coord-console-intent-and-devops-sections` Phase 3 (Gap 1).
    //
    // On the label — three names were rejected and one tiebreak was decided:
    //  - NOT `Digital Twin`, despite that being the operator's framing: the
    //    app sidebar already uses that name for the *observed-system* twin
    //    (`navigation/sidebar/nav-items.ts` — CI state, routing, dependencies,
    //    health, deploy freshness), and reusing it collides with a large
    //    shipped subsystem.
    //  - NOT `Policies` / `Rules` / `Guidance`: plan
    //    `2026-08-21-project-intent-documents-and-the-selection-loop`
    //    §"Naming constraint" forbids those for these documents, and `/policy`
    //    already means agent-behaviour rules fleet-wide.
    //  - `Intent` over `Direction` (both were live): `Intent` is the vocabulary
    //    of the plan that FILLS this section — `policy = how to act, intent =
    //    what to build`. Two plans, one word.
    //
    // Ownership: `2026-08-21-project-intent-documents-and-the-selection-loop`
    // §3c describes this same edit and is also VETTED. The nav section landed
    // HERE, because Phase 1 of the sections plan had already rewritten this
    // file — two PRs editing `GROUPS` with no shared base is a conflict by
    // construction. Do not implement it a second time from that plan.
    //
    // Member-visible, trigger and items alike: every one of the three is a
    // tenant-scoped surface today and none carries `operatorOnly`.
    id: "intent",
    label: "Intent",
    icon: Compass,
    items: [
      {
        href: "/admin/coord/prompt-documents",
        label: "Prompt Documents",
        icon: NotebookText,
        testId: "coord-nav-prompt-documents",
      },
      {
        href: "/admin/coord/policies",
        label: "Policies",
        icon: Scale,
        testId: "coord-nav-policies",
      },
      {
        // Sits beside Prompt Documents deliberately: it reviews edits TO those
        // documents. Distinct path (not /prompt-documents/proposals) so the
        // Prompt Documents item's startsWith active-match doesn't
        // double-highlight, matching the Onboarding / Onboarding Status pair.
        href: "/admin/coord/prompt-document-proposals",
        label: "Policy Edit Review",
        icon: Gavel,
        testId: "coord-nav-prompt-document-proposals",
      },
    ],
  },
  {
    // Everything about the hardware the fleet runs on: whose machines they
    // are, what they are doing, and how much they will take. The GROUP is
    // member-visible and its members are not — see `NavGroup.operatorOnly`.
    id: "devops",
    label: "Dev Ops",
    icon: Server,
    items: [
      {
        // The only tenant-visible member, and the reason the group flag is
        // gone: "how is the system functioning" is a question a developer
        // asks about their own machines.
        href: "/admin/coord/devops",
        label: "Overview",
        icon: Gauge,
        testId: "coord-nav-devops-overview",
      },
      {
        href: "/admin/coord/trees",
        label: "Trees",
        icon: Boxes,
        testId: "coord-nav-trees",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/spawn",
        label: "Spawn",
        icon: Rocket,
        testId: "coord-nav-spawn",
        operatorOnly: true,
      },
      {
        // Its own route since Phase 4, not a disclosure two levels deep inside
        // the pipeline page: it is a config editor with four write paths
        // (`PATCH /fleet/apps/{id}`, `PUT`/`DELETE
        // /fleet/test-targets/{device}/{app}`, `POST /dispatch/fresh-host`),
        // and a config editor buried inside another domain's page is a defect.
        href: "/admin/coord/test-targets",
        label: "Test Targets",
        icon: Rocket,
        testId: "coord-nav-test-targets",
        operatorOnly: true,
      },
      {
        // Dev Ops rather than Merge (resolved Q4): the alembic reservation
        // queue is a shared RESOURCE, and blocking a PR is a consequence of
        // contention on it, not what it is. The merge-side need is carried by
        // a cross-link from a waiting `MergePipeline` row.
        href: "/admin/coord/migrations",
        label: "Migrations",
        icon: Layers,
        testId: "coord-nav-migrations",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/deploys",
        label: "Deploys",
        icon: Rocket,
        testId: "coord-nav-deploys",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/releases",
        label: "Releases",
        icon: Package,
        testId: "coord-nav-releases",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/git-ops",
        label: "Git Ops",
        icon: GitBranch,
        testId: "coord-nav-git-ops",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/federation",
        label: "Federation",
        icon: GitMerge,
        testId: "coord-nav-federation",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/memory",
        label: "Memory",
        icon: BookOpen,
        testId: "coord-nav-memory",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/onboarding",
        label: "Onboarding",
        icon: Plug,
        testId: "coord-nav-onboarding",
        operatorOnly: true,
      },
      {
        // Zero-touch onboarding status (P4) — per-repo doctor checklist. Also
        // the GitHub App's post-install Setup URL target (accepts ?repo=…).
        // Distinct path (not /onboarding/status) so the Onboarding item's
        // startsWith active-match doesn't double-highlight.
        href: "/admin/coord/onboarding-status",
        label: "Onboarding Status",
        icon: Stethoscope,
        testId: "coord-nav-onboarding-status",
        operatorOnly: true,
      },
    ],
  },
  {
    id: "access",
    label: "Access",
    icon: KeyRound,
    items: [
      {
        href: "/admin/coord/members",
        label: "Members",
        icon: UserCog,
        testId: "coord-nav-members",
      },
      {
        // The tenant DEFAULT for each agent — what a member with no recorded
        // preference gets. A member's own preference lives at
        // /settings/agents, which is not a console surface.
        href: "/admin/coord/agent-registry",
        label: "Agent Registry",
        icon: Bot,
        testId: "coord-nav-agent-registry",
      },
      {
        href: "/admin/agent-claims",
        label: "Claims",
        icon: ShieldCheck,
        testId: "coord-nav-claims",
        external: true,
      },
      {
        href: "/admin/agent-sessions",
        label: "Sessions",
        icon: Users,
        testId: "coord-nav-sessions",
        external: true,
      },
    ],
  },
];

function isLeafActive(pathname: string, leaf: NavLeaf): boolean {
  return (
    !leaf.external &&
    (pathname === leaf.href || pathname.startsWith(leaf.href + "/"))
  );
}

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
 * One retained value, and the honest answer to "did the latest read refresh
 * it?".
 *
 * Both nav badges keep their last good value across a failed poll — the right
 * call, and half of R6's stale arm; the other half is saying so. Three axes
 * across the two badges owe the same bookkeeping (the alert count, the
 * critical flag, the unread count), and hand-rolling it three times is the
 * drift this lineage exists to stop.
 *
 * The arithmetic is `console/readSequence.ts` — imported, not re-spelled,
 * because `/admin/coord/notifications` needs the same verdict about the same
 * scalar and two spellings of it drift invisibly. That module carries the
 * argument for why staleness is a comparison of SEQUENCES rather than a flag
 * set in a `catch`, and both wrong answers that produced it. This hook is the
 * React shell around it: state for what renders, refs for what settles.
 *
 * `hasRead` is separate: has any read ever delivered? It gates the RETAINED
 * ZERO — see the render gate — and a value never read has no retained fact to
 * qualify.
 */
function useRetainedValue<T>(initial: T): {
  value: T;
  hasRead: boolean;
  stale: boolean;
  /** @returns whether this response's value was applied. */
  settle: (seq: number, delivered: { value: T } | null) => boolean;
} {
  const [value, setValue] = useState<T>(initial);
  const [hasRead, setHasRead] = useState(false);
  const [stale, setStale] = useState(false);
  // The sequence lives in a ref: `settle` has to read its own writes in the
  // same tick, and state does not update synchronously.
  const seqRef = useRef<ReturnType<typeof createReadSequence> | null>(null);
  if (seqRef.current === null) seqRef.current = createReadSequence();

  const settle = useCallback(
    (seq: number, delivered: { value: T } | null): boolean => {
      const sequence = seqRef.current!;
      const applied = sequence.settle(seq, delivered !== null);
      if (applied && delivered) {
        setValue(delivered.value);
        setHasRead(true);
      }
      setStale(sequence.isStale());
      return applied;
    },
    []
  );

  return { value, hasRead, stale, settle };
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
  const seqRef = useRef(0);
  const { settle: settleCount } = countAxis;
  const { settle: settleCritical } = criticalAxis;

  const fetchCount = useCallback(async () => {
    const seq = ++seqRef.current;
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
        settleCritical(seq, { value: critTotal > 0 });
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
        settleCritical(seq, { value: true });
      } else {
        // ...and absence does NOT. This arm used to answer `false` here, which
        // asserts a fleet-wide negative from a `limit=1` window: the 2026-08-14
        // defect above, inverted. That one was "a flag that is always on
        // carries no information"; answering `false` from an empty sample is
        // the same error pointed the other way, and it is worse, because it is
        // the reassuring direction. A read that did not answer the question
        // settles as a NON-delivery, and the badge says the accent is unknown.
        settleCritical(seq, null);
      }
    } else {
      log.warn("alerts badge severity fetch failed", criticals.reason);
      settleCritical(seq, null);
    }
  }, [settleCount, settleCritical]);

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
  const seqRef = useRef(0);
  const { settle } = countAxis;

  const fetchCount = useCallback(async () => {
    const seq = ++seqRef.current;
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
  }, [settle]);

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
 * The fleet alarm, on the `Dev Ops ▾` trigger.
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
 */
function FleetAlarmBadges({ counts }: { counts: FleetAlarmBadge }) {
  const badges: Array<{
    key: string;
    testId: string;
    count: number;
    label: string;
    tone: "critical" | "attention" | "muted";
    title: string;
  }> = [
    {
      key: "unhealthy",
      testId: "coord-nav-devops-unhealthy-badge",
      count: counts.unhealthy,
      label: "unhealthy",
      tone: "critical",
      title: "machines coord reports in a state other than healthy",
    },
    {
      key: "breach",
      testId: "coord-nav-devops-breach-badge",
      count: counts.breach,
      label: "refusing work",
      tone: "critical",
      title: "lanes below the floor coord's admission actually enforces",
    },
    {
      key: "warn",
      testId: "coord-nav-devops-warn-badge",
      count: counts.warn,
      label: "delaying work",
      tone: "attention",
      title: "lanes inside coord's amber band — work is deferred, not rejected",
    },
    {
      key: "stale",
      testId: "coord-nav-devops-stale-badge",
      count: counts.stale,
      label: "stale",
      tone: "muted",
      title: "lanes whose last sample is too old to be a claim about now",
    },
    {
      key: "unknown",
      testId: "coord-nav-devops-unknown-badge",
      count: counts.unknown,
      label: "unknown",
      tone: "muted",
      title:
        "lanes coord reports no admission verdict for — not healthy, not red",
    },
  ];
  return (
    <>
      {badges
        .filter((b) => b.count > 0)
        .map((b) => (
          <span
            key={b.key}
            data-testid={b.testId}
            title={b.title}
            className={cn(
              "rounded-full px-1.5 text-[10px] font-bold leading-4 whitespace-nowrap",
              b.tone === "critical"
                ? "bg-red-500/25 text-red-200"
                : b.tone === "attention"
                  ? "bg-amber-500/25 text-amber-200"
                  : "bg-muted text-foreground"
            )}
          >
            {b.count} {b.label}
          </span>
        ))}
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

const TAB_BASE =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap";
const TAB_IDLE = "text-muted-foreground hover:text-foreground hover:bg-muted";
const TAB_ACTIVE = "bg-primary text-primary-foreground";

export default function CoordNav() {
  const pathname = usePathname() ?? "";
  const { user } = useAuth();
  const alertsBadge = useAlertsBadge();
  const notificationsBadge = useNotificationsBadge();
  // The fleet alarm that used to live on the pipeline page's collapsed
  // `System details` header. It is read here, on the nav, so a red fleet is
  // visible from every console page instead of from one — and so the pipeline
  // page can stop polling `/fleet/health` and `/fleet/resource-samples`
  // altogether.
  const fleetAlarm = useFleetAlarmBadge();

  // Operator-infra entries are cross-tenant/fleet-wide surfaces — gate them on
  // `is_superuser` (the operator axis), matching the other operator-only admin
  // pages in this app. `isCoordAdmin` is deliberately NOT used here: it also
  // grants coord-*tenant* admins, and it is the app's convention for
  // tenant-scoped *mutation* control gating (see CoordAdminOnly.tsx), not for
  // hiding operator-infra navigation.
  const isOperator = user?.is_superuser === true;

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

  const renderGroup = (group: NavGroup) => {
    if (group.operatorOnly && !isOperator) return null;
    const items = group.items.filter((i) => !i.operatorOnly || isOperator);
    if (items.length === 0) return null;
    const GroupIcon = group.icon;
    const activeItem = items.find((i) => isLeafActive(pathname, i)) ?? null;
    return (
      <DropdownMenu key={group.id}>
        <DropdownMenuTrigger
          data-testid={`coord-nav-group-${group.id}`}
          className={cn(TAB_BASE, activeItem ? TAB_ACTIVE : TAB_IDLE)}
        >
          <GroupIcon className="h-3.5 w-3.5" />
          {group.label}
          {group.id === "devops" && <FleetAlarmBadges counts={fleetAlarm} />}
          {activeItem && (
            <>
              <span className="opacity-60">·</span>
              {/* Wayfinding crumb. `-active` suffix (not the canonical
                  testid): the canonical id belongs to the menu item, and the
                  two would collide in strict selectors while the menu is
                  open. Spec-CI "active section" assertions match this id. */}
              <span data-testid={`${activeItem.testId}-active`}>
                {activeItem.label}
              </span>
            </>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[190px]">
          {items.map((leaf) => {
            const Icon = leaf.icon;
            const active = isLeafActive(pathname, leaf);
            return (
              <DropdownMenuItem key={leaf.href} asChild>
                <Link
                  href={leaf.href}
                  // Canonical testid stays on the menu item so existing e2e
                  // selectors keep working once the group menu is open.
                  data-testid={leaf.testId}
                  className={cn(
                    "flex items-center gap-2 cursor-pointer",
                    active && "bg-muted"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {leaf.label}
                  {leaf.external && (
                    <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
                  )}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <nav
      data-testid="coord-nav"
      className="flex items-center gap-1 flex-wrap min-w-0"
    >
      {DIRECT_TABS.map(renderDirect)}
      {GROUPS.map(renderGroup)}
    </nav>
  );
}

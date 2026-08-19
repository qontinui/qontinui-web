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
 *   Merge ▾   Pull Decisions / Policies / Automation Rules / Merge Settings°
 *   Infra ▾°  Trees / Spawn / Deploys / Git Ops / Federation / Memory /
 *             Onboarding / Onboarding Status
 *   Access ▾  Members / Claims↗ / Sessions↗          (° = operator-only)
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

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Anchor,
  Bell,
  BookOpen,
  Boxes,
  ChevronDown,
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
  /** Group hidden entirely for non-operators (every item is operator-only). */
  operatorOnly?: boolean;
}

// The redesigned /admin/coord/fleet page is the developer's merge-pipeline
// view (one row per PR), so the tab is member-visible and named for what a
// developer comes for — the pipeline — rather than the machine fleet.
const DIRECT_TABS: NavLeaf[] = [
  {
    href: "/admin/coord/fleet",
    label: "Pipeline",
    icon: Activity,
    testId: "coord-nav-fleet",
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
        href: "/admin/coord/policies",
        label: "Policies",
        icon: Scale,
        testId: "coord-nav-policies",
      },
      {
        href: "/admin/coord/automation-rules",
        label: "Automation Rules",
        icon: Workflow,
        testId: "coord-nav-automation-rules",
      },
      {
        // Sits with the other coord policy-authoring surfaces (it authors
        // `coord.policy_rules` rows like Policies and Automation Rules do),
        // and the Gates page links across to it from the gate context — the
        // direct row is already at its five-tab cap, see the header note.
        href: "/admin/coord/gate-clearance",
        label: "Gate Clearance",
        icon: ShieldCheck,
        testId: "coord-nav-gate-clearance",
      },
      {
        href: "/admin/coord/prompt-documents",
        label: "Prompt Documents",
        icon: NotebookText,
        testId: "coord-nav-prompt-documents",
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
    id: "infra",
    label: "Infra",
    icon: Server,
    operatorOnly: true,
    items: [
      {
        href: "/admin/coord/trees",
        label: "Trees",
        icon: Boxes,
        testId: "coord-nav-trees",
      },
      {
        href: "/admin/coord/spawn",
        label: "Spawn",
        icon: Rocket,
        testId: "coord-nav-spawn",
      },
      {
        href: "/admin/coord/deploys",
        label: "Deploys",
        icon: Rocket,
        testId: "coord-nav-deploys",
      },
      {
        href: "/admin/coord/releases",
        label: "Releases",
        icon: Package,
        testId: "coord-nav-releases",
      },
      {
        href: "/admin/coord/git-ops",
        label: "Git Ops",
        icon: GitBranch,
        testId: "coord-nav-git-ops",
      },
      {
        href: "/admin/coord/federation",
        label: "Federation",
        icon: GitMerge,
        testId: "coord-nav-federation",
      },
      {
        href: "/admin/coord/memory",
        label: "Memory",
        icon: BookOpen,
        testId: "coord-nav-memory",
      },
      {
        href: "/admin/coord/onboarding",
        label: "Onboarding",
        icon: Plug,
        testId: "coord-nav-onboarding",
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

/** Live unresolved-alert count for the Alerts tab badge. Best-effort — a
 *  failed poll renders no badge, never an error. */
function useAlertsBadge(): { count: number; critical: boolean } {
  const [count, setCount] = useState(0);
  const [critical, setCritical] = useState(false);

  const fetchCount = useCallback(async () => {
    try {
      const body = await httpClient.get<
        { alerts?: Array<{ severity?: string }> } | Array<{ severity?: string }>
      >(ALERTS_API);
      const alerts = Array.isArray(body) ? body : (body.alerts ?? []);
      setCount(alerts.length);
      setCritical(alerts.some((a) => a.severity === "critical"));
    } catch (err) {
      log.warn("alerts badge fetch failed", err);
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const id = setInterval(fetchCount, ALERTS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchCount]);

  return { count, critical };
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
 *  The 503 is opted out of `HttpClient`'s 5xx retry
 *  (`NOTIFICATIONS_REQUEST_OPTIONS`): during the pre-migration window this poll
 *  runs on every console page, and the default policy measures at 5 requests
 *  over ~15s — so retrying would make a badge nobody can see yet cost five
 *  requests a minute per open console tab.
 *
 *  ⚠️ It deliberately does NOT copy `useAlertsBadge`'s `setCount(alerts.length)`.
 *  `/coord/notifications` is genuinely paged, so the returned row count is the
 *  PAGE SIZE — a badge reading it would pin at that constant forever no matter
 *  how many unread events exist. `unread_count` is a server-computed scalar,
 *  distinct from the page, and it is the only honest source for this number. */
function useNotificationsBadge(): { count: number } {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const body = await httpClient.get<{ unread_count?: number }>(
        NOTIFICATIONS_API,
        NOTIFICATIONS_REQUEST_OPTIONS
      );
      const unread = body?.unread_count;
      // A response without the scalar is UNKNOWN, not zero — leave the
      // previous value alone rather than silently clearing the badge.
      if (typeof unread === "number" && Number.isFinite(unread)) {
        setCount(unread);
      }
    } catch (err) {
      log.warn("notifications badge fetch failed", err);
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const id = setInterval(fetchCount, NOTIFICATIONS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchCount]);

  return { count };
}

const TAB_BASE =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap";
const TAB_IDLE = "text-muted-foreground hover:text-foreground hover:bg-muted";
const TAB_ACTIVE = "bg-primary text-primary-foreground";

export default function CoordNav() {
  const pathname = usePathname() ?? "";
  const { user } = useAuth();
  const alertsBadge = useAlertsBadge();
  const notificationsBadge = useNotificationsBadge();

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
            critical: alertsBadge.critical,
          }
        : leaf.testId === "coord-nav-notifications"
          ? {
              testId: "coord-nav-notifications-badge",
              count: notificationsBadge.count,
              // Notifications are events, not conditions — nothing about an
              // unread count is "critical", so it never takes the red accent.
              critical: false,
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
        {badge && badge.count > 0 && (
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
          >
            {badge.count}
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

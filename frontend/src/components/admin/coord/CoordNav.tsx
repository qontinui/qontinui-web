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
 *   Pipeline · Pull Requests · Gates · Alerts(•N)   ← direct, daily
 *   Work ▾    Plans / Questions / Agents / History / Lands
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
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Anchor,
  BookOpen,
  Boxes,
  ChevronDown,
  ExternalLink,
  FileText,
  Gauge,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Hammer,
  History as HistoryIcon,
  Inbox,
  KeyRound,
  NotebookText,
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

const log = createLogger("CoordNav");

const ALERTS_API = "/api/v1/operations/alerts";
/** Alerts churn at incident cadence — one poll a minute keeps the badge
 *  honest without adding meaningful load next to the page-level pollers. */
const ALERTS_POLL_MS = 60_000;

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
        href: "/admin/coord/policy-documents",
        label: "Policy Documents",
        icon: NotebookText,
        testId: "coord-nav-policy-documents",
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

const TAB_BASE =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap";
const TAB_IDLE = "text-muted-foreground hover:text-foreground hover:bg-muted";
const TAB_ACTIVE = "bg-primary text-primary-foreground";

export default function CoordNav() {
  const pathname = usePathname() ?? "";
  const { user } = useAuth();
  const alertsBadge = useAlertsBadge();

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
    const showAlertsBadge =
      leaf.testId === "coord-nav-alerts" && alertsBadge.count > 0;
    return (
      <Link
        key={leaf.href}
        href={leaf.href}
        data-testid={leaf.testId}
        className={cn(TAB_BASE, active ? TAB_ACTIVE : TAB_IDLE)}
      >
        <Icon className="h-3.5 w-3.5" />
        {leaf.label}
        {showAlertsBadge && (
          <span
            data-testid="coord-nav-alerts-badge"
            className={cn(
              "rounded-full px-1.5 text-[10px] font-bold leading-4",
              alertsBadge.critical
                ? "bg-red-500/25 text-red-200"
                : active
                  ? "bg-primary-foreground/20"
                  : "bg-muted text-foreground"
            )}
          >
            {alertsBadge.count}
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

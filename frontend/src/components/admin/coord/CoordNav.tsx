"use client";

/**
 * Top-level navigation shell for the /admin/coord/* operator console.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * Renders five primary tabs (Fleet / Trees / Plans / Alerts / History)
 * plus cross-links to the existing observability surfaces
 * (/admin/agent-claims, /admin/agent-sessions).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Anchor,
  BookOpen,
  Boxes,
  FileText,
  Gauge,
  GitBranch,
  GitMerge,
  GitPullRequest,
  History as HistoryIcon,
  Inbox,
  NotebookText,
  Plug,
  Rocket,
  Scale,
  ScrollText,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Activity;
  testId: string;
  external?: boolean;
  /**
   * Operator-infrastructure-only tab — cross-tenant / fleet-wide surfaces with
   * no tenant-scoped meaning for a developer (fleet health, worktrees, deploys,
   * federation, raw git ops, session spawn, operator memory, global merge
   * settings, GitHub-App onboarding). Rendered only for operators
   * (`user.is_superuser`). Tenant-relevant tabs (PRs, gates, lands, plans,
   * alerts, history, policies, automation rules, pull decisions, members,
   * questions, agents) carry no flag and render for every authenticated member;
   * the backend enforces tenant scoping on their data.
   */
  operatorOnly?: boolean;
}

const PRIMARY_TABS: NavItem[] = [
  {
    href: "/admin/coord/fleet",
    label: "Fleet",
    icon: Activity,
    testId: "coord-nav-fleet",
    operatorOnly: true,
  },
  {
    href: "/admin/coord/trees",
    label: "Trees",
    icon: Boxes,
    testId: "coord-nav-trees",
    operatorOnly: true,
  },
  {
    href: "/admin/coord/plans",
    label: "Plans",
    icon: FileText,
    testId: "coord-nav-plans",
  },
  {
    href: "/admin/coord/gates",
    label: "Gates",
    icon: Gauge,
    testId: "coord-nav-gates",
  },
  {
    href: "/admin/coord/prs",
    label: "Pull Requests",
    icon: GitPullRequest,
    testId: "coord-nav-prs",
  },
  {
    href: "/admin/coord/spawn",
    label: "Spawn",
    icon: Rocket,
    testId: "coord-nav-spawn",
    operatorOnly: true,
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
    href: "/admin/coord/alerts",
    label: "Alerts",
    icon: AlertTriangle,
    testId: "coord-nav-alerts",
  },
  {
    href: "/admin/coord/memory",
    label: "Memory",
    icon: BookOpen,
    testId: "coord-nav-memory",
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
    href: "/admin/coord/git-ops",
    label: "Git Ops",
    icon: GitBranch,
    testId: "coord-nav-git-ops",
    operatorOnly: true,
  },
  {
    href: "/admin/coord/lands",
    label: "Lands",
    icon: Anchor,
    testId: "coord-nav-lands",
  },
  {
    href: "/admin/coord/deploys",
    label: "Deploys",
    icon: Rocket,
    testId: "coord-nav-deploys",
    operatorOnly: true,
  },
  {
    href: "/admin/coord/history",
    label: "History",
    icon: HistoryIcon,
    testId: "coord-nav-history",
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
    href: "/admin/coord/pull-decisions",
    label: "Pull Decisions",
    icon: GitPullRequest,
    testId: "coord-nav-pull-decisions",
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
    // Distinct path (not /onboarding/status) so the Onboarding tab's
    // startsWith active-match doesn't double-highlight.
    href: "/admin/coord/onboarding-status",
    label: "Onboarding Status",
    icon: Stethoscope,
    testId: "coord-nav-onboarding-status",
    operatorOnly: true,
  },
  {
    href: "/admin/coord/merge-settings",
    label: "Merge Settings",
    icon: GitMerge,
    testId: "coord-nav-merge-settings",
    operatorOnly: true,
  },
  {
    href: "/admin/coord/members",
    label: "Members",
    icon: UserCog,
    testId: "coord-nav-members",
  },
];

const CROSS_LINKS: NavItem[] = [
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
];

export default function CoordNav() {
  const pathname = usePathname() ?? "";
  const { user } = useAuth();

  // Operator-infra tabs are cross-tenant/fleet-wide surfaces — gate them on
  // `is_superuser` (the operator axis), matching the other operator-only admin
  // pages in this app (architecture / datasets / automation-rules / …).
  // `isCoordAdmin` is deliberately NOT used here: it also grants coord-*tenant*
  // admins, and it is the app's convention for tenant-scoped *mutation* control
  // gating (see CoordAdminOnly.tsx), not for hiding operator-infra navigation.
  const isOperator = user?.is_superuser === true;
  const visibleTabs = PRIMARY_TABS.filter(
    (item) => !item.operatorOnly || isOperator
  );

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive =
      !item.external &&
      (pathname === item.href || pathname.startsWith(item.href + "/"));
    return (
      <Link
        key={item.href}
        href={item.href}
        data-testid={item.testId}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
          item.external && "opacity-80"
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      data-testid="coord-nav"
      className="flex items-center gap-1 flex-wrap px-3 sm:px-6 py-2 border-b border-border bg-card overflow-x-auto"
    >
      <div className="flex items-center gap-1 flex-wrap">
        {visibleTabs.map(renderItem)}
      </div>
      <div
        className="mx-1 sm:mx-3 h-5 w-px bg-border hidden sm:block"
        aria-hidden
      />
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1 hidden sm:inline">
          cross-links:
        </span>
        {CROSS_LINKS.map(renderItem)}
      </div>
    </nav>
  );
}

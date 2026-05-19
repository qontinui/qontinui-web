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
  Boxes,
  FileText,
  History as HistoryIcon,
  Inbox,
  Rocket,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Activity;
  testId: string;
  external?: boolean;
}

const PRIMARY_TABS: NavItem[] = [
  {
    href: "/admin/coord/fleet",
    label: "Fleet",
    icon: Activity,
    testId: "coord-nav-fleet",
  },
  {
    href: "/admin/coord/trees",
    label: "Trees",
    icon: Boxes,
    testId: "coord-nav-trees",
  },
  {
    href: "/admin/coord/plans",
    label: "Plans",
    icon: FileText,
    testId: "coord-nav-plans",
  },
  {
    href: "/admin/coord/spawn",
    label: "Spawn",
    icon: Rocket,
    testId: "coord-nav-spawn",
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
    href: "/admin/coord/history",
    label: "History",
    icon: HistoryIcon,
    testId: "coord-nav-history",
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
        {PRIMARY_TABS.map(renderItem)}
      </div>
      <div className="mx-1 sm:mx-3 h-5 w-px bg-border hidden sm:block" aria-hidden />
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1 hidden sm:inline">
          cross-links:
        </span>
        {CROSS_LINKS.map(renderItem)}
      </div>
    </nav>
  );
}

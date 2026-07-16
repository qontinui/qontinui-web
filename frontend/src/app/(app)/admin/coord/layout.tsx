"use client";

/**
 * /admin/coord/* — operator console shell.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * Admin-gates every page below this layout, renders the CoordNav, and
 * routes the page body. Five primary pages:
 *  - /admin/coord/fleet
 *  - /admin/coord/trees
 *  - /admin/coord/plans (+ /admin/coord/plans/[slug])
 *  - /admin/coord/alerts
 *  - /admin/coord/history
 *
 * Cross-links to /admin/agent-claims (PR #156) and /admin/agent-sessions
 * (PR #158) live in CoordNav.
 */

import { Activity } from "lucide-react";
import CoordNav from "@/components/admin/coord/CoordNav";
import { CoordTenantSwitcher } from "@/components/admin/coord/CoordTenantSwitcher";
import RedMainBanner from "@/components/admin/coord/RedMainBanner";

export default function CoordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Any authenticated tenant member may VIEW the coordination pages. The
  // parent `(app)` AppAuthGate already redirects truly-unauthenticated
  // visitors to /login, so no per-section auth guard is needed here.
  // Mutation controls within each page gate on `isCoordAdmin` (read from
  // useAuth) so non-admin "Developer"-tier members see read-only views.
  return (
    <div
      data-testid="coord-layout"
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
    >
      {/* One chrome row: title + grouped nav + tenant switcher (the old
          two-row header/nav stack folded together — nav redesign). The h1
          keeps its exact text: e2e + page specs assert it by role/name. */}
      <header className="flex items-center gap-2 flex-wrap px-3 sm:px-6 py-2 border-b border-border bg-card shrink-0">
        <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
        <h1 className="text-sm font-semibold whitespace-nowrap">
          Coord operator console
        </h1>
        <div className="mx-1 sm:mx-2 h-5 w-px bg-border hidden sm:block" aria-hidden />
        <CoordNav />
        <div className="ml-auto shrink-0">
          <CoordTenantSwitcher />
        </div>
      </header>

      {/* Red-main outage banner (plan 2026-07-06-coord-red-main-…, Phase 1
          D2): one persistent, non-dismissable row per repo whose main CI is
          red, driven solely by the coord `red_main:<repo>` alert rows.
          Mounted in the layout so it shows on EVERY coord console page. */}
      <RedMainBanner />

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

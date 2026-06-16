"use client";

/**
 * /admin/coord/* — coordination console shell.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * Renders the CoordNav + page body. The console is VIEWABLE by every
 * authenticated user — this layout does NOT gate on any role. Standard
 * `(app)` auth (middleware + AppAuthGate) still requires an authenticated
 * session to reach any page here; an unauthenticated visitor is redirected
 * to /login by that layer, not by this component.
 *
 * Mutation controls below this layout (spawn, plan transitions, memory
 * writes, rollout promote/demote, onboarding writes, question answers) are
 * gated PER-CONTROL on the caller's COORD role via `useCoordIdentity()` +
 * `@/lib/coord-permissions` — mirroring coord's server-side RBAC
 * (`operator < agent_supervisor < admin`). Coord gates these routes on
 * tenant membership, so the controls are visible to any coord member and
 * hidden from non-members. This layout is no longer the write-gate, and the
 * gating is UX only — coord enforces the real boundary server-side.
 *
 * Five primary pages:
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

export default function CoordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Any authenticated user may VIEW the coordination pages. The parent
  // `(app)` AppAuthGate already redirects truly-unauthenticated visitors to
  // /login, so no per-section auth guard is needed here. Mutation controls
  // within each page gate per-control on the caller's COORD role via
  // useCoordIdentity() + @/lib/coord-permissions (mirroring coord's
  // server-side RBAC), so non-members see read-only views.
  return (
    <div
      data-testid="coord-layout"
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
    >
      <header className="flex items-center gap-3 px-3 sm:px-6 py-3 border-b border-border shrink-0">
        <Activity className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold truncate">
            Coord operator console
          </h1>
          <p className="text-xs text-muted-foreground hidden sm:block">
            Cross-machine fleet state, primary trees, plans, alerts, history.
          </p>
        </div>
      </header>

      <CoordNav />

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

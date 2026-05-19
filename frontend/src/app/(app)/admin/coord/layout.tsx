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

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Activity } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import CoordNav from "@/components/admin/coord/CoordNav";

export default function CoordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }
    if (!authLoading && user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/build/workflows");
      return;
    }
  }, [user, authLoading, router]);

  if (!user?.is_superuser) {
    return null;
  }

  return (
    <div
      data-testid="coord-layout"
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
    >
      <header className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <Activity className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Coord operator console</h1>
          <p className="text-xs text-muted-foreground">
            Cross-machine fleet state, primary trees, plans, alerts, history.
          </p>
        </div>
      </header>

      <CoordNav />

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

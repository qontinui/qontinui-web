"use client";

/**
 * /admin/agent-sessions — Claude Code session lineage observability.
 *
 * Plan `D:/qontinui-root/plans/coord-agent-session-id-tracking.md` Side D / Phase 4.
 *
 * Surfaces the data shipped by Phase 1 (alembic
 * coord_agent_session_id_lineage) + Phase 2 (coord HTTP mutating
 * handlers writing agent_session_id):
 *
 *  - Sessions table from coord.agent_sessions (live + historical)
 *  - Per-session lineage panel (UNION ALL across four lineage tables)
 *  - Per-user rollup (count + most-recent activity)
 *
 * Polls the lineage endpoint every 5s for the currently-expanded
 * live session; full-list refresh every 10s. SSE follow-up tracked
 * separately — no coord-events SSE surface exists in qontinui-web
 * yet, so the page polls in the meantime.
 *
 * Shell mirrors `/admin/agent-claims` so the back-button + title-bar
 * pattern stays consistent across admin surfaces.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import AgentSessionsDashboard from "@/components/admin/agent-sessions/AgentSessionsDashboard";

export default function AgentSessionsPage() {
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
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin")}
            data-testid="admin-agent-sessions-back-btn"
          >
            Admin
          </Button>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">Agent sessions</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <AgentSessionsDashboard />
      </div>
    </div>
  );
}

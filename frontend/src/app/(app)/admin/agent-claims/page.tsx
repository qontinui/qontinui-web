"use client";

/**
 * /admin/agent-claims — observability dashboard for the claim-system.
 *
 * Plan `2026-05-18-agent-spawn-coordination.md` Phase 5.
 *
 * Four sections rendered by `AgentClaimsDashboard`:
 *  - Active claims (filter by kind + resource_key prefix)
 *  - Recent conflicts
 *  - Recent steals
 *  - Stale-claim alerts
 */

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import AgentClaimsDashboard from "@/components/admin/agent-claims/AgentClaimsDashboard";

export default function AgentClaimsPage() {
  // Any authenticated tenant member may VIEW this observability dashboard.
  // The parent `(app)` AppAuthGate handles unauthenticated redirects; the
  // mutating gate approve/reject controls inside the dashboard gate on
  // `isCoordAdmin`.
  const router = useRouter();

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin")}
            data-testid="admin-agent-claims-back-btn"
          >
            Admin
          </Button>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">Agent claims</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <AgentClaimsDashboard />
      </div>
    </div>
  );
}

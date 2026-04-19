"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { CalendarClock, Loader2 } from "lucide-react";
import { ScheduledRunsTable } from "@/components/server-runners/ScheduledRunsTable";
import { listWorkflows } from "@/lib/api/unified-workflows";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

export default function ScheduledRunsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [workflows, setWorkflows] = useState<UnifiedWorkflow[]>([]);

  useEffect(() => {
    if (!user) return;
    listWorkflows()
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  }, [user]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    router.push("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-surface-raised to-surface-canvas text-white">
      <header className="border-b border-border-subtle bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <CalendarClock className="w-5 h-5 text-brand-primary" aria-hidden />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              Scheduled Runs
            </h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/runners/fleet")}
          >
            Manage fleet
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">All schedules</h2>
          <p className="text-text-muted">
            Cron-style recurring dispatches. Schedules fire in UTC and target a
            specific runner or <em>auto</em> (any healthy runner).
          </p>
        </div>

        <ScheduledRunsTable
          workflows={workflows.map((w) => ({ id: w.id, name: w.name }))}
        />
      </main>
    </div>
  );
}

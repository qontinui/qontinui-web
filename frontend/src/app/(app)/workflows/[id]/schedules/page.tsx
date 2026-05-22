"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CalendarClock, Loader2 } from "lucide-react";
import { ScheduledRunsTable } from "@/components/server-runners/ScheduledRunsTable";
import { getWorkflow } from "@/lib/api/unified-workflows";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

export default function WorkflowSchedulesPage() {
  const router = useRouter();
  const params = useParams();
  const workflowId = params?.id ? String(params.id) : null;

  const [workflow, setWorkflow] = useState<UnifiedWorkflow | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!workflowId) return;
    setWorkflowLoading(true);
    getWorkflow(workflowId)
      .then((wf) => setWorkflow(wf))
      .catch(() => setWorkflow(null))
      .finally(() => setWorkflowLoading(false));
  }, [workflowId]);

  if (workflowLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!workflowId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-muted">
        No workflow id provided
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-surface-raised to-surface-canvas text-white">
      <header className="border-b border-border-subtle bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/build/workflows`)}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Workflows
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <CalendarClock className="w-5 h-5 text-brand-primary" aria-hidden />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              Schedules
            </h1>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">
            {workflow?.name ?? "Workflow schedules"}
          </h2>
          <p className="text-text-muted">
            Cron schedules that dispatch this workflow. Fires in UTC.
          </p>
        </div>

        <ScheduledRunsTable
          workflowId={workflowId}
          workflows={workflow ? [{ id: workflow.id, name: workflow.name }] : []}
        />
      </main>
    </div>
  );
}

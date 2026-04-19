"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CalendarClock,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useScheduledRuns,
  useDeleteScheduledRun,
  useRunScheduledRunNow,
  useUpdateScheduledRun,
} from "@/hooks/useServerRunners";
import { formatRelativeTime } from "@/utils/formatDuration";
import type { ScheduledWorkflowRun } from "@/types/server-runner";
import { describeCron } from "./cron-preview";
import { CreateScheduledRunDialog } from "./CreateScheduledRunDialog";

interface ScheduledRunsTableProps {
  /** Scope to a single workflow. If provided, create dialog preselects it. */
  workflowId?: string;
  /** Optional list of workflows for the create dialog selector. */
  workflows?: Array<{ id: string; name: string }>;
}

export function ScheduledRunsTable({
  workflowId,
  workflows,
}: ScheduledRunsTableProps) {
  const router = useRouter();
  const {
    data: schedules,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useScheduledRuns(workflowId);
  const deleteMutation = useDeleteScheduledRun();
  const runNowMutation = useRunScheduledRunNow();
  const updateMutation = useUpdateScheduledRun();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledWorkflowRun | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggle = async (schedule: ScheduledWorkflowRun) => {
    try {
      await updateMutation.mutateAsync({
        id: schedule.id,
        data: { enabled: !schedule.enabled },
      });
    } catch {
      // toast handled in hook
    }
  };

  const handleRunNow = async (schedule: ScheduledWorkflowRun) => {
    try {
      const result = await runNowMutation.mutateAsync(schedule.id);
      toast.success(`Dispatched ${schedule.name}`, {
        description: `Execution ID: ${result.execution_id.slice(0, 8)}...`,
        action: {
          label: "View run",
          onClick: () =>
            router.push(`/runs/${encodeURIComponent(result.execution_id)}`),
        },
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to dispatch schedule"
      );
    }
  };

  return (
    <>
      <Card className="bg-surface-raised border-border-subtle">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <div>
            <h3 className="text-sm font-semibold text-white">Scheduled runs</h3>
            <p className="text-xs text-text-muted">
              {workflowId
                ? "Schedules that dispatch this workflow."
                : "All scheduled workflow runs you own."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="border-border-default"
              aria-label="Refresh schedules"
            >
              {isRefetching ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-2" />
              )}
              Refresh
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setCreateOpen(true);
              }}
              size="sm"
              className="bg-brand-primary hover:bg-brand-primary/80 text-black"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Create schedule
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-brand-primary" />
            <span className="ml-3 text-text-muted text-sm">
              Loading schedules...
            </span>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-text-muted text-sm mb-3">{error.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try again
            </Button>
          </div>
        ) : !schedules || schedules.length === 0 ? (
          <div className="text-center py-10">
            <CalendarClock className="w-10 h-10 mx-auto text-text-muted mb-2" />
            <p className="text-sm text-text-muted">
              No scheduled runs yet. Create one to dispatch on a cron cadence.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Name</TableHead>
                {!workflowId && <TableHead scope="col">Workflow</TableHead>}
                <TableHead scope="col">Cron</TableHead>
                <TableHead scope="col">Target</TableHead>
                <TableHead scope="col">Enabled</TableHead>
                <TableHead scope="col">Last fired</TableHead>
                <TableHead scope="col">Last status</TableHead>
                <TableHead scope="col" className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell>
                    <div className="font-medium text-white">
                      {schedule.name}
                    </div>
                    {schedule.description && (
                      <div className="text-xs text-text-muted max-w-[280px] truncate">
                        {schedule.description}
                      </div>
                    )}
                  </TableCell>
                  {!workflowId && (
                    <TableCell className="text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/workflows/${schedule.workflow_id}/schedules`
                          )
                        }
                        className="text-brand-primary hover:underline font-mono"
                      >
                        {schedule.workflow_id.slice(0, 8)}
                      </button>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="font-mono text-xs text-white">
                      {schedule.cron_expression}
                    </div>
                    <div className="text-xs text-text-muted">
                      {describeCron(schedule.cron_expression)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {schedule.target === "auto" ? (
                      <Badge
                        variant="outline"
                        className="border-border-default"
                      >
                        auto
                      </Badge>
                    ) : (
                      <span className="font-mono text-text-muted">
                        {schedule.target.slice(0, 8)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={schedule.enabled}
                      onCheckedChange={() => handleToggle(schedule)}
                      disabled={updateMutation.isPending}
                      aria-label={`${schedule.enabled ? "Disable" : "Enable"} ${schedule.name}`}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-text-muted">
                    {schedule.last_fired_at
                      ? formatRelativeTime(schedule.last_fired_at)
                      : "never"}
                  </TableCell>
                  <TableCell>
                    {schedule.last_status === "dispatched" && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/50 text-emerald-400"
                      >
                        dispatched
                      </Badge>
                    )}
                    {schedule.last_status === "failed" && (
                      <Badge
                        variant="outline"
                        className="border-red-500/50 text-red-400"
                        title={schedule.last_error ?? undefined}
                      >
                        failed
                      </Badge>
                    )}
                    {!schedule.last_status && (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRunNow(schedule)}
                        disabled={runNowMutation.isPending}
                        aria-label={`Run ${schedule.name} now`}
                        title="Run now"
                      >
                        <Play className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(schedule);
                          setCreateOpen(true);
                        }}
                        aria-label={`Edit ${schedule.name}`}
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingId(schedule.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        aria-label={`Delete ${schedule.name}`}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <CreateScheduledRunDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditing(null);
        }}
        workflowId={workflowId}
        workflows={workflows}
        editing={editing}
      />

      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => !open && setDeletingId(null)}
      >
        <AlertDialogContent className="bg-surface-raised border-border-subtle">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              This schedule will stop firing immediately. In-flight runs are
              unaffected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border-default">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId && handleDelete(deletingId)}
              disabled={deleteMutation.isPending}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

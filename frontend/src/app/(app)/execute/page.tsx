"use client";

import { useState, useMemo } from "react";
import { useWorkflowQueue, runnerApi } from "@/lib/runner-api";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Search,
  Clock,
  Play,
  Pause,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Loader2,
  Workflow,
  CheckCircle2,
  XCircle,
  Timer,
  AlertCircle,
  ListChecks,
  Library,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import {
  useScheduledTasks,
  updateScheduledTask,
  deleteScheduledTask,
  runScheduledTaskNow,
} from "@/lib/runner/hooks/scheduler-hooks";
import { ScheduleEditorDialog } from "@/components/execute/ScheduleEditorDialog";
import { ScheduleListItem } from "@/components/execute/ScheduleListItem";
import type { ScheduledTask } from "@/lib/runner/types/scheduler";

function getStatusBadge(status: string) {
  switch (status) {
    case "running":
      return (
        <Badge
          variant="outline"
          className="bg-blue-500/20 text-blue-400 border-blue-500/30"
        >
          <Loader2 className="size-3 animate-spin mr-1" />
          Running
        </Badge>
      );
    case "completed":
      return (
        <Badge
          variant="outline"
          className="bg-green-500/20 text-green-400 border-green-500/30"
        >
          <CheckCircle2 className="size-3 mr-1" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge
          variant="outline"
          className="bg-red-500/20 text-red-400 border-red-500/30"
        >
          <XCircle className="size-3 mr-1" />
          Failed
        </Badge>
      );
    case "pending":
      return (
        <Badge
          variant="outline"
          className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
        >
          <Timer className="size-3 mr-1" />
          Pending
        </Badge>
      );
    case "paused":
      return (
        <Badge
          variant="outline"
          className="bg-gray-500/20 text-gray-400 border-gray-500/30"
        >
          <Pause className="size-3 mr-1" />
          Paused
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-text-muted">
          {status}
        </Badge>
      );
  }
}

function getPriorityBadge(priority: number | string | undefined) {
  const p =
    typeof priority === "string" ? parseInt(priority, 10) : (priority ?? 0);
  if (p >= 8)
    return (
      <Badge
        variant="outline"
        className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px]"
      >
        High
      </Badge>
    );
  if (p >= 4)
    return (
      <Badge
        variant="outline"
        className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 text-[10px]"
      >
        Medium
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="bg-gray-500/10 text-gray-400 border-gray-500/20 text-[10px]"
    >
      Low
    </Badge>
  );
}

// =============================================================================
// Queue Tab
// =============================================================================

function QueueTabContent({
  queueItems,
  isLoading,
  error,
  refetch,
  workflows,
  workflowsLoading,
  showLibrary,
}: {
  queueItems: Record<string, unknown>[] | null | undefined;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  workflows:
    | { id: string; name: string; description?: string }[]
    | null
    | undefined;
  workflowsLoading: boolean;
  showLibrary: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(
    null,
  );

  const filteredQueue = useMemo(() => {
    if (!queueItems) return [];
    if (!searchQuery.trim()) return queueItems;
    const q = searchQuery.toLowerCase();
    return queueItems.filter((item) => {
      const name =
        (item.name as string) || (item.workflow_name as string) || "";
      return name.toLowerCase().includes(q);
    });
  }, [queueItems, searchQuery]);

  const handleAddToQueue = async () => {
    if (!selectedWorkflowId) return;
    setRunningWorkflowId(selectedWorkflowId);
    try {
      await runnerApi.runWorkflow(selectedWorkflowId);
      setShowAddDialog(false);
      setSelectedWorkflowId("");
      toast.success("Workflow started");
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start workflow",
      );
    } finally {
      setRunningWorkflowId(null);
    }
  };

  return (
    <>
      {/* Library sidebar */}
      {showLibrary && (
        <div className="w-80 shrink-0 space-y-4">
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Library className="size-4" />
                Workflow Library
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
                <Input
                  placeholder="Search workflows..."
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  className="pl-8 h-8 bg-surface-canvas/50 border-border-subtle/50 text-xs"
                />
              </div>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {(workflows || [])
                  .filter(
                    (w) =>
                      !librarySearch ||
                      w.name
                        .toLowerCase()
                        .includes(librarySearch.toLowerCase()),
                  )
                  .map((workflow) => (
                    <div
                      key={workflow.id}
                      className="p-3 rounded-lg bg-surface-canvas/50 border border-border-subtle/30 hover:border-border-default transition-all"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-text-primary truncate">
                          {workflow.name}
                        </span>
                      </div>
                      {workflow.description && (
                        <p className="text-xs text-text-muted mb-2 line-clamp-2">
                          {workflow.description}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs h-7"
                        disabled={runningWorkflowId === workflow.id}
                        onClick={async () => {
                          setRunningWorkflowId(workflow.id);
                          try {
                            await runnerApi.runWorkflow(workflow.id);
                            refetch();
                            toast.success(`Started "${workflow.name}"`);
                          } catch (err) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Failed to start workflow",
                            );
                          } finally {
                            setRunningWorkflowId(null);
                          }
                        }}
                      >
                        {runningWorkflowId === workflow.id ? (
                          <>
                            <Loader2 className="size-3 mr-1 animate-spin" />
                            Running...
                          </>
                        ) : (
                          <>
                            <Plus className="size-3 mr-1" />
                            Add to Queue
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                {workflows && workflows.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-4">
                    No workflows available
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 min-w-0">
        {/* Add to Queue Dialog */}
        {showAddDialog && (
          <Card className="bg-surface-raised/50 border-border-subtle/50 mb-6">
            <CardHeader>
              <CardTitle className="text-base text-text-primary flex items-center gap-2">
                <Plus className="size-4" />
                Add Workflow to Queue
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {workflowsLoading ? (
                <Skeleton className="h-9 w-full bg-surface-raised/50" />
              ) : workflows && workflows.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-text-muted">
                    Select Workflow
                  </p>
                  <div className="grid gap-2 max-h-[200px] overflow-y-auto">
                    {workflows.map((workflow) => (
                      <div
                        key={workflow.id}
                        role="button"
                        tabIndex={0}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedWorkflowId === workflow.id
                            ? "bg-brand-primary/10 border-brand-primary/40"
                            : "bg-surface-hover border-border-subtle hover:border-border-default"
                        }`}
                        onClick={() => setSelectedWorkflowId(workflow.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedWorkflowId(workflow.id);
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Workflow className="size-4 text-text-muted" />
                          <span className="text-sm text-text-primary font-medium">
                            {workflow.name}
                          </span>
                        </div>
                        {workflow.description && (
                          <p className="text-xs text-text-muted mt-1 ml-6">
                            {workflow.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAddDialog(false);
                        setSelectedWorkflowId("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="brand-primary"
                      size="sm"
                      disabled={!selectedWorkflowId || !!runningWorkflowId}
                      onClick={handleAddToQueue}
                    >
                      {runningWorkflowId ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <Play className="size-4" />
                          Add & Run
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-muted">
                  No workflows available. Create a workflow first.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
            <Input
              placeholder="Search queue..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-surface-raised/50 border-border-subtle"
            />
          </div>
        </div>

        {/* Queue List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-20 w-full bg-surface-raised/50 rounded-lg"
              />
            ))}
          </div>
        ) : error ? (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-8 text-center">
              <AlertCircle className="w-10 h-10 mx-auto mb-2 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => refetch()}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : !filteredQueue || filteredQueue.length === 0 ? (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-12 text-center">
              <ListChecks className="w-12 h-12 mx-auto mb-3 text-text-muted" />
              <h3 className="text-lg font-medium text-text-secondary mb-1">
                {searchQuery
                  ? "No queued items match your search"
                  : "Queue is Empty"}
              </h3>
              <p className="text-sm text-text-muted max-w-md mx-auto">
                {searchQuery
                  ? "Try a different search term"
                  : "Add workflows to the queue to schedule and manage their execution. Items in the queue will run in order of priority."}
              </p>
              {!searchQuery && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setShowAddDialog(true)}
                >
                  <Plus className="size-4" />
                  Add a Workflow
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredQueue.map((item, index) => {
              const name =
                (item.name as string) ||
                (item.workflow_name as string) ||
                `Queue Item ${index + 1}`;
              const status = (item.status as string) || "pending";
              const priority = item.priority as number | undefined;

              return (
                <Card
                  key={(item.id as string) || index}
                  className="bg-surface-raised/50 border-border-subtle/50 hover:border-brand-primary/30 transition-all"
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="cursor-grab shrink-0 text-text-muted hover:text-text-secondary">
                        <GripVertical className="size-5" />
                      </div>
                      <div className="w-8 h-8 bg-surface-hover rounded-lg flex items-center justify-center shrink-0">
                        <span className="text-sm font-mono text-text-muted">
                          {index + 1}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-medium text-text-primary truncate text-sm">
                            {name}
                          </h3>
                          {getPriorityBadge(priority)}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-text-muted">
                          {item.created_at ? (
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              {new Date(
                                item.created_at as string,
                              ).toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {getStatusBadge(status)}
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          disabled={index === 0}
                        >
                          <ChevronUp className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          disabled={index === filteredQueue.length - 1}
                        >
                          <ChevronDown className="size-3" />
                        </Button>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {status === "pending" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-400 hover:text-green-300"
                          >
                            <Play className="size-4" />
                          </Button>
                        )}
                        {status === "running" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-yellow-400 hover:text-yellow-300"
                          >
                            <Pause className="size-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {filteredQueue && filteredQueue.length > 0 && (
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-text-muted">
              <span>
                {filteredQueue.length} item
                {filteredQueue.length !== 1 ? "s" : ""} in queue
              </span>
              <span className="text-xs">&bull;</span>
              <span className="text-xs">
                {filteredQueue.reduce((sum, item) => {
                  const steps = (item.steps_count as number) || 1;
                  return sum + steps;
                }, 0)}{" "}
                total steps
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={stopOnFailure}
                  onChange={(e) => setStopOnFailure(e.target.checked)}
                  className="rounded border-border-subtle"
                />
                <span>Stop on failure</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// =============================================================================
// Scheduled Tab
// =============================================================================

function ScheduledTabContent() {
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [editingScheduledTask, setEditingScheduledTask] = useState<
    ScheduledTask | undefined
  >();
  const { data: scheduledTasks, refetch: refetchScheduled } =
    useScheduledTasks();

  return (
    <div className="flex-1 min-w-0">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {scheduledTasks?.length || 0} scheduled task
          {scheduledTasks?.length !== 1 ? "s" : ""}
        </p>
        <Button
          variant="brand-primary"
          size="sm"
          onClick={() => {
            setEditingScheduledTask(undefined);
            setShowScheduleEditor(true);
          }}
        >
          <Plus className="size-4" />
          New Schedule
        </Button>
      </div>

      {!scheduledTasks || scheduledTasks.length === 0 ? (
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="py-12 text-center">
            <Calendar className="w-12 h-12 mx-auto mb-3 text-text-muted" />
            <h3 className="text-lg font-medium text-text-secondary mb-1">
              No Scheduled Tasks
            </h3>
            <p className="text-sm text-text-muted max-w-md mx-auto">
              Create a schedule to run workflows automatically at specific times
              or intervals.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setEditingScheduledTask(undefined);
                setShowScheduleEditor(true);
              }}
            >
              <Plus className="size-4" />
              Create Schedule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {scheduledTasks.map((task) => (
            <ScheduleListItem
              key={task.id}
              task={task}
              onEdit={(t) => {
                setEditingScheduledTask(t);
                setShowScheduleEditor(true);
              }}
              onDelete={async (t) => {
                await deleteScheduledTask(t.id);
                refetchScheduled();
              }}
              onRunNow={async (t) => {
                await runScheduledTaskNow(t.id);
                refetchScheduled();
              }}
              onToggleEnabled={async (t, enabled) => {
                await updateScheduledTask(t.id, { enabled });
                refetchScheduled();
              }}
            />
          ))}
        </div>
      )}

      <ScheduleEditorDialog
        open={showScheduleEditor}
        onClose={() => {
          setShowScheduleEditor(false);
          setEditingScheduledTask(undefined);
        }}
        editingTask={editingScheduledTask}
        onSaved={() => {
          refetchScheduled();
          setShowScheduleEditor(false);
          setEditingScheduledTask(undefined);
        }}
      />
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function ExecutePage() {
  const {
    data: queueItems,
    isLoading,
    error,
    isOffline,
    refetch,
  } = useWorkflowQueue();
  const {
    data: workflows,
    isLoading: workflowsLoading,
    isOffline: workflowsOffline,
  } = useUnifiedWorkflows();

  const [activeTab, setActiveTab] = useState<"queue" | "scheduled">("queue");
  const [showLibrary, setShowLibrary] = useState(false);

  const { data: scheduledTasks } = useScheduledTasks();

  if (isOffline || workflowsOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Play className="w-6 h-6 text-brand-primary" />
            <h1 className="text-2xl font-bold text-text-primary">Execute</h1>
            {activeTab === "queue" && queueItems && (
              <Badge variant="secondary">{queueItems.length} in queue</Badge>
            )}
            {activeTab === "scheduled" && scheduledTasks && (
              <Badge variant="secondary">
                {scheduledTasks.length} scheduled
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "queue" && (
              <>
                <Button
                  variant={showLibrary ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowLibrary(!showLibrary)}
                  className={
                    showLibrary
                      ? "bg-brand-primary text-black"
                      : "border-border-default"
                  }
                >
                  <Library className="size-4 mr-1" />
                  Library
                </Button>
                {queueItems && queueItems.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-400 border-red-500/30 hover:bg-red-950/30"
                    onClick={() =>
                      toast.info(
                        "Clear queue requested - this feature requires runner support",
                      )
                    }
                  >
                    <Trash2 className="size-4 mr-1" />
                    Clear
                  </Button>
                )}
                <Button
                  variant="brand-primary"
                  size="sm"
                  onClick={() =>
                    toast.info("Use the Add to Queue form below to add items")
                  }
                >
                  <Plus className="size-4" />
                  Add to Queue
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-6 py-2 border-t border-border-subtle/30 bg-surface-canvas/60">
          <button
            onClick={() => setActiveTab("queue")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "queue"
                ? "bg-brand-primary/20 text-brand-primary"
                : "text-text-muted hover:text-text-secondary hover:bg-surface-hover"
            }`}
          >
            <Play className="size-4 inline mr-1.5" />
            Queue
            {queueItems && (
              <span className="ml-1.5 text-xs opacity-70">
                {queueItems.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("scheduled")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "scheduled"
                ? "bg-brand-primary/20 text-brand-primary"
                : "text-text-muted hover:text-text-secondary hover:bg-surface-hover"
            }`}
          >
            <Calendar className="size-4 inline mr-1.5" />
            Scheduled
            {scheduledTasks && (
              <span className="ml-1.5 text-xs opacity-70">
                {scheduledTasks.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <main
        className="p-6 mx-auto flex gap-6"
        style={{
          maxWidth: showLibrary && activeTab === "queue" ? "1400px" : "1024px",
        }}
      >
        {activeTab === "queue" && (
          <QueueTabContent
            queueItems={queueItems}
            isLoading={isLoading}
            error={error}
            refetch={refetch}
            workflows={workflows}
            workflowsLoading={workflowsLoading}
            showLibrary={showLibrary}
          />
        )}
        {activeTab === "scheduled" && <ScheduledTabContent />}
      </main>
    </div>
  );
}

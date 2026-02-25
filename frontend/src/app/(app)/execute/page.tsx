"use client";

import { useState, useMemo, useCallback } from "react";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./execute.spec.uibridge.json";
import { runnerApi } from "@/lib/runner-api";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import { getTotalStepCount } from "@/types/unified-workflow";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Play, Plus, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { WorkflowLibraryPanel } from "@/components/execute/WorkflowLibraryPanel";
import {
  SequenceBuilderPanel,
  type QueueItem,
} from "@/components/execute/SequenceBuilderPanel";
import { SavedSequenceSelector } from "@/components/execute/SavedSequenceSelector";
import {
  useWorkflowSequences,
  getSequence,
  createSequence,
  updateSequence,
  deleteSequence,
} from "@/lib/api/workflow-sequences";
import { useProject } from "@/hooks/automation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";

const pageSpec = pageSpecJson as unknown as SpecConfig;

// =============================================================================
// Queue Tab — Workflow Sequence Builder
// =============================================================================

function QueueTabContent({
  workflows,
  workflowsLoading,
}: {
  workflows: UnifiedWorkflow[] | null;
  workflowsLoading: boolean;
}) {
  const { projectId } = useProject();
  const {
    data: savedSequences,
    isLoading: sequencesLoading,
    refetch: refetchSequences,
  } = useWorkflowSequences(projectId);

  // Local queue state
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [sequenceName, setSequenceName] = useState("");
  const [stopOnFailure, setStopOnFailure] = useState(true);
  const [activeSequenceId, setActiveSequenceId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // DnD state
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Track which workflow IDs are in the queue
  const queuedWorkflowIds = useMemo(() => {
    return new Set(queueItems.map((item) => item.workflowId));
  }, [queueItems]);

  // Workflow lookup for loading sequences
  const workflowMap = useMemo(() => {
    const map = new Map<string, UnifiedWorkflow>();
    if (workflows) {
      workflows.forEach((w) => map.set(w.id, w));
    }
    return map;
  }, [workflows]);

  const handleAddWorkflow = useCallback((workflow: UnifiedWorkflow) => {
    const queueId = `${workflow.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setQueueItems((prev) => [
      ...prev,
      {
        queueId,
        workflowId: workflow.id,
        name: workflow.name,
        description: workflow.description || undefined,
        category: workflow.category || undefined,
        stepCount: getTotalStepCount(workflow),
      },
    ]);
  }, []);

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setDragActiveId(null);

    if (!over) return;

    const activeIdStr = active.id as string;

    if (activeIdStr.startsWith("library-")) {
      // Dragging from library — create new item
      const workflow = active.data.current?.workflow as
        | UnifiedWorkflow
        | undefined;
      if (!workflow) return;

      const newItem: QueueItem = {
        queueId: `${workflow.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        workflowId: workflow.id,
        name: workflow.name,
        description: workflow.description || undefined,
        category: workflow.category || undefined,
        stepCount: getTotalStepCount(workflow),
      };

      const overId = over.id as string;
      if (overId === "sequence-drop-zone" || overId.startsWith("library-")) {
        // Drop on empty zone or back on library — append to end
        setQueueItems((prev) => [...prev, newItem]);
      } else {
        // Drop on a queue item — insert at that position
        setQueueItems((prev) => {
          const overIndex = prev.findIndex((i) => i.queueId === overId);
          if (overIndex >= 0) {
            const copy = [...prev];
            copy.splice(overIndex, 0, newItem);
            return copy;
          }
          return [...prev, newItem];
        });
      }
    } else {
      // Reordering within queue
      if (active.id !== over.id) {
        setQueueItems((prev) => {
          const oldIndex = prev.findIndex((i) => i.queueId === activeIdStr);
          const newIndex = prev.findIndex(
            (i) => i.queueId === (over.id as string)
          );
          if (oldIndex >= 0 && newIndex >= 0) {
            return arrayMove(prev, oldIndex, newIndex);
          }
          return prev;
        });
      }
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    setDragActiveId(null);
  }, []);

  // Drag overlay content
  const dragOverlayLabel = useMemo(() => {
    if (!dragActiveId) return null;
    if (dragActiveId.startsWith("library-")) {
      const wId = dragActiveId.slice("library-".length);
      return workflowMap.get(wId)?.name || wId;
    }
    return queueItems.find((i) => i.queueId === dragActiveId)?.name || "";
  }, [dragActiveId, workflowMap, queueItems]);

  const handleRun = useCallback(async () => {
    if (queueItems.length === 0) return;
    setIsRunning(true);
    try {
      const workflowIds = queueItems.map((item) => item.workflowId);
      const result = await runnerApi.runWorkflowSequence(
        workflowIds,
        stopOnFailure
      );
      toast.success(`Sequence started (task run: ${result.task_run_id})`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to run sequence"
      );
    } finally {
      setIsRunning(false);
    }
  }, [queueItems, stopOnFailure]);

  const handleSave = useCallback(async () => {
    if (!projectId || !sequenceName.trim() || queueItems.length === 0) return;
    setIsSaving(true);
    try {
      const workflowIds = queueItems.map((item) => item.workflowId);
      const itemSchedules = queueItems.map((item) => item.scheduledAt || null);
      const hasAnySchedule = itemSchedules.some((s) => s !== null);
      const scheduleData = hasAnySchedule
        ? { item_schedules: itemSchedules }
        : null;

      if (activeSequenceId) {
        await updateSequence(projectId, activeSequenceId, {
          name: sequenceName,
          workflow_ids: workflowIds,
          stop_on_failure: stopOnFailure,
          schedule: scheduleData,
        });
        toast.success("Sequence updated");
      } else {
        const created = await createSequence(projectId, {
          name: sequenceName,
          workflow_ids: workflowIds,
          stop_on_failure: stopOnFailure,
          schedule: scheduleData,
        });
        setActiveSequenceId(created.id);
        toast.success("Sequence saved");
      }
      refetchSequences();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save sequence"
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    projectId,
    sequenceName,
    queueItems,
    stopOnFailure,
    activeSequenceId,
    refetchSequences,
  ]);

  const handleLoadSequence = useCallback(
    async (sequenceId: string) => {
      if (!projectId) return;
      try {
        const seq = await getSequence(projectId, sequenceId);
        setSequenceName(seq.name);
        setStopOnFailure(seq.stop_on_failure);
        setActiveSequenceId(seq.id);

        // Rebuild queue items from workflow IDs with per-item schedules
        const itemSchedules = seq.schedule?.item_schedules || [];
        const items: QueueItem[] = seq.workflow_ids.map((wId, index) => {
          const workflow = workflowMap.get(wId);
          return {
            queueId: `${wId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            workflowId: wId,
            name: workflow?.name || wId,
            description: workflow?.description || undefined,
            category: workflow?.category || undefined,
            stepCount: workflow ? getTotalStepCount(workflow) : 0,
            scheduledAt: itemSchedules[index] || undefined,
          };
        });
        setQueueItems(items);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load sequence"
        );
      }
    },
    [projectId, workflowMap]
  );

  const handleNewSequence = useCallback(() => {
    setQueueItems([]);
    setSequenceName("");
    setStopOnFailure(true);
    setActiveSequenceId(null);
  }, []);

  const handleDeleteSequence = useCallback(
    async (sequenceId: string) => {
      if (!projectId) return;
      try {
        await deleteSequence(projectId, sequenceId);
        if (activeSequenceId === sequenceId) {
          handleNewSequence();
        }
        refetchSequences();
        toast.success("Sequence deleted");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete sequence"
        );
      }
    },
    [projectId, activeSequenceId, handleNewSequence, refetchSequences]
  );

  const handleClear = useCallback(() => {
    setQueueItems([]);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <WorkflowLibraryPanel
        workflows={workflows}
        isLoading={workflowsLoading}
        queuedWorkflowIds={queuedWorkflowIds}
        onAddWorkflow={handleAddWorkflow}
      />
      <div className="flex-1 min-w-0">
        <SavedSequenceSelector
          sequences={savedSequences}
          isLoading={sequencesLoading}
          activeSequenceId={activeSequenceId}
          onLoad={handleLoadSequence}
          onNew={handleNewSequence}
          onDelete={handleDeleteSequence}
        />
        <SequenceBuilderPanel
          items={queueItems}
          sequenceName={sequenceName}
          stopOnFailure={stopOnFailure}
          isRunning={isRunning}
          isSaving={isSaving}
          onItemsChange={setQueueItems}
          onSequenceNameChange={setSequenceName}
          onStopOnFailureChange={setStopOnFailure}
          onRun={handleRun}
          onSave={handleSave}
          onClear={handleClear}
        />
      </div>
      <DragOverlay>
        {dragOverlayLabel ? (
          <div className="flex items-center gap-2 p-3 bg-surface-raised border border-brand-primary rounded-lg shadow-lg shadow-brand-primary/20">
            {dragActiveId?.startsWith("library-") ? (
              <Plus className="size-4 text-brand-primary" />
            ) : (
              <GripVertical className="size-4 text-brand-primary" />
            )}
            <span className="text-sm font-medium text-text-primary">
              {dragOverlayLabel}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function ExecutePage() {
  usePageSpecs({ execute: pageSpec });
  const {
    data: workflows,
    isLoading: workflowsLoading,
    isOffline: workflowsOffline,
  } = useUnifiedWorkflows();

  if (workflowsOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Play className="w-6 h-6 text-brand-primary" />
            <h1 className="text-2xl font-bold text-text-primary">Execute</h1>
          </div>
        </div>
      </header>

      <main className="p-6 mx-auto flex gap-6" style={{ maxWidth: "1400px" }}>
        <QueueTabContent
          workflows={workflows}
          workflowsLoading={workflowsLoading}
        />
      </main>
    </div>
  );
}

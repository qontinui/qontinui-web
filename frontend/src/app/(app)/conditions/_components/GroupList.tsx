"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useConditions } from "../_hooks/useConditions";
import { GroupEditorDialog } from "./GroupEditorDialog";
import { ConditionList } from "./ConditionList";
import { RunHistory } from "./RunHistory";
import { StatusBadge } from "./StatusBadge";
import type { ConditionGroup, ConditionGroupDetail } from "../types";

/** Human-readable schedule label for a group's interval. */
function scheduleLabel(secs: number | null | undefined): string {
  if (secs === null || secs === undefined) return "On demand";
  if (secs % 86400 === 0) return `Every ${secs / 86400}d`;
  if (secs % 3600 === 0) return `Every ${secs / 3600}h`;
  if (secs % 60 === 0) return `Every ${secs / 60}m`;
  return `Every ${secs}s`;
}

export function GroupList() {
  const {
    groups,
    loading,
    saving,
    getGroupDetail,
    createGroup,
    updateGroup,
    deleteGroup,
    addCondition,
    updateCondition,
    deleteCondition,
    reorderConditions,
    runGroup,
    listRuns,
    getRun,
  } = useConditions();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ConditionGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConditionGroup | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConditionGroupDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);

  const reloadDetail = useCallback(
    async (groupId: string) => {
      setDetailLoading(true);
      const d = await getGroupDetail(groupId);
      setDetail(d);
      setDetailLoading(false);
    },
    [getGroupDetail]
  );

  // Load the conditions for whichever group is expanded.
  useEffect(() => {
    if (expandedId === null) {
      setDetail(null);
      return;
    }
    void reloadDetail(expandedId);
  }, [expandedId, reloadDetail]);

  const openCreate = () => {
    setEditingGroup(null);
    setEditorOpen(true);
  };
  const openEdit = (group: ConditionGroup) => {
    setEditingGroup(group);
    setEditorOpen(true);
  };

  const toggleExpand = (groupId: string) => {
    setExpandedId((prev) => (prev === groupId ? null : groupId));
  };

  const handleRunNow = async (groupId: string) => {
    const res = await runGroup(groupId);
    if (res && expandedId === groupId) {
      setRunsRefreshKey((k) => k + 1);
    }
  };

  // Condition mutations reload the expanded group's detail after they land, so
  // the inline list reflects the change (the group list also reloads for the
  // condition_count badge, handled inside the hook).
  const wrappedAddCondition = useCallback<typeof addCondition>(
    async (groupId, data) => {
      const created = await addCondition(groupId, data);
      if (created && expandedId === groupId) await reloadDetail(groupId);
      return created;
    },
    [addCondition, expandedId, reloadDetail]
  );

  const wrappedUpdateCondition = useCallback<typeof updateCondition>(
    async (conditionId, data) => {
      const ok = await updateCondition(conditionId, data);
      if (ok && expandedId !== null) await reloadDetail(expandedId);
      return ok;
    },
    [updateCondition, expandedId, reloadDetail]
  );

  const wrappedDeleteCondition = useCallback<typeof deleteCondition>(
    async (conditionId) => {
      const ok = await deleteCondition(conditionId);
      if (ok && expandedId !== null) await reloadDetail(expandedId);
      return ok;
    },
    [deleteCondition, expandedId, reloadDetail]
  );

  const wrappedReorderConditions = useCallback<typeof reorderConditions>(
    async (groupId, conditionIds) => {
      const ok = await reorderConditions(groupId, conditionIds);
      if (ok && expandedId !== null) await reloadDetail(expandedId);
      return ok;
    },
    [reorderConditions, expandedId, reloadDetail]
  );

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} data-testid="new-group">
          <Plus className="size-4" />
          New Group
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <ListChecks className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No condition groups yet — create one to start accumulating
            regression checks.
          </p>
          <Button variant="outline" className="mt-3" onClick={openCreate}>
            <Plus className="size-4" />
            Create your first group
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const isOpen = expandedId === group.group_id;
            return (
              <div
                key={group.group_id}
                className="rounded-lg border border-border bg-card"
              >
                <div className="flex items-center gap-3 px-3 py-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(group.group_id)}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={isOpen ? "Collapse" : "Expand"}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleExpand(group.group_id)}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {group.name}
                      </button>
                      <span className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {group.condition_count}{" "}
                        {group.condition_count === 1 ? "check" : "checks"}
                      </span>
                    </div>
                    <a
                      href={group.target_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="truncate">{group.target_url}</span>
                      <ExternalLink className="size-3 shrink-0" />
                    </a>
                  </div>

                  <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                    <Clock className="size-3" />
                    {scheduleLabel(group.schedule_interval_secs)}
                  </span>

                  <StatusBadge status={group.last_status} />

                  <Switch
                    checked={group.enabled}
                    disabled={saving}
                    onCheckedChange={(enabled) =>
                      void updateGroup(group.group_id, { enabled })
                    }
                    aria-label="Enabled"
                  />

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={() => void handleRunNow(group.group_id)}
                    disabled={saving || !group.enabled}
                    title={
                      group.enabled ? "Run now" : "Enable the group to run it"
                    }
                  >
                    <Play className="size-4" />
                    Run now
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0"
                    onClick={() => openEdit(group)}
                    title="Edit group"
                  >
                    <Pencil className="size-4" />
                  </Button>

                  <DestructiveButton
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0"
                    onClick={() => setDeleteTarget(group)}
                    title="Delete group"
                  >
                    <Trash2 className="size-4" />
                  </DestructiveButton>
                </div>

                {isOpen && (
                  <div className="space-y-5 border-t border-border px-4 py-4">
                    {group.description && (
                      <p className="text-sm text-muted-foreground">
                        {group.description}
                      </p>
                    )}

                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Conditions</h4>
                      {detailLoading || detail === null ? (
                        <div className="space-y-2">
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      ) : (
                        <ConditionList
                          groupId={group.group_id}
                          conditions={detail.conditions}
                          allGroups={groups}
                          saving={saving}
                          onAdd={wrappedAddCondition}
                          onUpdate={wrappedUpdateCondition}
                          onDelete={wrappedDeleteCondition}
                          onReorder={wrappedReorderConditions}
                        />
                      )}
                    </div>

                    <RunHistory
                      groupId={group.group_id}
                      conditions={detail?.conditions ?? []}
                      listRuns={listRuns}
                      getRun={getRun}
                      refreshKey={runsRefreshKey}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <GroupEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        group={editingGroup}
        saving={saving}
        onCreate={createGroup}
        onUpdate={updateGroup}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium">{deleteTarget?.name}</span> and all
              of its conditions and run history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  const id = deleteTarget.group_id;
                  if (expandedId === id) setExpandedId(null);
                  void deleteGroup(id);
                }
                setDeleteTarget(null);
              }}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

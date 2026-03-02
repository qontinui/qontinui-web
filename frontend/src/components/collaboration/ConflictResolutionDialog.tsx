"use client";

import { AlertTriangle, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  Conflict,
  ConflictChange,
  ConflictResolutionDialogProps,
  ViewMode,
} from "./_types/conflict";
import { useConflictResolution } from "./_hooks/useConflictResolution";
import { ConflictDiffItem } from "./_components/ConflictDiffItem";
import { ConflictNavigator } from "./_components/ConflictNavigator";
import { ConflictFooter } from "./_components/ConflictFooter";

export type { Conflict, ConflictChange };

export function ConflictResolutionDialog({
  open,
  onOpenChange,
  conflicts,
  currentConflictIndex = 0,
  onResolve,
  onResolveAll,
}: ConflictResolutionDialogProps) {
  const {
    selectedIndex,
    setSelectedIndex,
    loading,
    mergeChoices,
    setMergeChoice,
    viewMode,
    setViewMode,
    currentConflict,
    conflictedChanges,
    nonConflictedChanges,
    handleResolve,
    handleResolveAll,
  } = useConflictResolution({
    conflicts,
    currentConflictIndex,
    onResolve,
    onResolveAll,
    onOpenChange,
  });

  if (!currentConflict) {
    return null;
  }

  const remoteUserName = currentConflict.remote_user_name ?? "Unknown user";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[90vh] flex flex-col"
        data-ui-id="dialog-conflict-resolution"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Resolve Conflicts
          </DialogTitle>
          <DialogDescription>
            Conflicts detected in {currentConflict.resource_name}. Choose which
            changes to keep.
          </DialogDescription>
        </DialogHeader>

        <ConflictNavigator
          selectedIndex={selectedIndex}
          totalConflicts={conflicts.length}
          onNavigate={setSelectedIndex}
        />

        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as ViewMode)}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="split">Split View</TabsTrigger>
            <TabsTrigger value="unified">Unified View</TabsTrigger>
          </TabsList>
        </Tabs>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3">
            {conflictedChanges.length > 0 && (
              <>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Conflicting Changes ({conflictedChanges.length})
                </h3>
                {conflictedChanges.map((change) => (
                  <ConflictDiffItem
                    key={change.field}
                    change={change}
                    viewMode={viewMode}
                    mergeChoices={mergeChoices}
                    remoteUserName={remoteUserName}
                    onChoose={setMergeChoice}
                  />
                ))}
              </>
            )}

            {nonConflictedChanges.length > 0 && (
              <>
                <h3 className="text-sm font-semibold flex items-center gap-2 mt-6">
                  <Check className="h-4 w-4 text-green-500" />
                  Non-conflicting Changes ({nonConflictedChanges.length})
                </h3>
                {nonConflictedChanges.map((change) => (
                  <ConflictDiffItem
                    key={change.field}
                    change={change}
                    viewMode={viewMode}
                    mergeChoices={mergeChoices}
                    remoteUserName={remoteUserName}
                    onChoose={setMergeChoice}
                  />
                ))}
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <ConflictFooter
            loading={loading}
            showBulkActions={conflicts.length > 1}
            onResolve={handleResolve}
            onResolveAll={handleResolveAll}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  X,
  GitMerge,
  User,
  Users,
  Loader2,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface ConflictChange {
  field: string;
  local_value: unknown;
  remote_value: unknown;
  base_value?: unknown;
  conflicted: boolean;
}

export interface Conflict {
  id: string;
  resource_type: string;
  resource_id: string;
  resource_name: string;
  local_version: number;
  remote_version: number;
  local_user_id: string;
  local_user_name: string;
  remote_user_id: string;
  remote_user_name: string;
  changes: ConflictChange[];
  timestamp: Date | string;
}

interface ConflictResolutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: Conflict[];
  currentConflictIndex?: number;
  onResolve: (
    conflictId: string,
    resolution: "local" | "remote" | "merge",
    mergedData?: Record<string, unknown>
  ) => Promise<void>;
  onResolveAll: (resolution: "local" | "remote") => Promise<void>;
}

export function ConflictResolutionDialog({
  open,
  onOpenChange,
  conflicts,
  currentConflictIndex = 0,
  onResolve,
  onResolveAll,
}: ConflictResolutionDialogProps) {
  const [selectedIndex, setSelectedIndex] =
    React.useState(currentConflictIndex);
  const [loading, setLoading] = React.useState(false);
  const [mergeChoices, setMergeChoices] = React.useState<
    Record<string, "local" | "remote">
  >({});
  const [viewMode, setViewMode] = React.useState<"split" | "unified">("split");

  const currentConflict = conflicts[selectedIndex];

  React.useEffect(() => {
    setSelectedIndex(currentConflictIndex);
  }, [currentConflictIndex]);

  React.useEffect(() => {
    if (currentConflict) {
      // Initialize merge choices
      const initialChoices: Record<string, "local" | "remote"> = {};
      currentConflict.changes.forEach((change) => {
        if (change.conflicted) {
          initialChoices[change.field] = "local";
        }
      });
      setMergeChoices(initialChoices);
    }
  }, [currentConflict]);

  const handleResolve = async (resolution: "local" | "remote" | "merge") => {
    if (!currentConflict) return;

    setLoading(true);
    try {
      let mergedData: Record<string, unknown> | undefined;

      if (resolution === "merge") {
        mergedData = {};
        currentConflict.changes.forEach((change) => {
          if (change.conflicted) {
            const choice = mergeChoices[change.field];
            mergedData![change.field] =
              choice === "local" ? change.local_value : change.remote_value;
          } else {
            mergedData![change.field] = change.local_value;
          }
        });
      }

      await onResolve(currentConflict.id, resolution, mergedData);
      toast.success("Conflict resolved");

      // Move to next conflict or close
      if (selectedIndex < conflicts.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else {
        onOpenChange(false);
      }
    } catch (error: unknown) {
      toast.error(error.message || "Failed to resolve conflict");
    } finally {
      setLoading(false);
    }
  };

  const handleResolveAll = async (resolution: "local" | "remote") => {
    if (
      !confirm(
        `Resolve all ${conflicts.length} conflicts by keeping ${resolution} changes?`
      )
    ) {
      return;
    }

    setLoading(true);
    try {
      await onResolveAll(resolution);
      toast.success(`All conflicts resolved with ${resolution} changes`);
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(error.message || "Failed to resolve all conflicts");
    } finally {
      setLoading(false);
    }
  };

  const renderValue = (value: unknown) => {
    if (value === null || value === undefined) {
      return <span className="text-muted-foreground italic">empty</span>;
    }
    if (typeof value === "object") {
      return (
        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }
    return <span className="font-mono text-sm">{String(value)}</span>;
  };

  const renderDiff = (change: ConflictChange) => {
    if (!change.conflicted) {
      return (
        <div className="p-3 border rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <Check className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium">{change.field}</span>
            <Badge
              variant="outline"
              className="bg-green-500/10 text-green-500 border-green-500/20"
            >
              No Conflict
            </Badge>
          </div>
          <div className="text-sm">{renderValue(change.local_value)}</div>
        </div>
      );
    }

    if (viewMode === "split") {
      return (
        <div key={change.field} className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between bg-muted px-3 py-2 border-b">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium">{change.field}</span>
            </div>
            <Badge
              variant="outline"
              className="bg-orange-500/10 text-orange-500 border-orange-500/20"
            >
              Conflict
            </Badge>
          </div>
          <div className="grid grid-cols-2 divide-x">
            {/* Local Version */}
            <div
              className={cn(
                "p-3 cursor-pointer transition-colors",
                mergeChoices[change.field] === "local"
                  ? "bg-green-500/10"
                  : "hover:bg-muted/50"
              )}
              onClick={() =>
                setMergeChoices((prev) => ({
                  ...prev,
                  [change.field]: "local",
                }))
              }
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <User className="h-3 w-3" />
                  <span className="text-xs font-medium text-muted-foreground">
                    Your Changes
                  </span>
                </div>
                {mergeChoices[change.field] === "local" && (
                  <Check className="h-4 w-4 text-green-500" />
                )}
              </div>
              <div className="text-sm">{renderValue(change.local_value)}</div>
            </div>

            {/* Remote Version */}
            <div
              className={cn(
                "p-3 cursor-pointer transition-colors",
                mergeChoices[change.field] === "remote"
                  ? "bg-blue-500/10"
                  : "hover:bg-muted/50"
              )}
              onClick={() =>
                setMergeChoices((prev) => ({
                  ...prev,
                  [change.field]: "remote",
                }))
              }
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Users className="h-3 w-3" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {currentConflict?.remote_user_name ?? "Unknown user"}'s
                    Changes
                  </span>
                </div>
                {mergeChoices[change.field] === "remote" && (
                  <Check className="h-4 w-4 text-blue-500" />
                )}
              </div>
              <div className="text-sm">{renderValue(change.remote_value)}</div>
            </div>
          </div>
        </div>
      );
    } else {
      // Unified view
      return (
        <div key={change.field} className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between bg-muted px-3 py-2 border-b">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium">{change.field}</span>
            </div>
          </div>
          <div className="space-y-2 p-3">
            <div
              className={cn(
                "p-2 rounded border-l-2 cursor-pointer",
                mergeChoices[change.field] === "local"
                  ? "border-green-500 bg-green-500/10"
                  : "border-red-500 bg-red-500/5"
              )}
              onClick={() =>
                setMergeChoices((prev) => ({
                  ...prev,
                  [change.field]: "local",
                }))
              }
            >
              <div className="flex items-center gap-2 mb-1">
                <X className="h-3 w-3 text-red-500" />
                <span className="text-xs font-medium">Your Changes</span>
                {mergeChoices[change.field] === "local" && (
                  <Check className="h-3 w-3 text-green-500 ml-auto" />
                )}
              </div>
              <div className="text-sm">{renderValue(change.local_value)}</div>
            </div>
            <div
              className={cn(
                "p-2 rounded border-l-2 cursor-pointer",
                mergeChoices[change.field] === "remote"
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-500 bg-gray-500/5"
              )}
              onClick={() =>
                setMergeChoices((prev) => ({
                  ...prev,
                  [change.field]: "remote",
                }))
              }
            >
              <div className="flex items-center gap-2 mb-1">
                <ChevronRight className="h-3 w-3 text-blue-500" />
                <span className="text-xs font-medium">
                  {currentConflict?.remote_user_name ?? "Unknown user"}'s
                  Changes
                </span>
                {mergeChoices[change.field] === "remote" && (
                  <Check className="h-3 w-3 text-blue-500 ml-auto" />
                )}
              </div>
              <div className="text-sm">{renderValue(change.remote_value)}</div>
            </div>
          </div>
        </div>
      );
    }
  };

  if (!currentConflict) {
    return null;
  }

  const conflictedChanges = currentConflict.changes.filter((c) => c.conflicted);
  const nonConflictedChanges = currentConflict.changes.filter(
    (c) => !c.conflicted
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
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

        {/* Conflict Navigator */}
        {conflicts.length > 1 && (
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
              disabled={selectedIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <span className="text-sm font-medium">
              Conflict {selectedIndex + 1} of {conflicts.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSelectedIndex(
                  Math.min(conflicts.length - 1, selectedIndex + 1)
                )
              }
              disabled={selectedIndex === conflicts.length - 1}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* View Mode Toggle */}
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as unknown)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="split">Split View</TabsTrigger>
            <TabsTrigger value="unified">Unified View</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Changes List */}
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3">
            {/* Conflicted Changes */}
            {conflictedChanges.length > 0 && (
              <>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Conflicting Changes ({conflictedChanges.length})
                </h3>
                {conflictedChanges.map((change) => renderDiff(change))}
              </>
            )}

            {/* Non-conflicted Changes */}
            {nonConflictedChanges.length > 0 && (
              <>
                <h3 className="text-sm font-semibold flex items-center gap-2 mt-6">
                  <Check className="h-4 w-4 text-green-500" />
                  Non-conflicting Changes ({nonConflictedChanges.length})
                </h3>
                {nonConflictedChanges.map((change) => renderDiff(change))}
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 flex-1">
            {conflicts.length > 1 && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleResolveAll("local")}
                  disabled={loading}
                  className="flex-1"
                >
                  Keep All Mine
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleResolveAll("remote")}
                  disabled={loading}
                  className="flex-1"
                >
                  Keep All Theirs
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleResolve("local")}
              disabled={loading}
            >
              <User className="mr-2 h-4 w-4" />
              Keep Mine
            </Button>
            <Button
              variant="outline"
              onClick={() => handleResolve("remote")}
              disabled={loading}
            >
              <Users className="mr-2 h-4 w-4" />
              Keep Theirs
            </Button>
            <Button onClick={() => handleResolve("merge")} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GitMerge className="mr-2 h-4 w-4" />
              )}
              Merge Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

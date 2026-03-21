"use client";

import { useState } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("FormatConversionDialog");
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Workflow as WorkflowIcon,
  List,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import type { Workflow } from "@/lib/action-schema/action-types";

interface FormatConversionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Workflow | null;
  onConvert: (converted: Workflow) => void;
}

/**
 * Check if a workflow is linear (no branching)
 */
function isLinearWorkflow(workflow: Workflow): boolean {
  for (const sourceId in workflow.connections) {
    const outputs = workflow.connections[sourceId];
    if (!outputs) continue;
    if (outputs.error && outputs.error.length > 0) return false;
    if (outputs.success && outputs.success.length > 0) return false;
    if (outputs.main) {
      if (outputs.main.length > 1) return false;
      if (outputs.main[0] && outputs.main[0].length > 1) return false;
    }
  }
  return true;
}

export function FormatConversionDialog({
  open,
  onOpenChange,
  item,
  onConvert,
}: FormatConversionDialogProps) {
  const [converting, setConverting] = useState(false);

  if (!item) return null;

  const currentViewMode =
    item.metadata?.viewMode ||
    (isLinearWorkflow(item) ? "sequential" : "graph");
  const isSequentialToGraph = currentViewMode === "sequential";
  const targetViewMode = isSequentialToGraph ? "graph" : "sequential";

  // Check if conversion is possible
  const canConvert = isSequentialToGraph || isLinearWorkflow(item);
  const warnings: string[] = [];

  if (!isSequentialToGraph && !isLinearWorkflow(item)) {
    warnings.push(
      "This workflow has branching logic and cannot be converted to sequential view"
    );
  }

  const handleConvert = async () => {
    if (!canConvert) return;

    setConverting(true);

    try {
      log.debug("Converting workflow:", item.name, "to", targetViewMode);

      // Simply change the viewMode metadata
      const converted: Workflow = {
        ...item,
        metadata: {
          ...item.metadata,
          viewMode: targetViewMode,
          updated: new Date().toISOString(),
        },
      };

      log.debug("Conversion complete, calling onConvert");
      onConvert(converted);
      onOpenChange(false);
    } catch (error) {
      console.error("[FormatConversion] Conversion error:", error);
    } finally {
      setConverting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-surface-overlay border-border-default">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-brand-primary">
            {isSequentialToGraph ? (
              <>
                <List className="w-5 h-5" />
                <ArrowRight className="w-4 h-4" />
                <WorkflowIcon className="w-5 h-5 text-brand-success" />
                <span>Switch to Graph View</span>
              </>
            ) : (
              <>
                <WorkflowIcon className="w-5 h-5 text-brand-success" />
                <ArrowRight className="w-4 h-4" />
                <List className="w-5 h-5" />
                <span>Switch to Sequential View</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-text-muted">
            {isSequentialToGraph
              ? "Change the preferred view mode for this workflow to graph visualization."
              : "Change the preferred view mode for this workflow to sequential timeline."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Item Info */}
          <div className="bg-surface-raised/50 rounded-lg p-4">
            <div className="text-sm text-text-secondary">
              <div className="font-medium mb-1">{item.name}</div>
              <div className="text-xs text-text-muted">
                {item.actions.length} actions •{" "}
                {isLinearWorkflow(item) ? "Linear" : "Branching"}
              </div>
            </div>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <Alert className="bg-amber-500/10 border-amber-500/50">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertTitle className="text-amber-500">Cannot Convert</AlertTitle>
              <AlertDescription className="text-amber-200">
                <ul className="list-disc list-inside space-y-1 mt-2">
                  {warnings.map((warning, i) => (
                    <li key={i} className="text-sm">
                      {warning}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Conversion Info */}
          {canConvert && (
            <div className="space-y-2 text-sm text-text-muted">
              {isSequentialToGraph ? (
                <>
                  <p>✓ Workflow will be displayed in graph view</p>
                  <p>✓ All actions and connections are preserved</p>
                  <p>✓ You can switch back anytime</p>
                </>
              ) : (
                <>
                  <p>✓ Workflow will be displayed in sequential timeline</p>
                  <p>✓ All actions are preserved in order</p>
                  <p>✓ Linear workflows work best in this view</p>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border-default hover:bg-surface-raised"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConvert}
            disabled={!canConvert || converting}
            className={
              isSequentialToGraph
                ? "bg-brand-success hover:bg-brand-success/80 text-black"
                : "bg-brand-primary hover:bg-brand-primary/80 text-black"
            }
          >
            {converting ? "Switching..." : "Switch View"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

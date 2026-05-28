"use client";

import { Loader2, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Progress } from "@/components/ui/progress";
import type { TestExecutionState } from "../_types";

interface TestExecutionPanelProps {
  execution: TestExecutionState;
  selectedTests: Set<string>;
  onRunSelected: () => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
}

/**
 * Renders the execution progress bar (when tests are running)
 * and batch operations toolbar (when tests are selected).
 */
export function TestExecutionPanel({
  execution,
  selectedTests,
  onRunSelected,
  onDeleteSelected,
  onClearSelection,
}: TestExecutionPanelProps) {
  return (
    <>
      {/* Test Execution Progress */}
      {execution.isRunning && (
        <div className="border-b bg-blue-50 dark:bg-blue-950/20">
          <div className="container mx-auto px-6 py-3">
            <div className="flex items-center gap-4">
              <Loader2 className="size-5 animate-spin text-blue-500" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium">
                    Running: {execution.currentTest}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {execution.completedTests} / {execution.totalTests}
                  </p>
                </div>
                <Progress value={execution.progress} className="h-2" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Operations Toolbar */}
      {selectedTests.size > 0 && (
        <div className="border-b bg-accent/50">
          <div className="container mx-auto px-6 py-2">
            <div className="flex items-center gap-4">
              <p className="text-sm font-medium">
                {selectedTests.size} test
                {selectedTests.size !== 1 ? "s" : ""} selected
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={onRunSelected}
                  variant="outline"
                  size="sm"
                  disabled={execution.isRunning}
                >
                  <Play className="size-4" />
                  Run Selected
                </Button>
                <DestructiveButton onClick={onDeleteSelected} size="sm">
                  <Trash2 className="size-4" />
                  Delete Selected
                </DestructiveButton>
                <Button onClick={onClearSelection} variant="ghost" size="sm">
                  Clear Selection
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

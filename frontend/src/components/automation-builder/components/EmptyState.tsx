/**
 * EmptyState Component
 *
 * Displays placeholder content when no item is selected in the builder.
 */

import { Play, List as ListIcon, Workflow as WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmptyStateProps } from "../types";

export function EmptyState({ mode, onCreateNew }: EmptyStateProps) {
  const isSequential = mode === "sequential";

  return (
    <div className="flex items-center justify-center h-full text-text-muted">
      <div className="text-center space-y-6 max-w-md px-4">
        {/* Icon */}
        <div className="flex justify-center">
          {isSequential ? (
            <ListIcon className="w-20 h-20 opacity-20" />
          ) : (
            <WorkflowIcon className="w-20 h-20 opacity-20" />
          )}
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-text-muted">
            No Workflow Selected
          </h3>
          <p className="text-sm text-text-muted">
            Select a workflow from the library to edit, or create a new one to
            get started.
          </p>
        </div>

        {/* Actions */}
        {onCreateNew && (
          <div className="space-y-3">
            <Button
              onClick={onCreateNew}
              className={
                isSequential
                  ? "w-full bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
                  : "w-full bg-brand-success hover:bg-brand-success/80 text-black font-medium"
              }
            >
              <Play className="w-4 h-4 mr-2" />
              Create New Workflow
            </Button>

            <p className="text-xs text-text-muted">
              Or browse the library on the left to open an existing workflow
            </p>
          </div>
        )}

        {/* Quick tips */}
        <div className="pt-4 border-t border-border-subtle">
          <p className="text-xs text-text-muted mb-2">Quick Tips:</p>
          <ul className="text-xs text-text-muted space-y-1 text-left">
            <li className="flex items-start gap-2">
              <span className="text-text-muted">•</span>
              <span>
                {isSequential
                  ? "Sequential mode is for linear, step-by-step workflows"
                  : "Graph mode is for visual workflows with branching and loops"}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-text-muted">•</span>
              <span>
                Use the mode toggle above to switch between sequential and graph
                views
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-text-muted">•</span>
              <span>
                You can convert between formats using the conversion button ⇄
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * EmptyState Component
 *
 * Displays placeholder content when no item is selected in the builder.
 */

import {
  Play,
  List as ListIcon,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmptyStateProps } from "../types";

export function EmptyState({ mode, onCreateNew }: EmptyStateProps) {
  const isSequential = mode === "sequential";

  return (
    <div className="flex items-center justify-center h-full text-gray-500">
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
          <h3 className="text-xl font-semibold text-gray-300">
            No Workflow Selected
          </h3>
          <p className="text-sm text-gray-400">
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
                  ? "w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
                  : "w-full bg-[#00FF88] hover:bg-[#00FF88]/80 text-black font-medium"
              }
            >
              <Play className="w-4 h-4 mr-2" />
              Create New Workflow
            </Button>

            <p className="text-xs text-gray-500">
              Or browse the library on the left to open an existing workflow
            </p>
          </div>
        )}

        {/* Quick tips */}
        <div className="pt-4 border-t border-gray-800">
          <p className="text-xs text-gray-500 mb-2">Quick Tips:</p>
          <ul className="text-xs text-gray-500 space-y-1 text-left">
            <li className="flex items-start gap-2">
              <span className="text-gray-600">•</span>
              <span>
                {isSequential
                  ? "Sequential mode is for linear, step-by-step workflows"
                  : "Graph mode is for visual workflows with branching and loops"}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-600">•</span>
              <span>
                Use the mode toggle above to switch between sequential and graph
                views
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-600">•</span>
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

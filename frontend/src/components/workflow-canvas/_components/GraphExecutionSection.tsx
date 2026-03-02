"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Repeat } from "lucide-react";
import { hasConditionalLogic, hasLoops } from "@/lib/workflow-validator";
import type { Workflow as ExportWorkflow } from "@/lib/export-schema";
import type { WorkflowSectionProps } from "./WorkflowPropertiesTypes";

export const GraphExecutionSection: React.FC<WorkflowSectionProps> = ({
  workflow,
}) => {
  if (!workflow.connections || Object.keys(workflow.connections).length === 0) {
    return null;
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-4 h-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-text-secondary">
          Graph Execution
        </h3>
      </div>

      <div className="space-y-3">
        <div className="p-3 rounded bg-blue-900/20 border border-blue-700/30">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary" className="bg-blue-600 text-white">
              Graph Execution Enabled
            </Badge>
            <span className="text-xs text-text-muted">
              {Object.keys(workflow.connections).length} actions with
              connections
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mt-2">
            {hasConditionalLogic(workflow as unknown as ExportWorkflow) && (
              <Badge
                variant="outline"
                className="border-green-600 text-green-400"
              >
                <GitBranch className="w-3 h-3 mr-1" />
                Conditional Branching
              </Badge>
            )}

            {hasLoops(workflow as unknown as ExportWorkflow) && (
              <Badge
                variant="outline"
                className="border-yellow-600 text-yellow-400"
              >
                <Repeat className="w-3 h-3 mr-1" />
                Contains Loops
              </Badge>
            )}
          </div>
        </div>

        <div className="text-xs text-text-muted space-y-1">
          <p>
            <strong>Conditional Branching:</strong> Uses success/error paths to
            control flow
          </p>
          <p>
            <strong>Loops:</strong> May contain cycles - ensure proper exit
            conditions
          </p>
        </div>
      </div>
    </section>
  );
};

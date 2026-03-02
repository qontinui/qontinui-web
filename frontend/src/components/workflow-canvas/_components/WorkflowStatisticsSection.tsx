"use client";

import React from "react";
import { BarChart3, Info } from "lucide-react";
import type { WorkflowSectionProps } from "./WorkflowPropertiesTypes";

function computeConnectionCount(
  connections: Record<string, Record<string, unknown>>
): number {
  return Object.values(connections).reduce<number>((sum, conn) => {
    return (
      sum +
      Object.values(conn).reduce<number>((s, outputs) => {
        const arr = outputs as unknown[][] | undefined;
        return (
          s + (arr?.reduce<number>((ss, conns) => ss + conns.length, 0) || 0)
        );
      }, 0)
    );
  }, 0);
}

export const WorkflowStatisticsSection: React.FC<WorkflowSectionProps> = ({
  workflow,
}) => {
  const actionCount = workflow.actions.length;
  const connectionCount = computeConnectionCount(
    workflow.connections as unknown as Record<string, Record<string, unknown>>
  );

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-text-secondary">
          Statistics
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded bg-surface-raised/50 border border-border-default">
          <div className="text-2xl font-bold text-blue-400">{actionCount}</div>
          <div className="text-xs text-text-muted">Actions</div>
        </div>

        <div className="p-3 rounded bg-surface-raised/50 border border-border-default">
          <div className="text-2xl font-bold text-green-400">
            {connectionCount}
          </div>
          <div className="text-xs text-text-muted">Connections</div>
        </div>

        <div className="p-3 rounded bg-surface-raised/50 border border-border-default">
          <div className="text-2xl font-bold text-purple-400">
            {Object.keys(workflow.variables?.local || {}).length}
          </div>
          <div className="text-xs text-text-muted">Variables</div>
        </div>

        <div className="p-3 rounded bg-surface-raised/50 border border-border-default">
          <div className="text-2xl font-bold text-yellow-400">
            {workflow.tags?.length || 0}
          </div>
          <div className="text-xs text-text-muted">Tags</div>
        </div>
      </div>

      <div className="mt-4 p-3 rounded bg-blue-900/20 border border-blue-700/30">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-text-secondary">
            <strong>Estimated execution time:</strong> Varies based on
            conditions and retries. Run validation for detailed analysis.
          </div>
        </div>
      </div>
    </section>
  );
};

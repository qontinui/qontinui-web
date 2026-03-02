"use client";

import React from "react";
import {
  AlertCircle,
  TrendingUp,
  EyeOff,
  X,
  BarChart3,
  Layers,
} from "lucide-react";
import { Button } from "../../../ui/button";
import { Badge } from "../../../ui/badge";
import { ScrollArea } from "../../../ui/scroll-area";
import { Separator } from "../../../ui/separator";
import { AnalysisPanelProps } from "../types";

export function AnalysisPanel({
  analysis,
  workflows,
  onSelectWorkflow,
  onHighlightCircular,
  onClose,
}: AnalysisPanelProps) {
  return (
    <div className="w-80 border-l bg-background overflow-hidden flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Analysis
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Circular Dependencies */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-600" />
                Circular Dependencies
              </h4>
              <Badge variant="destructive" className="text-xs">
                {analysis.circularDependencies.length}
              </Badge>
            </div>
            {analysis.circularDependencies.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No circular dependencies detected
              </p>
            ) : (
              <div className="space-y-2">
                {analysis.circularDependencies.map((circ, index) => (
                  <button
                    key={index}
                    className="w-full text-left p-2 rounded-md border bg-card hover:bg-accent transition-colors"
                    onClick={() => onHighlightCircular(index)}
                  >
                    <div className="text-xs font-medium mb-1">
                      Cycle {index + 1}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {circ.chain
                        .map(
                          (id) => workflows.find((w) => w.id === id)?.name || id
                        )
                        .slice(0, 3)
                        .join(" \u2192 ")}
                      {circ.chain.length > 3 && " ..."}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Unused Workflows */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <EyeOff className="h-4 w-4 text-text-muted" />
                Unused Workflows
              </h4>
              <Badge variant="secondary" className="text-xs">
                {analysis.unusedWorkflows.length}
              </Badge>
            </div>
            {analysis.unusedWorkflows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                All workflows are in use
              </p>
            ) : (
              <div className="space-y-1">
                {analysis.unusedWorkflows.slice(0, 5).map((id) => {
                  const workflow = workflows.find((w) => w.id === id);
                  return (
                    <button
                      key={id}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-accent"
                      onClick={() => onSelectWorkflow(id)}
                    >
                      {workflow?.name || id}
                    </button>
                  );
                })}
                {analysis.unusedWorkflows.length > 5 && (
                  <p className="text-xs text-muted-foreground px-2">
                    +{analysis.unusedWorkflows.length - 5} more
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Most Depended On */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                Most Depended On
              </h4>
            </div>
            {analysis.mostDependedOn.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data</p>
            ) : (
              <div className="space-y-1">
                {analysis.mostDependedOn.slice(0, 5).map((item) => {
                  const workflow = workflows.find(
                    (w) => w.id === item.workflowId
                  );
                  return (
                    <button
                      key={item.workflowId}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-accent flex items-center justify-between"
                      onClick={() => onSelectWorkflow(item.workflowId)}
                    >
                      <span className="truncate">
                        {workflow?.name || item.workflowId}
                      </span>
                      <Badge variant="secondary" className="text-xs ml-2">
                        {item.count}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Separator />

          {/* Longest Chains */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Layers className="h-4 w-4 text-purple-600" />
                Longest Chains
              </h4>
            </div>
            {analysis.longestChains.length === 0 ? (
              <p className="text-xs text-muted-foreground">No chains</p>
            ) : (
              <div className="space-y-2">
                {analysis.longestChains.slice(0, 3).map((item, index) => (
                  <div
                    key={index}
                    className="p-2 rounded-md border bg-card text-xs"
                  >
                    <div className="font-medium mb-1">
                      Chain {index + 1} (Length: {item.length})
                    </div>
                    <div className="text-muted-foreground">
                      {item.chain
                        .map(
                          (id) => workflows.find((w) => w.id === id)?.name || id
                        )
                        .slice(0, 3)
                        .join(" \u2192 ")}
                      {item.chain.length > 3 && " ..."}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Statistics */}
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Statistics
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Workflows:</span>
                <span className="font-medium">{workflows.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Total Dependencies:
                </span>
                <span className="font-medium">
                  {analysis.totalDependencies}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg Dependencies:</span>
                <span className="font-medium">
                  {analysis.avgDependencies.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Circular Deps:</span>
                <span className="font-medium text-red-600">
                  {analysis.circularDependencies.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unused:</span>
                <span className="font-medium text-text-muted">
                  {analysis.unusedWorkflows.length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

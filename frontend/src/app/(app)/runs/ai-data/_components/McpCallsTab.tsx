"use client";

import { useState, Fragment } from "react";
import { useTaskRunMcpCalls, type McpCall } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { Wrench, ChevronDown, ChevronRight } from "lucide-react";
import { formatDate, formatDuration, tryFormatJson } from "./utils";

export function McpCallsTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunMcpCalls(runId);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading MCP calls...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        Error loading MCP calls: {error}
      </div>
    );
  }

  const calls = data ?? [];

  if (calls.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Wrench className="size-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No MCP tool calls for this run.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="w-8" />
            <th className="text-left py-2 px-3 text-muted-foreground font-medium">
              Tool Name
            </th>
            <th className="text-left py-2 px-3 text-muted-foreground font-medium">
              Status
            </th>
            <th className="text-right py-2 px-3 text-muted-foreground font-medium">
              Duration
            </th>
            <th className="text-left py-2 px-3 text-muted-foreground font-medium">
              Created At
            </th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call: McpCall) => {
            const isExpanded = expandedRow === call.id;
            return (
              <Fragment key={call.id}>
                <tr
                  className="border-b border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => setExpandedRow(isExpanded ? null : call.id)}
                >
                  <td className="py-2.5 px-2 text-muted-foreground">
                    {isExpanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-foreground text-xs">
                    {call.tool_name}
                  </td>
                  <td className="py-2.5 px-3">
                    <Badge
                      variant={
                        call.status === "success"
                          ? "success"
                          : call.status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-xs"
                    >
                      {call.status}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-3 text-right text-muted-foreground">
                    {formatDuration(call.duration_ms)}
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground text-xs">
                    {formatDate(call.timestamp)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-border">
                    <td colSpan={5} className="p-0">
                      <div className="bg-background px-6 py-4 space-y-3">
                        {call.input && Object.keys(call.input).length > 0 && (
                          <div>
                            <div
                              data-content-role="label"
                              data-content-label="mcp call arguments label"
                              className="text-xs font-medium text-muted-foreground mb-1"
                            >
                              Arguments
                            </div>
                            <pre className="text-xs font-mono text-muted-foreground bg-muted/50 rounded-md p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                              {tryFormatJson(call.input)}
                            </pre>
                          </div>
                        )}
                        {call.output != null && (
                          <div>
                            <div
                              data-content-role="label"
                              data-content-label="mcp call result label"
                              className="text-xs font-medium text-muted-foreground mb-1"
                            >
                              Result
                            </div>
                            <pre className="text-xs font-mono text-muted-foreground bg-muted/50 rounded-md p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                              {tryFormatJson(call.output)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

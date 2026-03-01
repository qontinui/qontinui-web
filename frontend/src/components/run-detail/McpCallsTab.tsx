"use client";

import { useState, useMemo } from "react";
import { useTaskRunEvents, type TaskRunEvent } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { RefreshCw, Wrench, ChevronRight, ChevronDown } from "lucide-react";

interface McpCallsTabProps {
  runId: string;
}

function truncateJson(value: unknown, maxLen: number = 80): string {
  if (value == null) return "-";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + "...";
}

function formatJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function McpCallRow({ event }: { event: TaskRunEvent }) {
  const [isOpen, setIsOpen] = useState(false);
  const toolName = String(event.data.tool_name || event.data.name || "unknown");
  const args = event.data.arguments || event.data.input || event.data.args;
  const result = event.data.result || event.data.output;
  const duration = event.data.duration_ms
    ? Number(event.data.duration_ms)
    : null;
  const status = String(event.data.status || "");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <TableRow
        className="border-border-subtle/50 cursor-pointer hover:bg-surface-raised/30"
        onClick={() => setIsOpen(!isOpen)}
      >
        <TableCell className="w-8">
          {isOpen ? (
            <ChevronDown className="size-3.5 text-text-muted" />
          ) : (
            <ChevronRight className="size-3.5 text-text-muted" />
          )}
        </TableCell>
        <TableCell>
          <Badge variant="info" className="text-xs font-mono">
            {toolName}
          </Badge>
        </TableCell>
        <TableCell className="text-sm text-text-secondary font-mono max-w-xs truncate">
          {truncateJson(args)}
        </TableCell>
        <TableCell className="text-sm text-text-secondary max-w-xs truncate">
          {truncateJson(result)}
        </TableCell>
        <TableCell>
          {status && (
            <Badge
              variant={
                status === "success"
                  ? "success"
                  : status === "error"
                    ? "destructive"
                    : "secondary"
              }
              className="text-xs"
            >
              {status}
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-sm text-text-muted">
          {duration != null ? `${duration}ms` : "-"}
        </TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow className="border-border-subtle/30">
          <TableCell colSpan={6} className="p-0">
            <div className="p-4 bg-surface-canvas/50 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {args != null && (
                  <div>
                    <div className="text-xs font-medium text-text-muted mb-1">
                      Arguments
                    </div>
                    <pre className="text-xs font-mono text-text-secondary bg-surface-raised/30 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto border border-border-subtle/30">
                      {formatJson(args)}
                    </pre>
                  </div>
                )}
                {result != null && (
                  <div>
                    <div className="text-xs font-medium text-text-muted mb-1">
                      Result
                    </div>
                    <pre className="text-xs font-mono text-text-secondary bg-surface-raised/30 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto border border-border-subtle/30">
                      {formatJson(result)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function McpCallsTab({ runId }: McpCallsTabProps) {
  const { data, isLoading, error } = useTaskRunEvents(runId);

  const mcpEvents = useMemo(() => {
    if (!data) return [];
    return (data as TaskRunEvent[]).filter(
      (e) => e.event_type === "mcp_call" || e.event_type.includes("mcp_call")
    );
  }, [data]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading MCP calls...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (mcpEvents.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Wrench className="size-12 mx-auto mb-4" />
        <p>No MCP tool calls recorded for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary">{mcpEvents.length} calls</Badge>
      </div>

      <ScrollArea className="h-[650px]">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border-subtle/50">
                <TableHead className="w-8" />
                <TableHead>Tool</TableHead>
                <TableHead>Arguments</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-24">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mcpEvents.map((event) => (
                <McpCallRow key={event.id} event={event as TaskRunEvent} />
              ))}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
    </div>
  );
}

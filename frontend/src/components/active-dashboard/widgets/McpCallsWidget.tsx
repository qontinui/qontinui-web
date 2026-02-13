"use client";

import type { McpCall } from "@/lib/runner-api";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Terminal, RefreshCw } from "lucide-react";

export function McpCallsWidget({ runId }: { runId: string }) {
  const { data, isLoading } = useEventTriggeredFetch<McpCall[]>(
    "step-progress",
    `/task-runs/${runId}/mcp-calls`,
    {
      transform: (raw: unknown) => {
        const obj = raw as Record<string, unknown>;
        if (obj && typeof obj === "object" && "calls" in obj && Array.isArray(obj.calls))
          return obj.calls as McpCall[];
        if (Array.isArray(raw)) return raw as McpCall[];
        return [];
      },
    }
  );

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Terminal className="size-4 text-purple-400" />
            MCP Calls
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const calls = (data as McpCall[] | undefined) || [];
  const recentCalls = calls.slice(-15);

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Terminal className="size-4 text-purple-400" />
          MCP Calls
          <Badge variant="secondary" className="text-xs">
            {calls.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4">
        <ScrollArea className="h-full">
          <div className="space-y-1.5">
            {recentCalls.map((call) => (
              <div key={call.id} className="flex items-center gap-2 text-xs">
                <Badge
                  variant={
                    call.status === "success"
                      ? "success"
                      : call.status === "error"
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-[10px] shrink-0"
                >
                  {call.status}
                </Badge>
                <span className="font-mono text-text-primary truncate">
                  {call.tool_name}
                </span>
                {call.duration_ms != null && (
                  <span className="text-text-muted shrink-0">
                    {call.duration_ms}ms
                  </span>
                )}
              </div>
            ))}
            {recentCalls.length === 0 && (
              <p className="text-xs text-text-muted">No MCP calls yet...</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

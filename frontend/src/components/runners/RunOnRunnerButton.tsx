"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Monitor, Loader2, Wifi } from "lucide-react";
import { toast } from "sonner";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { runnerService } from "@/services/service-factory";
import { formatRelativeTime } from "@/utils/formatDuration";

interface RunOnRunnerButtonProps {
  workflow: Record<string, unknown>;
  disabled?: boolean;
}

export function RunOnRunnerButton({
  workflow,
  disabled,
}: RunOnRunnerButtonProps) {
  const { connections, isLoading } = useRealtimeConnections();
  const [isExecuting, setIsExecuting] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const activeConnections = connections.filter((c) => c.ws_connected);

  const handleExecute = async (connectionId: number, runnerName: string) => {
    setIsExecuting(connectionId);
    try {
      const result = await runnerService.executeWorkflowOnRunner(
        connectionId,
        workflow
      );
      toast.success(`Workflow sent to ${runnerName}`, {
        description: `Execution ID: ${result.execution_id.slice(0, 8)}...`,
      });
      setOpen(false);
    } catch (error) {
      toast.error(`Failed to send workflow to ${runnerName}`, {
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setIsExecuting(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={disabled || activeConnections.length === 0}
          title={
            activeConnections.length === 0
              ? "No runners connected"
              : `Run on remote runner (${activeConnections.length} available)`
          }
        >
          <Monitor className="size-3" />
          <span className="ml-1">Remote</span>
          {activeConnections.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 h-4 px-1 text-[10px] leading-none"
            >
              {activeConnections.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="text-xs font-medium text-zinc-400 px-2 py-1">
          Run on Runner
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="size-4 animate-spin text-zinc-500" />
          </div>
        ) : activeConnections.length === 0 ? (
          <div className="text-xs text-zinc-500 px-2 py-3 text-center">
            No runners connected
          </div>
        ) : (
          <div className="space-y-0.5">
            {activeConnections.map((conn) => (
              <button
                key={conn.id}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 transition-colors text-left disabled:opacity-50"
                disabled={isExecuting !== null}
                onClick={() => handleExecute(conn.id, conn.runner_name)}
              >
                <Wifi className="size-3 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-200 truncate">
                    {conn.runner_name}
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate">
                    {conn.ip_address || "Unknown IP"}
                    {" \u00b7 "}
                    {formatRelativeTime(conn.connected_at)}
                  </div>
                </div>
                {isExecuting === conn.id && (
                  <Loader2 className="size-3 animate-spin text-zinc-400 shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

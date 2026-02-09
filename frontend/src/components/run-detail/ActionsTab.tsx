"use client";

import { useState, useMemo } from "react";
import { useTaskRunEvents } from "@/lib/runner-api";
import type { TaskRunEvent } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Zap } from "lucide-react";

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

function getTypeColor(type: string): string {
  if (type.includes("action") || type.includes("click"))
    return "bg-blue-500/10 text-blue-400 border-blue-500/30";
  if (type.includes("image") || type.includes("recognition"))
    return "bg-purple-500/10 text-purple-400 border-purple-500/30";
  if (type.includes("state"))
    return "bg-green-500/10 text-green-400 border-green-500/30";
  if (type.includes("error") || type.includes("fail"))
    return "bg-red-500/10 text-red-400 border-red-500/30";
  return "bg-surface-raised/30 text-text-muted border-border-subtle";
}

export function ActionsTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunEvents(runId);
  const [levelFilter, setLevelFilter] = useState("all");

  const events = useMemo(() => {
    if (!data) return [];
    const evts = data as TaskRunEvent[];
    if (levelFilter === "all") return evts;
    return evts.filter((e) => e.event_type.includes(levelFilter));
  }, [data, levelFilter]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading actions...
      </div>
    );
  }
  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Zap className="size-12 mx-auto mb-4" />
        <p>No action events for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-[180px] bg-surface-raised/50 border-border-default">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            <SelectItem value="action">Actions</SelectItem>
            <SelectItem value="state">State Changes</SelectItem>
            <SelectItem value="image">Image Recognition</SelectItem>
            <SelectItem value="error">Errors</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary">{events.length} events</Badge>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border-subtle/50">
              <TableHead>Type</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.slice(0, 200).map((event) => (
              <TableRow key={event.id} className="border-border-subtle/50">
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-xs ${getTypeColor(event.event_type)}`}
                  >
                    {event.event_type}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-text-secondary max-w-md">
                  {event.data.target
                    ? String(event.data.target)
                    : event.data.action
                      ? String(event.data.action)
                      : event.data.message
                        ? String(event.data.message)
                        : Object.keys(event.data).length > 0
                          ? JSON.stringify(event.data).substring(0, 120)
                          : "-"}
                </TableCell>
                <TableCell className="text-xs text-text-muted">
                  {formatTime(event.timestamp)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {events.length > 200 && (
        <p className="text-xs text-text-muted text-center">
          Showing first 200 of {events.length} events
        </p>
      )}
    </div>
  );
}

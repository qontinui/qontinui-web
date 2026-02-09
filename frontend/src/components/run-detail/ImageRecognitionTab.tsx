"use client";

import { useMemo } from "react";
import { useTaskRunEvents } from "@/lib/runner-api";
import type { TaskRunEvent } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Eye } from "lucide-react";

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

export function ImageRecognitionTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunEvents(runId);

  const imageEvents = useMemo(() => {
    if (!data) return [];
    return (data as TaskRunEvent[]).filter(
      (e) =>
        e.event_type.includes("image") ||
        e.event_type.includes("recognition") ||
        e.event_type.includes("match")
    );
  }, [data]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading image recognition data...
      </div>
    );
  }
  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }
  if (imageEvents.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Eye className="size-12 mx-auto mb-4" />
        <p>No image recognition events for this run.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border-subtle/50">
            <TableHead>Time</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {imageEvents.map((event) => {
            const found =
              event.data.found ?? event.data.matched ?? event.data.success;
            const confidence = event.data.confidence ?? event.data.score;
            const template =
              event.data.template ??
              event.data.template_name ??
              event.data.image_name;
            const location = event.data.location ?? event.data.position;

            return (
              <TableRow key={event.id} className="border-border-subtle/50">
                <TableCell className="text-xs text-text-muted">
                  {formatTime(event.timestamp)}
                </TableCell>
                <TableCell className="text-sm font-medium text-text-primary">
                  {template ? String(template) : "-"}
                </TableCell>
                <TableCell>
                  {found ? (
                    <Badge variant="success" className="text-xs">
                      FOUND
                    </Badge>
                  ) : found === false ? (
                    <Badge variant="destructive" className="text-xs">
                      NOT FOUND
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      -
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {confidence != null ? (
                    <Badge
                      variant={
                        Number(confidence) >= 0.8
                          ? "success"
                          : Number(confidence) >= 0.5
                            ? "warning"
                            : "destructive"
                      }
                      className="text-xs"
                    >
                      {(Number(confidence) * 100).toFixed(0)}%
                    </Badge>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell className="text-xs text-text-muted font-mono">
                  {location
                    ? typeof location === "object"
                      ? JSON.stringify(location)
                      : String(location)
                    : "-"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

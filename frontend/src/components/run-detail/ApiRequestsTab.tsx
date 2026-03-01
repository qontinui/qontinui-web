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
import { RefreshCw, Globe, ChevronRight, ChevronDown } from "lucide-react";

interface ApiRequestsTabProps {
  runId: string;
}

function getMethodBadgeClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "bg-green-500/10 text-green-400 border-green-500/30";
    case "POST":
      return "bg-blue-500/10 text-blue-400 border-blue-500/30";
    case "PUT":
    case "PATCH":
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
    case "DELETE":
      return "bg-red-500/10 text-red-400 border-red-500/30";
    default:
      return "bg-surface-raised/30 text-text-muted border-border-subtle";
  }
}

function getStatusBadgeVariant(
  status: number
): "success" | "warning" | "destructive" | "secondary" {
  if (status >= 200 && status < 300) return "success";
  if (status >= 400 && status < 500) return "warning";
  if (status >= 500) return "destructive";
  return "secondary";
}

function truncateUrl(url: string, maxLen: number = 60): string {
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen) + "...";
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

function ApiRequestRow({ event }: { event: TaskRunEvent }) {
  const [isOpen, setIsOpen] = useState(false);
  const method = String(event.data.method || "GET").toUpperCase();
  const url = String(event.data.url || "");
  const status = Number(event.data.status || event.data.status_code || 0);
  const duration = event.data.duration_ms
    ? Number(event.data.duration_ms)
    : null;

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
          <Badge
            variant="outline"
            className={`text-xs font-mono ${getMethodBadgeClass(method)}`}
          >
            {method}
          </Badge>
        </TableCell>
        <TableCell
          className="text-sm text-text-secondary font-mono max-w-sm truncate"
          title={url}
        >
          {truncateUrl(url)}
        </TableCell>
        <TableCell>
          {status > 0 ? (
            <Badge variant={getStatusBadgeVariant(status)} className="text-xs">
              {status}
            </Badge>
          ) : (
            <span className="text-xs text-text-muted">-</span>
          )}
        </TableCell>
        <TableCell className="text-sm text-text-muted">
          {duration != null ? `${duration}ms` : "-"}
        </TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow className="border-border-subtle/30">
          <TableCell colSpan={5} className="p-0">
            <div className="p-4 bg-surface-canvas/50 space-y-3">
              <div className="text-xs font-mono text-text-muted break-all">
                {url}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {event.data.request_body != null && (
                  <div>
                    <div className="text-xs font-medium text-text-muted mb-1">
                      Request Body
                    </div>
                    <pre className="text-xs font-mono text-text-secondary bg-surface-raised/30 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto border border-border-subtle/30">
                      {formatJson(event.data.request_body)}
                    </pre>
                  </div>
                )}
                {event.data.response_body != null && (
                  <div>
                    <div className="text-xs font-medium text-text-muted mb-1">
                      Response Body
                    </div>
                    <pre className="text-xs font-mono text-text-secondary bg-surface-raised/30 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto border border-border-subtle/30">
                      {formatJson(event.data.response_body)}
                    </pre>
                  </div>
                )}
              </div>
              {event.data.headers != null && (
                <div>
                  <div className="text-xs font-medium text-text-muted mb-1">
                    Headers
                  </div>
                  <pre className="text-xs font-mono text-text-secondary bg-surface-raised/30 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto border border-border-subtle/30">
                    {formatJson(event.data.headers)}
                  </pre>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ApiRequestsTab({ runId }: ApiRequestsTabProps) {
  const { data, isLoading, error } = useTaskRunEvents(runId);

  const apiEvents = useMemo(() => {
    if (!data) return [];
    return (data as TaskRunEvent[]).filter(
      (e) =>
        e.event_type === "api_request" || e.event_type.includes("api_request")
    );
  }, [data]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading API requests...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (apiEvents.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Globe className="size-12 mx-auto mb-4" />
        <p>No API requests recorded for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary">{apiEvents.length} requests</Badge>
      </div>

      <ScrollArea className="h-[650px]">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border-subtle/50">
                <TableHead className="w-8" />
                <TableHead className="w-24">Method</TableHead>
                <TableHead>URL</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-24">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiEvents.map((event) => (
                <ApiRequestRow key={event.id} event={event as TaskRunEvent} />
              ))}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
    </div>
  );
}

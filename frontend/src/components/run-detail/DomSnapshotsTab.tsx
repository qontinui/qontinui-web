"use client";

import { useState, useMemo } from "react";
import { useTaskRunEvents, type TaskRunEvent } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  RefreshCw,
  FileCode,
  ChevronRight,
  ChevronDown,
  Globe,
  ExternalLink,
} from "lucide-react";

interface DomSnapshotsTabProps {
  runId: string;
}

function formatTimestamp(ts: string): string {
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

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}

function extractUrlParts(url: string): { domain: string; pathname: string } {
  try {
    const parsed = new URL(url);
    return { domain: parsed.hostname, pathname: parsed.pathname };
  } catch {
    return { domain: url, pathname: "" };
  }
}

function SnapshotItem({ event }: { event: TaskRunEvent }) {
  const [isOpen, setIsOpen] = useState(false);

  const url = String(event.data.url || event.data.page_url || "");
  const title = String(event.data.title || event.data.page_title || "");
  const htmlContent = String(
    event.data.html || event.data.content || event.data.snapshot || ""
  );
  const { domain, pathname } = extractUrlParts(url);
  const actions = event.data.actions as string[] | undefined;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-3 w-full p-3 rounded-lg bg-surface-raised/30 border border-border-subtle/50 hover:bg-surface-raised/50 transition-colors text-left">
        {isOpen ? (
          <ChevronDown className="size-3.5 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 text-text-muted shrink-0" />
        )}
        <Globe className="size-4 text-text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">
              {domain || "Unknown"}
            </span>
            {pathname && pathname !== "/" && (
              <span className="text-xs text-text-muted font-mono truncate">
                {pathname}
              </span>
            )}
          </div>
          {title && (
            <div className="text-xs text-text-muted mt-0.5 truncate">
              {title}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {htmlContent && (
            <Badge variant="outline" className="text-xs">
              {formatSize(htmlContent.length)}
            </Badge>
          )}
          <span className="text-xs text-text-muted">
            {formatTimestamp(event.timestamp)}
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 p-4 bg-surface-canvas/50 rounded-lg border border-border-subtle/30 space-y-3">
          {title && (
            <div>
              <span className="text-xs font-medium text-text-muted">
                Page Title:
              </span>
              <span className="text-sm text-text-primary ml-2">{title}</span>
            </div>
          )}
          {url && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-muted">URL:</span>
              <span className="text-sm text-text-secondary font-mono break-all">
                {url}
              </span>
              <ExternalLink className="size-3 text-text-muted shrink-0" />
            </div>
          )}
          {actions && actions.length > 0 && (
            <div>
              <span className="text-xs font-medium text-text-muted mb-1 block">
                Associated Actions:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {actions.map((action, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {String(action)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {htmlContent && (
            <div>
              <div className="text-xs font-medium text-text-muted mb-1">
                Snapshot Content ({formatSize(htmlContent.length)})
              </div>
              <ScrollArea className="h-[300px]">
                <pre className="text-xs font-mono text-text-secondary bg-surface-raised/30 rounded p-3 whitespace-pre-wrap break-words border border-border-subtle/30">
                  {htmlContent.substring(0, 50000)}
                  {htmlContent.length > 50000 && "\n\n... (truncated)"}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DomSnapshotsTab({ runId }: DomSnapshotsTabProps) {
  const { data, isLoading, error } = useTaskRunEvents(runId);

  const snapshotEvents = useMemo(() => {
    if (!data) return [];
    return (data as TaskRunEvent[]).filter(
      (e) =>
        e.event_type === "dom_snapshot" ||
        e.event_type === "page_snapshot" ||
        e.event_type.includes("dom_snapshot") ||
        e.event_type.includes("page_snapshot")
    );
  }, [data]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading snapshots...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (snapshotEvents.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <FileCode className="size-12 mx-auto mb-4" />
        <p>No DOM/page snapshots captured for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary">
          {snapshotEvents.length} snapshot
          {snapshotEvents.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <ScrollArea className="h-[650px]">
        <div className="space-y-2 pr-4">
          {snapshotEvents.map((event) => (
            <SnapshotItem key={event.id} event={event as TaskRunEvent} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

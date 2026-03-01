"use client";

import { useState, useMemo } from "react";
import { useTaskRunEvents, type TaskRunEvent } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RefreshCw, Activity, ChevronRight, ChevronDown } from "lucide-react";

interface EventsTabProps {
  runId: string;
}

const EVENT_TYPE_STYLES: Record<string, { label: string; className: string }> =
  {
    ai_output: {
      label: "AI Output",
      className: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    },
    action: {
      label: "Action",
      className: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    },
    image_recognition: {
      label: "Image Recognition",
      className: "bg-green-500/10 text-green-400 border-green-500/30",
    },
    state_change: {
      label: "State Change",
      className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    },
    error: {
      label: "Error",
      className: "bg-red-500/10 text-red-400 border-red-500/30",
    },
    api_request: {
      label: "API Request",
      className: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
    },
    mcp_call: {
      label: "MCP Call",
      className: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
    },
    dom_snapshot: {
      label: "DOM Snapshot",
      className: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    },
    page_snapshot: {
      label: "Page Snapshot",
      className: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    },
  };

function getEventStyle(eventType: string) {
  for (const [key, style] of Object.entries(EVENT_TYPE_STYLES)) {
    if (eventType.includes(key)) return style;
  }
  return {
    label: eventType,
    className: "bg-surface-raised/30 text-text-muted border-border-subtle",
  };
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hour12: false,
    });
  } catch {
    return ts;
  }
}

function getUniqueEventTypes(events: TaskRunEvent[]): string[] {
  const types = new Set<string>();
  for (const event of events) {
    types.add(event.event_type);
  }
  return Array.from(types).sort();
}

function EventItem({ event }: { event: TaskRunEvent }) {
  const [isOpen, setIsOpen] = useState(false);
  const style = getEventStyle(event.event_type);
  const hasData = Object.keys(event.data).length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        className="flex items-center gap-3 w-full p-3 rounded-lg bg-surface-raised/30 border border-border-subtle/50 hover:bg-surface-raised/50 transition-colors text-left"
        disabled={!hasData}
      >
        {hasData ? (
          isOpen ? (
            <ChevronDown className="size-3.5 text-text-muted shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 text-text-muted shrink-0" />
          )
        ) : (
          <div className="size-3.5 shrink-0" />
        )}
        <Badge variant="outline" className={`text-xs ${style.className}`}>
          {event.event_type}
        </Badge>
        <span className="text-sm text-text-secondary flex-1 truncate">
          {event.data.message
            ? String(event.data.message)
            : event.data.target
              ? String(event.data.target)
              : event.data.action
                ? String(event.data.action)
                : hasData
                  ? JSON.stringify(event.data).substring(0, 100)
                  : "-"}
        </span>
        <span className="text-xs text-text-muted shrink-0">
          {formatTimestamp(event.timestamp)}
        </span>
      </CollapsibleTrigger>
      {hasData && (
        <CollapsibleContent>
          <div className="mt-1 ml-7 p-3 bg-surface-canvas/50 rounded-lg border border-border-subtle/30">
            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export function EventsTab({ runId }: EventsTabProps) {
  const { data, isLoading, error } = useTaskRunEvents(runId);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const eventTypes = useMemo(() => {
    if (!data) return [];
    return getUniqueEventTypes(data as TaskRunEvent[]);
  }, [data]);

  const filteredEvents = useMemo(() => {
    if (!data) return [];
    const events = data as TaskRunEvent[];
    if (!activeFilter) return events;
    return events.filter((e) => e.event_type === activeFilter);
  }, [data, activeFilter]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading events...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Activity className="size-12 mx-auto mb-4" />
        <p>No events recorded for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={activeFilter === null ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveFilter(null)}
          className="text-xs"
        >
          All ({(data as TaskRunEvent[]).length})
        </Button>
        {eventTypes.map((type) => {
          const style = getEventStyle(type);
          const count = (data as TaskRunEvent[]).filter(
            (e) => e.event_type === type
          ).length;
          return (
            <Button
              key={type}
              variant={activeFilter === type ? "default" : "outline"}
              size="sm"
              onClick={() =>
                setActiveFilter(activeFilter === type ? null : type)
              }
              className="text-xs"
            >
              {style.label} ({count})
            </Button>
          );
        })}
      </div>

      <ScrollArea className="h-[650px]">
        <div className="space-y-2 pr-4">
          {filteredEvents.slice(0, 500).map((event) => (
            <EventItem key={event.id} event={event as TaskRunEvent} />
          ))}
        </div>
        {filteredEvents.length > 500 && (
          <p className="text-xs text-text-muted text-center mt-4">
            Showing first 500 of {filteredEvents.length} events
          </p>
        )}
      </ScrollArea>
    </div>
  );
}

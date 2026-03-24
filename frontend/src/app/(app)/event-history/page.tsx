"use client";

import { useState, useMemo } from "react";
import { useRunnerQuery } from "@/lib/runner/api-client";
import { Radio, Search, Filter } from "lucide-react";

// =============================================================================
// Types matching the runner's WorkflowEvent / SubscriptionInfo structs
// =============================================================================

interface EventSource {
  task_run_id?: string;
  workflow_id?: string;
  workflow_name?: string;
}

interface WorkflowEvent {
  name: string;
  data: unknown;
  timestamp: string;
  idempotency_key?: string;
  source: EventSource;
}

interface SubscriptionInfo {
  id: string;
  event_pattern: string;
  target_workflow_id?: string;
  once: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }) + " " + d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function truncateJson(value: unknown, maxLen = 120): string {
  const s = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return s.length > maxLen ? s.slice(0, maxLen) + "\u2026" : s;
}

function sourceLabel(source: EventSource): string {
  if (source.workflow_name) return source.workflow_name;
  if (source.workflow_id) return source.workflow_id;
  if (source.task_run_id) return `task:${source.task_run_id.slice(0, 8)}`;
  return "\u2014";
}

// =============================================================================
// Component
// =============================================================================

export default function EventHistoryPage() {
  const [filter, setFilter] = useState("");

  // Fetch events with 5-second auto-refresh via shared poll
  const {
    data: events,
    isLoading: eventsLoading,
    error: eventsError,
    isOffline,
  } = useRunnerQuery<WorkflowEvent[]>("/inngest/events?limit=100", {
    pollInterval: 5000,
  });

  // Fetch subscriptions (slower poll — they change infrequently)
  const { data: subscriptions } = useRunnerQuery<SubscriptionInfo[]>(
    "/inngest/subscriptions",
    { pollInterval: 15000 }
  );

  // Client-side filter
  const filtered = useMemo(() => {
    if (!events) return [];
    if (!filter) return events;
    const lower = filter.toLowerCase();
    return events.filter(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        sourceLabel(e.source).toLowerCase().includes(lower)
    );
  }, [events, filter]);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-[#F59E0B]" />
          <h1 className="text-lg font-semibold">Workflow Event History</h1>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {subscriptions && (
            <span className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" />
              {subscriptions.length} subscription{subscriptions.length !== 1 ? "s" : ""}
            </span>
          )}
          {events && (
            <span>{events.length} event{events.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      </header>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter by event name or source..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md border border-border bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {isOffline && (
          <div className="mx-6 mt-4 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
            Runner not connected. Is qontinui-runner running?
          </div>
        )}

        {eventsError && !isOffline && (
          <div className="mx-6 mt-4 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {eventsError}
          </div>
        )}

        {eventsLoading && !events && (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Loading event history...
          </div>
        )}

        {events && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Radio className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">
              {filter ? "No events match the filter." : "No events recorded yet."}
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted border-b border-border">
                <tr className="text-left text-muted-foreground">
                  <th className="px-6 py-2 font-medium w-44">Timestamp</th>
                  <th className="px-6 py-2 font-medium">Event Name</th>
                  <th className="px-6 py-2 font-medium w-48">Source</th>
                  <th className="px-6 py-2 font-medium">Data Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((evt, idx) => (
                  <tr
                    key={evt.idempotency_key ?? `${evt.timestamp}-${idx}`}
                    className="hover:bg-muted/60 transition-colors"
                  >
                    <td className="px-6 py-2 text-muted-foreground whitespace-nowrap font-mono text-xs">
                      {formatTimestamp(evt.timestamp)}
                    </td>
                    <td className="px-6 py-2 font-medium text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={
                            evt.name.includes("failed") || evt.name.includes("error")
                              ? "text-red-400"
                              : evt.name.includes("completed") || evt.name.includes("success")
                                ? "text-green-400"
                                : "text-foreground"
                          }
                        >
                          {evt.name}
                        </span>
                      </span>
                    </td>
                    <td className="px-6 py-2 text-muted-foreground whitespace-nowrap">
                      {sourceLabel(evt.source)}
                    </td>
                    <td className="px-6 py-2 text-muted-foreground font-mono text-xs max-w-md truncate">
                      {truncateJson(evt.data)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Subscriptions panel */}
        {subscriptions && subscriptions.length > 0 && (
          <div className="mx-6 my-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-2">
              Active Subscriptions
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {subscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted text-sm"
                >
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <span className="font-mono text-xs text-foreground truncate">
                    {sub.event_pattern}
                  </span>
                  {sub.once && (
                    <span className="ml-auto text-xs text-muted-foreground">once</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

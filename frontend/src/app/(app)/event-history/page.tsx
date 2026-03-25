"use client";

import { useState, useMemo, Fragment } from "react";
import { useRunnerQuery } from "@/lib/runner/api-client";
import { Radio, Search, Filter, ChevronDown, ChevronRight } from "lucide-react";

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

interface DurableQueueStatus {
  pending: number;
  running: number;
  max_concurrent: number;
  max_queue_depth: number;
  durable_persistence: boolean;
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

function formatTimestampFull(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function truncateJson(value: unknown, maxLen = 120): string {
  const s = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return s.length > maxLen ? s.slice(0, maxLen) + "\u2026" : s;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

function sourceLabel(source: EventSource): string {
  if (source.workflow_name) return source.workflow_name;
  if (source.workflow_id) return source.workflow_id;
  if (source.task_run_id) return `task:${source.task_run_id.slice(0, 8)}`;
  return "\u2014";
}

/** Colored dot class based on event name pattern. */
function eventDotColor(name: string): string {
  if (name.includes("completed") || name.includes("success")) return "bg-green-500";
  if (name.includes("failed") || name.includes("error")) return "bg-red-500";
  if (name.includes("started")) return "bg-blue-500";
  if (name.startsWith("step.")) return "bg-yellow-500";
  return "bg-zinc-500";
}

/** Text color class for event name. */
function eventTextColor(name: string): string {
  if (name.includes("failed") || name.includes("error")) return "text-red-400";
  if (name.includes("completed") || name.includes("success")) return "text-green-400";
  return "text-foreground";
}

// =============================================================================
// Queue Status Widget
// =============================================================================

function QueueStatusWidget() {
  const { data: queue } = useRunnerQuery<DurableQueueStatus>("/inngest/queue", {
    pollInterval: 5000,
  });

  if (!queue) return null;

  const stats = [
    { label: "Pending", value: queue.pending },
    { label: "Running", value: queue.running },
    { label: "Max Concurrent", value: queue.max_concurrent },
    { label: "Max Depth", value: queue.max_queue_depth },
  ];

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted text-sm"
        >
          <span className="text-muted-foreground">{s.label}</span>
          <span className="font-semibold text-foreground tabular-nums">{s.value}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-muted text-sm">
        <span
          className={`w-2 h-2 rounded-full ${queue.durable_persistence ? "bg-green-500" : "bg-zinc-500"}`}
        />
        <span className="text-muted-foreground">
          {queue.durable_persistence ? "Durable" : "In-Memory"}
        </span>
      </div>
    </div>
  );
}

// =============================================================================
// Circuit Breaker Status Widget
// =============================================================================

interface CircuitBreakerStatus {
  state: string;
  failure_count: number;
  failure_threshold: number;
  cooldown_ms: number;
}

function CircuitBreakerWidget() {
  const { data: cb } = useRunnerQuery<CircuitBreakerStatus>("/inngest/circuit-breaker", {
    pollInterval: 5000,
  });

  if (!cb) return null;

  const stateConfig: Record<string, { dot: string; label: string }> = {
    closed:    { dot: "bg-green-500",  label: "Closed" },
    open:      { dot: "bg-red-500",    label: "Open" },
    half_open: { dot: "bg-yellow-500", label: "Half-Open" },
  };

  const { dot, label } = stateConfig[cb.state] ?? { dot: "bg-zinc-500", label: cb.state };
  const cooldownSec = Math.round(cb.cooldown_ms / 1000);

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-muted text-sm">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-muted-foreground">Circuit</span>
        <span className="font-semibold text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted text-sm">
        <span className="text-muted-foreground">Failures</span>
        <span className="font-semibold text-foreground tabular-nums">
          {cb.failure_count} / {cb.failure_threshold}
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted text-sm">
        <span className="text-muted-foreground">Cooldown</span>
        <span className="font-semibold text-foreground tabular-nums">{cooldownSec}s</span>
      </div>
    </div>
  );
}

// =============================================================================
// Event Detail Panel (inline expandable)
// =============================================================================

function EventDetailPanel({ evt }: { evt: WorkflowEvent }) {
  return (
    <tr>
      <td colSpan={4} className="px-6 py-4 bg-muted/40 border-b border-border">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {/* Left column: metadata */}
          <div className="space-y-2">
            <div>
              <span className="text-muted-foreground text-xs uppercase tracking-wide">Event Name</span>
              <p className={`font-mono text-sm ${eventTextColor(evt.name)}`}>{evt.name}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs uppercase tracking-wide">Timestamp</span>
              <p className="font-mono text-sm text-foreground">{formatTimestampFull(evt.timestamp)}</p>
            </div>
            {evt.idempotency_key && (
              <div>
                <span className="text-muted-foreground text-xs uppercase tracking-wide">Idempotency Key</span>
                <p className="font-mono text-xs text-foreground break-all">{evt.idempotency_key}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground text-xs uppercase tracking-wide">Source</span>
              <div className="space-y-0.5 mt-0.5">
                {evt.source.workflow_name && (
                  <p className="text-sm text-foreground">{evt.source.workflow_name}</p>
                )}
                {evt.source.workflow_id && (
                  <p className="font-mono text-xs text-muted-foreground">
                    workflow_id: {evt.source.workflow_id}
                  </p>
                )}
                {evt.source.task_run_id && (
                  <p className="font-mono text-xs text-muted-foreground">
                    task_run_id: {evt.source.task_run_id}
                  </p>
                )}
                {!evt.source.workflow_name && !evt.source.workflow_id && !evt.source.task_run_id && (
                  <p className="text-muted-foreground">&mdash;</p>
                )}
              </div>
            </div>
          </div>

          {/* Right column: JSON data */}
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wide">Data</span>
            <pre className="mt-1 p-3 rounded-md bg-background border border-border font-mono text-xs text-foreground overflow-auto max-h-64 whitespace-pre-wrap break-all">
              {formatJson(evt.data)}
            </pre>
          </div>
        </div>
      </td>
    </tr>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function EventHistoryPage() {
  const [filter, setFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

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

  // Client-side filter, reversed for newest-first
  const filtered = useMemo(() => {
    if (!events) return [];
    const list = filter
      ? events.filter((e) => {
          const lower = filter.toLowerCase();
          return (
            e.name.toLowerCase().includes(lower) ||
            sourceLabel(e.source).toLowerCase().includes(lower)
          );
        })
      : events;
    return [...list].reverse();
  }, [events, filter]);

  // Reset selection when filter changes or events refresh in a way that changes length
  const handleRowClick = (idx: number) => {
    setSelectedIdx((prev) => (prev === idx ? null : idx));
  };

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

      {/* Queue & Circuit Breaker Status */}
      <div className="px-6 py-3 border-b border-border shrink-0 flex items-center gap-6 flex-wrap">
        <QueueStatusWidget />
        <CircuitBreakerWidget />
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter by event name or source..."
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setSelectedIdx(null); }}
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
                {filtered.map((evt, idx) => {
                  const isExpanded = selectedIdx === idx;
                  return (
                    <Fragment key={evt.idempotency_key ?? `${evt.timestamp}-${idx}`}>
                      <tr
                        onClick={() => handleRowClick(idx)}
                        className={`cursor-pointer transition-colors ${
                          isExpanded ? "bg-muted/80" : "hover:bg-muted/60"
                        }`}
                      >
                        <td className="px-6 py-2 text-muted-foreground whitespace-nowrap font-mono text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            {isExpanded
                              ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                              : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                            }
                            {formatTimestamp(evt.timestamp)}
                          </span>
                        </td>
                        <td className="px-6 py-2 font-medium text-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${eventDotColor(evt.name)}`} />
                            <span className={eventTextColor(evt.name)}>
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
                      {isExpanded && <EventDetailPanel evt={evt} />}
                    </Fragment>
                  );
                })}
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

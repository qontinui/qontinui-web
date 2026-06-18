"use client";

/**
 * LogRow — render a single `coord.agent_logs` row.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 5 (Wave 3b).
 *
 * Compact one-line shape: [level] [time] event_name  agent_id_short
 * Click the row to expand the structured payload as JSON. Optional
 * `onAgentClick` cross-links to the per-agent live view (the recent
 * timeline at /admin/coord/agents uses this).
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { LevelBadge } from "@/components/admin/coord/LevelBadge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface AgentLogRow {
  log_id?: string | number;
  agent_id: string;
  agent_session_id?: string | null;
  device_id?: string | null;
  level?: string;
  event?: string;
  payload?: Record<string, unknown> | null;
  occurred_at?: string;
  /**
   * `true` when the agent has no `coord.agent_worktrees` row — an
   * interactive / runner-managed or PTY-CLI session rather than a
   * coord-spawned agent. Derived by coord's `get_recent`; `undefined`
   * on older coord shapes (then the badge is omitted).
   */
  is_interactive?: boolean;
  // Coord may use `ts` or `created_at` in older shapes — tolerate both.
  ts?: string;
  created_at?: string;
}

function shortId(id?: string | null, take = 8): string {
  if (!id) return "";
  return id.length > take ? `${id.slice(0, take)}…` : id;
}

function formatRelative(iso: string | undefined | null): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  const deltaSec = Math.round((Date.now() - parsed) / 1000);
  if (Math.abs(deltaSec) < 60) return `${deltaSec}s`;
  const deltaMin = Math.round(deltaSec / 60);
  if (Math.abs(deltaMin) < 60) return `${deltaMin}m`;
  const deltaHr = Math.round(deltaMin / 60);
  if (Math.abs(deltaHr) < 48) return `${deltaHr}h`;
  const deltaDay = Math.round(deltaHr / 24);
  return `${deltaDay}d`;
}

function formatAbs(iso: string | undefined | null): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").replace(/\..*$/, "Z");
}

export interface LogRowProps {
  log: AgentLogRow;
  /** When set, clicking the agent_id chip invokes this. */
  onAgentClick?: (agent_id: string) => void;
  /** When true, agent_id chip is omitted (we're already on a per-agent view). */
  hideAgentId?: boolean;
  /** When true, defaults to expanded payload (e.g. for newest row). */
  defaultExpanded?: boolean;
}

export function LogRow({
  log,
  onAgentClick,
  hideAgentId = false,
  defaultExpanded = false,
}: LogRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const occurredAt = log.occurred_at ?? log.ts ?? log.created_at ?? null;
  const hasPayload =
    log.payload != null &&
    typeof log.payload === "object" &&
    Object.keys(log.payload).length > 0;

  const handleAgentClick = (e: React.MouseEvent) => {
    if (!onAgentClick) return;
    e.stopPropagation();
    onAgentClick(log.agent_id);
  };

  return (
    <div
      data-testid="agent-log-row"
      data-log-level={(log.level ?? "info").toLowerCase()}
      data-agent-id={log.agent_id}
      className={cn(
        "group rounded-md border border-border bg-card px-2.5 py-1.5",
        "hover:bg-muted/40 transition-colors cursor-pointer",
      )}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform shrink-0",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
        <LevelBadge level={log.level} />
        <span
          className="font-mono text-[11px] text-muted-foreground"
          title={formatAbs(occurredAt)}
        >
          {formatRelative(occurredAt)}
        </span>
        <span className="font-medium text-foreground truncate">
          {log.event ?? "(no event)"}
        </span>
        {log.is_interactive !== undefined && (
          <Badge
            data-testid="log-row-source-badge"
            variant={log.is_interactive ? "info" : "secondary"}
            className="text-[10px] px-1 py-0 leading-tight"
            title={
              log.is_interactive
                ? "Interactive / PTY-CLI session (no coord worktree)"
                : "Coord-spawned agent (has a worktree)"
            }
          >
            {log.is_interactive ? "interactive" : "spawned"}
          </Badge>
        )}
        {!hideAgentId && (
          <button
            type="button"
            data-testid="log-row-agent-link"
            onClick={handleAgentClick}
            className={cn(
              "ml-auto font-mono text-[10px] px-1.5 py-0.5 rounded border",
              "border-border bg-muted/40 text-muted-foreground",
              onAgentClick && "hover:bg-primary/10 hover:text-primary",
            )}
          >
            agent {shortId(log.agent_id, 8)}
          </button>
        )}
      </div>
      {expanded && hasPayload && (
        <pre
          data-testid="agent-log-payload"
          className="mt-1.5 ml-5 text-[11px] font-mono bg-muted/30 border border-border rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words"
        >
          {JSON.stringify(log.payload, null, 2)}
        </pre>
      )}
      {expanded && !hasPayload && (
        <p className="mt-1 ml-5 text-[11px] text-muted-foreground italic">
          (no payload)
        </p>
      )}
    </div>
  );
}

export default LogRow;

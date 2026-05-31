"use client";

/**
 * /admin/coord/agents/[agent_id] — per-agent live log view.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 5 (Wave 3b).
 *
 * Reads `GET /api/v1/operations/agent-logs/by-agent/{agent_id}?limit=500`
 * and polls every 5s. Live updates via WS aren't bridged through web
 * yet (coord emits `events.agent.log.<agent_id>` but the web↔runner WS
 * bridge doesn't republish coord NATS subjects), so polling is the
 * canonical path; the URL is kept so a WS upgrade is a drop-in.
 *
 * Filters: level (multi-select), event (contains), since (relative time
 * picker). Auto-scrolls to latest when new rows land. Cross-links to
 * `/admin/agent-sessions/{session_id}` once the per-agent rows surface
 * an `agent_session_id` (the lineage UNION arm shipped in Wave 1).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ScrollText,
  RefreshCw,
  ChevronLeft,
  Users,
} from "lucide-react";
import {
  LogRow,
  type AgentLogRow,
} from "@/components/admin/coord/LogRow";
import { cn } from "@/lib/utils";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 5_000;
const FETCH_LIMIT = 500;
const ALL_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
type LevelKey = (typeof ALL_LEVELS)[number];

const SINCE_OPTIONS: { value: string; label: string; minutes: number | null }[] =
  [
    { value: "any", label: "Any time", minutes: null },
    { value: "5m", label: "Last 5 min", minutes: 5 },
    { value: "15m", label: "Last 15 min", minutes: 15 },
    { value: "1h", label: "Last 1 hour", minutes: 60 },
    { value: "24h", label: "Last 24 hours", minutes: 60 * 24 },
  ];

interface ByAgentResponse {
  agent_id?: string;
  logs?: AgentLogRow[];
}

function deriveSessionId(logs: AgentLogRow[]): string | null {
  // The session_id of an agent is stable; pick the first non-null we
  // see (rows may omit it if the agent predates the lineage column).
  for (const row of logs) {
    if (row.agent_session_id) return row.agent_session_id;
  }
  return null;
}

export default function CoordAgentLogPage() {
  const params = useParams<{ agent_id: string }>();
  const router = useRouter();
  const agentId = decodeURIComponent(params?.agent_id ?? "");

  const [data, setData] = useState<ByAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLevels, setSelectedLevels] = useState<Set<LevelKey>>(
    () => new Set(),
  );
  const [eventFilter, setEventFilter] = useState("");
  const [sinceKey, setSinceKey] = useState("any");
  const [autoScroll, setAutoScroll] = useState(true);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const lastSeenCount = useRef(0);

  const fetchData = useCallback(async () => {
    if (!agentId) return;
    try {
      const qs = new URLSearchParams();
      qs.set("limit", String(FETCH_LIMIT));
      const sinceOpt = SINCE_OPTIONS.find((o) => o.value === sinceKey);
      if (sinceOpt?.minutes != null) {
        const sinceIso = new Date(
          Date.now() - sinceOpt.minutes * 60_000,
        ).toISOString();
        qs.set("since", sinceIso);
      }
      const body = await httpClient.get<unknown>(
        `${API}/agent-logs/by-agent/${encodeURIComponent(agentId)}?${qs.toString()}`,
      );
      const normalized: ByAgentResponse = Array.isArray(body)
        ? { logs: body }
        : (body as ByAgentResponse);
      setData(normalized);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agentId, sinceKey]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const toggleLevel = useCallback((lvl: LevelKey) => {
    setSelectedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const raw = data?.logs ?? [];
    const evt = eventFilter.trim().toLowerCase();
    return raw.filter((row) => {
      if (selectedLevels.size > 0) {
        const lvl = (row.level ?? "info").toLowerCase() as LevelKey;
        if (!selectedLevels.has(lvl)) return false;
      }
      if (evt && !(row.event ?? "").toLowerCase().includes(evt)) {
        return false;
      }
      return true;
    });
  }, [data, selectedLevels, eventFilter]);

  // Auto-scroll to bottom when row count grows (new entries arrived).
  useEffect(() => {
    if (!autoScroll) return;
    if (filtered.length > lastSeenCount.current) {
      listEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
    lastSeenCount.current = filtered.length;
  }, [filtered, autoScroll]);

  const sessionId = useMemo(
    () => deriveSessionId(data?.logs ?? []),
    [data],
  );

  return (
    <div className="p-6 space-y-4" data-testid="coord-agent-log-page">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" />
              Agent log
              <span
                data-testid="coord-agent-log-agent-id"
                className="font-mono text-xs text-muted-foreground"
              >
                {agentId}
              </span>
              <Badge variant="outline" className="ml-2">
                {filtered.length}
                {data?.logs && data.logs.length !== filtered.length
                  ? ` / ${data.logs.length}`
                  : ""}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/admin/coord/agents")}
                data-testid="coord-agent-log-back"
              >
                <ChevronLeft className="h-3 w-3 mr-1" />
                Recent
              </Button>
              {sessionId && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  data-testid="coord-agent-log-session-link"
                >
                  <Link
                    href={`/admin/agent-sessions/${encodeURIComponent(sessionId)}`}
                  >
                    <Users className="h-3 w-3 mr-1" />
                    Session
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div
              data-testid="coord-agent-log-level-filter"
              className="flex items-center gap-1"
            >
              <span className="text-xs text-muted-foreground mr-1">
                levels:
              </span>
              {ALL_LEVELS.map((lvl) => {
                const active = selectedLevels.has(lvl);
                return (
                  <button
                    key={lvl}
                    type="button"
                    aria-pressed={active}
                    data-testid={`coord-agent-log-level-${lvl}`}
                    onClick={() => toggleLevel(lvl)}
                    className={cn(
                      "px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wide",
                      "transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
            <Input
              placeholder="event contains…"
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              data-testid="coord-agent-log-event-filter"
              className="h-8 max-w-[220px]"
            />
            <Select value={sinceKey} onValueChange={setSinceKey}>
              <SelectTrigger
                className="w-[140px] h-8"
                data-testid="coord-agent-log-since-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SINCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5 ml-2">
              <Switch
                id="auto-scroll"
                checked={autoScroll}
                onCheckedChange={setAutoScroll}
                data-testid="coord-agent-log-auto-scroll"
              />
              <label
                htmlFor="auto-scroll"
                className="text-xs text-muted-foreground"
              >
                auto-scroll
              </label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              data-testid="coord-agent-log-refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          )}

          {loading && !data ? (
            <Skeleton className="h-24 w-full" />
          ) : filtered.length > 0 ? (
            <div
              data-testid="coord-agent-log-list"
              className="space-y-1.5 max-h-[70vh] overflow-y-auto"
            >
              {filtered.map((row, i) => (
                <LogRow
                  key={row.log_id ?? `${row.occurred_at ?? row.ts ?? i}-${i}`}
                  log={row}
                  hideAgentId
                  defaultExpanded={i === filtered.length - 1}
                />
              ))}
              <div ref={listEndRef} />
            </div>
          ) : (
            <p
              data-testid="coord-agent-log-empty"
              className="text-sm text-muted-foreground italic"
            >
              No log entries for this agent match the current filters.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

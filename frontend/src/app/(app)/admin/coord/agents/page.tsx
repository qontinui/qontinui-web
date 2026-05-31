"use client";

/**
 * /admin/coord/agents — fleet-wide recent agent_logs timeline.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 5 (Wave 3b).
 *
 * Reads `GET /api/v1/operations/agent-logs/recent?limit=200` every 5s.
 * Rows render with LogRow (level badge + collapsible payload). Clicking
 * the agent_id chip cross-links to the per-agent live view at
 * `/admin/coord/agents/[agent_id]`.
 *
 * Two filter controls: level (multi-select chips) + event (free-text
 * contains, client-side filtered against the latest pull).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollText, RefreshCw } from "lucide-react";
import {
  LogRow,
  type AgentLogRow,
} from "@/components/admin/coord/LogRow";
import { cn } from "@/lib/utils";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 5_000;
const RECENT_LIMIT = 200;
const ALL_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
type LevelKey = (typeof ALL_LEVELS)[number];

interface RecentResponse {
  logs?: AgentLogRow[];
}

export default function CoordAgentsRecentPage() {
  const router = useRouter();
  const [data, setData] = useState<RecentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Level multi-select. Empty == "all".
  const [selectedLevels, setSelectedLevels] = useState<Set<LevelKey>>(
    () => new Set(),
  );
  const [eventFilter, setEventFilter] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      qs.set("limit", String(RECENT_LIMIT));
      const body = await httpClient.get<unknown>(
        `${API}/agent-logs/recent?${qs.toString()}`
      );
      // Tolerate bare list shape too.
      const normalized: RecentResponse = Array.isArray(body)
        ? { logs: body }
        : (body as RecentResponse);
      setData(normalized);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

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

  const handleAgentClick = useCallback(
    (agentId: string) => {
      router.push(`/admin/coord/agents/${encodeURIComponent(agentId)}`);
    },
    [router],
  );

  return (
    <div className="p-6 space-y-4" data-testid="coord-agents-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" />
            Recent agent activity
            <Badge variant="outline" className="ml-2">
              {filtered.length}
              {data?.logs && data.logs.length !== filtered.length
                ? ` / ${data.logs.length}`
                : ""}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div
              data-testid="coord-agents-level-filter"
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
                    data-testid={`coord-agents-level-${lvl}`}
                    aria-pressed={active}
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
              data-testid="coord-agents-event-filter"
              className="h-8 max-w-[220px]"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              data-testid="coord-agents-refresh"
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
              data-testid="coord-agents-recent-list"
              className="space-y-1.5"
            >
              {filtered.map((row, i) => (
                <LogRow
                  key={row.log_id ?? `${row.agent_id}-${i}`}
                  log={row}
                  onAgentClick={handleAgentClick}
                />
              ))}
            </div>
          ) : (
            <p
              data-testid="coord-agents-empty"
              className="text-sm text-muted-foreground italic"
            >
              No recent agent log entries match the current filters.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

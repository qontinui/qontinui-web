"use client";

/**
 * /admin/coord/agents — fleet-wide recent agent_logs timeline.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 5 (Wave 3b).
 *
 * Reads `GET /api/v1/operations/agent-logs/recent?limit=200` every 5s.
 * Rows render with LogRow (level badge + expand-in-place payload). The
 * expanded detail cross-links to the per-agent live view at
 * `/admin/coord/agents/[agent_id]`.
 *
 * Two filter controls: level (multi-select chips) + event (free-text
 * contains, client-side filtered against the latest pull).
 *
 * ## Console style (Phase 3 Wave 2)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>Recent agent
 *   activity` wrapper is gone, and the body's `p-6` became `p-3 sm:p-6`.
 *   `coord/layout.tsx` already renders the console `<h1>` and the nav crumb.
 * - **R1** — a `<HealthStrip>` derived from the rows ALREADY FETCHED opens the
 *   page. No second request: the error/warn counts come off the same 200-row
 *   pull the list does.
 * - **R2/R4/R5** — one log line is one `<LogRow>` (already close to this
 *   shape), now on `<RecordRow>`, with a left-edge accent for `error` / `warn`
 *   and one open at a time.
 *
 * **The level filter stays multi-select chips rather than `<FilterTabs>`.**
 * `<FilterTabs>` is single-select by construction (`active: Id`), and this
 * control is a SET — an operator watches `warn` + `error` together, which is
 * the main thing this page is for. Swapping it would be a functional
 * regression dressed as conformance. What R6 actually asks for that this
 * control lacked — a live count per option, and `–` rather than `0` for one
 * nobody has counted — is adopted onto the existing chips instead. Same call,
 * same reason, as `/plans` keeping its status `<Select>`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw } from "lucide-react";
import {
  HealthStrip,
  RecordList,
  type HealthBadge,
  type HealthStripLevel,
} from "@/components/console";
import { LogRow, type AgentLogRow } from "@/components/admin/coord/LogRow";
import { normalizeLevel } from "@/components/admin/coord/LevelBadge";
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

/**
 * The row's level, through the SAME normaliser the badge renders with.
 *
 * A bare `toLowerCase()` (what this page did before Wave 2) disagreed with
 * `<LevelBadge>` on coord's synonyms: a row stamped `"warning"` showed a WARN
 * badge but was invisible to the `warn` filter chip, and now would also have
 * been missed by the health strip's warning count. One field must have one
 * vocabulary, so both read it through `normalizeLevel`.
 */
function levelOf(row: AgentLogRow): LevelKey {
  return normalizeLevel(row.level) as LevelKey;
}

/**
 * The page's health, derived from the rows already on it (R1) — never a second
 * fetch. `loaded=false` returns EARLY with badge labels that spell the dash
 * literally: `<HealthStrip>` renders `label` verbatim, so a null label renders
 * NOTHING rather than `–`.
 *
 * The severity mapping is R3's: `error` is the level a human must act on,
 * `warn` the one that says something is degrading. Nothing else raises the
 * light — an `info`-only window is a healthy window, and a page that went
 * amber on log volume would train the eye to ignore it.
 */
function deriveAgentsHealth(
  rows: AgentLogRow[],
  loaded: boolean,
  window: number
): {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
} {
  if (!loaded) {
    return {
      level: "amber",
      headline: "Waiting for coord…",
      detail: "counts appear once the recent-activity pull arrives",
      badges: [
        { key: "total", label: <>events –</>, tone: "muted" },
        { key: "error", label: <>error –</>, tone: "muted" },
      ],
    };
  }

  let errors = 0;
  let warns = 0;
  const agents = new Set<string>();
  for (const r of rows) {
    const l = levelOf(r);
    if (l === "error") errors += 1;
    else if (l === "warn") warns += 1;
    if (r.agent_id) agents.add(r.agent_id);
  }

  return {
    level: errors > 0 ? "red" : warns > 0 ? "amber" : "green",
    headline:
      errors > 0
        ? `${errors} error${errors === 1 ? "" : "s"} in the last ${window} events`
        : rows.length === 0
          ? "No agent activity in this window"
          : warns > 0
            ? `${warns} warning${warns === 1 ? "" : "s"}, no errors`
            : "No errors or warnings in this window",
    detail: `${agents.size} agent${agents.size === 1 ? "" : "s"} active · newest ${window} events only`,
    badges: [
      { key: "total", label: <>events {rows.length}</>, tone: "muted" },
      {
        key: "error",
        label: <>error {errors}</>,
        tone: errors > 0 ? "attention" : "muted",
      },
      { key: "warn", label: <>warn {warns}</>, tone: "default" },
      { key: "agents", label: <>agents {agents.size}</>, tone: "muted" },
    ],
  };
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

  const rows = useMemo(() => data?.logs ?? [], [data]);

  /** Per-level counts over the window fetched. `null` before it answers (R6). */
  const levelCounts = useMemo(() => {
    if (data === null) return null;
    const out = new Map<LevelKey, number>();
    for (const lvl of ALL_LEVELS) out.set(lvl, 0);
    for (const r of rows) {
      const l = levelOf(r);
      out.set(l, (out.get(l) ?? 0) + 1);
    }
    return out;
  }, [data, rows]);

  const filtered = useMemo(() => {
    const evt = eventFilter.trim().toLowerCase();
    return rows.filter((row) => {
      if (selectedLevels.size > 0 && !selectedLevels.has(levelOf(row))) {
        return false;
      }
      if (evt && !(row.event ?? "").toLowerCase().includes(evt)) {
        return false;
      }
      return true;
    });
  }, [rows, selectedLevels, eventFilter]);

  const handleAgentClick = useCallback(
    (agentId: string) => {
      router.push(`/admin/coord/agents/${encodeURIComponent(agentId)}`);
    },
    [router],
  );

  const health = useMemo(
    () => deriveAgentsHealth(rows, data !== null, RECENT_LIMIT),
    [rows, data]
  );

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-agents-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-agents-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <div
          data-testid="coord-agents-level-filter"
          className="flex items-center gap-1"
        >
          <span className="text-xs text-muted-foreground mr-1">levels:</span>
          {ALL_LEVELS.map((lvl) => {
            const active = selectedLevels.has(lvl);
            const count = levelCounts?.get(lvl);
            return (
              <button
                key={lvl}
                type="button"
                data-testid={`coord-agents-level-${lvl}`}
                aria-pressed={active}
                onClick={() => toggleLevel(lvl)}
                className={cn(
                  "px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wide",
                  "transition-colors inline-flex items-center gap-1",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {lvl}
                {/* R6's dash rule: `–` while nothing has answered, never `0`.
                    A `0` here would claim the window holds no errors before
                    anyone has looked. */}
                <span className={active ? "" : "text-muted-foreground/70"}>
                  {count == null ? "–" : count}
                </span>
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
          aria-label="Refresh agent activity"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      <div data-testid="coord-agents-recent-list">
        <RecordList
          items={filtered}
          itemKey={(row) => String(row.log_id ?? `${row.agent_id}-${row.occurred_at ?? row.ts ?? ""}`)}
          loaded={!(loading && !data)}
          skeletonRows={8}
          renderRow={(row, ctx) => (
            <LogRow
              log={row}
              onAgentClick={handleAgentClick}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
            />
          )}
          empty={
            // Gated on `error`: a failed fetch leaves the list empty, and
            // asserting "nothing matched" about a request that never answered
            // is the `silent-empty-is-unknown` mistake.
            error ? null : (
              <p
                data-testid="coord-agents-empty"
                className="text-sm text-muted-foreground italic"
              >
                No recent agent log entries match the current filters.
              </p>
            )
          }
        />
      </div>
    </div>
  );
}

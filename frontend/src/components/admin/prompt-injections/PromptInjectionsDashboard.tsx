"use client";

/**
 * Prompt-injection audit-log dashboard.
 *
 * Phase 4 of the "Unified Coord Prompt-Injection Audit Log" plan.
 *
 * A read-only table of every coord-originated prompt injection with the
 * session name per row. Click a row to expand a detail panel that lazily
 * fetches the full event and shows TWO labeled blocks: the output that
 * triggered the injection (`trigger_text`) and the exact prompt that was
 * injected (`injected_prompt`).
 *
 * Mirrors `AgentSessionsDashboard`'s expandable-rows structure: each row is
 * a <Fragment> with a clickable <TableRow> chevron toggle plus a second
 * colSpan <TableRow> for the detail panel.
 *
 * Filter bar: source dropdown (All + the 6 values) + session-name search +
 * a live-poll toggle. Full list refreshes every 10s when polling is on.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
  ScrollText,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getPromptInjection,
  listPromptInjections,
  PromptInjectionsApiError,
  type PromptInjectionDetail,
  type PromptInjectionRow,
  type PromptInjectionSource,
} from "@/services/prompt-injections-api";

const POLL_MS = 10_000;

// The six coord injection origins (SHARED WIRE CONTRACT `source` values).
const SOURCE_VALUES: PromptInjectionSource[] = [
  "question_auto_answer",
  "regex_submit_prompt",
  "regex_resolve_scoring",
  "session_bus_message",
  "continuation_dispatch",
  "spawned_session_initial",
];

const ALL_SOURCES = "__all__";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function shortId(id?: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** Session display: session_name, else short agent_session_id, else terminal_id. */
function sessionLabel(row: PromptInjectionRow): string {
  if (row.session_name) return row.session_name;
  if (row.agent_session_id) return shortId(row.agent_session_id);
  if (row.terminal_id) return shortId(row.terminal_id);
  return "—";
}

// ---------------------------------------------------------------------------
// Detail panel — lazily fetches the full event for a single event id.
// ---------------------------------------------------------------------------

function DetailPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<PromptInjectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPromptInjection(eventId)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof PromptInjectionsApiError
            ? `${e.status}: ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e)
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (loading && !data) {
    return <Skeleton className="h-24 w-full" data-testid="pinj-detail-loading" />;
  }
  if (error) {
    return (
      <p className="text-sm text-destructive" data-testid="pinj-detail-error">
        Failed to load detail: {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p
        className="text-sm text-muted-foreground italic"
        data-testid="pinj-detail-empty"
      >
        No detail available.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="pinj-detail">
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Output that triggered the injection
        </p>
        <pre
          className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words"
          data-testid="pinj-trigger-text"
        >
          {data.trigger_text ?? "—"}
        </pre>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Prompt injected
        </p>
        <pre
          className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words"
          data-testid="pinj-injected-prompt"
        >
          {data.injected_prompt}
        </pre>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          source: <span className="font-mono">{data.source}</span>
        </span>
        <span>
          rule: <span className="font-mono">{data.rule_id ?? "—"}</span>
        </span>
        <span>
          policy: <span className="font-mono">{data.policy_id ?? "—"}</span>
        </span>
        <span>
          terminal: <span className="font-mono">{data.terminal_id ?? "—"}</span>
        </span>
        <span>
          device: <span className="font-mono">{data.device_id ?? "—"}</span>
        </span>
        <span>
          created: <span className="font-mono">{data.created_at}</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Injections table with expansion to the DetailPanel
// ---------------------------------------------------------------------------

function InjectionsTable({
  rows,
  loading,
  error,
  onRefresh,
}: {
  rows: PromptInjectionRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card data-testid="prompt-injections-table-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="h-4 w-4" />
          Prompt Injections
          <Badge variant="outline" className="ml-2">
            {rows.length}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onRefresh}
            data-testid="prompt-injections-refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p
            className="text-sm text-destructive"
            data-testid="prompt-injections-error"
          >
            Failed to load: {error}
          </p>
        )}
        {loading && rows.length === 0 ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="prompt-injections-empty"
          >
            No prompt injections matching the current filters.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]"></TableHead>
                <TableHead>session</TableHead>
                <TableHead className="w-[180px]">source</TableHead>
                <TableHead>trigger</TableHead>
                <TableHead className="w-[120px]">when</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isExpanded = expanded === row.event_id;
                return (
                  <Fragment key={row.event_id}>
                    <TableRow
                      data-testid="prompt-injections-row"
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        setExpanded((cur) =>
                          cur === row.event_id ? null : row.event_id
                        )
                      }
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {sessionLabel(row)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {row.source}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[420px] truncate text-xs text-muted-foreground">
                        {row.trigger_preview ?? (
                          <span className="italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {relativeTime(row.created_at)}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow data-testid="prompt-injections-detail-row">
                        <TableCell colSpan={5} className="bg-muted/10 p-4">
                          <DetailPanel eventId={row.event_id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top-level dashboard
// ---------------------------------------------------------------------------

interface InjectionFilters {
  source: string;
  session_name: string;
  polling: boolean;
}

export default function PromptInjectionsDashboard() {
  const [filters, setFilters] = useState<InjectionFilters>({
    source: ALL_SOURCES,
    session_name: "",
    polling: true,
  });
  const [rows, setRows] = useState<PromptInjectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInjections = useCallback(async () => {
    try {
      const body = await listPromptInjections({
        limit: 200,
        source:
          filters.source === ALL_SOURCES ? undefined : filters.source,
        session_name: filters.session_name.trim() || undefined,
      });
      setRows(body.events);
      setError(null);
    } catch (e) {
      setError(
        e instanceof PromptInjectionsApiError
          ? `${e.status}: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e)
      );
    } finally {
      setLoading(false);
    }
  }, [filters.source, filters.session_name]);

  useEffect(() => {
    setLoading(true);
    fetchInjections();
    if (!filters.polling) return;
    const interval = setInterval(fetchInjections, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchInjections, filters.polling]);

  const sourceOptions = useMemo(() => SOURCE_VALUES, []);

  return (
    <div className="space-y-6">
      <Card data-testid="prompt-injections-filters">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <Select
              value={filters.source}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, source: v }))
              }
            >
              <SelectTrigger
                className="w-[240px]"
                data-testid="prompt-injections-source-select"
              >
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SOURCES}>All sources</SelectItem>
                {sourceOptions.map((s) => (
                  <SelectItem key={s} value={s} className="font-mono text-xs">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="session name"
              value={filters.session_name}
              onChange={(e) =>
                setFilters((f) => ({ ...f, session_name: e.target.value }))
              }
              className="max-w-xs text-xs"
              data-testid="prompt-injections-session-input"
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={filters.polling}
                onCheckedChange={(v) =>
                  setFilters((f) => ({ ...f, polling: Boolean(v) }))
                }
                data-testid="prompt-injections-poll-toggle"
              />
              Live poll (10s)
            </label>
          </div>
        </CardContent>
      </Card>

      <InjectionsTable
        rows={rows}
        loading={loading}
        error={error}
        onRefresh={fetchInjections}
      />
    </div>
  );
}

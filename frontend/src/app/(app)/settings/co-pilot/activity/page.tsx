"use client";

/**
 * UI Bridge Co-Pilot Activity Viewer (§4.8 of the production-safe plan).
 *
 * Shows the calling user's own bridge write commands — one row per row in
 * ``web.bridge_audit_log``. Server-side scoping (the FastAPI endpoint
 * filters by ``user_id = current_user.id``) means we never display
 * another user's rows, regardless of what the page does.
 *
 * Columns: occurred_at, command_name, target_element_id, status_code,
 * path, origin. Filters: 24h/7d/30d/custom time window, command, status.
 * Pagination: cursor-based (``next_before`` from the response).
 */

import { useCallback, useMemo, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  type QueryFunctionContext,
} from "@tanstack/react-query";
import { List, type RowComponentProps } from "react-window";
import { format } from "date-fns";

import {
  fetchCoPilotActivity,
  type BridgeAuditLogEntry,
  type BridgeAuditLogListResponse,
  type CoPilotActivityFilters,
} from "@/lib/co-pilot-activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, Loader2, RefreshCw } from "lucide-react";

type Range = "24h" | "7d" | "30d" | "custom";

function rangeToAfterIso(range: Range, custom: string | null): string | null {
  const now = Date.now();
  switch (range) {
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    case "custom":
      return custom && custom.length > 0
        ? new Date(custom).toISOString()
        : null;
  }
}

const ROW_HEIGHT = 56;
const PAGE_LIMIT = 100;

interface RowProps {
  items: BridgeAuditLogEntry[];
}

function ActivityRow({
  index,
  items,
  style,
}: RowComponentProps<RowProps>) {
  const r = items[index];
  if (!r) return null;
  const ok = r.status_code < 400;
  return (
    <div
      style={style}
      className="grid grid-cols-[170px_180px_220px_70px_1fr_180px] gap-3 px-3 py-2 border-b border-border text-xs items-center hover:bg-muted/40"
    >
      <span className="text-muted-foreground">
        {format(new Date(r.occurred_at), "yyyy-MM-dd HH:mm:ss")}
      </span>
      <span className="font-mono truncate">{r.command_name}</span>
      <span className="font-mono truncate text-muted-foreground">
        {r.target_element_id ?? "—"}
      </span>
      <span
        className={ok ? "text-emerald-500" : "text-rose-500"}
        aria-label={ok ? "success" : "failed"}
      >
        {r.status_code}
      </span>
      <span className="font-mono truncate text-muted-foreground">{r.path}</span>
      <span className="truncate text-muted-foreground">{r.origin ?? "—"}</span>
    </div>
  );
}

export default function CoPilotActivityPage() {
  const [range, setRange] = useState<Range>("7d");
  const [customAfter, setCustomAfter] = useState<string>("");
  const [commandFilter, setCommandFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">(
    "all",
  );

  const after = useMemo(() => rangeToAfterIso(range, customAfter), [
    range,
    customAfter,
  ]);

  const filtersForQuery: CoPilotActivityFilters = useMemo(
    () => ({
      after: after ?? undefined,
      command: commandFilter.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: PAGE_LIMIT,
    }),
    [after, commandFilter, statusFilter],
  );

  const fetchPage = useCallback(
    async ({
      pageParam,
    }: QueryFunctionContext<
      readonly unknown[],
      string | undefined
    >): Promise<BridgeAuditLogListResponse> => {
      return fetchCoPilotActivity({ ...filtersForQuery, before: pageParam });
    },
    [filtersForQuery],
  );

  const query = useInfiniteQuery({
    queryKey: ["co-pilot-activity", filtersForQuery] as const,
    queryFn: fetchPage,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: BridgeAuditLogListResponse) =>
      last.next_before ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const rows: BridgeAuditLogEntry[] = useMemo(() => {
    if (!query.data) return [];
    return query.data.pages.flatMap((p) => p.items);
  }, [query.data]);

  const listHeight = Math.min(640, Math.max(ROW_HEIGHT * 4, ROW_HEIGHT * 12));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="size-5" />
            Co-Pilot Activity
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every UI Bridge co-pilot write command issued on your behalf is
            recorded here. Reads (snapshots, page-state queries) are not
            audited; this view shows only state-changing commands.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Time range</Label>
          <Select
            value={range}
            onValueChange={(v) => setRange(v as Range)}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="custom">Custom (from…)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {range === "custom" ? (
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="custom-after">
              From (ISO)
            </Label>
            <Input
              id="custom-after"
              type="datetime-local"
              value={customAfter}
              onChange={(e) => setCustomAfter(e.target.value)}
            />
          </div>
        ) : (
          <div />
        )}

        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="command-filter">
            Command
          </Label>
          <Input
            id="command-filter"
            placeholder="e.g. element.action"
            value={commandFilter}
            onChange={(e) => setCommandFilter(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as "all" | "success" | "failed")
            }
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="success">Success (2xx)</SelectItem>
              <SelectItem value="failed">Failed (≥400)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[170px_180px_220px_70px_1fr_180px] gap-3 px-3 py-2 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground">
          <span>Time</span>
          <span>Command</span>
          <span>Target element</span>
          <span>Status</span>
          <span>Path</span>
          <span>Origin</span>
        </div>

        {query.isPending ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No co-pilot activity in this window.
          </div>
        ) : (
          <List
            rowCount={rows.length}
            rowHeight={ROW_HEIGHT}
            rowComponent={ActivityRow}
            rowProps={{ items: rows }}
            style={{ height: listHeight }}
          />
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Showing {rows.length} row{rows.length === 1 ? "" : "s"}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!query.hasNextPage || query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          Load older
        </Button>
      </div>
    </div>
  );
}

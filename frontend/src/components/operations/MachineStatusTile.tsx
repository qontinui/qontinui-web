"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, WifiOff } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { relativeTime } from "./utils";
import type { MachineStatusResponse, MachineStatusRow } from "./coordTypes";

const log = createLogger("MachineStatusTile");

const COORD_REST_PATH = "/coord-api/status";
const COORD_WS_URL =
  process.env.NEXT_PUBLIC_COORD_WS_URL || "ws://localhost:9870/ws";
const WS_PATTERN = "events.coord.machine_status_updated";
const POLL_INTERVAL_MS = 30_000;
const REFETCH_DEBOUNCE_MS = 1_000;
const MAX_RECONNECT_ATTEMPTS = 5;

type Staleness = "fresh" | "warn" | "stale";

function classifyAge(updatedAt: string): Staleness {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageMin = ageMs / 60_000;
  if (ageMin < 5) return "fresh";
  if (ageMin < 15) return "warn";
  return "stale";
}

function rowTintClass(staleness: Staleness): string {
  // Mirrors MachineCard.tsx's healthy/warn/danger gradient (lines 84-89):
  // healthy=green, warn=yellow, danger=red. Using the same Tailwind
  // utilities keeps the visual vocabulary of the page consistent.
  switch (staleness) {
    case "fresh":
      return "bg-muted/40";
    case "warn":
      return "bg-yellow-500/10";
    case "stale":
      return "bg-red-500/10";
  }
}

function rowTextClass(staleness: Staleness): string {
  if (staleness === "stale") return "text-red-300";
  if (staleness === "warn") return "text-yellow-200";
  return "text-foreground";
}

function identityLabel(row: MachineStatusRow): string {
  if (row.hostname && row.hostname.length > 0) return row.hostname;
  return row.machine_id.slice(0, 8) + "…";
}

function repoBranchLabel(row: MachineStatusRow): string | null {
  if (row.current_repo && row.current_branch) {
    return `${row.current_repo}:${row.current_branch}`;
  }
  return row.current_repo ?? row.current_branch ?? null;
}

/**
 * If a MachineCard with the same hostname exists above this tile, scroll
 * it into view and flash a highlight ring. Cheap UX win for the operator
 * jumping from "this machine is doing X" to the runner detail card.
 */
function focusMachineCard(hostname: string | null) {
  if (!hostname) return;
  const card = document.querySelector(
    `[data-operations-machine-card][data-hostname="${CSS.escape(hostname)}"]`,
  );
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("ring-2", "ring-primary", "ring-offset-2");
  window.setTimeout(() => {
    card.classList.remove("ring-2", "ring-primary", "ring-offset-2");
  }, 1500);
}

export function MachineStatusTile() {
  const [rows, setRows] = useState<MachineStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [, setNowTick] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(false);
  const cleanedUpRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(COORD_REST_PATH, { credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MachineStatusResponse = await res.json();
      setRows(data.machines ?? []);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      log.warn("GET /coord/status failed:", msg);
      setError(msg);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const debouncedRefetch = useCallback(() => {
    if (debounceRef.current) return;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetchStatus();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchStatus]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = setInterval(() => {
      if (!document.hidden) void fetchStatus();
    }, POLL_INTERVAL_MS);
  }, [fetchStatus, stopPolling]);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
  }, []);

  const connectWs = useCallback(() => {
    if (cleanedUpRef.current || document.hidden) return;
    closeWs();

    const url = `${COORD_WS_URL}?pattern=${encodeURIComponent(WS_PATTERN)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      log.warn("WebSocket constructor failed:", err);
      startPolling();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (cleanedUpRef.current) {
        ws.close();
        return;
      }
      setWsConnected(true);
      reconnectAttemptsRef.current = 0;
      stopPolling();
      // Resync after (re)connect to catch any updates that landed while
      // we were disconnected — the publish payload only carries
      // `{machine_id, updated_at}`, never the full row, so a refetch is
      // the simplest path to consistency.
      void fetchStatus();
    };

    ws.onmessage = () => {
      // Coord publishes one event per upsert. Payload shape isn't
      // load-bearing here — debounce a refetch to absorb bursts.
      debouncedRefetch();
    };

    ws.onerror = () => {
      setWsConnected(false);
    };

    ws.onclose = () => {
      setWsConnected(false);
      if (wsRef.current === ws) wsRef.current = null;
      if (cleanedUpRef.current || document.hidden) return;

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttemptsRef.current),
          30_000,
        );
        reconnectRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          connectWs();
        }, delay);
      }
      // Whether reconnect succeeds or not, fall back to polling so the
      // operator keeps seeing fresh data.
      startPolling();
    };
  }, [closeWs, debouncedRefetch, fetchStatus, startPolling, stopPolling]);

  // Tab visibility — drop the WS when hidden, reconnect on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearReconnect();
        closeWs();
        stopPolling();
        setWsConnected(false);
      } else {
        reconnectAttemptsRef.current = 0;
        void fetchStatus();
        connectWs();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clearReconnect, closeWs, stopPolling, fetchStatus, connectWs]);

  // Mount: seed + connect.
  useEffect(() => {
    cleanedUpRef.current = false;
    void fetchStatus();
    connectWs();
    return () => {
      cleanedUpRef.current = true;
      closeWs();
      stopPolling();
      clearReconnect();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [fetchStatus, connectWs, closeWs, stopPolling, clearReconnect]);

  // Tick every 15s so the relative-time labels and staleness tints
  // refresh without waiting on a server event.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
    [rows],
  );

  return (
    <section
      className="rounded-lg border border-border bg-card/30 p-4"
      data-ui-bridge-id="operations.machine-status-tile"
    >
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Machine status
          </h2>
          <Badge variant="outline" className="text-[10px]">
            {sortedRows.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {wsConnected ? (
            <>
              <span
                className="h-2 w-2 rounded-full bg-green-500"
                aria-hidden
              />
              <span data-ui-bridge-id="operations.machine-status-connection">
                live
              </span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-yellow-400" />
              <span
                className="text-yellow-300"
                data-ui-bridge-id="operations.machine-status-connection"
              >
                polling (WS offline)
              </span>
            </>
          )}
          {error && (
            <Badge variant="destructive" className="text-[10px]">
              error
            </Badge>
          )}
          <button
            type="button"
            onClick={() => void fetchStatus()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30"
            data-ui-bridge-id="operations.machine-status-refresh"
            aria-label="Refresh machine status"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </header>

      {loading && sortedRows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-2 py-3">
          Loading machine status&hellip;
        </p>
      ) : sortedRows.length === 0 ? (
        <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
          No machines reporting status. Agents post here voluntarily via{" "}
          <code className="bg-muted px-1 rounded">POST /coord/status</code>;
          rows older than 1h are pruned.
        </div>
      ) : (
        <ul
          className="flex flex-col gap-1.5"
          data-ui-bridge-id="operations.machine-status-list"
        >
          {sortedRows.map((row) => {
            const staleness = classifyAge(row.updated_at);
            const repoBranch = repoBranchLabel(row);
            const identity = identityLabel(row);
            return (
              <li
                key={row.machine_id}
                data-ui-bridge-id="operations.machine-status-row"
                data-machine-id={row.machine_id}
                data-staleness={staleness}
                className={`grid grid-cols-[10rem_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border/40 px-3 py-2 text-sm ${rowTintClass(staleness)} ${rowTextClass(staleness)}`}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => focusMachineCard(row.hostname)}
                      className="text-left font-medium truncate hover:underline disabled:cursor-default disabled:no-underline"
                      disabled={!row.hostname}
                      data-ui-bridge-id="operations.machine-status-identity"
                    >
                      {identity}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="font-mono text-[11px]">
                    {row.machine_id}
                  </TooltipContent>
                </Tooltip>

                <span
                  className="truncate text-foreground/90"
                  data-ui-bridge-id="operations.machine-status-task"
                >
                  {row.current_task ?? (
                    <span className="text-muted-foreground italic">
                      idle
                    </span>
                  )}
                </span>

                <span
                  className="truncate font-mono text-xs text-muted-foreground"
                  data-ui-bridge-id="operations.machine-status-repo-branch"
                >
                  {repoBranch ?? ""}
                </span>

                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  {row.free_text && (
                    <span
                      className="italic max-w-[14rem] truncate"
                      data-ui-bridge-id="operations.machine-status-free-text"
                      title={row.free_text}
                    >
                      {row.free_text}
                    </span>
                  )}
                  <span
                    className="tabular-nums"
                    data-ui-bridge-id="operations.machine-status-updated-at"
                    title={new Date(row.updated_at).toLocaleString()}
                  >
                    {relativeTime(row.updated_at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

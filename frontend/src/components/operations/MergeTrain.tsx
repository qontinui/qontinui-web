"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GitMerge, AlertTriangle, ExternalLink } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { OPERATIONS_API, relativeTime } from "./utils";
import type { ProposalDetail, ProposalStatus, QueueResponse } from "./mergeTypes";

const log = createLogger("MergeTrain");

const COORD_WS_URL =
  process.env.NEXT_PUBLIC_COORD_WS_URL || "ws://localhost:9870/ws";
const WS_PATTERN = "events.merge.>";
const POLL_INTERVAL_MS = 2_000;
const REFETCH_DEBOUNCE_MS = 250;
const MAX_RECONNECT_ATTEMPTS = 5;

// ----------------------------------------------------------------------------
// Status visual classification
// ----------------------------------------------------------------------------

function statusTint(status: ProposalStatus): string {
  switch (status) {
    case "merged":
      return "bg-green-500/15 text-green-200 border-green-500/30";
    case "landing":
      return "bg-blue-500/15 text-blue-200 border-blue-500/30";
    case "awaiting-ci":
      return "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
    case "dry-rebasing":
      return "bg-purple-500/15 text-purple-200 border-purple-500/30";
    case "queued":
      return "bg-muted text-muted-foreground border-border";
    case "conflict":
    case "blocked-by-overlap":
      return "bg-red-500/15 text-red-200 border-red-500/30";
    case "cancelled":
      return "bg-muted/40 text-muted-foreground border-border line-through";
  }
}

// ----------------------------------------------------------------------------
// Row
// ----------------------------------------------------------------------------

function MergeTrainRow({ proposal }: { proposal: ProposalDetail }) {
  const repoSummary = useMemo(() => {
    if (proposal.repos.length === 0) return "—";
    if (proposal.repos.length === 1) {
      const r = proposal.repos[0];
      return `${r.repo} · ${r.branch}`;
    }
    return `${proposal.repos.length} repos`;
  }, [proposal.repos]);

  const ciLink = useMemo(() => {
    return proposal.repos.find((r) => r.ci_run_url)?.ci_run_url ?? null;
  }, [proposal.repos]);

  const agentShort = proposal.agent_id.slice(0, 8);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 border rounded-md transition-colors ${statusTint(
        proposal.status
      )}`}
      data-status={proposal.status}
      data-proposal-id={proposal.proposal_id}
    >
      <Badge variant="outline" className="font-mono text-xs">
        {agentShort}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{repoSummary}</p>
        {proposal.error && (
          <p className="text-xs text-red-300 flex items-center gap-1 mt-0.5">
            <AlertTriangle className="h-3 w-3" />
            {proposal.error}
          </p>
        )}
      </div>
      <Badge className="font-mono text-[10px] uppercase tracking-wide">
        {proposal.status}
      </Badge>
      <span className="text-xs text-muted-foreground tabular-nums">
        {relativeTime(proposal.updated_at)}
      </span>
      {ciLink && (
        <a
          href={ciLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Open CI run"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Section
// ----------------------------------------------------------------------------

export function MergeTrain() {
  const [proposals, setProposals] = useState<ProposalDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanedUpRef = useRef(false);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`${OPERATIONS_API}/merge/queue`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as QueueResponse | ProposalDetail[];
      // Coord returns {proposals: [...]}; tolerate either shape.
      const list = Array.isArray(body) ? body : body.proposals ?? [];
      if (!cleanedUpRef.current) {
        setProposals(list);
        setError(null);
      }
    } catch (err) {
      if (!cleanedUpRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(fetchQueue, REFETCH_DEBOUNCE_MS);
  }, [fetchQueue]);

  const connectWs = useCallback(() => {
    if (cleanedUpRef.current || document.hidden) return;
    if (wsRef.current) wsRef.current.close();

    const url = `${COORD_WS_URL}?pattern=${encodeURIComponent(WS_PATTERN)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      log.warn("WebSocket constructor failed", err);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (cleanedUpRef.current) {
        ws.close();
        return;
      }
      reconnectAttemptsRef.current = 0;
      // Resync after (re)connect — events flow live but the snapshot
      // catches any updates that happened during the disconnect.
      scheduleRefetch();
    };

    ws.onmessage = () => {
      // The merge-event payload only signals "something changed."
      // Refetch the queue to get the canonical state.
      scheduleRefetch();
    };

    ws.onerror = (e) => {
      log.warn("WS error", e);
    };

    ws.onclose = () => {
      if (cleanedUpRef.current) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        log.warn("WS max reconnect attempts reached; relying on poll");
        return;
      }
      const delay = Math.min(
        1_000 * 2 ** reconnectAttemptsRef.current,
        30_000
      );
      reconnectAttemptsRef.current += 1;
      reconnectRef.current = setTimeout(connectWs, delay);
    };
  }, [scheduleRefetch]);

  useEffect(() => {
    cleanedUpRef.current = false;
    fetchQueue();
    const pollId = setInterval(fetchQueue, POLL_INTERVAL_MS);
    connectWs();
    return () => {
      cleanedUpRef.current = true;
      clearInterval(pollId);
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchQueue, connectWs]);

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitMerge className="h-4 w-4" />
          Merge train
          {proposals && (
            <Badge variant="outline" className="ml-2 font-mono text-xs">
              {proposals.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-xs text-red-300 mb-2">{error}</p>
        )}
        {proposals === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : proposals.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No in-flight proposals.
          </p>
        ) : (
          <div className="space-y-2">
            {proposals.map((p) => (
              <MergeTrainRow key={p.proposal_id} proposal={p} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

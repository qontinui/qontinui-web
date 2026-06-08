"use client";

// ============================================================================
// CommitSessionChip — a clickable session pill that opens a drawer listing
// every commit that session produced.
//
// Web-native port of the supervisor's SessionChip: shadcn Dialog instead of
// the supervisor's hand-rolled overlay, and the operator credential is
// implicit (httpClient forwards it) rather than a passed-in JWT.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getSessionCommits } from "./api";
import type { LineageRow } from "./types";
import { commitUrl, formatTs, sessionLabel, shortSha } from "./format";

// Stable module-level empty array (identity-memo safety).
const EMPTY_ROWS: LineageRow[] = [];

interface CommitSessionChipProps {
  /** The Claude Code agent session UUID. */
  sessionId: string | null | undefined;
  /** Human session name; falls back to first 8 of the uuid. */
  sessionName?: string | null;
}

/**
 * Renders a session's name (or short uuid) as a clickable chip. Clicking
 * opens a dialog listing that session's commits. Renders an inert
 * "unattributed" pill when no session id is present.
 */
export function CommitSessionChip({
  sessionId,
  sessionName,
}: CommitSessionChipProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<LineageRow[]>(EMPTY_ROWS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await getSessionCommits(sessionId, signal);
        setRows(result.length > 0 ? result : EMPTY_ROWS);
      } catch (e) {
        if (signal?.aborted) return;
        setRows(EMPTY_ROWS);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [open, load]);

  if (!sessionId || !sessionId.trim()) {
    return (
      <Badge variant="warning" className="font-normal">
        unattributed
      </Badge>
    );
  }

  return (
    <>
      <button
        type="button"
        title={`View commits for session ${sessionId}`}
        className="cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <Badge
          variant="secondary"
          className="font-mono font-normal hover:bg-secondary/70"
        >
          {sessionLabel(sessionName, sessionId)}
        </Badge>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{sessionLabel(sessionName, sessionId)}</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {sessionId}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading commits…
            </div>
          )}
          {error && (
            <div className="break-words py-4 font-mono text-sm text-destructive">
              {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="py-6 text-sm text-muted-foreground">
              No commits attributed to this session.
            </div>
          )}
          {rows.length > 0 && (
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Commit</TableHead>
                    <TableHead>Repo</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>PR</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.commit_sha}>
                      <TableCell className="font-mono">
                        <a
                          href={commitUrl(r.repo, r.commit_sha)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {shortSha(r.commit_sha)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.repo}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.branch ?? "—"}
                      </TableCell>
                      <TableCell>
                        {r.pr_number != null ? `#${r.pr_number}` : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatTs(r.recorded_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CommitSessionChip;

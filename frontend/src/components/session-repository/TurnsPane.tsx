"use client";

/**
 * The archived transcript, read page by page from
 * `GET /session-repository/{id}/turns?from=&limit=`.
 *
 * **This pane never calls `/export`.** p99 body is 4 MB and the corpus is
 * ~3.5 GB; the plan spells the paged route out separately precisely so the
 * UI cannot swallow a whole transcript to show the first screen of it. The
 * verbatim export exists, but only as an explicit operator download
 * (`BodyPanel`), never as this view's data source. `include_raw` is likewise
 * left off — the raw records are the same megabytes in a more expensive
 * encoding.
 *
 * It is a sibling of `components/sessions/TranscriptPane` rather than a copy.
 * That pane decodes base64 chunks out of coord's warm/cold stream and parses
 * the JSONL itself; here the server has already decoded each turn, so the
 * client-side parse has nothing to do. What IS reused from the shipped
 * `components/sessions/output-text` is the render cap — a single tool-result
 * turn can be megabytes on its own, and the same ceiling that protects the
 * live pane protects this one.
 *
 * A malformed line arrives as a turn carrying `parse_error` rather than being
 * skipped, and is rendered in place. A silently dropped line is
 * indistinguishable from a session that said nothing there, which is exactly
 * the kind of invisible gap an archive must not have.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileWarning, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { capTail } from "@/components/sessions/output-text";
import { getSessionTurns, SessionRepositoryApiError } from "./api";
import type { SessionTurn } from "./types";

/** Turns fetched per page. The server clamps to [1, 500]. */
export const TURN_PAGE_SIZE = 100;

type PaneState =
  | { phase: "loading" }
  | { phase: "unauthorized" }
  | { phase: "not-found" }
  /** 409: the SESSION exists, its body does not. A different fact from 404. */
  | { phase: "no-body"; reason: string }
  | { phase: "error"; message: string }
  | { phase: "ready" };

function TurnRow({ turn }: { turn: SessionTurn }) {
  const label = turn.role ?? turn.type ?? null;

  if (turn.parse_error) {
    return (
      <li className="text-xs" data-testid="session-turn-parse-error">
        <span className="mr-2 select-none font-mono text-[10px] text-muted-foreground">
          #{turn.index}
        </span>
        <span className="inline-flex items-baseline gap-1 text-amber-700 dark:text-amber-300">
          <FileWarning className="size-3 shrink-0 self-center" aria-hidden />
          line {turn.line_number} could not be parsed: {turn.parse_error}
        </span>
      </li>
    );
  }

  const { text, truncated } = capTail(turn.text ?? "");

  return (
    <li className="text-xs">
      <span className="mr-2 select-none font-mono text-[10px] text-muted-foreground">
        #{turn.index}
      </span>
      {label && (
        <span className="mr-2 select-none text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      )}
      <span
        className={
          turn.text
            ? "whitespace-pre-wrap break-words font-mono"
            : "whitespace-pre-wrap break-words font-mono italic text-muted-foreground"
        }
      >
        {turn.text ? text : "(this record carried no text content)"}
      </span>
      {truncated && (
        <span className="ml-1 text-[10px] text-muted-foreground">
          — turn truncated for display
        </span>
      )}
    </li>
  );
}

export function TurnsPane({
  artifactId,
  /** `turn_count` from the head row — what the archive's writer believed. */
  expectedTurns,
  /** False when the row has no archived body at all. */
  hasBody,
}: {
  artifactId: string;
  expectedTurns: number | null;
  hasBody: boolean;
}) {
  const [state, setState] = useState<PaneState>({ phase: "loading" });
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [nextFrom, setNextFrom] = useState(0);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [fetchingMore, setFetchingMore] = useState(false);

  const fetchPage = useCallback(
    async (from: number, append: boolean) => {
      if (append) setFetchingMore(true);
      else setState({ phase: "loading" });
      try {
        const page = await getSessionTurns(artifactId, {
          from,
          limit: TURN_PAGE_SIZE,
        });
        const served = page.items ?? [];
        setTurns((prev) => (append ? [...prev, ...served] : served));
        setNextFrom(from + served.length);
        setServerTotal(page.total);
        setState({ phase: "ready" });
      } catch (err) {
        if (err instanceof SessionRepositoryApiError) {
          if (err.status === 401 || err.status === 403) {
            setState({ phase: "unauthorized" });
            return;
          }
          if (err.status === 404) {
            setState({ phase: "not-found" });
            return;
          }
          if (err.status === 409) {
            // The server distinguishes "no such session" from "this session's
            // body is not readable", and so does this pane.
            const detail =
              typeof err.body === "object" &&
              err.body !== null &&
              typeof (err.body as { detail?: unknown }).detail === "string"
                ? ((err.body as { detail: string }).detail)
                : "the archived body could not be read";
            setState({ phase: "no-body", reason: detail });
            return;
          }
        }
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : "failed to load turns",
        });
      } finally {
        if (append) setFetchingMore(false);
      }
    },
    [artifactId]
  );

  useEffect(() => {
    if (!hasBody) {
      setState({ phase: "ready" });
      setTurns([]);
      return;
    }
    setTurns([]);
    setNextFrom(0);
    setServerTotal(null);
    void fetchPage(0, false);
  }, [hasBody, fetchPage]);

  if (!hasBody) {
    return (
      <div
        className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground"
        data-testid="session-repository-turns-no-body"
      >
        This is a metadata-only row: the session&apos;s transcript bytes were
        never archived, so there is nothing to read here. That is a gap in the
        archive, not an empty session.
      </div>
    );
  }

  const total = serverTotal;
  const exhausted = total !== null && nextFrom >= total;

  return (
    <div className="space-y-2" data-testid="session-repository-turns">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ScrollText className="size-3.5" aria-hidden />
        <span>Transcript</span>
        <Badge variant="outline">paged read</Badge>
        <span>
          {turns.length} loaded
          {total !== null ? ` of ${total}` : ""}
        </span>
        {/* Both counts, never reconciled behind the reader's back: the head
            row's estimate can legitimately differ from what actually decoded. */}
        {total !== null &&
          expectedTurns !== null &&
          expectedTurns !== total && (
            <span
              className="text-[11px] text-amber-700 dark:text-amber-300"
              data-testid="session-turn-count-mismatch"
            >
              the head row records {expectedTurns} turns; {total} decoded from
              the stored body
            </span>
          )}
        <span className="text-[11px]">
          Read {TURN_PAGE_SIZE} at a time — the full body is never fetched to
          render this view.
        </span>
      </div>

      {state.phase === "loading" && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {state.phase === "unauthorized" && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          <AlertTriangle className="mr-1.5 inline size-3.5" aria-hidden />
          You are not authorized to read this session&apos;s transcript.
        </div>
      )}

      {state.phase === "not-found" && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          <AlertTriangle className="mr-1.5 inline size-3.5" aria-hidden />
          The archive has no such session.
        </div>
      )}

      {state.phase === "no-body" && (
        <div
          className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground"
          data-testid="session-repository-turns-body-unreadable"
        >
          <FileWarning className="mr-1.5 inline size-3.5" aria-hidden />
          The session is archived but its body could not be read:{" "}
          {state.reason} — that is a gap in the archive, not an empty session.
        </div>
      )}

      {state.phase === "error" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-xs text-amber-800 dark:text-amber-200">
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            Couldn&apos;t load turns: {state.message}
            {turns.length > 0
              ? " — the turns already loaded are still shown; the rest is unknown."
              : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() =>
              void fetchPage(turns.length > 0 ? nextFrom : 0, turns.length > 0)
            }
            data-testid="session-repository-turns-retry"
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}

      {turns.length > 0 && (
        <div
          className="max-h-[520px] overflow-auto rounded-md border border-border bg-muted/30 p-3"
          data-testid="session-repository-turns-body"
        >
          <ol className="space-y-1.5">
            {turns.map((turn) => (
              <TurnRow key={`${turn.index}-${turn.line_number}`} turn={turn} />
            ))}
          </ol>
        </div>
      )}

      {state.phase === "ready" && turns.length === 0 && (
        <div
          className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground"
          data-testid="session-repository-turns-empty"
        >
          The archive holds a body for this session but decoded no turns from
          it. Export the JSONL below to see what it actually contains.
        </div>
      )}

      {state.phase === "ready" && !exhausted && turns.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchPage(nextFrom, true)}
          disabled={fetchingMore}
          data-testid="session-repository-turns-more"
        >
          {fetchingMore ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ScrollText className="size-3.5" />
          )}
          Load {TURN_PAGE_SIZE} more
        </Button>
      )}

      {state.phase === "ready" && exhausted && turns.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          End of the archived transcript.
        </p>
      )}
    </div>
  );
}

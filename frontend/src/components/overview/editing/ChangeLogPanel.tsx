"use client";

/**
 * "Last edited by X, 2 days ago" → the record's history.
 *
 * The first line comes from the record itself, so it also covers edits made
 * outside the overview (the operator console, an agent writing to coord
 * directly). The history is `overview.change_log` — every write made through
 * the overview's contract, with where it came from — read only when asked
 * for, and it says when it is showing part of a longer history rather than
 * presenting the page as the whole.
 */

import { useState } from "react";
import { formatRelativeTime } from "@/lib/time-utils";
import { fetchChangeLog, type ChangeLogEntry } from "./api";

const SOURCE_LABEL: Record<ChangeLogEntry["source"], string> = {
  ui: "on the overview",
  api: "through the API",
  import: "by an import",
};

const ACTION_LABEL: Record<ChangeLogEntry["action"], string> = {
  create: "created it",
  update: "changed it",
  delete: "deleted it",
};

type HistoryState =
  | { state: "closed" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; entries: ChangeLogEntry[]; truncated: boolean };

export function ChangeLogPanel({
  resource,
  recordId,
  updatedBy,
  updatedAt,
  uiBridgeId,
}: {
  resource: string;
  recordId: string;
  updatedBy: string | null;
  updatedAt: string | null;
  uiBridgeId: string;
}) {
  const [history, setHistory] = useState<HistoryState>({ state: "closed" });

  const toggle = () => {
    if (history.state !== "closed") {
      setHistory({ state: "closed" });
      return;
    }
    setHistory({ state: "loading" });
    fetchChangeLog(resource, recordId).then(
      (page) =>
        setHistory({
          state: "ready",
          entries: page.entries,
          truncated: page.truncated,
        }),
      (err: unknown) =>
        setHistory({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
  };

  if (!updatedAt && !updatedBy) return null;

  return (
    <div
      className="mt-2 text-xs text-muted-foreground"
      data-ui-bridge-id={uiBridgeId}
    >
      <span>
        Last edited
        {updatedBy ? ` by ${updatedBy}` : ""}
        {updatedAt ? `, ${formatRelativeTime(updatedAt)}` : ""}
      </span>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={history.state !== "closed"}
        className="ml-2 inline-flex min-h-9 items-center rounded-md underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id={`${uiBridgeId}.toggle`}
      >
        {history.state === "closed" ? "History" : "Hide history"}
      </button>
      {history.state === "loading" && <p className="mt-1">Loading history…</p>}
      {history.state === "error" && (
        <p className="mt-1" role="status">
          The history couldn&rsquo;t be loaded. Try again later.
        </p>
      )}
      {history.state === "ready" && (
        <div className="mt-1" data-ui-bridge-id={`${uiBridgeId}.entries`}>
          {history.entries.length === 0 ? (
            <p>No changes have been made through the overview yet.</p>
          ) : (
            <ol className="space-y-0.5">
              {history.entries.map((entry) => (
                <li key={entry.id}>
                  {entry.actor ?? "Someone"} {ACTION_LABEL[entry.action]}{" "}
                  {formatRelativeTime(entry.created_at)},{" "}
                  {SOURCE_LABEL[entry.source]}
                </li>
              ))}
            </ol>
          )}
          {history.truncated && (
            <p className="mt-1">Showing the most recent changes only.</p>
          )}
        </div>
      )}
    </div>
  );
}

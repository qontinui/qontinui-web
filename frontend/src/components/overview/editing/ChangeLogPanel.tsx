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

import { useRef, useState } from "react";
import { formatRelativeTime } from "@/lib/time-utils";
import { fetchChangeLog, type ChangeLogEntry } from "./api";

/** An id as people read it: its first group. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

/** " — reported session 1d390724, device 7c2e…" when a device made it. */
function viaText(entry: ChangeLogEntry): string {
  const parts = [
    entry.via_session && `reported session ${shortId(entry.via_session)}`,
    entry.via_device && `device ${shortId(entry.via_device)}`,
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

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

/** Which record a resource-wide entry is about, by the title it carried. */
function entryTitle(entry: ChangeLogEntry): string | null {
  const title = (entry.after ?? entry.before)?.title;
  return typeof title === "string" && title !== "" ? title : null;
}

type HistoryState =
  | { state: "closed" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ready";
      entries: ChangeLogEntry[];
      truncated: boolean;
      /** Set when the API-only view was asked for and the server answered
       *  with other writes too, i.e. did not filter: how many of the latest
       *  changes were filtered here. Nothing is known beyond them. */
      scannedLocally: number | null;
    };

export function ChangeLogPanel({
  resource,
  recordId,
  updatedBy,
  updatedAt,
  uiBridgeId,
}: {
  resource: string;
  /** One record's history; `null` for every record of the resource. */
  recordId: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  uiBridgeId: string;
}) {
  const [history, setHistory] = useState<HistoryState>({ state: "closed" });
  /** Only the writes made through the API — agents and scripts. */
  const [apiOnly, setApiOnly] = useState(false);
  // Which read is current: a slower reply to an earlier filter (or one
  // landing after Hide) must not replace what is shown.
  const reading = useRef(0);

  const load = (onlyApi: boolean) => {
    const ticket = ++reading.current;
    setHistory({ state: "loading" });
    fetchChangeLog(
      resource,
      recordId,
      onlyApi ? { source: "api" } : undefined
    ).then(
      (page) => {
        if (ticket !== reading.current) return;
        // A server that answers the API-only read with other writes did not
        // filter: filter here, and say the view covers only the changes it
        // sent — its `truncated` is about the unfiltered history.
        const unfiltered =
          onlyApi && page.entries.some((e) => e.source !== "api");
        setHistory({
          state: "ready",
          entries: onlyApi
            ? page.entries.filter((e) => e.source === "api")
            : page.entries,
          truncated: unfiltered ? false : page.truncated,
          scannedLocally: unfiltered ? page.entries.length : null,
        });
      },
      (err: unknown) =>
        ticket === reading.current &&
        setHistory({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
  };

  const toggle = () => {
    if (history.state !== "closed") {
      reading.current++;
      setHistory({ state: "closed" });
      return;
    }
    load(apiOnly);
  };

  const toggleApiOnly = () => {
    const next = !apiOnly;
    setApiOnly(next);
    load(next);
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
      {history.state !== "closed" && (
        <button
          type="button"
          onClick={toggleApiOnly}
          aria-pressed={apiOnly}
          className="ml-2 inline-flex min-h-9 items-center rounded-md underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id={`${uiBridgeId}.api-only`}
        >
          {apiOnly ? "Show all changes" : "Only changes through the API"}
        </button>
      )}
      {history.state === "loading" && <p className="mt-1">Loading history…</p>}
      {history.state === "error" && (
        <p className="mt-1" role="status">
          The history couldn&rsquo;t be loaded. Try again later.
        </p>
      )}
      {history.state === "ready" && (
        <div className="mt-1" data-ui-bridge-id={`${uiBridgeId}.entries`}>
          {history.entries.length === 0 ? (
            <p>
              {history.scannedLocally !== null
                ? `None of the latest ${history.scannedLocally} changes was made through the API.`
                : apiOnly
                  ? "No change has been made through the API yet."
                  : "No changes have been made through the overview yet."}
            </p>
          ) : (
            <ol className="space-y-0.5">
              {history.entries.map((entry) => (
                <li key={entry.id}>
                  {entry.actor ?? "Someone"} {ACTION_LABEL[entry.action]}
                  {recordId === null && entryTitle(entry)
                    ? ` (“${entryTitle(entry)}”)`
                    : ""}{" "}
                  {formatRelativeTime(entry.created_at)},{" "}
                  {SOURCE_LABEL[entry.source]}
                  {viaText(entry)}
                </li>
              ))}
            </ol>
          )}
          {history.truncated && (
            <p className="mt-1">Showing the most recent changes only.</p>
          )}
          {history.scannedLocally !== null && history.entries.length > 0 && (
            <p className="mt-1">
              Only the latest {history.scannedLocally} changes were checked for
              API writes; older ones may include more.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

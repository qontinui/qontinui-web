"use client";

/**
 * SavedSessionListDetail — what a click on a saved tab list earns.
 *
 * Plan `2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days`
 * Phase 3. The panel is `RecordDetail` (style guide R5): it expands in place
 * under its row, and its five slots carry, in their fixed order:
 *
 * | slot | what this surface puts in it |
 * |---|---|
 * | `why` | where and when the list was saved, by whom, and until when it is kept |
 * | `problems` | what the snapshot could not establish — a layout that could not be read, sessions whose finished state is unknown |
 * | `actions` | Copy as Markdown, Delete |
 * | `history` | the snapshot itself: each tab in the runner's order, and the terminals in it |
 * | `raw` | the ids, mono, last |
 *
 * The layout is read ONCE, when the row opens (`RecordList` keeps one open at
 * a time), unless the caller already holds it — a capture answers with the
 * whole list, so the list a Save just made opens without a second read. A
 * 404 is an answer (the list expired or was deleted), never "could not read".
 *
 * Every word comes from `savedSessionListStatus.ts` (R8).
 */

import { useEffect, useRef, useState } from "react";
import {
  BackendErrorMessage,
  RecordDetail,
  StatusBadge,
  absoluteTime,
} from "@/components/console";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import {
  deleteSavedSessionList,
  getSavedSessionList,
  isSavedListGone,
  type SavedSessionListDetail as Detail,
  type SavedSessionListSummary,
} from "@/lib/api/savedSessionLists";
import {
  SAVED_SESSION_FINISHED_PALETTE,
  byWhom,
  deletionCountdown,
  runnerProvenance,
  savedListMarkdown,
  sessionLine,
  tabHeadings,
  unknownFinishedCount,
} from "./savedSessionListStatus";

type DetailRead =
  | { kind: "loading" }
  | { kind: "loaded"; detail: Detail }
  | { kind: "gone" }
  | { kind: "failed"; error: unknown };

export interface SavedSessionListDetailProps {
  list: SavedSessionListSummary;
  /** The list's layout when the caller already holds it (a capture's answer). */
  seed?: Detail;
  /** Called with a layout this panel read, so a re-open needs no second read. */
  onLoaded: (detail: Detail) => void;
  /** Called once the list is gone: deleted here, or found already deleted. */
  onDeleted: (listId: string) => void;
  /** The runner's name, as the panel names it everywhere else. */
  runnerName: string;
  now: number;
}

/** What the last Copy press did — never a silent no-op. */
type CopyState = "idle" | "copied" | "failed";

export function SavedSessionListDetail({
  list,
  seed,
  onLoaded,
  onDeleted,
  runnerName,
  now,
}: SavedSessionListDetailProps) {
  const [fetched, setFetched] = useState<DetailRead>(
    seed ? { kind: "loaded", detail: seed } : { kind: "loading" }
  );
  // A layout the caller comes to hold while this read is out is as good as
  // the read's own answer.
  const read: DetailRead =
    fetched.kind === "loading" && seed
      ? { kind: "loaded", detail: seed }
      : fetched;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const seeded = seed !== undefined;

  useEffect(() => {
    if (seeded) return;
    const ctrl = new AbortController();
    getSavedSessionList(list.id, { signal: ctrl.signal }).then(
      (detail) => {
        setFetched({ kind: "loaded", detail });
        onLoadedRef.current(detail);
      },
      (error: unknown) => {
        if (ctrl.signal.aborted) return;
        setFetched(
          isSavedListGone(error) ? { kind: "gone" } : { kind: "failed", error }
        );
      }
    );
    return () => ctrl.abort();
  }, [list.id, seeded]);

  const [copy, setCopy] = useState<CopyState>("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const countdown = deletionCountdown(list.expires_at, now);
  const detail = read.kind === "loaded" ? read.detail : null;

  const copyMarkdown = () => {
    if (detail === null) return;
    if (!navigator.clipboard) {
      setCopy("failed");
      return;
    }
    // Back to idle first, so a repeat press is announced again.
    setCopy("idle");
    navigator.clipboard.writeText(savedListMarkdown(detail, runnerName)).then(
      () => setCopy("copied"),
      () => setCopy("failed")
    );
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSavedSessionList(list.id);
      setConfirmOpen(false);
      onDeleted(list.id);
    } catch (error) {
      setConfirmOpen(false);
      // Already gone is the outcome the press asked for.
      if (isSavedListGone(error)) onDeleted(list.id);
      else setDeleteError(error);
    } finally {
      setDeleting(false);
    }
  };

  const unknownCount = detail ? unknownFinishedCount(detail) : 0;

  return (
    <div
      data-ui-bridge-id="sessions.saved-tab-lists.detail"
      data-testid="saved-tab-list-detail"
    >
      <RecordDetail
        why={
          <div className="space-y-1">
            <p
              className="m-0 text-[13px] text-foreground/85"
              data-testid="saved-tab-list-why"
            >
              Saved from {runnerName} ({runnerProvenance(list)}){" "}
              {byWhom(list.created_by_name)} at {absoluteTime(list.captured_at)}
              . Tabs and terminals are listed in the runner&apos;s own order.
              Kept until {absoluteTime(list.expires_at)} ({countdown.text}).
            </p>
            {detail && !detail.layout.labelsRegistered && (
              <p
                className="m-0 text-xs text-muted-foreground"
                data-testid="saved-tab-list-labels-unreported"
              >
                The runner had not reported its tab names when this list was
                saved, so each tab is shown by its id.
              </p>
            )}
          </div>
        }
        problems={
          read.kind === "gone" ? (
            <p className="m-0 text-sm" data-testid="saved-tab-list-gone">
              This list is no longer available: it expired or was deleted.
            </p>
          ) : read.kind === "failed" ? (
            <div
              className="space-y-1 text-sm"
              data-testid="saved-tab-list-read-failed"
            >
              <p className="m-0">
                The saved layout could not be read, so its tabs are unknown —
                not empty.
              </p>
              <BackendErrorMessage error={read.error} className="text-xs" />
            </div>
          ) : unknownCount > 0 ? (
            <p
              className="m-0 text-xs text-muted-foreground"
              data-testid="saved-tab-list-unknown-finished"
            >
              Whether{" "}
              {unknownCount === 1 ? "1 session" : `${unknownCount} sessions`}{" "}
              had finished is unknown: the runner reported no finished marker,
              and coord did not answer for {unknownCount === 1 ? "it" : "them"}{" "}
              when this list was saved.
            </p>
          ) : null
        }
        actions={
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={copyMarkdown}
                disabled={detail === null}
                title="Copies the whole list — every tab and terminal — as Markdown"
                data-ui-bridge-id="sessions.saved-tab-lists.copy-markdown"
                data-testid="saved-tab-list-copy"
              >
                Copy as Markdown
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setConfirmOpen(true)}
                disabled={read.kind === "gone"}
                title="Deletes this saved list now, for everyone who can see this runner's lists"
                data-ui-bridge-id="sessions.saved-tab-lists.delete"
                data-testid="saved-tab-list-delete"
              >
                Delete…
              </button>
              {/* Always mounted, so a screen reader announces the change. */}
              <span
                className="text-xs text-muted-foreground"
                aria-live="polite"
                data-testid="saved-tab-list-copy-state"
              >
                {copy === "copied"
                  ? "Copied."
                  : copy === "failed"
                    ? "Copy failed — the clipboard is not available here."
                    : null}
              </span>
            </div>
            {deleteError !== null && (
              <div
                role="alert"
                className="text-sm"
                data-testid="saved-tab-list-delete-error"
              >
                <p className="m-0">The list was not deleted.</p>
                <BackendErrorMessage error={deleteError} className="text-xs" />
              </div>
            )}
            <ConfirmDestructiveDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="Delete this saved tab list?"
              description={`It is removed for everyone who can see this runner's lists, and it cannot be restored. Left alone, it is deleted automatically ${absoluteTime(list.expires_at)}.`}
              busy={deleting}
              onConfirm={() => void confirmDelete()}
              testId="saved-tab-list-delete-dialog"
            >
              <p className="m-0">
                {list.title ?? "Untitled list"} — {runnerName},{" "}
                {list.tab_count === 1 ? "1 tab" : `${list.tab_count} tabs`},{" "}
                {list.session_count === 1
                  ? "1 session"
                  : `${list.session_count} sessions`}
                , saved {absoluteTime(list.captured_at)}
              </p>
            </ConfirmDestructiveDialog>
          </div>
        }
        history={
          read.kind === "loading" ? (
            <div className="space-y-1.5" data-testid="saved-tab-list-loading">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : detail ? (
            <TabGroups detail={detail} />
          ) : null
        }
        raw={
          <dl className="m-0 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground/60 break-all">
            <dt>list id</dt>
            <dd className="m-0">{list.id}</dd>
            <dt>device id</dt>
            <dd className="m-0">{list.device_id}</dd>
            <dt>runner instance</dt>
            <dd className="m-0">{list.runner_instance ?? "not reported"}</dd>
            <dt>runner port</dt>
            <dd className="m-0">{list.runner_port ?? "not reported"}</dd>
            <dt>runner build</dt>
            <dd className="m-0">{list.runner_build_id ?? "not reported"}</dd>
            {detail && (
              <>
                <dt>captured (runner clock)</dt>
                <dd className="m-0">{detail.layout.capturedAt}</dd>
              </>
            )}
          </dl>
        }
      />
    </div>
  );
}

/** The snapshot: one section per tab, in the runner's order. */
function TabGroups({ detail }: { detail: Detail }) {
  const pages = detail.layout.pages;
  if (pages.length === 0) {
    return (
      <p
        className="m-0 text-sm text-muted-foreground"
        data-testid="saved-tab-list-no-tabs"
      >
        The runner had no terminal tabs open when this list was saved.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="saved-tab-list-tabs">
      {tabHeadings(pages).map(({ page, text, title }) => (
        <section
          key={page.pageId}
          aria-label={text}
          data-testid="saved-tab-list-tab"
          data-page-id={page.pageId}
        >
          <h3
            className="m-0 mb-1 flex items-baseline gap-2 text-xs font-semibold text-foreground/90"
            title={title}
            data-testid="saved-tab-list-tab-heading"
          >
            <span className="truncate">{text}</span>
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              {page.sessions.length === 1
                ? "1 terminal"
                : `${page.sessions.length} terminals`}
            </span>
          </h3>
          {page.sessions.length === 0 ? (
            <p className="m-0 text-xs text-muted-foreground">
              No terminals in this tab.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-1 p-0">
              {page.sessions.map((session) => {
                const line = sessionLine(session, detail.coord_status);
                return (
                  <li
                    key={line.key}
                    className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card/30 px-2 py-1 text-xs"
                    data-testid="saved-tab-list-session"
                    data-terminal-id={line.key}
                    data-ui-bridge-id={`sessions.saved-tab-lists.session.${line.key}`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        line.name.known
                          ? "font-medium"
                          : "italic text-muted-foreground"
                      }`}
                      title={line.name.title}
                      data-testid="saved-tab-list-session-name"
                    >
                      {line.name.text}
                      {!line.confirmed && (
                        <>
                          {" "}
                          <span className="not-italic text-muted-foreground">
                            · no confirmed session
                          </span>
                        </>
                      )}
                    </span>
                    <span
                      className={`max-w-[18ch] truncate ${
                        line.account.known ? "" : "italic"
                      } text-muted-foreground`}
                      title={line.account.title}
                      data-testid="saved-tab-list-session-account"
                    >
                      {line.account.text}
                    </span>
                    {line.finished.status && (
                      <StatusBadge
                        status={line.finished.status}
                        palette={SAVED_SESSION_FINISHED_PALETTE}
                      />
                    )}
                    <span
                      className={`hidden max-w-[28ch] truncate sm:inline ${
                        line.title.known ? "" : "italic"
                      } text-muted-foreground`}
                      title={line.title.tooltip}
                      data-testid="saved-tab-list-session-title"
                    >
                      {line.title.text}
                    </span>
                    <span
                      className="shrink-0 font-mono text-[11px] text-muted-foreground"
                      title={line.process.tooltip}
                      data-testid="saved-tab-list-session-process"
                    >
                      {line.process.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

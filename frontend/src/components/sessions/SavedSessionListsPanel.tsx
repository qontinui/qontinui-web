"use client";

/**
 * SavedSessionListsPanel — "Saved tab lists" on `/sessions`.
 *
 * Plan `2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days`
 * Phase 3. Saves which sessions sat in which tab of a runner — with each
 * session's account, name and finished state — and lists those saves until the
 * backend deletes them, 14 days after each was made.
 *
 * ## Shape (`frontend/docs/console-ui-style-guide.md`, §3.15)
 *
 * - **R7.** A `CollapsiblePanel`, collapsed by default, with the count of
 *   saved lists in its header. `CollapsiblePanel` unmounts its children, so
 *   the ONE list read is hoisted here, out of them: a closed panel costs that
 *   read and nothing polls. The runner list and every layout are read only
 *   once the panel (and then a row) is open.
 * - **R2/R4/R5.** One saved list is one `RecordRow`; a click opens its
 *   `SavedSessionListDetail` in place. No row is classified — nothing in a
 *   saved list asks anyone to act — so no row carries an attention accent.
 * - **R6.** A count never read renders `–`. A first read that fails says the
 *   lists are unknown, never "none"; a refresh that fails keeps the rows and
 *   says they are from the last good read. Every surface below consults the
 *   same read (`console/readFailure.ts`, `console/readSequence.ts`).
 * - **R8.** Every word is derived in `savedSessionListStatus.ts`.
 *
 * ## Saving (D4, D7)
 *
 * The runner picker reads `listRunners()` (`GET /api/v1/devices`). A capture
 * travels the device's relay socket, which only its primary runner holds, so
 * a device is offered while that socket is up and its secondary instances are
 * listed, disabled, as not addressable over the relay. A refusal renders
 * through `BackendErrorMessage`; the one the plan words itself — a runner
 * whose build predates saved tab lists — leads with those words.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Runner } from "@qontinui/shared-types";
import {
  BackendErrorMessage,
  CollapsiblePanel,
  FilterTabs,
  INERT,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  createReadSequence,
  readIsUnknown,
  relativeTime,
} from "@/components/console";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { listRunners } from "@/lib/api/runners";
import {
  SAVED_SESSION_LIST_TITLE_MAX,
  listSavedSessionLists,
  refusalDiscriminator,
  saveMayHaveLanded,
  saveSessionList,
  type SavedSessionListDetail as Detail,
  type SavedSessionListSummary,
} from "@/lib/api/savedSessionLists";
import { SavedSessionListDetail } from "./SavedSessionListDetail";
import {
  SAVED_SESSION_LIST_RETENTION_DAYS,
  SECONDARY_NOT_ADDRESSABLE,
  deletionCountdown,
  listReason,
  runnerFilterOptions,
  runnerHostNames,
  runnerPickerRows,
  saveRefusalLead,
  shortId,
  summaryOf,
} from "./savedSessionListStatus";

/** The filter tab that shows every runner's lists. Device ids are UUIDs. */
const ALL_RUNNERS = "all";

// ---------------------------------------------------------------------------
// The one list read (hoisted: it feeds the header count while closed)
// ---------------------------------------------------------------------------

interface SavedListsRead {
  /** The last delivered lists, or `null` while nothing has been delivered. */
  lists: SavedSessionListSummary[] | null;
  /** The most recent completed read did not replace `lists`. */
  readFailed: boolean;
  /** Why the most recent failed read failed. */
  error: unknown;
  /** When `lists` was last delivered (ISO). */
  readAt: string | null;
  refresh: () => Promise<void>;
  /** A capture answered with this list. */
  added: (list: SavedSessionListSummary) => void;
  /** This list is gone (deleted here, or found already deleted). */
  removed: (listId: string) => void;
}

function useSavedListsRead(): SavedListsRead {
  // Staleness is a comparison of SEQUENCES, not a flag set in a catch: a
  // superseded failure landing after a newer success must not stale it.
  const [sequence] = useState(createReadSequence);
  const [lists, setLists] = useState<SavedSessionListSummary[] | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const seq = sequence.issue();
    let next: SavedSessionListSummary[] | null = null;
    let failure: { error: unknown } | null = null;
    try {
      next = await listSavedSessionLists();
    } catch (err) {
      failure = { error: err };
    }
    if (!mounted.current) return;
    if (sequence.settle(seq, next !== null) && next !== null) {
      setLists(next);
      setReadAt(new Date().toISOString());
    }
    const failed = sequence.hasDelivered() ? sequence.isStale() : true;
    setReadFailed(failed);
    if (failure) setError(failure.error);
    if (!failed) setError(null);
  }, [sequence]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const added = useCallback((list: SavedSessionListSummary) => {
    // Only into lists already read: a list the read never delivered is not
    // known to be ONLY this one, so it stays unknown until the refresh lands.
    setLists((prev) =>
      prev === null ? prev : [list, ...prev.filter((l) => l.id !== list.id)]
    );
  }, []);
  const removed = useCallback((listId: string) => {
    setLists((prev) =>
      prev === null ? prev : prev.filter((l) => l.id !== listId)
    );
  }, []);

  return { lists, readFailed, error, readAt, refresh, added, removed };
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export interface SavedSessionListsPanelProps {
  /** device_id → hostname, from the page's live device-status stream. */
  hostnameFor?: (deviceId: string) => string | undefined;
  /** The clock (epoch ms) for the deletion countdowns. Defaults to now. */
  now?: number;
}

export function SavedSessionListsPanel({
  hostnameFor,
  now,
}: SavedSessionListsPanelProps) {
  const read = useSavedListsRead();
  const unknown = readIsUnknown(read.lists !== null, read.readFailed);
  const stale = read.lists !== null && read.readFailed;

  return (
    <CollapsiblePanel
      title="Saved tab lists"
      summary={
        <SavedListsCount
          count={read.lists === null ? null : read.lists.length}
          unknown={unknown}
          stale={stale}
        />
      }
      headerActions={
        <RefreshButton
          onRefresh={read.refresh}
          label="Refresh saved tab lists"
          title="Asks the backend again; the count beside the title follows it"
          data-testid="saved-tab-lists-refresh"
        />
      }
      defaultOpen={false}
      storageKey="sessions.saved-tab-lists.open"
      data-testid="saved-tab-lists-panel"
      data-ui-bridge-id="sessions.saved-tab-lists"
    >
      <SavedSessionListsBody
        read={read}
        unknown={unknown}
        stale={stale}
        hostnameFor={hostnameFor}
        now={now}
      />
    </CollapsiblePanel>
  );
}

/** The header count (R6/R7): `–` until read, and marked when stale. */
function SavedListsCount({
  count,
  unknown,
  stale,
}: {
  count: number | null;
  unknown: boolean;
  stale: boolean;
}) {
  const title =
    count === null
      ? unknown
        ? "Your saved tab lists could not be read, so the count is unknown — a dash, not a zero."
        : "Reading your saved tab lists…"
      : stale
        ? `${count} at the last good read; the latest refresh failed.`
        : `${count} saved tab ${count === 1 ? "list" : "lists"}, each deleted automatically ${SAVED_SESSION_LIST_RETENTION_DAYS} days after it was saved.`;
  return (
    <Badge
      variant="outline"
      className="font-mono text-[11px]"
      title={title}
      data-testid="saved-tab-lists-count"
    >
      {count === null ? "–" : count}
      {stale && <span aria-hidden>*</span>}
      {unknown && <span className="sr-only"> (unknown)</span>}
      {stale && (
        <span className="sr-only"> (stale: the latest refresh failed)</span>
      )}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// The open panel: save form + lists
// ---------------------------------------------------------------------------

interface RunnersRead {
  runners: Runner[] | null;
  error: unknown;
  reload: () => Promise<void>;
}

function useRunnersRead(): RunnersRead {
  const [runners, setRunners] = useState<Runner[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next: unknown = await listRunners();
      if (!Array.isArray(next)) {
        throw new Error("the runners read answered without a list of runners");
      }
      if (!mounted.current) return;
      setRunners(next as Runner[]);
      setError(null);
    } catch (err) {
      if (mounted.current) setError(err);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  return { runners, error, reload };
}

function SavedSessionListsBody({
  read,
  unknown,
  stale,
  hostnameFor,
  now,
}: {
  read: SavedListsRead;
  unknown: boolean;
  stale: boolean;
  hostnameFor?: (deviceId: string) => string | undefined;
  now?: number;
}) {
  const { added, removed, refresh } = read;
  const runners = useRunnersRead();
  const hosts = useMemo(
    () => runnerHostNames(runners.runners ?? []),
    [runners.runners]
  );
  const nameFor = useCallback(
    (deviceId: string) =>
      hostnameFor?.(deviceId) ??
      hosts.get(deviceId) ??
      `device ${shortId(deviceId)}`,
    [hostnameFor, hosts]
  );

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(ALL_RUNNERS);
  // Layouts already in hand — a capture's answer, or a row read once — so a
  // re-opened row needs no second read.
  const [seeds, setSeeds] = useState<Readonly<Record<string, Detail>>>({});

  const remember = useCallback((detail: Detail) => {
    setSeeds((prev) => ({ ...prev, [detail.id]: detail }));
  }, []);

  const onSaved = useCallback(
    (detail: Detail) => {
      remember(detail);
      setFilter(ALL_RUNNERS);
      setExpandedKey(detail.id);
      added(summaryOf(detail));
      void refresh();
    },
    [remember, added, refresh]
  );

  const onDeleted = useCallback(
    (listId: string) => {
      setExpandedKey((key) => (key === listId ? null : key));
      setSeeds((prev) => {
        const next = { ...prev };
        delete next[listId];
        return next;
      });
      removed(listId);
      void refresh();
    },
    [removed, refresh]
  );

  const lists = read.lists ?? [];
  const options = runnerFilterOptions(lists, nameFor);
  const active =
    filter !== ALL_RUNNERS && options.some((o) => o.deviceId === filter)
      ? filter
      : ALL_RUNNERS;
  const shown =
    active === ALL_RUNNERS
      ? lists
      : lists.filter((l) => l.device_id === active);
  const nowMs = now ?? Date.now();

  return (
    <div className="space-y-4">
      <SaveTabListForm
        runners={runners}
        nameFor={nameFor}
        onSaved={onSaved}
        onMaybeSaved={() => void refresh()}
      />

      {unknown ? (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-border px-3 py-2 text-sm"
          data-testid="saved-tab-lists-unknown"
        >
          <p className="m-0">
            Your saved tab lists could not be read, so whether you have any is
            unknown — not none.
          </p>
          <BackendErrorMessage error={read.error} className="text-xs" />
        </div>
      ) : (
        <div className="space-y-2">
          {stale && (
            <div
              className="space-y-0.5 text-xs text-muted-foreground"
              data-testid="saved-tab-lists-stale"
            >
              <p className="m-0">
                The latest refresh failed — these are the lists from the last
                good read ({relativeTime(read.readAt, { now: nowMs })}).
              </p>
              <BackendErrorMessage error={read.error} />
            </div>
          )}
          {options.length > 1 && (
            <FilterTabs
              tabs={[
                { id: ALL_RUNNERS, label: "All runners", count: lists.length },
                ...options.map((o) => ({
                  id: o.deviceId,
                  label: o.label,
                  count: o.count,
                })),
              ]}
              active={active}
              onChange={setFilter}
              testIdPrefix="saved-tab-lists-filter"
            />
          )}
          <RecordList
            items={shown}
            itemKey={(list) => list.id}
            loaded={read.lists !== null}
            skeletonRows={2}
            expandedKey={expandedKey}
            onExpandedKeyChange={setExpandedKey}
            empty={
              <p
                className="m-0 text-sm text-muted-foreground"
                data-testid="saved-tab-lists-empty"
              >
                {stale
                  ? `No saved tab lists at the last good read (${relativeTime(read.readAt, { now: nowMs })}); the latest refresh failed.`
                  : `No saved tab lists yet. Save one above — each is deleted automatically ${SAVED_SESSION_LIST_RETENTION_DAYS} days after it is saved.`}
              </p>
            }
            renderRow={(list, { expanded, onToggle }) => {
              const countdown = deletionCountdown(list.expires_at, nowMs);
              const runnerName = nameFor(list.device_id);
              return (
                <div
                  data-ui-bridge-id={`sessions.saved-tab-lists.row.${list.id}`}
                >
                  <RecordRow
                    identity={runnerName}
                    label={
                      list.title ? (
                        <span title={list.title}>{list.title}</span>
                      ) : (
                        <span className="italic text-muted-foreground">
                          untitled
                        </span>
                      )
                    }
                    status={
                      <Badge
                        variant="outline"
                        className={`whitespace-nowrap text-[11px] font-medium ${INERT}`}
                        title={countdown.title}
                        data-testid="saved-tab-lists-countdown"
                      >
                        {countdown.text}
                      </Badge>
                    }
                    reason={listReason(list)}
                    time={<RowTime at={list.captured_at} verb="Saved" />}
                    expanded={expanded}
                    onToggle={onToggle}
                    data-testid="saved-tab-lists-row"
                  >
                    <SavedSessionListDetail
                      list={list}
                      seed={seeds[list.id]}
                      onLoaded={remember}
                      onDeleted={onDeleted}
                      runnerName={runnerName}
                      now={nowMs}
                    />
                  </RecordRow>
                </div>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

type SaveOutcome =
  | { kind: "saved"; detail: Detail }
  | { kind: "refused"; error: unknown; maybeSaved: boolean }
  | null;

function SaveTabListForm({
  runners,
  nameFor,
  onSaved,
  onMaybeSaved,
}: {
  runners: RunnersRead;
  nameFor: (deviceId: string) => string;
  onSaved: (detail: Detail) => void;
  onMaybeSaved: () => void;
}) {
  const rows = useMemo(
    () => (runners.runners === null ? null : runnerPickerRows(runners.runners)),
    [runners.runners]
  );
  const pickerLabelId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome>(null);

  const selectable = rows?.filter((r) => r.selectable) ?? [];
  const [onlyOne] = selectable.length === 1 ? selectable : [];
  // With no choice made, the one connected runner is the choice. A choice
  // that has since dropped off the relay is cleared, never swapped for
  // another runner: a save must go where the operator pointed it.
  const selected =
    chosen === null
      ? (onlyOne?.deviceId ?? null)
      : selectable.some((r) => r.deviceId === chosen)
        ? chosen
        : null;

  const save = async () => {
    if (selected === null || saving) return;
    setSaving(true);
    setOutcome(null);
    const trimmed = title.trim();
    try {
      const detail = await saveSessionList({
        device_id: selected,
        title: trimmed === "" ? null : trimmed,
      });
      setOutcome({ kind: "saved", detail });
      setTitle("");
      onSaved(detail);
    } catch (error) {
      const maybeSaved = saveMayHaveLanded(error);
      setOutcome({ kind: "refused", error, maybeSaved });
      if (maybeSaved) onMaybeSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="saved-tab-lists-save-form">
      <div
        role="radiogroup"
        aria-labelledby={pickerLabelId}
        className="min-w-0 space-y-1.5"
        data-testid="saved-tab-lists-runner-picker"
        data-ui-bridge-id="sessions.saved-tab-lists.runner-picker"
      >
        <div className="flex items-center gap-2">
          <span
            id={pickerLabelId}
            className="text-xs font-medium text-muted-foreground"
          >
            Runner to save from
          </span>
          <RefreshButton
            onRefresh={runners.reload}
            label="Refresh runners"
            title="Re-reads which of your runners are connected to the relay"
            data-testid="saved-tab-lists-runners-refresh"
          />
        </div>
        {rows === null ? (
          runners.error !== null ? (
            <div
              className="text-sm"
              data-testid="saved-tab-lists-runners-unknown"
            >
              <p className="m-0">
                Your runners could not be listed, so there is nothing to save
                from yet.
              </p>
              <BackendErrorMessage error={runners.error} className="text-xs" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-5 w-56" />
            </div>
          )
        ) : rows.length === 0 ? (
          <p
            className="m-0 text-sm text-muted-foreground"
            data-testid="saved-tab-lists-no-runners"
          >
            No runners are paired with your account.
          </p>
        ) : (
          <div className="space-y-1">
            {runners.error !== null && (
              <p
                className="m-0 text-xs text-muted-foreground"
                data-testid="saved-tab-lists-runners-stale"
              >
                The latest runner read failed; these are from the read before.
              </p>
            )}
            {rows.map((row) => (
              <div
                key={row.deviceId}
                data-testid="saved-tab-lists-runner"
                data-device-id={row.deviceId}
              >
                <label
                  className={`flex min-w-0 items-center gap-2 text-sm ${
                    row.selectable ? "cursor-pointer" : "text-muted-foreground"
                  }`}
                  title={row.title}
                >
                  <input
                    type="radio"
                    className="radio shrink-0"
                    name="saved-tab-lists-runner"
                    value={row.deviceId}
                    checked={selected === row.deviceId}
                    disabled={!row.selectable}
                    onChange={() => setChosen(row.deviceId)}
                    data-ui-bridge-id={`sessions.saved-tab-lists.runner.${row.deviceId}`}
                  />
                  <span className="truncate font-medium">{row.host}</span>
                  {row.instanceText !== null && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {row.instanceText}
                    </span>
                  )}
                  {row.disabledReason !== null && (
                    <span
                      className="truncate text-xs"
                      data-testid="saved-tab-lists-runner-reason"
                    >
                      {row.disabledReason}
                    </span>
                  )}
                </label>
                {row.secondaries.map((secondary) => (
                  <label
                    key={secondary.key}
                    className="ml-6 flex items-center gap-2 text-xs text-muted-foreground"
                    title="Only the instance holding the device's relay connection — its primary — can be reached from here."
                    data-testid="saved-tab-lists-runner-secondary"
                  >
                    <input
                      type="radio"
                      className="radio shrink-0"
                      name="saved-tab-lists-runner"
                      value={`${row.deviceId}:${secondary.key}`}
                      disabled
                    />
                    <span className="font-mono text-[11px]">
                      secondary
                      {secondary.port !== null ? ` :${secondary.port}` : ""}
                    </span>
                    <span>{SECONDARY_NOT_ADDRESSABLE}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">
            Title (optional)
          </span>
          <input
            type="text"
            className="input text-sm"
            value={title}
            maxLength={SAVED_SESSION_LIST_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. before rebuilding the runner"
            data-ui-bridge-id="sessions.saved-tab-lists.title"
            data-testid="saved-tab-lists-title"
          />
        </label>
        <button
          type="button"
          className="btn-primary btn-sm"
          // Busy is aria-busy + aria-disabled with presses ignored, never the
          // real `disabled`, which would pull focus from the keyboard user who
          // just pressed it. No runner on offer is a real `disabled`.
          disabled={selected === null}
          aria-busy={saving || undefined}
          aria-disabled={saving || undefined}
          onClick={() => void save()}
          title={
            selected === null
              ? "Choose a runner that is connected to the relay first"
              : `Saves the tabs and sessions of ${nameFor(selected)}'s runner, kept ${SAVED_SESSION_LIST_RETENTION_DAYS} days`
          }
          data-ui-bridge-id="sessions.saved-tab-lists.save"
          data-testid="saved-tab-lists-save"
        >
          {saving ? "Saving…" : "Save tab list"}
        </button>
      </div>

      {outcome?.kind === "saved" && (
        <p
          role="status"
          className="m-0 text-sm text-muted-foreground"
          data-testid="saved-tab-lists-saved"
        >
          Saved{" "}
          {outcome.detail.title
            ? `"${outcome.detail.title}"`
            : "an untitled list"}{" "}
          from {nameFor(outcome.detail.device_id)}:{" "}
          {outcome.detail.tab_count === 1
            ? "1 tab"
            : `${outcome.detail.tab_count} tabs`}
          ,{" "}
          {outcome.detail.session_count === 1
            ? "1 session"
            : `${outcome.detail.session_count} sessions`}
          . It is deleted automatically in {SAVED_SESSION_LIST_RETENTION_DAYS}{" "}
          days.
        </p>
      )}
      {outcome?.kind === "refused" && (
        <SaveRefusal error={outcome.error} maybeSaved={outcome.maybeSaved} />
      )}
    </div>
  );
}

/** A capture that did not save — in the refusal's own words (D7). */
function SaveRefusal({
  error,
  maybeSaved,
}: {
  error: unknown;
  maybeSaved: boolean;
}) {
  const lead = saveRefusalLead(refusalDiscriminator(error));
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
      data-testid="saved-tab-lists-save-error"
    >
      {lead !== null && (
        <p className="m-0 font-medium" data-testid="saved-tab-lists-save-lead">
          {lead}
        </p>
      )}
      <BackendErrorMessage
        error={error}
        data-testid="saved-tab-lists-save-refusal"
      />
      {maybeSaved && (
        <p className="m-0 text-xs text-muted-foreground">
          No answer said whether the save landed, so the lists below were
          re-read rather than saving again.
        </p>
      )}
    </div>
  );
}

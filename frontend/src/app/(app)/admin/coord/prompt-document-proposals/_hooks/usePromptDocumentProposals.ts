"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import { canWithdraw, writeKey } from "../_lib/writes";
import { isUnavailableSevere } from "../types";
import type {
  ListProposalsResponse,
  ListWritesResponse,
  PromptDocumentProposal,
  PromptDocumentWrite,
  UnavailableKind,
} from "../types";

const API = "/api/v1/operations";
const PROPOSALS = `${API}/coord/prompt-document-proposals`;
const WRITES = `${API}/coord/prompt-document-writes`;
const DOCUMENTS = `${API}/coord/prompt-documents`;

/** `/coord/prompt-documents/:kind/:name`, each segment encoded. */
function docPath(kind: string, name: string): string {
  return `${DOCUMENTS}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
}

/** Key for the live-version map — the `(kind, name)` document address. */
function docKey(kind: string, name: string): string {
  return `${kind}/${name}`;
}

/**
 * Whether a failed withdraw POST is coord's `409 withdraw_stale` refusal (the
 * record's live version is no longer the `expected_version` sent), and the
 * version coord says it is now at.
 *
 * The operations proxy passes coord's JSON body through as a string, which the
 * backend's error envelope then JSON-escapes into its `message`, and
 * `httpClient` folds the whole response text into the Error message. So the
 * code is matched as the `error_code` KEY/VALUE pair, tolerating that one
 * level of escaping — never as a bare substring, which a record whose name
 * (it is in the request URL the message also carries) contained the token
 * would satisfy on every unrelated failure.
 */
const WITHDRAW_STALE_CODE = /error_code\\*"\s*:\s*\\*"withdraw_stale\\*"/;
const STALE_CURRENT_VERSION = /current_version\\*"\s*:\s*(\d+)/;

function withdrawStale(err: unknown): { stale: boolean; now: number | null } {
  const text = message(err, "");
  if (!WITHDRAW_STALE_CODE.test(text)) return { stale: false, now: null };
  const match = STALE_CURRENT_VERSION.exec(text);
  return { stale: true, now: match ? Number(match[1]) : null };
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Shape of the document-list rows this hook needs (bodies omitted upstream). */
interface DocumentVersionRow {
  kind: string;
  name: string;
  current_version: number;
}

/** One immutable version snapshot — the body an undo PATCHes back in. */
interface VersionSnapshot {
  body: string;
}

/**
 * The two bodies a landed write's diff is computed from, or why they could not
 * be fetched.
 *
 * `error` is a first-class arm rather than an empty diff: an unreadable version
 * must not render as "this write changed nothing", which is the same
 * absence-is-not-zero rule the caveat banners above follow.
 */
export type WriteDiffState =
  | { status: "loading" }
  | { status: "ready"; previous: string; current: string }
  | { status: "error"; error: string };

/**
 * The operator review feed's data layer: pending policy-edit proposals, the
 * recently landed writes, and the live document versions the two are judged
 * against.
 *
 * Everything goes through the tenant coord-proxy under `/api/v1/operations`.
 * Reads are visible to any tenant member; approve/reject and revert are
 * tenant-admin-gated (the backend re-checks, and coord re-checks again), and the
 * deciding/editing identity is stamped SERVER-SIDE — the browser never says who
 * decided anything.
 *
 * ## Honesty about uncertainty
 *
 * `error` (we could not reach the backend at all) and `unavailable` (the backend
 * reached coord's surface and coord has no such route yet) are distinct states
 * the page renders separately. Neither is collapsed into an empty queue: "no
 * pending proposals" is a claim this page only makes when it actually knows.
 *
 * ## Why undo is a PATCH, not a coord `restore` call
 *
 * coord has no revert-to-version route. Its `restore-default` re-seeds from the
 * SHIPPED code default — a different operation, and unavailable for
 * hand-authored documents. Undoing a write is therefore: read the body of the
 * version BEFORE it, then PATCH that back as an ordinary edit. coord snapshots a
 * NEW version for it, so history is appended to rather than rewritten and the
 * undo is itself undoable.
 */
export function usePromptDocumentProposals() {
  const [proposals, setProposals] = useState<PromptDocumentProposal[]>([]);
  const [writes, setWrites] = useState<PromptDocumentWrite[]>([]);
  /** `(kind/name) → current_version` for staleness checks. */
  const [liveVersions, setLiveVersions] = useState<Map<string, number>>(
    new Map()
  );

  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [unavailableKind, setUnavailableKind] =
    useState<UnavailableKind | null>(null);
  /** Every write-feed caveat that is set — they are independent, not a chain. */
  const [writesNotices, setWritesNotices] = useState<string[]>([]);
  const [writesSevere, setWritesSevere] = useState(false);
  const [writesNothingRead, setWritesNothingRead] = useState(false);
  /**
   * Per-write diff bodies, keyed by `(kind, name, version)`.
   *
   * Never invalidated, and that is correct rather than lazy: a version snapshot
   * is IMMUTABLE — coord appends a new version for every edit and never
   * rewrites an old one — so the pair of bodies behind a given `(document,
   * version)` cannot change under the cache. `reload()` deliberately leaves it
   * alone; re-fetching bodies that cannot have moved would cost a round trip
   * per open row for a guaranteed-identical answer.
   */
  const [writeDiffs, setWriteDiffs] = useState<Map<string, WriteDiffState>>(
    new Map()
  );
  /**
   * Keys already requested. A ref, not derived from `writeDiffs`, because the
   * dedupe decision has to be made SYNCHRONOUSLY — reading it out of state
   * would let two expands in the same tick both see an empty map and fire two
   * identical pairs of fetches. Deciding it inside a `setState` updater would
   * work too, but only by making the updater impure, which is exactly what
   * React's StrictMode double-invoke exists to punish.
   *
   * A FAILED read is removed again, so re-expanding the row retries instead of
   * pinning the error forever.
   */
  const requestedDiffs = useRef<Set<string>>(new Set());

  const loadProposals = useCallback(async () => {
    try {
      const data = await httpClient.get<ListProposalsResponse>(
        `${PROPOSALS}?status=pending`
      );
      setProposals(data.proposals ?? []);
      setUnavailable(data.unavailable ?? null);
      setUnavailableKind(data.unavailable_kind ?? null);
      setError(null);
    } catch (err) {
      // Keep the last-good queue on screen; the banner says it may be stale.
      // Clear the unavailable note: it described the PREVIOUS response, and
      // leaving it set would stack two contradictory banners.
      setError(message(err, "Failed to load proposals"));
      setUnavailable(null);
      setUnavailableKind(null);
    }
  }, []);

  const loadWrites = useCallback(async () => {
    try {
      const data = await httpClient.get<ListWritesResponse>(
        `${WRITES}?limit=40`
      );
      setWrites(data.writes ?? []);
      // All five caveats are independent and can co-occur — showing only the
      // first would swallow the others.
      setWritesNotices(
        [
          data.unavailable,
          data.degraded,
          data.partial,
          data.truncated,
          data.limited,
        ].filter((n): n is string => Boolean(n))
      );
      // Only an `unavailable` response is a coord failure; degraded / partial /
      // truncated / limited all mean "read fine, just incomplete".
      setWritesSevere(
        Boolean(data.unavailable) &&
          // This route's document list ships in today's coord, so an
          // unlabelled failure here still means coord is not answering.
          isUnavailableSevere(data.unavailable_kind, true)
      );
      // Distinct from severity: `partial` with an empty feed means every
      // document failed individually — coord is up, but nothing was read, and
      // the empty state must not claim there is nothing to show.
      setWritesNothingRead(
        Boolean(data.unavailable) ||
          (Boolean(data.partial) && (data.writes ?? []).length === 0)
      );
    } catch (err) {
      setWritesNotices([message(err, "Failed to load recent writes")]);
      setWritesSevere(true);
      setWritesNothingRead(true);
    }
  }, []);

  /**
   * The documents' live versions. Fetched separately from the write feed so a
   * proposal targeting a rarely-touched document still gets a truthful
   * staleness verdict rather than none.
   */
  const loadLiveVersions = useCallback(async () => {
    try {
      const data = await httpClient.get<{ documents?: DocumentVersionRow[] }>(
        DOCUMENTS
      );
      setLiveVersions(
        new Map(
          (data.documents ?? []).map((d) => [
            docKey(d.kind, d.name),
            d.current_version,
          ])
        )
      );
    } catch {
      // Non-fatal: without this map the page shows no staleness verdict at all,
      // which is the honest outcome — it must never claim "up to date" on a
      // failed lookup.
      setLiveVersions(new Map());
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadProposals(), loadWrites(), loadLiveVersions()]);
    setLoading(false);
  }, [loadProposals, loadWrites, loadLiveVersions]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * The document's live version, or `null` when it could not be resolved.
   * `null` means "unknown", and the page renders it as unknown — never as
   * "not stale".
   */
  const liveVersionFor = useCallback(
    (kind: string, name: string): number | null =>
      liveVersions.get(docKey(kind, name)) ?? null,
    [liveVersions]
  );

  /**
   * Fetch the two bodies a landed write's diff needs — the version itself and
   * the one before it.
   *
   * No new endpoint: these are the SAME `…/versions/{n}` reads the undo path
   * already makes, asked one version apart. Lazy on purpose — a feed of forty
   * rows would otherwise open with eighty body fetches to render diffs nobody
   * has asked to see.
   *
   * `v1` has no predecessor, so its left side is the empty document and the
   * whole body renders as added. That is the truthful reading of "this document
   * did not exist before this write"; the alternative (refusing to diff v1)
   * would leave the first write — often the interesting one — unexplained.
   */
  const loadWriteDiff = useCallback(
    async (write: PromptDocumentWrite): Promise<void> => {
      const key = writeKey(write);
      // Already ready or already in flight: a second expand must not re-fetch.
      if (requestedDiffs.current.has(key)) return;
      requestedDiffs.current.add(key);
      setWriteDiffs((prev) => new Map(prev).set(key, { status: "loading" }));

      const path = docPath(write.kind, write.name);
      const previousVersion = write.version_number - 1;
      try {
        const [current, previous] = await Promise.all([
          httpClient.get<VersionSnapshot>(
            `${path}/versions/${write.version_number}`
          ),
          previousVersion >= 1
            ? httpClient.get<VersionSnapshot>(
                `${path}/versions/${previousVersion}`
              )
            : Promise.resolve({ body: "" }),
        ]);
        setWriteDiffs((prev) => {
          const next = new Map(prev);
          next.set(key, {
            status: "ready",
            previous: previous?.body ?? "",
            current: current?.body ?? "",
          });
          return next;
        });
      } catch (err) {
        // Drop the guard so a later expand can try again — a transient 502
        // must not make this row permanently unexplainable.
        requestedDiffs.current.delete(key);
        setWriteDiffs((prev) =>
          new Map(prev).set(key, {
            status: "error",
            error: message(err, "Failed to read this version's text"),
          })
        );
      }
    },
    []
  );

  /** The cached diff state for one write, or `null` when it was never asked for. */
  const writeDiffFor = useCallback(
    (write: PromptDocumentWrite): WriteDiffState | null =>
      writeDiffs.get(writeKey(write)) ?? null,
    [writeDiffs]
  );

  const decide = useCallback(
    async (
      proposal: PromptDocumentProposal,
      action: "approve" | "reject",
      decisionNote: string
    ): Promise<boolean> => {
      try {
        setActing(true);
        const note = decisionNote.trim();
        await httpClient.post(
          `${PROPOSALS}/${encodeURIComponent(proposal.id)}/${action}`,
          note ? { decision_note: note } : {}
        );
        toast.success(
          action === "approve"
            ? `Approved — the edit to ${proposal.doc_name} has been applied.`
            : `Rejected — the edit to ${proposal.doc_name} was not applied.`
        );
        await reload();
        return true;
      } catch (err) {
        toast.error(
          message(
            err,
            action === "approve"
              ? "Failed to approve proposal"
              : "Failed to reject proposal"
          )
        );
        return false;
      } finally {
        setActing(false);
      }
    },
    [reload]
  );

  /**
   * Undo one landed write: read the body of the version BEFORE it and PATCH
   * that back. Appends a new version rather than rewriting history (see the
   * module note), so the undo is itself undoable.
   *
   * Only meaningful for a write that is currently head — undoing an older write
   * would silently discard every write made since.
   *
   * The head check is done TWICE, and the second one is the real guard. The
   * feed's `current_version` is a snapshot from page load; if a peer admin
   * edited the document since, it is stale and would wave through exactly the
   * clobber this exists to prevent. coord's PATCH takes no version
   * precondition, so a live re-read is the only place the invariant can be
   * enforced at all. The first check just avoids a pointless round trip.
   *
   * The remaining window is honestly small but NOT zero: one more GET (the
   * snapshot fetch) sits between the guard and the PATCH. Closing it properly
   * needs an `If-Match`-style precondition on coord's PATCH, which does not
   * exist yet — so this narrows the race from "page lifetime" to "one request",
   * rather than eliminating it.
   */
  const revertWrite = useCallback(
    async (write: PromptDocumentWrite): Promise<boolean> => {
      const target = write.version_number - 1;
      const notHead =
        "Only the most recent write can be undone in one click. Use the document's history view for anything older.";
      if (write.version_number !== write.current_version || target < 1) {
        toast.error(notHead);
        return false;
      }
      try {
        setActing(true);
        // Live re-read: has the document moved under us since page load?
        const live = await httpClient.get<{ current_version?: number }>(
          `${docPath(write.kind, write.name)}/versions`
        );
        if (live.current_version !== write.version_number) {
          // A missing `current_version` fails closed here (strict !==), so
          // describe it as unknown rather than printing "now vundefined".
          const now =
            typeof live.current_version === "number"
              ? `now v${live.current_version}`
              : "its current version could not be read";
          toast.error(
            `${write.label} has changed since this page loaded (${now}). Refreshed — review the newer write before undoing anything.`
          );
          await reload();
          return false;
        }
        const snapshot = await httpClient.get<VersionSnapshot>(
          `${docPath(write.kind, write.name)}/versions/${target}`
        );
        await httpClient.patch(docPath(write.kind, write.name), {
          body: snapshot.body,
          change_description: `Undid v${write.version_number} — restored the wording from v${target} via the review feed`,
        });
        toast.success(
          `Restored ${write.label} to the wording from v${target}.`
        );
        await reload();
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to undo this write"));
        return false;
      } finally {
        setActing(false);
      }
    },
    [reload]
  );

  /**
   * Withdraw a CREATED decision record — the undo `revertWrite` cannot offer,
   * because a v1 has no earlier body (plan
   * `2026-09-13-decision-records-are-agent-writable-but-policy-says-they-are-not`,
   * §7 3.3).
   *
   * Calls coord's operator `…/withdraw` route through the tenant proxy. Coord
   * writes a NEW version marking the record withdrawn and keeps its text and
   * history, so nothing is deleted and the new head carries the ordinary Undo.
   * The withdrawer is stamped by coord from the authenticated operator, never
   * sent from here.
   *
   * Same double head check as `revertWrite`, for the same reason: the feed's
   * `current_version` is a page-load snapshot. If a peer edited or already
   * withdrew the record since, it is no longer the v1 this control was offered
   * on, and withdrawing on the strength of a stale row would act on a document
   * the operator has not seen. Unlike `revertWrite`, the window is CLOSED, not
   * narrowed: the POST carries the version just re-read as `expected_version`,
   * and coord compares it under its row lock, answering `409 withdraw_stale`
   * when a peer write landed between the re-read and the POST. That refusal is
   * reported as the same "changed since" outcome and the feed reloads. (A coord
   * predating that check ignores the field, and the window is then only
   * narrowed to one request; nothing breaks either way.)
   */
  const withdrawWrite = useCallback(
    async (write: PromptDocumentWrite, reason: string): Promise<boolean> => {
      const trimmed = reason.trim();
      if (!canWithdraw(write)) {
        toast.error(
          "Only a newly created decision record can be withdrawn from here. Use Undo on a later write."
        );
        return false;
      }
      if (!trimmed) {
        toast.error("Say why you are withdrawing this record.");
        return false;
      }
      try {
        setActing(true);
        const path = docPath(write.kind, write.name);
        const live = await httpClient.get<{ current_version?: number }>(
          `${path}/versions`
        );
        if (live.current_version !== write.version_number) {
          const now =
            typeof live.current_version === "number"
              ? `now v${live.current_version}`
              : "its current version could not be read";
          toast.error(
            `${write.label} has changed since this page loaded (${now}). Refreshed — review the newer write before withdrawing anything.`
          );
          await reload();
          return false;
        }
        try {
          await httpClient.post(`${path}/withdraw`, {
            reason: trimmed,
            expected_version: live.current_version,
          });
        } catch (err) {
          const { stale, now } = withdrawStale(err);
          if (stale) {
            const version = now === null ? "" : ` (now v${now})`;
            toast.error(
              `${write.label} changed while you were withdrawing it${version}. Nothing was withdrawn. Refreshed — review the newer write first.`
            );
            await reload();
            return false;
          }
          throw err;
        }
        toast.success(
          `Withdrew ${write.label}. It no longer counts as a decision; Undo on the new version reinstates it.`
        );
        await reload();
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to withdraw this record"));
        return false;
      } finally {
        setActing(false);
      }
    },
    [reload]
  );

  return {
    proposals,
    writes,
    loading,
    acting,
    error,
    unavailable,
    unavailableKind,
    writesNotices,
    writesSevere,
    writesNothingRead,
    liveVersionFor,
    loadWriteDiff,
    writeDiffFor,
    reload,
    decide,
    revertWrite,
    withdrawWrite,
  };
}

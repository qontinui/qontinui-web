"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
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
    reload,
    decide,
    revertWrite,
  };
}

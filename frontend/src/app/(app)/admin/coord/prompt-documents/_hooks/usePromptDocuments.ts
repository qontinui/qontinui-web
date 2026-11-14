"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { readActiveTenantId } from "@/services/http-client";
import {
  type TenantPin,
  createPromptDocument,
  fetchPromptDocument,
  fetchPromptDocumentVersion,
  listPromptDocuments,
  listPromptDocumentVersions,
  restorePromptDocumentDefault,
  restorePromptDocumentVersion,
  updatePromptDocument,
} from "@/lib/api/operations/coordPromptDocuments";
import type {
  ListVersionsResponse,
  PromptDocument,
  PromptDocumentCreate,
  PromptDocumentKind,
  PromptDocumentSummary,
  PromptDocumentUpdate,
  PromptDocumentVersion,
} from "../types";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Loads and mutates the tenant's prompt documents via the coord-proxy
 * (`/api/v1/operations/coord/prompt-documents`). Reads are visible to any tenant
 * member; PATCH/restore writes are tenant-admin-gated (coord re-checks) and the
 * editing user is stamped server-side onto the version snapshot.
 *
 * Coord's list route seeds the canonical documents on first touch, so a fresh
 * tenant sees the full set immediately.
 *
 * Honesty about uncertainty: `error` and `degraded` are distinct states the page
 * renders explicitly. `error` = coord unreachable or refusing (we know nothing);
 * `degraded` = coord answered but its document store is not provisioned yet (the
 * empty list means "cannot see", not "nothing is there"). Neither is flattened
 * into a confident "no documents" empty state.
 *
 * **Pinned.** `pin` is the project the page's rows belong to. Every read and
 * write below is sent in it on EVERY attempt (`pinActiveTenant`), and so is the
 * re-read each write takes, and `reload()` by default. The HTTP client
 * otherwise reads the stored project per attempt, so a request retried (429),
 * or replayed after a token refresh, after another tab switched project would
 * land in, or answer from, that project. The one exception is the mount read,
 * which goes out before the page's project is known and is superseded by a
 * pinned read once it is (`PromptDocumentList`). Each returned function keeps
 * one identity until the pinned project changes — the dialogs hold the readers
 * in their effect dependencies.
 */
export function usePromptDocuments({ pin }: { pin?: TenantPin } = {}) {
  // Keyed on the project, not on the caller's object: a new `{ tenant }` for
  // the same project changes nothing below.
  const pinTenant = pin?.tenant;
  const projectPin = useMemo<TenantPin | undefined>(
    () => (pinTenant === undefined ? undefined : { tenant: pinTenant }),
    [pinTenant]
  );
  const [documents, setDocuments] = useState<PromptDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  /**
   * The project `documents` were read in: the read's pin, else the project
   * stored when it was sent (`null`: none). `undefined` until a read lands.
   */
  const [documentsTenant, setDocumentsTenant] = useState<
    string | null | undefined
  >(undefined);
  // Bumped by every read. Reads overlap (the mount read, each write's
  // re-read, a re-read in a newly selected project), and only the newest may
  // land: an older answer arriving last would put back rows from before —
  // possibly another project's.
  const listRequest = useRef(0);
  // The project the newest read was SENT in — the read that owns the list
  // once it answers (`undefined`: none sent yet).
  const listSentIn = useRef<string | null | undefined>(undefined);
  /** The project the newest list read was sent in, answered or not. */
  const newestReadTenant = useCallback(() => listSentIn.current, []);

  /**
   * Re-read the list. Resolves to what coord just served — the documents AND
   * its `degraded` reason, because a degraded answer can carry an empty list
   * that means "unknown", not "none" — or `null` when the read failed or a
   * newer read was sent before it answered. A caller that needs THIS read (the
   * adopt-all preview pins versions from it) is not left guessing whether state
   * has settled. `pin` sends it in the pinned project (`pinActiveTenant`: a
   * project id on every attempt; a `null` pin is not retried, though a
   * token-refresh replay re-reads the stored project); omitted, it goes in the
   * stored project.
   */
  const loadDocuments = useCallback(
    async (
      pin?: TenantPin
    ): Promise<{
      documents: PromptDocumentSummary[];
      degraded: string | null;
    } | null> => {
      const request = ++listRequest.current;
      const newest = () => request === listRequest.current;
      const tenant = pin ? pin.tenant : readActiveTenantId();
      listSentIn.current = tenant;
      try {
        setLoading(true);
        const data = await listPromptDocuments(pin);
        // Superseded: a newer read owns the list, and this caller gets no
        // answer rather than one that is no longer on screen.
        if (!newest()) return null;
        const items = (data.documents ?? [])
          .slice()
          .sort((a, b) =>
            (a.description ?? a.name).localeCompare(b.description ?? b.name)
          );
        setDocuments(items);
        setDocumentsTenant(tenant);
        setDegraded(data.degraded ?? null);
        setError(null);
        return { documents: items, degraded: data.degraded ?? null };
      } catch (err) {
        if (!newest()) return null;
        // Keep the last-good list on screen rather than blanking it; the banner
        // says the view is stale.
        setError(message(err, "Failed to load prompt documents"));
        return null;
      } finally {
        if (newest()) setLoading(false);
      }
    },
    []
  );

  // The mount read: UNPINNED, because it goes out before the page's project is
  // known. The page re-reads pinned once that project resolves, if this read
  // went out in a different one (`newestReadTenant`).
  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  /**
   * Re-read the list — in the pinned project unless the caller names another
   * (`loadDocuments`). Passing `undefined` takes the default too.
   */
  const reload = useCallback(
    (readPin: TenantPin | undefined = projectPin) => loadDocuments(readPin),
    [loadDocuments, projectPin]
  );

  /** Fetch one document WITH its body (the list omits bodies). */
  const fetchDocument = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string
    ): Promise<PromptDocument | null> => {
      try {
        return await fetchPromptDocument(kind, name, projectPin);
      } catch (err) {
        toast.error(message(err, "Failed to load document"));
        return null;
      }
    },
    [projectPin]
  );

  /** Version-history metadata, newest first. */
  const fetchVersions = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string
    ): Promise<ListVersionsResponse | null> => {
      try {
        return await listPromptDocumentVersions(kind, name, projectPin);
      } catch (err) {
        toast.error(message(err, "Failed to load version history"));
        return null;
      }
    },
    [projectPin]
  );

  /** One immutable version snapshot, body included — the diff's left side. */
  const fetchVersion = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      version: number
    ): Promise<PromptDocumentVersion | null> => {
      try {
        return await fetchPromptDocumentVersion(
          kind,
          name,
          version,
          projectPin
        );
      } catch (err) {
        toast.error(message(err, "Failed to load version"));
        return null;
      }
    },
    [projectPin]
  );

  /**
   * Create a new hand-authored document. Coord writes the row AND its version-1
   * snapshot; a duplicate `(kind, name)` is coord's 409. Returns the created
   * document (with body) on success so the caller can open it, else `null`.
   */
  const createDocument = useCallback(
    async (
      kind: PromptDocumentKind,
      data: PromptDocumentCreate
    ): Promise<PromptDocument | null> => {
      try {
        setSaving(true);
        const created = await createPromptDocument(kind, data, projectPin);
        toast.success(`Created "${created.description ?? created.name}"`);
        await loadDocuments(projectPin);
        return created;
      } catch (err) {
        toast.error(message(err, "Failed to create document"));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [loadDocuments, projectPin]
  );

  /** Save an edit. Coord snapshots a NEW version; nothing is overwritten. */
  const updateDocument = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      data: PromptDocumentUpdate
    ): Promise<boolean> => {
      try {
        setSaving(true);
        const updated = await updatePromptDocument(
          kind,
          name,
          data,
          projectPin
        );
        toast.success(`Saved as version ${updated.current_version}`);
        await loadDocuments(projectPin);
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to save document"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadDocuments, projectPin]
  );

  /** Re-seed from the code default. Itself an edit ⇒ a new version ⇒ undoable. */
  const restoreDefault = useCallback(
    async (kind: PromptDocumentKind, name: string): Promise<boolean> => {
      try {
        setSaving(true);
        await restorePromptDocumentDefault(kind, name, projectPin);
        toast.success("Restored to default");
        await loadDocuments(projectPin);
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to restore default"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadDocuments, projectPin]
  );

  /**
   * Roll the document back to an earlier version (plan
   * `2026-07-30-session-compliance-report-enforcement.md` §B1).
   *
   * Distinct from {@link restoreDefault}, which re-seeds the shipped code
   * default: this restores an arbitrary prior SNAPSHOT, which is what "undo
   * that edit" means. Coord copies that version's body forward as a NEW
   * version — **history is never rewritten**, so the restore is itself
   * reversible and the version restored from stays readable.
   *
   * `change_note` is recorded on the new snapshot; the editor is stamped by
   * coord from its authenticated operator context, never asserted here.
   */
  const restoreVersion = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      version: number,
      changeNote?: string
    ): Promise<boolean> => {
      try {
        setSaving(true);
        await restorePromptDocumentVersion(
          kind,
          name,
          version,
          changeNote,
          projectPin
        );
        toast.success(`Restored version ${version} as a new version`);
        await loadDocuments(projectPin);
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to restore that version"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadDocuments, projectPin]
  );

  return {
    documents,
    documentsTenant,
    newestReadTenant,
    loading,
    saving,
    error,
    degraded,
    reload,
    fetchDocument,
    fetchVersions,
    fetchVersion,
    createDocument,
    updateDocument,
    restoreDefault,
    restoreVersion,
  };
}

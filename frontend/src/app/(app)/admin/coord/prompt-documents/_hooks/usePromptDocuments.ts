"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  ListPromptDocumentsResponse,
  ListVersionsResponse,
  PromptDocument,
  PromptDocumentCreate,
  PromptDocumentKind,
  PromptDocumentSummary,
  PromptDocumentUpdate,
  PromptDocumentVersion,
} from "../types";

const API = "/api/v1/operations";

/** `/coord/prompt-documents/:kind/:name`, each segment encoded. */
function docPath(kind: PromptDocumentKind, name: string): string {
  return `${API}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}`;
}

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
 */
export function usePromptDocuments() {
  const [documents, setDocuments] = useState<PromptDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await httpClient.get<ListPromptDocumentsResponse>(
        `${API}/coord/prompt-documents`
      );
      const items = (data.documents ?? [])
        .slice()
        .sort((a, b) => (a.description ?? a.name).localeCompare(b.description ?? b.name));
      setDocuments(items);
      setDegraded(data.degraded ?? null);
      setError(null);
    } catch (err) {
      // Keep the last-good list on screen rather than blanking it; the banner
      // says the view is stale.
      setError(message(err, "Failed to load prompt documents"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  /** Fetch one document WITH its body (the list omits bodies). */
  const fetchDocument = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string
    ): Promise<PromptDocument | null> => {
      try {
        return await httpClient.get<PromptDocument>(docPath(kind, name));
      } catch (err) {
        toast.error(message(err, "Failed to load document"));
        return null;
      }
    },
    []
  );

  /** Version-history metadata, newest first. */
  const fetchVersions = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string
    ): Promise<ListVersionsResponse | null> => {
      try {
        return await httpClient.get<ListVersionsResponse>(
          `${docPath(kind, name)}/versions`
        );
      } catch (err) {
        toast.error(message(err, "Failed to load version history"));
        return null;
      }
    },
    []
  );

  /** One immutable version snapshot, body included — the diff's left side. */
  const fetchVersion = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      version: number
    ): Promise<PromptDocumentVersion | null> => {
      try {
        return await httpClient.get<PromptDocumentVersion>(
          `${docPath(kind, name)}/versions/${version}`
        );
      } catch (err) {
        toast.error(message(err, "Failed to load version"));
        return null;
      }
    },
    []
  );

  /**
   * Create a new hand-authored document. Coord writes the row AND its version-1
   * snapshot; a duplicate `(kind, name)` is coord's 409. Returns the created
   * document (with body) on success so the caller can open it, else `null`.
   */
  const createDocument = async (
    kind: PromptDocumentKind,
    data: PromptDocumentCreate
  ): Promise<PromptDocument | null> => {
    try {
      setSaving(true);
      const created = await httpClient.post<PromptDocument>(
        `${API}/coord/prompt-documents/${encodeURIComponent(kind)}`,
        data
      );
      toast.success(`Created "${created.description ?? created.name}"`);
      await loadDocuments();
      return created;
    } catch (err) {
      toast.error(message(err, "Failed to create document"));
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** Save an edit. Coord snapshots a NEW version; nothing is overwritten. */
  const updateDocument = async (
    kind: PromptDocumentKind,
    name: string,
    data: PromptDocumentUpdate
  ): Promise<boolean> => {
    try {
      setSaving(true);
      const updated = await httpClient.patch<PromptDocument>(
        docPath(kind, name),
        data
      );
      toast.success(`Saved as version ${updated.current_version}`);
      await loadDocuments();
      return true;
    } catch (err) {
      toast.error(message(err, "Failed to save document"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Re-seed from the code default. Itself an edit ⇒ a new version ⇒ undoable. */
  const restoreDefault = async (
    kind: PromptDocumentKind,
    name: string
  ): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.post(`${docPath(kind, name)}/restore-default`, {});
      toast.success("Restored to default");
      await loadDocuments();
      return true;
    } catch (err) {
      toast.error(message(err, "Failed to restore default"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    documents,
    loading,
    saving,
    error,
    degraded,
    reload: loadDocuments,
    fetchDocument,
    fetchVersions,
    fetchVersion,
    createDocument,
    updateDocument,
    restoreDefault,
  };
}

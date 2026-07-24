"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  Clause,
  ClauseCreate,
  ClauseUpdate,
  ListClausesResponse,
  PromptDocumentAttrs,
  PromptDocumentKind,
} from "../types";

const API = "/api/v1/operations";

/** `/coord/prompt-documents/:kind/:name/clauses`, each segment encoded. */
function clausesPath(kind: PromptDocumentKind, name: string): string {
  return `${API}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}/clauses`;
}

function docPath(kind: PromptDocumentKind, name: string): string {
  return `${API}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}`;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function unwrap(data: ListClausesResponse): Clause[] {
  const list = Array.isArray(data) ? data : (data?.clauses ?? []);
  return list.slice().sort((a, b) => a.position - b.position);
}

/**
 * Loads and mutates the structured clauses of a single policy document via the
 * coord clause-route proxy
 * (`/api/v1/operations/coord/prompt-documents/:kind/:name/clauses`). Reads gate
 * on tenant membership; writes are tenant-admin-gated (coord re-checks).
 *
 * Only meaningful for `kind === "policy"` documents; the caller passes `enabled`
 * false for other kinds so the hook doesn't fetch. `onAttrsSaved` lets the caller
 * (which owns the document list) refresh after a category default-tier edit.
 */
export function useClauses(
  kind: PromptDocumentKind,
  name: string,
  enabled: boolean,
  onAttrsSaved?: () => void
) {
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !name) return;
    try {
      setLoading(true);
      const data = await httpClient.get<ListClausesResponse>(
        clausesPath(kind, name)
      );
      setClauses(unwrap(data));
      setError(null);
    } catch (err) {
      setError(message(err, "Failed to load clauses"));
    } finally {
      setLoading(false);
    }
  }, [enabled, kind, name]);

  useEffect(() => {
    void load();
  }, [load]);

  const createClause = async (body: ClauseCreate): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.post(clausesPath(kind, name), body);
      toast.success("Clause created");
      await load();
      return true;
    } catch (err) {
      toast.error(message(err, "Failed to create clause"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateClause = async (
    clauseId: string,
    body: ClauseUpdate
  ): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.patch(
        `${clausesPath(kind, name)}/${encodeURIComponent(clauseId)}`,
        body
      );
      toast.success("Clause updated");
      await load();
      return true;
    } catch (err) {
      toast.error(message(err, "Failed to update clause"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteClause = async (clauseId: string): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.delete(
        `${clausesPath(kind, name)}/${encodeURIComponent(clauseId)}`
      );
      toast.success("Clause deleted");
      await load();
      return true;
    } catch (err) {
      toast.error(message(err, "Failed to delete clause"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Persist a new order (array of clause_ids). Optimistic: re-fetches after. */
  const reorderClauses = async (clauseIds: string[]): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.post(`${clausesPath(kind, name)}/reorder`, {
        clause_ids: clauseIds,
      });
      await load();
      return true;
    } catch (err) {
      toast.error(message(err, "Failed to reorder clauses"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Insert a batch of imported draft clauses (from a pasted `POLICY_CANDIDATES`
   * YAML block). Each is POSTed individually so coord validates every one; a
   * duplicate `clause_id` (409) fails just that clause and is reported. Returns
   * the count actually created.
   */
  const importCandidates = async (
    candidates: ClauseCreate[]
  ): Promise<number> => {
    let created = 0;
    const failures: string[] = [];
    try {
      setSaving(true);
      for (const c of candidates) {
        try {
          await httpClient.post(clausesPath(kind, name), c);
          created += 1;
        } catch (err) {
          failures.push(`${c.clause_id}: ${message(err, "rejected")}`);
        }
      }
      if (created > 0) {
        toast.success(
          `Imported ${created} clause${created === 1 ? "" : "s"} as proposed`
        );
      }
      if (failures.length > 0) {
        toast.error(
          `${failures.length} clause(s) not imported: ${failures.join("; ")}`
        );
      }
      await load();
    } finally {
      setSaving(false);
    }
    return created;
  };

  /**
   * Edit the parent document's `attrs` (the category header editor writes
   * `default_tier` here) via the prompt-document PATCH proxy. The merge is
   * CLIENT-side — `ClauseManagerDialog` spreads `document.attrs` before
   * overwriting keys — and the merged object is forwarded verbatim; the server
   * REPLACES the stored attrs object with it wholesale.
   */
  const saveAttrs = async (attrs: PromptDocumentAttrs): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.patch(docPath(kind, name), { attrs });
      toast.success("Category settings saved");
      onAttrsSaved?.();
      return true;
    } catch (err) {
      toast.error(message(err, "Failed to save category settings"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    clauses,
    loading,
    saving,
    error,
    reload: load,
    createClause,
    updateClause,
    deleteClause,
    reorderClauses,
    importCandidates,
    saveAttrs,
  };
}

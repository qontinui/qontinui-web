"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { TenantPin } from "@/services/http-client";
import {
  createPromptDocumentClause,
  deletePromptDocumentClause,
  listPromptDocumentClauses,
  reorderPromptDocumentClauses,
  updatePromptDocumentAttrs,
  updatePromptDocumentClause,
} from "@/lib/api/operations/coordPromptDocuments";
import type {
  Clause,
  ClauseCreate,
  ClauseUpdate,
  ListClausesResponse,
  PromptDocumentAttrs,
  PromptDocumentKind,
} from "../types";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function unwrap(data: ListClausesResponse): Clause[] {
  const list = Array.isArray(data) ? data : (data?.clauses ?? []);
  return list.slice().sort((a, b) => a.position - b.position);
}

/** What `useClauses` is told beyond the document it manages. */
export interface UseClausesOptions {
  /**
   * Called after a category default-tier edit, so the caller (which owns the
   * document list) can re-read it.
   */
  onAttrsSaved?: () => void;
  /**
   * Checked before every write; `false` sends nothing (the caller says why).
   * The prompt-documents page passes its cross-tab guard here, so a clause
   * write raced past the page's notice is refused.
   */
  canWrite?: () => boolean;
  /**
   * The project the clause read and every write are sent in, on every attempt
   * (`pinActiveTenant`) — the page's own, so a write in flight when another tab
   * switches project cannot be re-issued into that project. Omitted, each
   * request goes in the project stored when it is sent.
   */
  pin?: TenantPin;
}

/**
 * Loads and mutates the structured clauses of a single policy document via the
 * coord clause-route proxy
 * (`coord/prompt-documents/:kind/:name/clauses` under `/operations`). Reads gate
 * on tenant membership; writes are tenant-admin-gated (coord re-checks).
 *
 * Only meaningful for `kind === "policy"` documents; the caller passes `enabled`
 * false for other kinds so the hook doesn't fetch. See {@link UseClausesOptions}
 * for the re-read, write-guard and pin the caller hands in.
 */
export function useClauses(
  kind: PromptDocumentKind,
  name: string,
  enabled: boolean,
  { onAttrsSaved, canWrite, pin }: UseClausesOptions = {}
) {
  // Keyed on the project, not on the caller's object: the clause read below
  // re-fires only when the pinned project actually changes.
  const pinTenant = pin?.tenant;
  const projectPin = useMemo<TenantPin | undefined>(
    () => (pinTenant === undefined ? undefined : { tenant: pinTenant }),
    [pinTenant]
  );
  const blocked = () => canWrite !== undefined && !canWrite();
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !name) return;
    try {
      setLoading(true);
      const data = await listPromptDocumentClauses(kind, name, projectPin);
      setClauses(unwrap(data));
      setError(null);
    } catch (err) {
      setError(message(err, "Failed to load clauses"));
    } finally {
      setLoading(false);
    }
  }, [enabled, kind, name, projectPin]);

  useEffect(() => {
    void load();
  }, [load]);

  const createClause = async (body: ClauseCreate): Promise<boolean> => {
    if (blocked()) return false;
    try {
      setSaving(true);
      await createPromptDocumentClause(kind, name, body, projectPin);
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
    if (blocked()) return false;
    try {
      setSaving(true);
      await updatePromptDocumentClause(kind, name, clauseId, body, projectPin);
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
    if (blocked()) return false;
    try {
      setSaving(true);
      await deletePromptDocumentClause(kind, name, clauseId, projectPin);
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
    if (blocked()) return false;
    try {
      setSaving(true);
      await reorderPromptDocumentClauses(kind, name, clauseIds, projectPin);
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
    let refused = false;
    const failures: string[] = [];
    try {
      setSaving(true);
      for (const c of candidates) {
        // Before EVERY create, not once before the loop: the project can be
        // switched in another tab while an import is part-way through, and
        // the rest of it would land there. What was already created stays.
        if (blocked()) {
          refused = true;
          break;
        }
        try {
          await createPromptDocumentClause(kind, name, c, projectPin);
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
      // The re-read shows what the run created. A refused run takes it only
      // when it is pinned to a NAMED project: unpinned — or pinned to `null`,
      // which sends no header, so the client fills in the stored project — it
      // would be served by the project the other tab stored, not this page's.
      if (!refused || projectPin?.tenant != null) await load();
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
    if (blocked()) return false;
    try {
      setSaving(true);
      // Safe to re-issue (`idempotent: true` in the client):
      // `update_prompt_document` replaces attrs in place with the merged
      // object; an attrs-only edit creates no version row.
      await updatePromptDocumentAttrs(kind, name, attrs, projectPin);
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

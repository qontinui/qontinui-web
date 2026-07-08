"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  ListPolicyDocumentsResponse,
  PolicyDocument,
  PolicyDocumentUpdate,
} from "../types";

const API = "/api/v1/operations";

/**
 * Loads and mutates the tenant's policy documents (coord's editable canonical
 * policy prose) via the coord-proxy
 * (`/api/v1/operations/coord/policy-documents`). Reads are visible to any tenant
 * member; the PATCH/restore writes are re-checked as tenant-admin by coord.
 *
 * The coord `get_list` route seeds the canonical documents on first touch, so a
 * fresh tenant sees the full set immediately.
 */
export function usePolicyDocuments() {
  const [documents, setDocuments] = useState<PolicyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await httpClient.get<ListPolicyDocumentsResponse>(
        `${API}/coord/policy-documents`
      );
      const items = (data.documents ?? [])
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title));
      setDocuments(items);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load policy documents"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const updateDocument = async (
    handle: string,
    data: PolicyDocumentUpdate
  ): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.patch(
        `${API}/coord/policy-documents/${encodeURIComponent(handle)}`,
        data
      );
      toast.success("Document saved");
      await loadDocuments();
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save document"
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const restoreDefault = async (handle: string): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.post(
        `${API}/coord/policy-documents/${encodeURIComponent(handle)}/restore-default`,
        {}
      );
      toast.success("Restored to default");
      await loadDocuments();
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to restore default"
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    documents,
    loading,
    saving,
    reload: loadDocuments,
    updateDocument,
    restoreDefault,
  };
}

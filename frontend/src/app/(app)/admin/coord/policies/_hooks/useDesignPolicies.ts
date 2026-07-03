"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/design-policies";

export type Severity = "info" | "warning" | "error";

export interface DesignPolicy {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  principle: string;
  rationale: string;
  enforcement: string;
  category: string;
  severity: Severity;
  applies_to: string;
  is_built_in: boolean;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DesignPolicyCreate {
  slug: string;
  name: string;
  principle: string;
  rationale: string;
  enforcement: string;
  category: string;
  severity: Severity;
  applies_to: string;
  sort_order: number;
  enabled: boolean;
}

export type DesignPolicyUpdate = Partial<Omit<DesignPolicyCreate, "slug">>;

interface ListResponse {
  items: DesignPolicy[];
  count: number;
}

/**
 * Loads and mutates tenant-scoped design/UX policies via the first-party
 * `/api/v1/design-policies` endpoint. Reads are open to any tenant member;
 * writes require tenant admin (enforced server-side). Built-ins are seeded on
 * first read and cannot be deleted (only disabled/edited).
 */
export function useDesignPolicies() {
  const [policies, setPolicies] = useState<DesignPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await httpClient.get<ListResponse>(`${API}/`);
      setPolicies(data.items ?? []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load design policies"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (data: DesignPolicyCreate): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.post(`${API}/`, data);
      toast.success("Policy created");
      await load();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create policy");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const update = async (
    id: string,
    data: DesignPolicyUpdate
  ): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.put(`${API}/${encodeURIComponent(id)}`, data);
      toast.success("Policy updated");
      await load();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update policy");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.delete(`${API}/${encodeURIComponent(id)}`);
      toast.success("Policy deleted");
      await load();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete policy");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const reset = async (): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.post(`${API}/reset`, {});
      toast.success("Policies reset to defaults");
      await load();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset policies");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { policies, loading, saving, reload: load, create, update, remove, reset };
}

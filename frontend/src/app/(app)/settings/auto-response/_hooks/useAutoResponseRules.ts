import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import type {
  AutoResponseRule,
  AutoResponseRuleCreate,
  AutoResponseRuleUpdate,
} from "../types";

/**
 * Loads and mutates the fleet-wide (per-organization) auto-response rules.
 *
 * Mirrors the loading/saving + toast handling used by useAgenticSettings,
 * but talks to the cloud backend via `apiClient` (not the local runnerApi).
 */
export function useAutoResponseRules(orgId: string | null) {
  const [rules, setRules] = useState<AutoResponseRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadRules = useCallback(async () => {
    if (!orgId) {
      setRules([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const items = await apiClient.getAutoResponseRules(orgId);
      // Keep rows in their persisted order.
      items.sort((a, b) => a.sort_order - b.sort_order);
      setRules(items);
    } catch {
      toast.error("Failed to load auto-response rules");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const createRule = async (
    data: AutoResponseRuleCreate
  ): Promise<boolean> => {
    if (!orgId) return false;
    try {
      setSaving(true);
      const created = await apiClient.createAutoResponseRule(orgId, data);
      setRules((prev) =>
        [...prev, created].sort((a, b) => a.sort_order - b.sort_order)
      );
      toast.success("Rule created");
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create rule"
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateRule = async (
    id: string,
    data: AutoResponseRuleUpdate
  ): Promise<boolean> => {
    if (!orgId) return false;
    try {
      setSaving(true);
      const updated = await apiClient.updateAutoResponseRule(orgId, id, data);
      setRules((prev) =>
        prev.map((r) => (r.id === id ? updated : r))
      );
      toast.success("Rule updated");
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update rule"
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (id: string): Promise<boolean> => {
    if (!orgId) return false;
    try {
      setSaving(true);
      await apiClient.deleteAutoResponseRule(orgId, id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success("Rule deleted");
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete rule"
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Persist a new ordering. Optimistically applies, reverts on failure. */
  const reorderRules = async (orderedIds: string[]): Promise<boolean> => {
    if (!orgId) return false;
    const previous = rules;
    // Optimistic reorder.
    const byId = new Map(rules.map((r) => [r.id, r]));
    const optimistic = orderedIds
      .map((id) => byId.get(id))
      .filter((r): r is AutoResponseRule => r !== undefined);
    setRules(optimistic);
    try {
      setSaving(true);
      const items = await apiClient.reorderAutoResponseRules(orgId, orderedIds);
      items.sort((a, b) => a.sort_order - b.sort_order);
      setRules(items);
      return true;
    } catch (err) {
      setRules(previous);
      toast.error(
        err instanceof Error ? err.message : "Failed to reorder rules"
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    rules,
    loading,
    saving,
    reload: loadRules,
    createRule,
    updateRule,
    deleteRule,
    reorderRules,
  };
}

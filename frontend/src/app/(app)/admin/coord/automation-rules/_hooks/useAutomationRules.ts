"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  ListPoliciesResponse,
  PolicyCreate,
  PolicyRow,
  PolicyUpdate,
  RuleKind,
} from "../types";

const API = "/api/v1/operations";

/** The two policy kinds the Automation Rules surface authors. */
const AUTHORED_KINDS: ReadonlySet<string> = new Set<RuleKind>([
  "terminal_auto_response",
  "question_auto_answer",
]);

/**
 * Loads and mutates tenant-scoped automation rules (coord policies) via the
 * tenant-admin coord-proxy (`/api/v1/operations/coord/policies`). The unified
 * replacement for the org-scoped `useAutoResponseRules` hook (#580, deleted in
 * the Phase 5 cutover): no `organizationService`/`useOrganization` — the
 * coord-proxy resolves the tenant from the operator bearer.
 *
 * The list is filtered to the two kinds this surface authors
 * (`terminal_auto_response`, `question_auto_answer`) so it doesn't show the
 * deterministic/guidance rows managed elsewhere (Policies page).
 */
export function useAutomationRules() {
  const [rules, setRules] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      setLoading(true);
      // List ALL enabled states (enabled=false param surfaces disabled rows too).
      const data = await httpClient.get<ListPoliciesResponse>(
        `${API}/coord/policies`
      );
      const items = (data.policies ?? [])
        .filter((p) => p.kind !== null && AUTHORED_KINDS.has(p.kind))
        .sort((a, b) => b.priority - a.priority);
      setRules(items);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load automation rules"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const createRule = async (data: PolicyCreate): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.post(`${API}/coord/policies`, data);
      toast.success("Rule created");
      await loadRules();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create rule");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateRule = async (
    policyId: string,
    data: PolicyUpdate
  ): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.patch(
        `${API}/coord/policies/${encodeURIComponent(policyId)}`,
        data
      );
      toast.success("Rule updated");
      await loadRules();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update rule");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (policyId: string): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.delete(
        `${API}/coord/policies/${encodeURIComponent(policyId)}`
      );
      toast.success("Rule deleted");
      await loadRules();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete rule");
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Upsert THIS tenant's override of a system built-in rule. `body` is either
   * `{ disabled }` (turn the built-in off/on for this tenant) or a full
   * customized policy body (replace it with the tenant's own version). Targets
   * `PUT /coord/policies/system/:systemRuleId/override`.
   */
  const overrideRule = async (
    systemRuleId: string,
    body: { disabled: boolean } | PolicyCreate
  ): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.put(
        `${API}/coord/policies/system/${encodeURIComponent(systemRuleId)}/override`,
        body
      );
      toast.success("Built-in updated for your workspace");
      await loadRules();
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update built-in"
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Revert THIS tenant's override of a system built-in rule (disable OR
   * customize) back to the built-in default. Targets
   * `DELETE /coord/policies/system/:systemRuleId/override`.
   */
  const revertOverride = async (systemRuleId: string): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.delete(
        `${API}/coord/policies/system/${encodeURIComponent(systemRuleId)}/override`
      );
      toast.success("Reverted to built-in");
      await loadRules();
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to revert to built-in"
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
    overrideRule,
    revertOverride,
  };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  Condition,
  ConditionCreate,
  ConditionGroup,
  ConditionGroupCreate,
  ConditionGroupDetail,
  ConditionGroupUpdate,
  ConditionRun,
  ConditionUpdate,
  RunTriggerResponse,
} from "../types";

const API = "/api/v1/conditions";

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Loads and mutates the tenant's condition groups (regression tests) via the
 * backend proxy (`/api/v1/conditions/*`). Mirrors the automation-rules data
 * layer: httpClient GET/POST/PATCH/DELETE, `loading`/`saving` flags, a toast on
 * every success/error, and a reload-after-mutate so the list always reflects
 * server truth.
 *
 * `saving` is a single shared in-flight flag across every mutation (create,
 * update, delete, add/move/reorder condition, run-now) — good enough to disable
 * controls while any write is pending.
 */
export function useConditions() {
  const [groups, setGroups] = useState<ConditionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      const data = await httpClient.get<ConditionGroup[]>(`${API}/groups`);
      const items = [...(data ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      setGroups(items);
    } catch (err) {
      toast.error(errMsg(err, "Failed to load condition groups"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // --- Group detail (conditions) -------------------------------------------

  /** Fetch a single group plus its ordered conditions. */
  const getGroupDetail = useCallback(
    async (groupId: string): Promise<ConditionGroupDetail | null> => {
      try {
        return await httpClient.get<ConditionGroupDetail>(
          `${API}/groups/${encodeURIComponent(groupId)}`
        );
      } catch (err) {
        toast.error(errMsg(err, "Failed to load conditions"));
        return null;
      }
    },
    []
  );

  // --- Group CRUD ----------------------------------------------------------

  const createGroup = async (data: ConditionGroupCreate): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.post(`${API}/groups`, data);
      toast.success("Group created");
      await loadGroups();
      return true;
    } catch (err) {
      toast.error(errMsg(err, "Failed to create group"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = async (
    groupId: string,
    data: ConditionGroupUpdate
  ): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.patch(
        `${API}/groups/${encodeURIComponent(groupId)}`,
        data
      );
      toast.success("Group updated");
      await loadGroups();
      return true;
    } catch (err) {
      toast.error(errMsg(err, "Failed to update group"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async (groupId: string): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.delete(`${API}/groups/${encodeURIComponent(groupId)}`);
      toast.success("Group deleted");
      await loadGroups();
      return true;
    } catch (err) {
      toast.error(errMsg(err, "Failed to delete group"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // --- Condition CRUD / move / reorder -------------------------------------

  const addCondition = async (
    groupId: string,
    data: ConditionCreate
  ): Promise<Condition | null> => {
    try {
      setSaving(true);
      const created = await httpClient.post<Condition>(
        `${API}/groups/${encodeURIComponent(groupId)}/conditions`,
        data
      );
      toast.success("Condition added");
      await loadGroups();
      return created;
    } catch (err) {
      toast.error(errMsg(err, "Failed to add condition"));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const updateCondition = async (
    conditionId: string,
    data: ConditionUpdate
  ): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.patch(
        `${API}/items/${encodeURIComponent(conditionId)}`,
        data
      );
      // A `group_id` change is a MOVE — surface it distinctly.
      toast.success(
        data.group_id !== undefined ? "Condition moved" : "Condition updated"
      );
      await loadGroups();
      return true;
    } catch (err) {
      toast.error(errMsg(err, "Failed to update condition"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteCondition = async (conditionId: string): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.delete(
        `${API}/items/${encodeURIComponent(conditionId)}`
      );
      toast.success("Condition deleted");
      await loadGroups();
      return true;
    } catch (err) {
      toast.error(errMsg(err, "Failed to delete condition"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Renumber a group's conditions to `conditionIds` order (top to bottom).
   * The backend requires the exact current set and renumbers `position` 0..n
   * atomically — no toast on success (reorder is a quiet, frequent action).
   */
  const reorderConditions = async (
    groupId: string,
    conditionIds: string[]
  ): Promise<boolean> => {
    try {
      setSaving(true);
      await httpClient.post(
        `${API}/groups/${encodeURIComponent(groupId)}/reorder`,
        { condition_ids: conditionIds }
      );
      await loadGroups();
      return true;
    } catch (err) {
      toast.error(errMsg(err, "Failed to reorder conditions"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // --- Runs ----------------------------------------------------------------

  const runGroup = async (
    groupId: string
  ): Promise<RunTriggerResponse | null> => {
    try {
      setSaving(true);
      const res = await httpClient.post<RunTriggerResponse>(
        `${API}/groups/${encodeURIComponent(groupId)}/run`
      );
      toast.success(`Run started (${res.run_id})`);
      // Optimistically reflect the running state; a subsequent reload will
      // settle the terminal status.
      setGroups((prev) =>
        prev.map((g) =>
          g.group_id === groupId ? { ...g, last_status: "running" } : g
        )
      );
      return res;
    } catch (err) {
      toast.error(errMsg(err, "Failed to start run"));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const listRuns = useCallback(
    async (groupId: string): Promise<ConditionRun[]> => {
      try {
        const data = await httpClient.get<ConditionRun[]>(
          `${API}/groups/${encodeURIComponent(groupId)}/runs`
        );
        return data ?? [];
      } catch (err) {
        toast.error(errMsg(err, "Failed to load run history"));
        return [];
      }
    },
    []
  );

  const getRun = useCallback(
    async (runId: string): Promise<ConditionRun | null> => {
      try {
        return await httpClient.get<ConditionRun>(
          `${API}/runs/${encodeURIComponent(runId)}`
        );
      } catch (err) {
        toast.error(errMsg(err, "Failed to load run details"));
        return null;
      }
    },
    []
  );

  return {
    groups,
    loading,
    saving,
    reload: loadGroups,
    getGroupDetail,
    createGroup,
    updateGroup,
    deleteGroup,
    addCondition,
    updateCondition,
    deleteCondition,
    reorderConditions,
    runGroup,
    listRuns,
    getRun,
  };
}

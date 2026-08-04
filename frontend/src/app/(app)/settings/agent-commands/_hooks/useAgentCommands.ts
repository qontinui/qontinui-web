"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  deleteAgentCommandOverride,
  listAgentCommandVersions,
  listAgentCommands,
  revertAgentCommand,
  upsertAgentCommand,
  type AgentCommand,
  type AgentCommandVersion,
} from "@/lib/api/agent-commands";
import { buildCommandRows, type CommandRow } from "../types";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Data hook for `/settings/agent-commands`.
 *
 * Shape mirrors `settings/agentic/_hooks/useAgenticSettings.ts`: the hook owns
 * every request and every piece of transient state, the page owns layout only.
 *
 * Two things it deliberately does NOT do:
 *
 * 1. It never invents a "default" body. The backend stores no default row (the
 *    bodies live in the runner binary), so a command with no override has
 *    `override === null` and the editor starts blank.
 * 2. It never optimistically patches local state after a write. Every mutation
 *    re-fetches, so what the page shows is what the server recorded — the same
 *    honesty rule `/settings/agents` follows.
 */
export function useAgentCommands() {
  const [overrides, setOverrides] = useState<AgentCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedName, setSelectedName] = useState<string | null>(null);

  const [draftBody, setDraftBody] = useState("");
  const [changeDescription, setChangeDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [versions, setVersions] = useState<AgentCommandVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const [busyAction, setBusyAction] = useState<"revert" | "reset" | null>(null);

  const rows = useMemo(() => buildCommandRows(overrides), [overrides]);

  const selected: CommandRow | null = useMemo(() => {
    if (!selectedName) return null;
    const found = rows.find((row) => row.name === selectedName);
    if (found) return found;
    // A name the user typed that is neither a known-embedded command nor an
    // existing override. It is still editable — the command set is open, and
    // the backend keys on `(organization_id, name)` with no allow-list — so
    // synthesize a `Default` row rather than refusing.
    return {
      name: selectedName,
      provenance: "default",
      override: null,
    } satisfies CommandRow;
  }, [rows, selectedName]);

  const refreshCommands = useCallback(async (): Promise<AgentCommand[]> => {
    const body = await listAgentCommands();
    const items = body.items ?? [];
    setOverrides(items);
    return items;
  }, []);

  useEffect(() => {
    refreshCommands()
      .catch((err: unknown) => {
        setLoadError(errorMessage(err, "Failed to load agent commands"));
      })
      .finally(() => setLoading(false));
  }, [refreshCommands]);

  const refreshVersions = useCallback(async (name: string) => {
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const body = await listAgentCommandVersions(name);
      setVersions(body.items ?? []);
    } catch (err) {
      setVersions([]);
      setVersionsError(errorMessage(err, "Failed to load version history"));
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  /** Select a command and seed the editor from the server's stored body. A
   *  command with no override seeds BLANK — there is no default to load. */
  const selectCommand = useCallback(
    (name: string) => {
      setSelectedName(name);
      setChangeDescription("");
      setVersions([]);
      setVersionsError(null);

      const override = overrides.find((c) => c.name === name) ?? null;
      setDraftBody(override?.body ?? "");
      if (override) {
        void refreshVersions(name);
      }
    },
    [overrides, refreshVersions]
  );

  const clearSelection = useCallback(() => {
    setSelectedName(null);
    setDraftBody("");
    setChangeDescription("");
    setVersions([]);
    setVersionsError(null);
  }, []);

  /** Save the draft as a new version (creating the override if absent). */
  const saveDraft = useCallback(async () => {
    if (!selectedName) return;
    if (!draftBody.trim()) {
      toast.error("The command body is empty — nothing to save.");
      return;
    }

    setSaving(true);
    try {
      const saved = await upsertAgentCommand({
        name: selectedName,
        body: draftBody,
        change_description: changeDescription.trim() || null,
      });
      await refreshCommands();
      await refreshVersions(selectedName);
      setChangeDescription("");
      toast.success(
        `Saved ${selectedName} as version ${saved.current_version}. ` +
          "Newly spawned sessions pick it up; sessions already running keep the body they started with."
      );
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save the command"));
    } finally {
      setSaving(false);
    }
  }, [
    selectedName,
    draftBody,
    changeDescription,
    refreshCommands,
    refreshVersions,
  ]);

  /**
   * Revert to an earlier version. The backend APPENDS a new head whose body
   * equals the target's, so the UI re-reads and shows the new head number —
   * never a rewind to `versionNumber`.
   */
  const revertToVersion = useCallback(
    async (versionNumber: number) => {
      if (!selectedName) return;
      setBusyAction("revert");
      try {
        const head = await revertAgentCommand(selectedName, versionNumber);
        const items = await refreshCommands();
        await refreshVersions(selectedName);
        const fresh = items.find((c) => c.name === selectedName);
        setDraftBody(fresh?.body ?? head.body);
        toast.success(
          `Reverted to v${versionNumber} — written as new version ${head.current_version}. ` +
            "History is unchanged; nothing was rewound."
        );
      } catch (err) {
        toast.error(errorMessage(err, "Failed to revert"));
      } finally {
        setBusyAction(null);
      }
    },
    [selectedName, refreshCommands, refreshVersions]
  );

  /**
   * Delete the override so the runner's embedded default applies again.
   *
   * This CASCADES the version chain — the confirmation dialog says so, because
   * it is not recoverable from this app.
   */
  const resetToDefault = useCallback(async () => {
    if (!selectedName) return;
    setBusyAction("reset");
    try {
      await deleteAgentCommandOverride(selectedName);
      await refreshCommands();
      setVersions([]);
      setVersionsError(null);
      setDraftBody("");
      setChangeDescription("");
      toast.success(
        `Removed the ${selectedName} override. Newly spawned sessions get the runner's embedded default again.`
      );
    } catch (err) {
      toast.error(errorMessage(err, "Failed to reset to default"));
    } finally {
      setBusyAction(null);
    }
  }, [selectedName, refreshCommands]);

  const retryLoad = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    refreshCommands()
      .catch((err: unknown) => {
        setLoadError(errorMessage(err, "Failed to load agent commands"));
      })
      .finally(() => setLoading(false));
  }, [refreshCommands]);

  /** True when the editor holds unsaved changes relative to the stored body. */
  const isDirty = useMemo(() => {
    if (!selected) return false;
    return draftBody !== (selected.override?.body ?? "");
  }, [selected, draftBody]);

  return {
    rows,
    loading,
    loadError,
    retryLoad,

    selected,
    selectCommand,
    clearSelection,

    draftBody,
    setDraftBody,
    changeDescription,
    setChangeDescription,
    isDirty,
    saving,
    saveDraft,

    versions,
    versionsLoading,
    versionsError,

    busyAction,
    revertToVersion,
    resetToDefault,
  };
}

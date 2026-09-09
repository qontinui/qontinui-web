"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  deleteAgentTextUnit,
  getAgentTextUnitDefaults,
  listAgentTextUnitVersions,
  listAgentTextUnits,
  revertAgentTextUnit,
  upsertAgentTextUnit,
  type AgentTextUnit,
  type AgentTextUnitDefaultsResponse,
  type AgentTextUnitVersion,
  type LayerRef,
  type UnitFiles,
} from "@/lib/api/agent-text-units";
import {
  entrypointFor,
  isCopySourceName,
  validateRelativePath,
  type UnitKindConfig,
  type UnitRow,
  type WritableLayer,
} from "../types";
import { buildUnitRows } from "../_lib/unitRows";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** The API's per-page ceiling. The corpus is ~90 units today, so one page
 *  covers it; the hook still reads `has_more` and says so rather than
 *  silently showing a truncated corpus. */
const PAGE_LIMIT = 500;

export type BusyAction = "revert" | "delete" | null;

export interface UseAgentTextUnitsOptions {
  config: UnitKindConfig;
  /**
   * Whether this user may WRITE the fleet-default layer. The backend gates it
   * on superuser and will 403 regardless; this is what stops the UI offering a
   * button that cannot work.
   */
  canWriteFleet: boolean;
}

/**
 * Data hook for the agent text-unit console, over ONE kind.
 *
 * Three things it deliberately does:
 *
 * 1. **Fetches the two stored layers separately** rather than the server's
 *    resolved view. The resolved view is the right shape for the runner and
 *    the wrong shape for an operator: it drops a fleet default the account has
 *    overridden, which is exactly the row that tells you fleet edits are no
 *    longer reaching this account.
 * 2. **Never invents an embedded body.** A unit stored at neither layer has
 *    `resolved === null` and the editor starts blank. What it CAN show is the
 *    copy a runner PUBLISHED to this account (`GET /defaults`, the third
 *    fetch) — carried on each row as `embedded`, labelled by the build that
 *    published it, and offered as a starting point. A failed defaults read is
 *    UNKNOWN (`baseline === null`, `baselineError` set), never "no baseline";
 *    and it never fails the page, because the two stored layers are still
 *    editable without it.
 * 3. **Never optimistically patches local state after a write.** Every
 *    mutation re-fetches, so what the page shows is what the server recorded.
 */
export function useAgentTextUnits({
  config,
  canWriteFleet,
}: UseAgentTextUnitsOptions) {
  const { kind } = config;

  const [accountUnits, setAccountUnits] = useState<AgentTextUnit[]>([]);
  const [fleetUnits, setFleetUnits] = useState<AgentTextUnit[]>([]);
  /** The account's published baseline; `null` until read, or when the read
   *  failed (see `baselineError`) — UNKNOWN, not empty. An account with no
   *  baseline reads as `{ units: [], published_by_version: null }`. */
  const [baseline, setBaseline] = useState<AgentTextUnitDefaultsResponse | null>(
    null
  );
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  /** Which stored layer edits are written to. */
  const [editLayer, setEditLayerState] = useState<WritableLayer>("account");

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draftFiles, setDraftFiles] = useState<UnitFiles>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [changeDescription, setChangeDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [versions, setVersions] = useState<AgentTextUnitVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  const rows = useMemo(
    () => buildUnitRows(config, accountUnits, fleetUnits, baseline?.units ?? []),
    [config, accountUnits, fleetUnits, baseline]
  );

  const layerRef = useCallback(
    (layer: WritableLayer): LayerRef =>
      layer === "fleet" ? { fleetDefault: true } : {},
    []
  );

  const refreshUnits = useCallback(async (): Promise<{
    account: AgentTextUnit[];
    fleet: AgentTextUnit[];
  }> => {
    const [account, fleet, defaults] = await Promise.all([
      listAgentTextUnits({
        kind,
        includeFleetDefaults: false,
        limit: PAGE_LIMIT,
      }),
      listAgentTextUnits({ kind, fleetDefault: true, limit: PAGE_LIMIT }),
      // Isolated: a failed baseline read degrades the baseline to UNKNOWN and
      // leaves the two stored layers editable, rather than failing the page.
      getAgentTextUnitDefaults().then(
        (value) => ({ ok: true as const, value }),
        (err: unknown) => ({
          ok: false as const,
          error: errorMessage(err, "Failed to read the published defaults"),
        })
      ),
    ]);
    setAccountUnits(account.items ?? []);
    setFleetUnits(fleet.items ?? []);
    if (defaults.ok) {
      setBaseline(defaults.value);
      setBaselineError(null);
    } else {
      setBaseline(null);
      setBaselineError(defaults.error);
    }
    setTruncated(
      Boolean(account.pagination?.has_more) || Boolean(fleet.pagination?.has_more)
    );
    setLoaded(true);
    return { account: account.items ?? [], fleet: fleet.items ?? [] };
  }, [kind]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    refreshUnits()
      .catch((err: unknown) => {
        setLoadError(errorMessage(err, `Failed to load agent ${config.label}`));
      })
      .finally(() => setLoading(false));
  }, [refreshUnits, config.label]);

  useEffect(load, [load]);

  // ---------------------------------------------------------------------------
  // Selection + draft
  // ---------------------------------------------------------------------------

  const selected: UnitRow | null = useMemo(() => {
    if (!selectedName) return null;
    const found = rows.find((row) => row.name === selectedName);
    if (found) return found;
    // A name the operator typed that exists at neither layer and is not in the
    // display seed. It is still editable — the corpus is open and the backend
    // keys on `(layer, kind, name)` with no allow-list — so synthesize the
    // embedded-only row rather than refusing.
    return {
      kind,
      name: selectedName,
      layer: "embedded",
      account: null,
      fleet: null,
      resolved: null,
      embedded: null,
      shadowsFleet: false,
      pinsFleet: false,
      isInvocable: !isCopySourceName(selectedName),
    } satisfies UnitRow;
  }, [rows, selectedName, kind]);

  /** The stored row of the layer currently being EDITED — the draft's baseline. */
  const editing: AgentTextUnit | null = useMemo(() => {
    if (!selected) return null;
    return editLayer === "fleet" ? selected.fleet : selected.account;
  }, [selected, editLayer]);

  const entrypoint = useMemo(
    () =>
      selected
        ? (editing?.entrypoint ?? entrypointFor(kind, selected.name))
        : entrypointFor(kind, ""),
    [selected, editing, kind]
  );

  const refreshVersions = useCallback(
    async (name: string, layer: WritableLayer) => {
      setVersionsLoading(true);
      setVersionsError(null);
      try {
        const body = await listAgentTextUnitVersions(
          kind,
          name,
          layerRef(layer)
        );
        setVersions(body.items ?? []);
      } catch (err) {
        setVersions([]);
        setVersionsError(errorMessage(err, "Failed to load version history"));
      } finally {
        setVersionsLoading(false);
      }
    },
    [kind, layerRef]
  );

  /** Seed the draft from one layer's stored files, or blank when it has none. */
  const seedDraft = useCallback(
    (name: string, unit: AgentTextUnit | null) => {
      const files = unit ? { ...unit.files } : {};
      setDraftFiles(files);
      const paths = Object.keys(files).sort();
      const entry = unit?.entrypoint ?? entrypointFor(kind, name);
      setActivePath(paths.includes(entry) ? entry : (paths[0] ?? null));
    },
    [kind]
  );

  const selectUnit = useCallback(
    (name: string) => {
      const row = rows.find((r) => r.name === name) ?? null;
      // Open on the layer that actually SERVES this unit — an operator opening
      // a fleet-default row means to read the fleet text, not a blank account
      // draft. Deliberately not conditioned on `canWriteFleet`: reading the
      // fleet layer is open to any member, so gating the initial VIEW on write
      // permission would show a non-superuser a blank editor for text that is
      // in front of them in the list. The editor renders it read-only instead.
      const layer: WritableLayer = row?.account
        ? "account"
        : row?.fleet
          ? "fleet"
          : "account";
      setSelectedName(name);
      setEditLayerState(layer);
      setChangeDescription("");
      setVersions([]);
      setVersionsError(null);
      const unit = layer === "fleet" ? (row?.fleet ?? null) : (row?.account ?? null);
      seedDraft(name, unit);
      if (unit) void refreshVersions(name, layer);
    },
    [rows, seedDraft, refreshVersions]
  );

  const clearSelection = useCallback(() => {
    setSelectedName(null);
    setDraftFiles({});
    setActivePath(null);
    setChangeDescription("");
    setVersions([]);
    setVersionsError(null);
  }, []);

  /** Switch which layer the editor is writing to, re-seeding from that layer. */
  const setEditLayer = useCallback(
    (layer: WritableLayer) => {
      if (!selected) return;
      setEditLayerState(layer);
      setChangeDescription("");
      setVersions([]);
      setVersionsError(null);
      const unit = layer === "fleet" ? selected.fleet : selected.account;
      seedDraft(selected.name, unit);
      if (unit) void refreshVersions(selected.name, layer);
    },
    [selected, seedDraft, refreshVersions]
  );

  // ---------------------------------------------------------------------------
  // File-map editing
  // ---------------------------------------------------------------------------

  const setFileContent = useCallback((path: string, content: string) => {
    setDraftFiles((current) => ({ ...current, [path]: content }));
  }, []);

  const addFile = useCallback(
    (path: string): string | null => {
      const trimmed = path.trim();
      const error = validateRelativePath(trimmed);
      if (error) return error;
      if (trimmed in draftFiles) return `"${trimmed}" is already in this unit.`;
      setDraftFiles((current) => ({ ...current, [trimmed]: "" }));
      setActivePath(trimmed);
      return null;
    },
    [draftFiles]
  );

  const renameFile = useCallback(
    (from: string, to: string): string | null => {
      const trimmed = to.trim();
      if (trimmed === from) return null;
      const error = validateRelativePath(trimmed);
      if (error) return error;
      if (trimmed in draftFiles) return `"${trimmed}" is already in this unit.`;
      if (from === entrypoint) {
        return `${entrypoint} is this ${config.singular}'s entrypoint and cannot be renamed.`;
      }
      setDraftFiles((current) => {
        const next: UnitFiles = {};
        for (const [key, value] of Object.entries(current)) {
          next[key === from ? trimmed : key] = value;
        }
        return next;
      });
      setActivePath((current) => (current === from ? trimmed : current));
      return null;
    },
    [draftFiles, entrypoint, config.singular]
  );

  const deleteFile = useCallback(
    (path: string): string | null => {
      if (path === entrypoint) {
        return `${entrypoint} is this ${config.singular}'s entrypoint and cannot be removed.`;
      }
      setDraftFiles((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      setActivePath((current) => {
        if (current !== path) return current;
        const remaining = Object.keys(draftFiles)
          .filter((p) => p !== path)
          .sort();
        return remaining.includes(entrypoint) ? entrypoint : (remaining[0] ?? null);
      });
      return null;
    },
    [draftFiles, entrypoint, config.singular]
  );

  /** Copy the fleet default's files into the draft as the starting point for
   *  an account override — the honest alternative to a blank editor when a
   *  fleet layer does exist. */
  const seedFromOtherLayer = useCallback(() => {
    if (!selected) return;
    const source = editLayer === "account" ? selected.fleet : selected.account;
    if (!source) return;
    setDraftFiles({ ...source.files });
    setActivePath(
      source.entrypoint in source.files
        ? source.entrypoint
        : (Object.keys(source.files).sort()[0] ?? null)
    );
  }, [selected, editLayer]);

  /** Copy the PUBLISHED embedded default into the draft — the honest
   *  starting point for an override when a runner has published one. */
  const seedFromBaseline = useCallback(() => {
    if (!selected?.embedded) return;
    const source = selected.embedded;
    setDraftFiles({ ...source.files });
    const entry = entrypointFor(kind, selected.name);
    setActivePath(
      entry in source.files
        ? entry
        : (Object.keys(source.files).sort()[0] ?? null)
    );
  }, [selected, kind]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const isDirty = useMemo(() => {
    const stored = editing?.files ?? {};
    const draftPaths = Object.keys(draftFiles).sort();
    const storedPaths = Object.keys(stored).sort();
    if (draftPaths.length !== storedPaths.length) return true;
    if (draftPaths.some((path, i) => path !== storedPaths[i])) return true;
    return draftPaths.some((path) => draftFiles[path] !== stored[path]);
  }, [draftFiles, editing]);

  const saveDraft = useCallback(async () => {
    if (!selected) return;
    if (editLayer === "fleet" && !canWriteFleet) {
      toast.error("Writing a fleet default requires a superuser.");
      return;
    }
    const paths = Object.keys(draftFiles);
    if (paths.length === 0) {
      toast.error(`A ${config.singular} must carry at least one file.`);
      return;
    }
    if (!(entrypoint in draftFiles)) {
      toast.error(
        `A ${config.singular} must carry its entrypoint ${entrypoint}.`
      );
      return;
    }
    const blank = paths.find((path) => !draftFiles[path]?.trim());
    if (blank) {
      toast.error(`"${blank}" is blank — a blank file is refused by the corpus.`);
      return;
    }

    setSaving(true);
    try {
      const saved = await upsertAgentTextUnit(
        {
          kind,
          name: selected.name,
          files: draftFiles,
          change_description: changeDescription.trim() || null,
          // Carried explicitly: the upsert REPLACES the row, so omitting these
          // would silently reset them to their defaults on every save.
          is_shared: editing?.is_shared ?? false,
          is_invocable: isCopySourceName(selected.name)
            ? false
            : (editing?.is_invocable ?? true),
        },
        layerRef(editLayer)
      );
      await refreshUnits();
      await refreshVersions(selected.name, editLayer);
      setChangeDescription("");
      toast.success(
        `Saved ${selected.name} as version ${saved.current_version} of the ` +
          `${editLayer === "fleet" ? "fleet default" : "account override"}. ` +
          "Newly spawned sessions pick it up; sessions already running keep the text they started with."
      );
    } catch (err) {
      toast.error(errorMessage(err, `Failed to save the ${config.singular}`));
    } finally {
      setSaving(false);
    }
  }, [
    selected,
    editLayer,
    canWriteFleet,
    draftFiles,
    entrypoint,
    kind,
    changeDescription,
    editing,
    layerRef,
    refreshUnits,
    refreshVersions,
    config.singular,
  ]);

  const revertToVersion = useCallback(
    async (versionNumber: number) => {
      if (!selected) return;
      setBusyAction("revert");
      try {
        const head = await revertAgentTextUnit(
          kind,
          selected.name,
          versionNumber,
          layerRef(editLayer)
        );
        const fresh = await refreshUnits();
        await refreshVersions(selected.name, editLayer);
        const source = editLayer === "fleet" ? fresh.fleet : fresh.account;
        const stored = source.find((u) => u.name === selected.name) ?? head;
        seedDraft(selected.name, stored);
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
    [selected, kind, editLayer, layerRef, refreshUnits, refreshVersions, seedDraft]
  );

  /** Delete the edited layer's row so the next layer down applies again. */
  const deleteLayer = useCallback(async () => {
    if (!selected) return;
    if (editLayer === "fleet" && !canWriteFleet) {
      toast.error("Deleting a fleet default requires a superuser.");
      return;
    }
    setBusyAction("delete");
    try {
      await deleteAgentTextUnit(kind, selected.name, layerRef(editLayer));
      const fresh = await refreshUnits();
      setVersions([]);
      setVersionsError(null);
      const source = editLayer === "fleet" ? fresh.fleet : fresh.account;
      seedDraft(selected.name, source.find((u) => u.name === selected.name) ?? null);
      const next =
        editLayer === "account"
          ? fresh.fleet.some((u) => u.name === selected.name)
            ? "the fleet default"
            : "the runner's embedded copy"
          : "the runner's embedded copy";
      toast.success(
        `Removed the ${editLayer === "fleet" ? "fleet default" : "account override"} for ` +
          `${selected.name}. Newly spawned sessions get ${next} again.`
      );
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete"));
    } finally {
      setBusyAction(null);
    }
  }, [
    selected,
    editLayer,
    canWriteFleet,
    kind,
    layerRef,
    refreshUnits,
    seedDraft,
  ]);

  return {
    rows,
    loading,
    loaded,
    loadError,
    truncated,
    retryLoad: load,

    baseline,
    baselineError,

    selected,
    selectUnit,
    clearSelection,

    editLayer,
    setEditLayer,
    editing,
    entrypoint,
    canWriteFleet,

    draftFiles,
    activePath,
    setActivePath,
    setFileContent,
    addFile,
    renameFile,
    deleteFile,
    seedFromOtherLayer,
    seedFromBaseline,

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
    deleteLayer,
  };
}

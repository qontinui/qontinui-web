/**
 * useConstraints
 *
 * Hook for managing constraint engine state in the web frontend.
 * Loads active constraints and raw TOML config on mount, provides local
 * editing state with dirty tracking, and exposes save/validate via the API.
 *
 * Adapted from the runner's useConstraints hook, using the web frontend's
 * constraints API client which calls through the FastAPI backend proxy.
 *
 * The read publishes what it answered (`readState`), because the constraints
 * routes are for platform admins only and a read can fail: a refusal and a
 * failure must not render as "no constraints", and a config that was never
 * read must not be overwritten from an empty editor (see `save`).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  Constraint,
  ResourceLimits,
  ValidateConfigResponse,
} from "@qontinui/shared-types/constraints";
import {
  isBuiltinConstraint,
  isCustomConstraint,
  isAiConstraint,
  generateConstraintToml,
} from "@qontinui/workflow-utils";
import {
  fetchActiveConstraints,
  fetchConstraintConfig,
  isConstraintsAdminRefusal,
  saveConstraintConfig,
  validateConstraintConfig,
} from "@/lib/constraints-api";

// ============================================================================
// Types
// ============================================================================

/**
 * What the constraints read (`reload`) answered.
 *
 * - `pending`: no read has settled yet. A panel shows its loader.
 * - `read`: the constraints and config are what the runner answered. If a
 *   later read failed, `readFailure` says why, and what is shown is STALE.
 * - `admin-only`: REFUSED, the viewer is not a platform admin. Nothing an
 *   earlier read delivered is kept, and no editor may be offered.
 * - `unknown`: no read has delivered and one failed. Nothing is known, so the
 *   empty initial state must not be shown as "no constraints".
 */
export type ConstraintsReadState =
  | "pending"
  | "read"
  | "admin-only"
  | "unknown";

export interface UseConstraintsOptions {
  /** Project path to scope the config to. If omitted, the backend resolves it. */
  projectPath?: string;
  /** Whether to load data on mount. Default: true. */
  loadOnMount?: boolean;
}

export interface UseConstraintsReturn {
  /** All constraints (builtins + custom), reflecting local edits. */
  constraints: Constraint[];
  /** Only built-in constraints. */
  builtinConstraints: Constraint[];
  /** Only custom (project:) constraints. */
  customConstraints: Constraint[];
  /** Only AI-proposed (ai:) constraints from the current run. */
  aiConstraints: Constraint[];
  /** Resource limits (local state). */
  resourceLimits: ResourceLimits;
  /** Whether the local state differs from the last loaded/saved config. */
  isDirty: boolean;
  /** Whether data is currently loading. */
  loading: boolean;
  /** What the latest settled read answered. */
  readState: ConstraintsReadState;
  /**
   * Why the latest read failed: the reason of an `unknown` state, or, beside
   * `read`, of a stale one. Null while the latest read delivered.
   */
  readFailure: string | null;
  /** Why the latest validate or save failed, if it did. */
  error: string | null;
  /** Path to the constraints.toml file (if one exists). */
  configPath: string | undefined;

  // Mutations
  /** Toggle a built-in constraint on/off by its suffix (e.g., "no-secrets"). */
  toggleBuiltin: (builtinSuffix: string, enabled: boolean) => void;
  /** Add a new custom constraint. */
  addConstraint: (constraint: Constraint) => void;
  /** Update an existing constraint by ID. */
  updateConstraint: (
    id: string,
    updates: Partial<Omit<Constraint, "id">>
  ) => void;
  /** Remove a custom constraint by ID. */
  removeConstraint: (id: string) => void;
  /** Promote an AI-proposed constraint to a project constraint. */
  promoteConstraint: (id: string) => void;
  /** Update resource limits. */
  updateResourceLimits: (limits: Partial<ResourceLimits>) => void;

  // Actions
  /** Validate current state without saving. */
  validate: () => Promise<ValidateConfigResponse>;
  /**
   * Generate TOML, validate, and save via the API. Returns true on success.
   * Writes nothing unless `readState` is `read`: a config that was never read
   * would be overwritten with whatever the editor holds.
   */
  save: () => Promise<boolean>;
  /** Reload constraints and config from the backend. */
  reload: () => Promise<void>;
}

// ============================================================================
// Hook
// ============================================================================

export function useConstraints(
  options: UseConstraintsOptions = {}
): UseConstraintsReturn {
  const { projectPath, loadOnMount = true } = options;

  // Local state
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [resourceLimits, setResourceLimits] = useState<ResourceLimits>({});
  const [configPath, setConfigPath] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [readState, setReadState] = useState<ConstraintsReadState>("pending");
  const [readFailure, setReadFailure] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Snapshot of the last saved/loaded state for dirty tracking
  const savedStateRef = useRef<string>("");
  // The issue number of the newest read: only it may settle the state, so a
  // slower, older read cannot overwrite a newer one's answer.
  const readSeqRef = useRef(0);

  /** Serialize current state to a string for dirty comparison. */
  const serializeState = useCallback(
    (cs: Constraint[], rl: ResourceLimits): string => {
      return JSON.stringify({ constraints: cs, resourceLimits: rl });
    },
    []
  );

  // Computed properties
  const builtinConstraints = useMemo(
    () => constraints.filter((c) => isBuiltinConstraint(c.id)),
    [constraints]
  );

  const customConstraints = useMemo(
    () => constraints.filter((c) => isCustomConstraint(c.id)),
    [constraints]
  );

  const aiConstraints = useMemo(
    () => constraints.filter((c) => isAiConstraint(c.id)),
    [constraints]
  );

  const isDirty = useMemo(
    () => serializeState(constraints, resourceLimits) !== savedStateRef.current,
    [constraints, resourceLimits, serializeState]
  );

  // --------------------------------------------------------------------------
  // Load
  // --------------------------------------------------------------------------

  /** The viewer may not see the constraints: drop them and every edit. */
  const refuse = useCallback(() => {
    setConstraints([]);
    setResourceLimits({});
    setConfigPath(undefined);
    savedStateRef.current = serializeState([], {});
    setReadState("admin-only");
    setReadFailure(null);
    setError(null);
  }, [serializeState]);

  const reload = useCallback(async () => {
    const seq = ++readSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [activeConstraints, config] = await Promise.all([
        fetchActiveConstraints(projectPath),
        fetchConstraintConfig(projectPath),
      ]);
      if (seq !== readSeqRef.current) return;

      setConstraints(activeConstraints);
      // Schema tightened config.path to `string | null | undefined`; the
      // state setter accepts `string | undefined`, so coerce null to undefined.
      setConfigPath(config.path ?? undefined);

      // Parse resource limits from the raw TOML if available.
      let limits: ResourceLimits = {};
      if (config.toml) {
        limits = parseResourceLimitsFromToml(config.toml);
        setResourceLimits(limits);
      } else {
        setResourceLimits({});
      }

      // Snapshot the loaded state
      savedStateRef.current = serializeState(activeConstraints, limits);
      setReadState("read");
      setReadFailure(null);
    } catch (err) {
      if (seq !== readSeqRef.current) return;
      // A refusal is an answer, not a failure: the viewer is not a platform
      // admin, so nothing is shown and nothing is editable.
      if (isConstraintsAdminRefusal(err)) {
        refuse();
        return;
      }
      console.error("[useConstraints] reload failed:", err);
      // Constraints an earlier read delivered stay on screen, labelled stale;
      // with none, what applies is unknown. Both carry the reason.
      setReadState((prev) => (prev === "read" ? prev : "unknown"));
      setReadFailure(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === readSeqRef.current) setLoading(false);
    }
  }, [projectPath, serializeState, refuse]);

  // Load on mount
  useEffect(() => {
    if (loadOnMount) {
      reload();
    }
  }, [loadOnMount, reload]);

  // --------------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------------

  const toggleBuiltin = useCallback(
    (builtinSuffix: string, enabled: boolean) => {
      const fullId = `builtin:${builtinSuffix}`;
      setConstraints((prev) =>
        prev.map((c) => (c.id === fullId ? { ...c, enabled } : c))
      );
    },
    []
  );

  const addConstraint = useCallback((constraint: Constraint) => {
    setConstraints((prev) => [...prev, constraint]);
  }, []);

  const updateConstraint = useCallback(
    (id: string, updates: Partial<Omit<Constraint, "id">>) => {
      setConstraints((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
      );
    },
    []
  );

  const removeConstraint = useCallback((id: string) => {
    setConstraints((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const promoteConstraint = useCallback((id: string) => {
    setConstraints((prev) =>
      prev.map((c) => {
        if (c.id !== id || !isAiConstraint(c.id)) return c;
        const projectId = c.id.replace(/^ai:/, "project:");
        return { ...c, id: projectId };
      })
    );
  }, []);

  const updateResourceLimitsHandler = useCallback(
    (limits: Partial<ResourceLimits>) => {
      setResourceLimits((prev) => ({ ...prev, ...limits }));
    },
    []
  );

  // --------------------------------------------------------------------------
  // Validate & Save
  // --------------------------------------------------------------------------

  const validate = useCallback(async (): Promise<ValidateConfigResponse> => {
    const toml = generateConstraintToml(constraints, resourceLimits);
    return validateConstraintConfig(toml);
  }, [constraints, resourceLimits]);

  const save = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (readState !== "read") {
      setError(
        "The constraints were not read, so saving would overwrite the " +
          "project's config with what this editor holds. Read them first."
      );
      return false;
    }
    try {
      const toml = generateConstraintToml(constraints, resourceLimits);

      // Validate first
      const validation = await validateConstraintConfig(toml);
      if (!validation.valid) {
        setError(validation.errors.join("; "));
        return false;
      }

      // Save
      const result = await saveConstraintConfig(toml, projectPath);
      if (!result.valid) {
        setError(result.errors.join("; "));
        return false;
      }

      // Update config path and snapshot
      setConfigPath(result.path);
      savedStateRef.current = serializeState(constraints, resourceLimits);
      return true;
    } catch (err) {
      if (isConstraintsAdminRefusal(err)) {
        // The viewer is not (or no longer) a platform admin: say so in place
        // of the editors, and drop the edits with them.
        refuse();
        return false;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useConstraints] save failed:", err);
      setError(msg);
      return false;
    }
  }, [
    constraints,
    resourceLimits,
    projectPath,
    serializeState,
    readState,
    refuse,
  ]);

  return {
    constraints,
    builtinConstraints,
    customConstraints,
    aiConstraints,
    resourceLimits,
    isDirty,
    loading,
    readState,
    readFailure,
    error,
    configPath,

    toggleBuiltin,
    addConstraint,
    updateConstraint,
    removeConstraint,
    promoteConstraint,
    updateResourceLimits: updateResourceLimitsHandler,

    validate,
    save,
    reload,
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Simple extraction of resource limits from raw TOML text.
 *
 * This avoids needing a full TOML parser in the frontend -- we just look
 * for the `[resources]` section and extract known keys.
 */
function parseResourceLimitsFromToml(toml: string): ResourceLimits {
  const limits: ResourceLimits = {};

  // Find the [resources] section
  const resourcesMatch = toml.match(
    /\[resources\]\s*\n([\s\S]*?)(?=\n\[|\n*$)/
  );
  if (!resourcesMatch?.[1]) return limits;

  const section = resourcesMatch[1];

  const wallTime = section.match(/max_wall_time_secs\s*=\s*(\d+)/);
  if (wallTime?.[1]) limits.maxWallTimeSecs = parseInt(wallTime[1], 10);

  const filesModified = section.match(/max_files_modified\s*=\s*(\d+)/);
  if (filesModified?.[1])
    limits.maxFilesModified = parseInt(filesModified[1], 10);

  const agenticTime = section.match(/max_agentic_time_ms\s*=\s*(\d+)/);
  if (agenticTime?.[1]) limits.maxAgenticTimeMs = parseInt(agenticTime[1], 10);

  const threshold = section.match(/warning_threshold\s*=\s*([\d.]+)/);
  if (threshold?.[1]) limits.warningThreshold = parseFloat(threshold[1]);

  return limits;
}

/**
 * ConstraintOverridesEditor.tsx
 *
 * Per-workflow constraint override editor for the web frontend settings panel.
 * Fetches available constraints from the backend API and displays a 3-state
 * toggle for each: Default (use project config), Force Enable, Force Disable.
 *
 * The constraints read is for platform admins only. A viewer who is not one
 * sees `ConstraintsAdminOnly`, and a read that failed is a labelled UNKNOWN
 * with its reason; neither is rendered as "No constraints configured", and
 * neither offers a toggle. Either way the workflow's own overrides still
 * apply, so their count is said.
 */

import { useState, useEffect } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import {
  fetchActiveConstraints,
  isConstraintsAdminRefusal,
} from "@/lib/constraints-api";
import type { Constraint } from "@qontinui/shared-types/constraints";
import { ConstraintsAdminOnly } from "../../constraints/ConstraintsAdminOnly";
import { ConstraintsReadNote } from "../../constraints/ConstraintsReadNote";
import type { SettingRenderProps } from "./types";

/** What the constraints read answered. */
type ConstraintsRead =
  | { state: "loading" }
  | { state: "read"; constraints: Constraint[] }
  | { state: "admin-only" }
  | { state: "unknown"; reason: string };

type OverrideState = "default" | "enable" | "disable";

function getOverrideState(
  overrides: Record<string, boolean> | undefined,
  constraintId: string
): OverrideState {
  if (!overrides || !(constraintId in overrides)) return "default";
  return overrides[constraintId] ? "enable" : "disable";
}

function cycleOverrideState(current: OverrideState): OverrideState {
  switch (current) {
    case "default":
      return "enable";
    case "enable":
      return "disable";
    case "disable":
      return "default";
  }
}

const STATE_LABELS: Record<OverrideState, string> = {
  default: "Default",
  enable: "Force On",
  disable: "Force Off",
};

const STATE_COLORS: Record<OverrideState, string> = {
  default: "bg-zinc-700 text-zinc-400",
  enable: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  disable: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function ConstraintOverridesEditor({
  workflow,
  updateWorkflow,
}: SettingRenderProps) {
  const overrides = workflow.constraintOverrides;

  const [read, setRead] = useState<ConstraintsRead>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    setRead({ state: "loading" });

    fetchActiveConstraints()
      .then((result) => {
        if (!cancelled) {
          setRead({ state: "read", constraints: result });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (isConstraintsAdminRefusal(err)) {
          setRead({ state: "admin-only" });
          return;
        }
        setRead({
          state: "unknown",
          reason: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = (constraintId: string) => {
    const current = getOverrideState(overrides, constraintId);
    const next = cycleOverrideState(current);
    const updated = { ...(overrides ?? {}) };

    if (next === "default") {
      delete updated[constraintId];
    } else {
      updated[constraintId] = next === "enable";
    }

    // Clean up: only store if there are actual overrides
    updateWorkflow({
      constraintOverrides:
        Object.keys(updated).length > 0 ? updated : undefined,
    });
  };

  const overrideCount = overrides ? Object.keys(overrides).length : 0;

  if (read.state === "loading") {
    return (
      <div
        className="flex items-center gap-2 text-xs text-zinc-500 py-2"
        data-testid="constraint-overrides-loading"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading constraints...
      </div>
    );
  }

  if (read.state !== "read") {
    return (
      <div className="space-y-2">
        {read.state === "admin-only" ? (
          <ConstraintsAdminOnly testId="constraint-overrides-admin-only" />
        ) : (
          <ConstraintsReadNote
            testId="constraint-overrides-read-failed"
            reason={read.reason}
          >
            The constraints could not be read, so which constraints this
            workflow can override is unknown.
          </ConstraintsReadNote>
        )}
        {overrideCount > 0 && (
          <p
            className="text-[10px] text-zinc-500"
            data-testid="constraint-overrides-count"
          >
            {overrideCount === 1
              ? "This workflow sets 1 constraint override, which still applies."
              : `This workflow sets ${overrideCount} constraint overrides, which still apply.`}
          </p>
        )}
      </div>
    );
  }

  const { constraints } = read;

  if (constraints.length === 0) {
    return (
      <div className="text-xs text-zinc-500 py-2">
        No constraints configured. Add constraints via the Constraints panel or
        constraints.toml.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-medium text-zinc-300">
          Constraint Overrides
        </span>
        {overrideCount > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/20 text-blue-400 rounded">
            {overrideCount} override{overrideCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <p className="text-[10px] text-zinc-500">
        Override project-level constraint settings for this workflow only.
      </p>
      <div className="space-y-1">
        {constraints.map((constraint) => {
          const currentState = getOverrideState(overrides, constraint.id);
          return (
            <div
              key={constraint.id}
              className="flex items-center gap-2 py-1 group"
            >
              <button
                type="button"
                onClick={() => handleToggle(constraint.id)}
                className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded border transition-colors cursor-pointer ${STATE_COLORS[currentState]}`}
                title="Click to cycle: Default -> Force On -> Force Off"
              >
                {STATE_LABELS[currentState]}
              </button>
              <div className="flex-1 min-w-0">
                <span className="text-[11px] text-zinc-300 truncate block">
                  {constraint.name}
                </span>
              </div>
              <span
                className={`flex-shrink-0 text-[10px] ${
                  constraint.enabled ? "text-emerald-500/60" : "text-zinc-600"
                }`}
                title={
                  constraint.enabled
                    ? "Enabled at project level"
                    : "Disabled at project level"
                }
              >
                {constraint.enabled ? "on" : "off"}
              </span>
            </div>
          );
        })}
      </div>
      {overrideCount > 0 && (
        <button
          type="button"
          onClick={() => updateWorkflow({ constraintOverrides: undefined })}
          className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
        >
          Clear all overrides
        </button>
      )}
    </div>
  );
}

"use client";

/**
 * /settings/agents -- per-user agent registry preferences.
 *
 * Lists every agent in the coord-backed registry (the current user's
 * EFFECTIVE view: registry defaults overlaid with the user's own prefs)
 * and lets the user enable/disable each one. Disabling a policy-required
 * agent forces an explicit disposition choice (block / degrade to inline /
 * warn & proceed) -- rendered as an inline required picker, never a toast.
 * After every save the row re-renders from re-fetched server state, so
 * what is shown is what was actually recorded.
 *
 * Backend: GET /api/v1/agent-registry, PUT /api/v1/agent-registry/prefs/{name}
 * (Phase 4d of plan 2026-07-28-migrate-claude-md-into-qontinui.md).
 */

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  AgentPrefError,
  listAgentRegistry,
  putAgentPref,
  type AgentDisposition,
  type AgentRegistryEntry,
} from "@/lib/api/agent-registry";

/** One-line, honest explanations of each disposition. */
const DISPOSITIONS: {
  value: AgentDisposition;
  label: string;
  explanation: string;
}[] = [
  {
    value: "block",
    label: "Block",
    explanation: "Spawn requests for this agent are refused outright.",
  },
  {
    value: "degrade",
    label: "Degrade to inline",
    explanation:
      "The work runs inline in the calling session instead of as a subagent.",
  },
  {
    value: "warn_proceed",
    label: "Warn & proceed",
    explanation:
      "The spawn goes ahead, but a warning is recorded and surfaced.",
  },
];

function dispositionLabel(value: string): string {
  return DISPOSITIONS.find((d) => d.value === value)?.label ?? value;
}

/** State of the inline disposition picker for one agent. */
interface PickerState {
  selected: AgentDisposition | null;
  /** Inline error (invalid_disposition or missing choice). */
  error: string | null;
  /** True when opened by a server 422 rather than pre-emptively. */
  forced: boolean;
}

function recordedLine(entry: AgentRegistryEntry): string {
  const state = entry.enabled
    ? "enabled"
    : `disabled — disposition: ${dispositionLabel(entry.disposition)}`;
  return entry.source === "user_pref"
    ? `Recorded preference: ${state}`
    : `Registry default: ${state} (no preference saved)`;
}

export default function AgentsSettingsPage() {
  const [entries, setEntries] = useState<AgentRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-agent in-flight set (not a single value): concurrent saves on two
  // rows must not cross-clear each other's disabled/spinner state.
  const [savingAgents, setSavingAgents] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [pickers, setPickers] = useState<Record<string, PickerState>>({});

  const refresh = useCallback(async (): Promise<AgentRegistryEntry[]> => {
    const rows = await listAgentRegistry();
    setEntries(rows);
    return rows;
  }, []);

  useEffect(() => {
    refresh()
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const openPicker = (agentName: string, forced: boolean, error?: string) => {
    setPickers((prev) => ({
      ...prev,
      [agentName]: { selected: null, error: error ?? null, forced },
    }));
  };

  const closePicker = (agentName: string) => {
    setPickers((prev) => {
      const next = { ...prev };
      delete next[agentName];
      return next;
    });
  };

  const save = async (
    agentName: string,
    update: { enabled: boolean; disposition?: AgentDisposition },
    fromPicker: boolean
  ) => {
    setSavingAgents((prev) => new Set(prev).add(agentName));
    try {
      await putAgentPref(agentName, update);
      const rows = await refresh();
      closePicker(agentName);
      const saved = rows.find((r) => r.agent_name === agentName);
      // UX honesty: report the state the SERVER recorded, not the request.
      toast.success(
        saved
          ? `${agentName}: ${recordedLine(saved)}`
          : `${agentName}: preference saved`
      );
    } catch (err) {
      if (
        err instanceof AgentPrefError &&
        err.code === "disposition_required"
      ) {
        // Forced choice, inline -- never a toast.
        openPicker(
          agentName,
          true,
          "A disposition is required to disable this policy-required agent."
        );
      } else if (
        err instanceof AgentPrefError &&
        err.code === "invalid_disposition" &&
        fromPicker
      ) {
        setPickers((prev) => ({
          ...prev,
          [agentName]: {
            selected: prev[agentName]?.selected ?? null,
            error:
              "That disposition was rejected as invalid. Pick one of the options below.",
            forced: prev[agentName]?.forced ?? false,
          },
        }));
      } else {
        toast.error(
          err instanceof Error ? err.message : "Failed to save preference"
        );
      }
    } finally {
      setSavingAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentName);
        return next;
      });
    }
  };

  const handleToggle = (entry: AgentRegistryEntry) => {
    if (entry.enabled && entry.policy_required) {
      // Disabling a policy-required agent: disposition choice is required
      // BEFORE anything is saved.
      openPicker(entry.agent_name, false);
      return;
    }
    void save(entry.agent_name, { enabled: !entry.enabled }, false);
  };

  const handlePickerSave = (agentName: string) => {
    const picker = pickers[agentName];
    if (!picker?.selected) {
      setPickers((prev) => ({
        ...prev,
        [agentName]: {
          selected: prev[agentName]?.selected ?? null,
          error: "Choose a disposition to continue.",
          forced: prev[agentName]?.forced ?? false,
        },
      }));
      return;
    }
    void save(
      agentName,
      { enabled: false, disposition: picker.selected },
      true
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl" data-page-id="settings-agents">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bot className="size-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enable or disable the agents your sessions may spawn. Disabling a
            policy-required agent requires choosing what happens when a spawn is
            requested anyway.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading agent registry…
        </div>
      )}

      {!loading && loadError && (
        <div className="card">
          <div className="card-content space-y-3">
            <p className="form-error">
              Failed to load the agent registry: {loadError}
            </p>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setLoading(true);
                setLoadError(null);
                refresh()
                  .catch((err: unknown) =>
                    setLoadError(
                      err instanceof Error ? err.message : String(err)
                    )
                  )
                  .finally(() => setLoading(false));
              }}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !loadError && entries.length === 0 && (
        <div className="card">
          <div className="card-content text-sm text-muted-foreground">
            No agents are registered for your tenant yet.
          </div>
        </div>
      )}

      {!loading &&
        !loadError &&
        entries.map((entry) => {
          const picker = pickers[entry.agent_name];
          const saving = savingAgents.has(entry.agent_name);
          return (
            <div className="card" key={entry.agent_name}>
              <div className="card-content flex items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{entry.agent_name}</span>
                    {entry.policy_required && (
                      <span className="badge badge-warning">
                        Policy required
                      </span>
                    )}
                    {entry.spawn_path && (
                      <span className="badge badge-muted">
                        {entry.spawn_path}
                      </span>
                    )}
                    <span
                      className={
                        entry.enabled
                          ? "badge badge-success"
                          : "badge badge-danger"
                      }
                    >
                      {entry.enabled
                        ? "Enabled"
                        : `Disabled · ${dispositionLabel(entry.disposition)}`}
                    </span>
                  </div>
                  {entry.purpose && (
                    <p className="text-sm text-muted-foreground">
                      {entry.purpose}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {[
                      entry.model ? `model: ${entry.model}` : null,
                      entry.effort ? `effort: ${entry.effort}` : null,
                      entry.fanout_bound !== null &&
                      entry.fanout_bound !== undefined
                        ? `fan-out bound: ${entry.fanout_bound}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {/* UX honesty: what the server actually has recorded. */}
                  <p className="text-xs text-muted-foreground italic">
                    {recordedLine(entry)}
                  </p>
                </div>
                <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none text-sm">
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={entry.enabled}
                    disabled={saving || Boolean(picker)}
                    onChange={() => handleToggle(entry)}
                    aria-label={`Toggle ${entry.agent_name}`}
                  />
                  {entry.enabled ? "On" : "Off"}
                </label>
              </div>

              {picker && (
                <div className="card-footer space-y-3">
                  <div className="form-group">
                    <span className="form-label">
                      Disabling {entry.agent_name} — choose what happens when a
                      spawn is requested anyway
                    </span>
                    {picker.forced && !picker.error && (
                      <p className="text-xs text-muted-foreground">
                        The server requires a disposition to disable this agent.
                      </p>
                    )}
                    {DISPOSITIONS.map((d) => (
                      <label
                        key={d.value}
                        className="flex items-start gap-2 cursor-pointer"
                      >
                        <input
                          type="radio"
                          className="radio mt-0.5"
                          name={`disposition-${entry.agent_name}`}
                          checked={picker.selected === d.value}
                          onChange={() =>
                            setPickers((prev) => ({
                              ...prev,
                              [entry.agent_name]: {
                                selected: d.value,
                                error: null,
                                forced: prev[entry.agent_name]?.forced ?? false,
                              },
                            }))
                          }
                        />
                        <span className="text-sm">
                          <span className="font-medium">{d.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {d.explanation}
                          </span>
                        </span>
                      </label>
                    ))}
                    {picker.error && (
                      <p className="form-error">{picker.error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={saving}
                      onClick={() => handlePickerSave(entry.agent_name)}
                    >
                      {saving && <Loader2 className="size-3.5 animate-spin" />}
                      Disable agent
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={saving}
                      onClick={() => closePicker(entry.agent_name)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

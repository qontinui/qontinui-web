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
 * The switch is driven ENTIRELY by server state (`checked={entry.enabled}`)
 * and is disabled while a save is in flight, so there is no local toggle
 * state that a failed save could leave disagreeing with the truth. Do not add
 * optimistic toggling or rollback here: a failed save already leaves the
 * control showing the truth, and optimism would be the only way to make it
 * show something else.
 *
 * Two refusals that are ABOUT THE ACCOUNT (a plain authorization 403, and
 * `operator_not_provisioned_in_web`) render as distinct, standing inline
 * states rather than toasts — see `DENIAL_COPY`. Transport and server
 * failures keep the toast.
 *
 * Backend: GET /api/v1/agent-registry, PUT /api/v1/agent-registry/prefs/{name}
 * (Phase 4d of plan 2026-07-28-migrate-claude-md-into-qontinui.md; the pref
 * write moved onto coord's SELF door — so it works for every member, not only
 * admins — in Phase 2 of plan
 * 2026-08-22-agent-registry-prefs-are-admin-only-and-the-tenant-default-has-no-ui).
 * The tenant DEFAULT behind these rows is edited at /admin/coord/agent-registry.
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

/**
 * A refusal that is ABOUT THE ACCOUNT, not about the request.
 *
 * Both arrive as 403 and neither is a transport failure, so neither belongs in
 * `toast.error(err.message)` with coord's raw text — a toast disappears, and
 * the reader is left with a switch that did not move and no standing
 * explanation of why. They render inline beside the agent, like the 422
 * disposition picker.
 *
 * They are kept DISTINCT because the remedy differs and the wrong one wastes
 * the reader's time:
 *
 * - `not_authorized` — the tenant has restricted this lever. Ask an admin.
 * - `not_provisioned` — the coord operator's verified email matches no
 *   qontinui-web account. No admin can grant a permission that would fix this;
 *   the two accounts have to be linked first.
 *
 * Both stay reachable after the write moved to coord's self door: a tenant may
 * later restrict the lever, and account linking can lapse independently.
 */
type DenialKind = "not_authorized" | "not_provisioned";

const DENIAL_COPY: Record<
  DenialKind,
  { title: string; body: string; testId: string }
> = {
  not_authorized: {
    title: "Your account cannot change this",
    body:
      "This tenant does not allow your account to change agent preferences. " +
      "A tenant administrator can change it for you, or grant you the role.",
    testId: "agent-pref-denied-not-authorized",
  },
  not_provisioned: {
    title: "Your coord account is not linked to a qontinui account",
    body:
      "Coord recognises your sign-in, but its verified email matches no " +
      "qontinui-web account, so there is no profile to save the preference " +
      "against. This is an account-linking problem, not a permissions one — " +
      "granting your account a role will not fix it. Ask an administrator to " +
      "link the two accounts.",
    testId: "agent-pref-denied-not-provisioned",
  },
};

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
  // Per-agent, for the same reason `savingAgents` is a set: a denial on one
  // row says nothing about another, and a single value would clear the
  // standing explanation the moment an unrelated row was toggled.
  const [denials, setDenials] = useState<Record<string, DenialKind>>({});

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

  const clearDenial = (agentName: string) => {
    setDenials((prev) => {
      if (!(agentName in prev)) return prev;
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
    // A retry starts from no standing explanation: leaving the previous one
    // up while a new attempt is in flight states a refusal that has not
    // happened yet.
    clearDenial(agentName);
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
      } else if (err instanceof AgentPrefError && err.status === 403) {
        // A refusal ABOUT THE ACCOUNT — inline and standing, never a toast.
        // The two codes are rendered distinctly because the remedy differs;
        // see `DENIAL_COPY`. An unrecognised 403 body is the plain
        // authorization case: coord's prose for it is not a stable contract,
        // so the status is what is keyed on, not the message.
        setDenials((prev) => ({
          ...prev,
          [agentName]:
            err.code === "operator_not_provisioned_in_web"
              ? "not_provisioned"
              : "not_authorized",
        }));
        // The picker asks for a choice that cannot be saved by this account.
        closePicker(agentName);
      } else {
        // Everything left is a transport or server failure — genuinely
        // transient, and a toast is the right weight for it.
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
          const denial = denials[entry.agent_name];
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

              {denial && (
                <div
                  className="card-footer space-y-2"
                  data-testid={DENIAL_COPY[denial].testId}
                  role="status"
                >
                  <p className="form-error font-medium">
                    {DENIAL_COPY[denial].title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {DENIAL_COPY[denial].body}
                  </p>
                  {/* The switch above still shows what the SERVER has
                      recorded, so this explains why it did not move rather
                      than apologising for a state it is not in. */}
                  <p className="text-xs text-muted-foreground italic">
                    {recordedLine(entry)} — unchanged.
                  </p>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => clearDenial(entry.agent_name)}
                  >
                    Dismiss
                  </button>
                </div>
              )}

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

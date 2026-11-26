"use client";

/**
 * "Spawns: On / Off" — the tenant-admin CEILING for one agent type (plan
 * `2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type` D1).
 *
 * Deliberately a different control, with a different label, from the row's
 * "Default for members" toggle: the default is what a member with no
 * preference gets and a member may override it; this switch binds every
 * member and no preference widens it.
 *
 * Driven entirely by what the catalog serves (`state`), never by local
 * optimism. Switching OFF opens an inline confirmation — the reason the admin
 * gives is recorded on the row and served in coord's catalog, which every
 * member reads, and a policy-required type needs its disposition
 * picked from the row's own `allowed_dispositions` (plan D5). Switching back
 * ON is immediate.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type {
  AgentAdminSwitchUpdate,
  AgentDisposition,
} from "@/lib/api/agent-registry";
import type { SpawnSwitchState } from "../_lib/agentCatalog";
import type { SwitchStatus } from "../_hooks/useAdminSpawnSwitch";

const DISPOSITION_COPY: Record<string, { label: string; explanation: string }> =
  {
    block: {
      label: "Block",
      explanation: "A spawn request for this agent is refused outright.",
    },
    degrade: {
      label: "Degrade to inline",
      explanation: "The work runs inline in the calling session instead.",
    },
    warn_proceed: {
      label: "Warn & proceed",
      explanation: "The spawn goes ahead with a recorded warning.",
    },
  };

/** Coord's `MAX_REASON_CHARS`. */
export const MAX_REASON_CHARS = 500;

/** A refusal is red (the write did not happen and the reader must act); an
 *  unknown outcome is the ignorance floor's amber, never calm and never red. */
export const STATUS_TEXT: Record<SwitchStatus["phase"], string> = {
  in_flight: "text-muted-foreground",
  done: "text-muted-foreground",
  failed: "text-red-200",
  unknown: "text-amber-200",
};

const STATE_LABEL: Record<SpawnSwitchState, string> = {
  on: "On",
  off: "Off",
  unknown: "Unknown",
};

export interface SpawnSwitchToggleProps {
  agentName: string;
  state: SpawnSwitchState;
  /** `null` when the reader may change the switch; otherwise why not. */
  readOnlyReason: string | null;
  status: SwitchStatus | undefined;
  confirming: boolean;
  /** Switching back ON writes at once. */
  onSwitchOn: () => void;
  /** Switching OFF opens the confirmation below the line. */
  onRequestOff: () => void;
}

/** The inline half: sits on the record's one line (R2). */
export function SpawnSwitchToggle({
  agentName,
  state,
  readOnlyReason,
  status,
  confirming,
  onSwitchOn,
  onRequestOff,
}: SpawnSwitchToggleProps) {
  const inFlight = status?.phase === "in_flight";
  const disabled =
    readOnlyReason !== null || inFlight || state === "unknown" || confirming;
  return (
    <span
      className="flex items-center gap-1.5 shrink-0 text-xs"
      data-testid={`agent-spawn-switch-${agentName}`}
      data-switch-state={state}
      title={readOnlyReason ?? undefined}
    >
      <span className="font-medium whitespace-nowrap">Spawns:</span>
      {inFlight && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      <Switch
        checked={state === "on"}
        disabled={disabled}
        onCheckedChange={(checked) => (checked ? onSwitchOn() : onRequestOff())}
        aria-label={`Spawns of ${agentName}`}
      />
      <span
        className="whitespace-nowrap w-14"
        data-testid={`agent-spawn-switch-label-${agentName}`}
      >
        {STATE_LABEL[state]}
      </span>
    </span>
  );
}

export interface SpawnSwitchPanelProps {
  agentName: string;
  readOnlyReason: string | null;
  needsDisposition: boolean;
  allowedDispositions: readonly string[];
  status: SwitchStatus | undefined;
  confirming: boolean;
  onCancel: () => void;
  onConfirmOff: (update: AgentAdminSwitchUpdate) => void;
}

/** The half under the line: the OFF confirmation, then the write's status. */
export function SpawnSwitchPanel({
  agentName,
  readOnlyReason,
  needsDisposition,
  allowedDispositions,
  status,
  confirming,
  onCancel,
  onConfirmOff,
}: SpawnSwitchPanelProps) {
  const [disposition, setDisposition] = useState<AgentDisposition | null>(null);
  const [reason, setReason] = useState("");

  const confirmOff = () => {
    const update: AgentAdminSwitchUpdate = { disabled: true };
    if (needsDisposition && disposition) update.disposition = disposition;
    const trimmed = reason.trim();
    if (trimmed) update.reason = trimmed;
    setDisposition(null);
    setReason("");
    onConfirmOff(update);
  };

  const cancel = () => {
    setDisposition(null);
    setReason("");
    onCancel();
  };

  if (!confirming && !status) return null;
  return (
    <div className="px-3 py-1 space-y-1.5">
      {confirming && readOnlyReason === null && (
        <div
          className="rounded-md border bg-card/30 px-3 py-2 space-y-2"
          data-testid={`agent-spawn-switch-confirm-${agentName}`}
        >
          <p className="text-xs">
            Switch spawns of <span className="font-mono">{agentName}</span> off
            for every member of this tenant? A member&apos;s own preference
            cannot turn it back on.
          </p>
          {needsDisposition && (
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium">
                What happens when a spawn is requested anyway
              </legend>
              {allowedDispositions.map((d) => (
                <label
                  key={d}
                  className="flex items-start gap-2 text-xs cursor-pointer"
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    name={`admin-disposition-${agentName}`}
                    checked={disposition === d}
                    onChange={() => setDisposition(d as AgentDisposition)}
                  />
                  <span>
                    <span className="font-medium">
                      {DISPOSITION_COPY[d]?.label ?? d}
                    </span>
                    {DISPOSITION_COPY[d] && (
                      <span className="block text-muted-foreground">
                        {DISPOSITION_COPY[d].explanation}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              {allowedDispositions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  This agent&apos;s row lists no allowed dispositions.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                With none picked, coord degrades the work to inline.
              </p>
            </fieldset>
          )}
          <Input
            className="h-8 text-xs"
            placeholder="Reason (optional, shown to every member)"
            value={reason}
            maxLength={MAX_REASON_CHARS}
            onChange={(e) => setReason(e.target.value)}
            aria-label={`Reason for switching off ${agentName}`}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={confirmOff}
              data-testid={`agent-spawn-switch-confirm-off-${agentName}`}
            >
              Switch spawns off
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {status && (
        <p
          className={`text-[11px] ${STATUS_TEXT[status.phase]}`}
          data-testid={`agent-spawn-switch-status-${agentName}`}
          data-phase={status.phase}
          role="status"
        >
          {status.message}
        </p>
      )}
    </div>
  );
}

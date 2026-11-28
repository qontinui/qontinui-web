"use client";

/**
 * The tenant-admin spawn switch's write, per agent type: in flight, done, or
 * failed with coord's own reason — then a re-read (ux-priorities
 * `an-action-must-acknowledge-itself`).
 *
 * The switch itself is driven entirely by what the catalog SERVES; this hook
 * keeps no optimistic state. A failed write therefore leaves the switch
 * showing the truth, and the status line says why it did not move.
 */

import { useCallback, useState } from "react";
import { outcomeUnknownReason } from "@/components/admin/coord/writeOutcome";
import {
  AgentAdminSwitchError,
  isWriteOutcomeUnknown,
  putAgentAdminSwitch,
  type AgentAdminSwitchUpdate,
} from "@/lib/api/agent-registry";

export type SwitchPhase = "in_flight" | "done" | "failed" | "unknown";

export interface SwitchStatus {
  phase: SwitchPhase;
  message: string;
}

/** Coord's refusal codes, said as the reason the switch did not move. */
const REFUSAL_COPY: Record<string, string> = {
  invalid_agent_name: "Coord refused the agent type name",
  disposition_not_allowed: "That disposition is not allowed for this agent",
  disposition_requires_disabled:
    "A disposition can only be chosen when switching spawns off",
  reason_too_long: "The reason is too long",
  registry_not_provisioned:
    "This tenant's agent registry is not provisioned yet",
};

function refusalText(err: unknown): string {
  if (err instanceof AgentAdminSwitchError) {
    const lead = err.coordCode ? REFUSAL_COPY[err.coordCode] : undefined;
    if (err.status === 403) {
      return `Not saved: only a tenant administrator can change this switch (${err.message}).`;
    }
    return lead && err.message !== err.coordCode
      ? `Not saved: ${lead} — ${err.message}`
      : `Not saved: ${lead ?? err.message}`;
  }
  return `Not saved: ${err instanceof Error ? err.message : String(err)}`;
}

export interface AdminSpawnSwitch {
  statuses: Readonly<Record<string, SwitchStatus>>;
  /** Write the ceiling, then call `reread` (which resolves with whether the
   *  screen now holds a read made after the write). */
  flip: (
    agentName: string,
    update: AgentAdminSwitchUpdate,
    reread: () => Promise<boolean>
  ) => Promise<void>;
  dismiss: (agentName: string) => void;
}

export function useAdminSpawnSwitch(): AdminSpawnSwitch {
  const [statuses, setStatuses] = useState<Record<string, SwitchStatus>>({});

  const set = useCallback((name: string, status: SwitchStatus) => {
    setStatuses((prev) => ({ ...prev, [name]: status }));
  }, []);

  const dismiss = useCallback((name: string) => {
    setStatuses((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const flip = useCallback(
    async (
      agentName: string,
      update: AgentAdminSwitchUpdate,
      reread: () => Promise<boolean>
    ) => {
      const verb = update.disabled ? "off" : "back on";
      set(agentName, {
        phase: "in_flight",
        message: `Switching spawns ${verb}…`,
      });
      try {
        await putAgentAdminSwitch(agentName, update);
      } catch (err) {
        if (isWriteOutcomeUnknown(err)) {
          // The change may have landed: only a re-read can say.
          const unknown = `Whether this change was applied is unknown (${outcomeUnknownReason(err)}).`;
          set(agentName, {
            phase: "unknown",
            message: `${unknown} Re-reading what coord serves.`,
          });
          set(agentName, {
            phase: "unknown",
            message: (await reread())
              ? `${unknown} What is shown is a read made after it.`
              : `${unknown} The re-read failed too, so what is shown may be out of date.`,
          });
          return;
        }
        set(agentName, { phase: "failed", message: refusalText(err) });
        return;
      }
      const done = update.disabled
        ? "Saved: spawns of this type are off for every member of the tenant."
        : "Saved: spawns are back on; each member's own choice applies again.";
      set(agentName, {
        phase: "done",
        message: (await reread())
          ? done
          : `${done} The re-read failed, so what is shown may be out of date.`,
      });
    },
    [set]
  );

  return { statuses, flip, dismiss };
}

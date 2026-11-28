"use client";

/**
 * "Add agent type by name" — for a custom agent no catalog source lists (plan
 * D2). The name is lowercased and checked against coord's grammar here, so
 * the field says what is wrong before a round trip; coord's own 422
 * `invalid_agent_name` is still what decides.
 *
 * Adding a name writes nothing by itself (plan D3: a row is written only when
 * an admin makes a decision). Its one action is the decision: switch spawns of
 * that type off, through the same admin-switch door every listed type uses.
 * A name already listed is not re-added — the reader is pointed at its line.
 * Like every listed line, the switch-off is confirmed first and may carry a
 * reason: one click on a typo must not switch a type off tenant-wide.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agentNameProblem, normalizeAgentName } from "../_lib/agentCatalog";
import { MAX_REASON_CHARS } from "./AdminSpawnSwitch";

export interface AddAgentByNameProps {
  knownNames: ReadonlySet<string>;
  /** Called, once confirmed, with the normalized name of a type that is not
   *  listed yet and the admin's reason (absent when none was given). */
  onSwitchOff: (agentName: string, reason?: string) => void;
  /** Called with a name that is already listed, to bring its line into view. */
  onShowExisting: (agentName: string) => void;
}

export function AddAgentByName({
  knownNames,
  onSwitchOff,
  onShowExisting,
}: AddAgentByNameProps) {
  const [raw, setRaw] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const name = normalizeAgentName(raw);

  const submit = () => {
    const issue = agentNameProblem(name);
    if (issue) {
      setProblem(issue);
      return;
    }
    if (knownNames.has(name)) {
      setProblem(`"${name}" is already listed below.`);
      onShowExisting(name);
      return;
    }
    setProblem(null);
    setPending(name);
  };

  const confirm = () => {
    if (pending === null) return;
    const trimmed = reason.trim();
    onSwitchOff(pending, trimmed || undefined);
    setPending(null);
    setReason("");
    setRaw("");
  };

  const cancel = () => {
    setPending(null);
    setReason("");
  };

  return (
    <form
      className="rounded-md border bg-card/20 px-3 py-2 space-y-1.5"
      data-testid="agent-registry-add-by-name"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label
        className="text-xs font-medium block"
        htmlFor="agent-registry-add-name"
      >
        Add agent type by name
      </label>
      <p className="text-[11px] text-muted-foreground">
        For a custom agent type the list does not show. Its spawns are switched
        off for the whole tenant; nothing is recorded until you do.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          id="agent-registry-add-name"
          className="h-8 w-64 text-xs font-mono"
          placeholder="e.g. my-custom-agent"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setProblem(null);
            setPending(null);
          }}
          aria-invalid={problem !== null}
          aria-describedby="agent-registry-add-name-problem"
        />
        <Button type="submit" size="sm" variant="outline">
          Switch its spawns off
        </Button>
        {raw && name !== raw && !problem && (
          <span className="text-[11px] text-muted-foreground">
            Saved as <span className="font-mono">{name}</span>
          </span>
        )}
      </div>
      {pending !== null && (
        <div
          className="rounded-md border bg-card/30 px-3 py-2 space-y-2"
          data-testid="agent-registry-add-confirm"
        >
          <p className="text-xs">
            Switch spawns of <span className="font-mono">{pending}</span> off
            for every member of this tenant? A member&apos;s own preference
            cannot turn it back on.
          </p>
          <Input
            className="h-8 text-xs"
            placeholder="Reason (optional, shown to every member)"
            value={reason}
            maxLength={MAX_REASON_CHARS}
            onChange={(e) => setReason(e.target.value)}
            aria-label={`Reason for switching off ${pending}`}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={confirm}
              data-testid="agent-registry-add-confirm-off"
            >
              Switch spawns off
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {problem && (
        <p
          id="agent-registry-add-name-problem"
          className="text-[11px] text-red-200"
          data-testid="agent-registry-add-name-problem"
          role="alert"
        >
          {problem}
        </p>
      )}
    </form>
  );
}

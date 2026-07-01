"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DevenvApiError,
  setMachineEnvironment,
  type Environment,
  type Machine,
} from "@/services/devenv-api";

/** Sentinel Select value for "no environment" (shadcn forbids empty values). */
const UNBOUND = "__none__";

interface MachineEnvironmentSelectorProps {
  machine: Machine;
  environments: Environment[];
  /** Called with the updated machine after a successful (un)bind. */
  onBound: (updated: Machine) => void;
}

/**
 * Per-machine dropdown that binds a machine to an environment (or unbinds it
 * via the "No environment" option). Selecting an option issues
 * `PUT /machines/{id}/environment`. This is the P1 explicit binding that
 * enrollment honors when a tenant has several environments.
 */
export function MachineEnvironmentSelector({
  machine,
  environments,
  onBound,
}: MachineEnvironmentSelectorProps) {
  const [saving, setSaving] = useState(false);

  const handleSelect = async (value: string) => {
    const nextEnvId = value === UNBOUND ? null : value;
    if (nextEnvId === machine.environment_id) return;
    setSaving(true);
    try {
      const updated = await setMachineEnvironment(machine.id, nextEnvId);
      const env = environments.find((e) => e.id === nextEnvId);
      toast.success(
        env
          ? `${machine.name} bound to ${env.name}`
          : `${machine.name} unbound from its environment`
      );
      onBound(updated);
    } catch (err) {
      const message =
        err instanceof DevenvApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to update environment binding";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        value={machine.environment_id ?? UNBOUND}
        onValueChange={handleSelect}
        disabled={saving || machine.revoked}
      >
        <SelectTrigger className="w-56" aria-label="Machine environment">
          <SelectValue placeholder="No environment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNBOUND}>No environment</SelectItem>
          {environments.map((env) => (
            <SelectItem key={env.id} value={env.id}>
              {env.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {saving && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

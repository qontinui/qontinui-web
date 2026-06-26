"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Crown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DevenvApiError,
  setCanonicalMachine,
  type Machine,
} from "@/services/devenv-api";

interface CanonicalSelectorProps {
  environmentId: string;
  /** Current canonical machine id, or null when none is set. */
  canonicalMachineId: string | null;
  /**
   * Machines that have reported a config for this environment — only these
   * are eligible to be canonical (the backend rejects others with a 409).
   */
  eligibleMachines: Machine[];
  /** Called with the updated canonical machine id after a successful set. */
  onCanonicalChange: (machineId: string) => void;
}

/**
 * Dropdown of machines eligible to be the canonical source of truth for an
 * environment. Selecting one issues `PUT .../canonical`. The current
 * canonical machine is highlighted with a crown badge.
 */
export function CanonicalSelector({
  environmentId,
  canonicalMachineId,
  eligibleMachines,
  onCanonicalChange,
}: CanonicalSelectorProps) {
  const [saving, setSaving] = useState(false);

  const canonical = useMemo(
    () => eligibleMachines.find((m) => m.id === canonicalMachineId) ?? null,
    [eligibleMachines, canonicalMachineId]
  );

  const handleSelect = async (machineId: string) => {
    if (machineId === canonicalMachineId) return;
    setSaving(true);
    try {
      await setCanonicalMachine(environmentId, machineId);
      const picked = eligibleMachines.find((m) => m.id === machineId);
      toast.success(
        picked
          ? `${picked.name} is now the canonical machine`
          : "Canonical machine updated"
      );
      onCanonicalChange(machineId);
    } catch (err) {
      const message =
        err instanceof DevenvApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to set canonical machine";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (eligibleMachines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No machines have reported a config for this environment yet. A machine
        must report a config before it can be designated canonical.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Select
        value={canonicalMachineId ?? undefined}
        onValueChange={handleSelect}
        disabled={saving}
      >
        <SelectTrigger className="w-72">
          <SelectValue placeholder="Select canonical machine" />
        </SelectTrigger>
        <SelectContent>
          {eligibleMachines.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {saving && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      )}

      {canonical && !saving && (
        <Badge variant="brand-primary" className="gap-1">
          <Crown className="size-3" />
          {canonical.name}
        </Badge>
      )}
    </div>
  );
}

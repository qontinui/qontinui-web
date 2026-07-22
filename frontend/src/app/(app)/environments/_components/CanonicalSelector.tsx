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
import { CanonicalHistoryPanel } from "./CanonicalHistoryPanel";
import { DesignateCanonicalDialog } from "./DesignateCanonicalDialog";

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
 * environment. Picking one opens a confirm dialog that also captures the
 * optional reason, then issues `PUT .../canonical`. The current canonical
 * machine is highlighted with a crown badge.
 *
 * The canonical-designation audit trail ("set by X at Y, because Z") renders
 * directly below the control that changes it, and refetches after a successful
 * set so the change you just made shows up without a reload.
 */
export function CanonicalSelector({
  environmentId,
  canonicalMachineId,
  eligibleMachines,
  onCanonicalChange,
}: CanonicalSelectorProps) {
  const [saving, setSaving] = useState(false);
  /** Bumped after a successful set so the history panel refetches. */
  const [historyKey, setHistoryKey] = useState(0);
  /**
   * The machine picked in the dropdown, awaiting confirmation — held as a
   * SNAPSHOT rather than an id. The parent rebuilds `eligibleMachines` on
   * every 10s drift poll, so a staged id would need re-resolving (and a guard
   * for the machine dropping out mid-dialog); a snapshot cannot go stale.
   */
  const [pending, setPending] = useState<Machine | null>(null);

  const canonical = useMemo(
    () => eligibleMachines.find((m) => m.id === canonicalMachineId) ?? null,
    [eligibleMachines, canonicalMachineId]
  );

  // Selecting only stages the change; the dialog confirms it. The Select stays
  // controlled by `canonicalMachineId`, so cancelling snaps it back on its own.
  const handleSelect = (machineId: string) => {
    if (machineId === canonicalMachineId) return;
    setPending(eligibleMachines.find((m) => m.id === machineId) ?? null);
  };

  const handleConfirm = async (note: string) => {
    if (!pending) return;
    const { id: machineId, name } = pending;
    setSaving(true);
    try {
      await setCanonicalMachine(environmentId, machineId, note);
      toast.success(`${name} is now the canonical machine`);
      setPending(null);
      onCanonicalChange(machineId);
      setHistoryKey((k) => k + 1);
    } catch (err) {
      const message =
        err instanceof DevenvApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to set canonical machine";
      toast.error(message);
      // Leave the dialog open: the note the operator typed survives a retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Even with no eligible machines the audit trail can be non-empty — the
          machine refs are soft, so past designations survive machine deletion.
          The panel renders in ONE position either way: moving it across this
          branch would remount it (and refetch) the moment drift resolves. */}
      {eligibleMachines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No machines have reported a config for this environment yet. A machine
          must report a config before it can be designated canonical.
        </p>
      ) : (
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
      )}

      <CanonicalHistoryPanel
        environmentId={environmentId}
        refreshKey={historyKey}
      />

      <DesignateCanonicalDialog
        // Remounts per designation, so each starts from a blank note.
        key={pending?.id ?? "none"}
        machineName={pending?.name ?? null}
        currentCanonicalName={canonical?.name ?? null}
        saving={saving}
        onConfirm={handleConfirm}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

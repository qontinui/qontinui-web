"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Server, Wifi, WifiOff } from "lucide-react";
import type { Runner } from "@qontinui/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { runnerService } from "@/services/service-factory";
import {
  dispatchEnroll,
  type Environment,
  type MachineCreated,
} from "@/services/devenv-api";

interface DispatchMachineModalProps {
  open: boolean;
  /** Environments the machine can optionally be bound to at creation. */
  environments: Environment[];
  onClose: () => void;
  /** The dispatch landed — refresh the machine list. */
  onDispatched: () => void;
  /**
   * The dispatch could not be delivered (device offline / coord rejected). The
   * machine + one-time code were still created; the parent shows the copy-paste
   * command modal so the operator can enroll manually.
   */
  onFallback: (machine: MachineCreated) => void;
}

function isOnline(r: Runner): boolean {
  return r.wsConnected || r.derivedStatus === "healthy";
}

/**
 * "Enroll a paired machine" — lists the operator's paired runners and dispatches
 * an enroll directive to the chosen one (Phase 3). Offline/unpaired boxes are
 * shown disabled with a note to use the copy-paste command instead.
 */
export function DispatchMachineModal({
  open,
  environments,
  onClose,
  onDispatched,
  onFallback,
}: DispatchMachineModalProps) {
  const [devices, setDevices] = useState<Runner[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [environmentId, setEnvironmentId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingDevices(true);
    runnerService
      .getRunners()
      .then((rs) => {
        if (!cancelled) setDevices(rs);
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load paired devices");
      })
      .finally(() => {
        if (!cancelled) setLoadingDevices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    setSelected(null);
    setName("");
    setEnvironmentId("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleDispatch = async () => {
    if (!selected || !name.trim()) return;
    setSubmitting(true);
    try {
      const res = await dispatchEnroll({
        name: name.trim(),
        target_device_id: selected,
        environment_id: environmentId || null,
      });
      if (res.dispatched) {
        toast.success(`Enroll dispatched to the runner for "${name.trim()}"`);
        onDispatched();
        handleClose();
      } else {
        toast.warning(
          res.detail ?? "Could not reach the runner — enroll it manually.",
        );
        onFallback(res.machine);
        handleClose();
      }
    } catch {
      toast.error("Dispatch failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="size-5" />
            Enroll a paired machine
          </DialogTitle>
          <DialogDescription>
            Pick an already-paired runner and we&apos;ll enroll it directly — no
            terminal, no copy-paste. Offline boxes fall back to the command.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <span className="text-xs font-medium">Machine name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. MSI"
              disabled={submitting}
            />
          </div>

          {environments.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Environment (optional)
              </span>
              <select
                value={environmentId}
                onChange={(e) => setEnvironmentId(e.target.value)}
                disabled={submitting}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Auto-bind on enroll</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <span className="text-xs font-medium">Paired devices</span>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {loadingDevices ? (
                <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading devices…
                </div>
              ) : devices.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  No paired devices found. Pair a runner first, or create the
                  machine and use the copy-paste command.
                </p>
              ) : (
                devices.map((d) => {
                  const online = isOnline(d);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      disabled={!online || submitting}
                      onClick={() => setSelected(d.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                        selected === d.id
                          ? "bg-muted ring-1 ring-border"
                          : "hover:bg-muted/60"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {d.name || "Unknown device"}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {d.hostname || d.id.slice(0, 8)}
                        </span>
                      </span>
                      {online ? (
                        <Wifi className="size-4 shrink-0 text-green-600 dark:text-green-500" />
                      ) : (
                        <WifiOff className="size-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            onClick={handleDispatch}
            disabled={!selected || !name.trim() || submitting}
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? "Dispatching…" : "Enroll this machine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

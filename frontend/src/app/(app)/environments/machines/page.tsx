"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Activity,
  AlertTriangle,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  ShieldX,
  Trash2,
} from "lucide-react";
import { relativeTime } from "@/components/operations/utils";
import { EnrollCodeModal } from "../_components/EnrollCodeModal";
import { DispatchMachineModal } from "../_components/DispatchMachineModal";
import { MachineEnvironmentSelector } from "../_components/MachineEnvironmentSelector";
import {
  createMachine,
  deleteMachine,
  DevenvApiError,
  listEnvironments,
  listMachines,
  regenerateEnrollment,
  revokeMachine,
  type Environment,
  type Machine,
  type MachineCreated,
} from "@/services/devenv-api";

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof DevenvApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);
  const [enrollMachine, setEnrollMachine] = useState<MachineCreated | null>(
    null
  );
  const [dispatchOpen, setDispatchOpen] = useState(false);

  const fetchMachines = useCallback(async () => {
    // The auth token can lag a first paint right after login (e.g. landing
    // here via a `?next=` deep link). A one-shot fetch that lands in that
    // window would strand the page on a misleading empty state, so retry a
    // few times with backoff before surfacing the error — the same race the
    // polling operations dashboards mask by simply fetching again next tick.
    const MAX_ATTEMPTS = 4;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const [machineData, envData] = await Promise.all([
          listMachines(),
          listEnvironments(),
        ]);
        setMachines(machineData);
        setEnvironments(envData);
        setLoadError(null);
        setLoading(false);
        return;
      } catch (err) {
        if (attempt === MAX_ATTEMPTS - 1) {
          // Exhausted retries: a failed load must NOT masquerade as an empty
          // tenant. Record the error so the UI offers a retry instead of the
          // misleading "no machines yet" empty state.
          const message = errMessage(err, "Failed to load machines");
          setLoadError(message);
          setLoading(false);
          toast.error(message);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
      }
    }
  }, []);

  const applyMachineUpdate = useCallback((updated: Machine) => {
    setMachines((prev) =>
      prev.map((m) => (m.id === updated.id ? updated : m))
    );
  }, []);

  useEffect(() => {
    fetchMachines();
  }, [fetchMachines]);

  const handleAdd = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Machine name is required");
      return;
    }
    setAdding(true);
    try {
      const created = await createMachine({
        name: trimmedName,
        hostname: hostname.trim() || null,
        description: description.trim() || null,
      });
      toast.success(`Registered ${trimmedName}`);
      setName("");
      setHostname("");
      setDescription("");
      setEnrollMachine(created);
      await fetchMachines();
    } catch (err) {
      toast.error(errMessage(err, "Failed to register machine"));
    } finally {
      setAdding(false);
    }
  };

  const handleRegenerate = async (machine: Machine) => {
    try {
      const created = await regenerateEnrollment(machine.id);
      toast.success(`New enrollment code minted for ${machine.name}`);
      setEnrollMachine(created);
      await fetchMachines();
    } catch (err) {
      toast.error(errMessage(err, "Failed to regenerate enrollment code"));
    }
  };

  const handleRevoke = async (machine: Machine) => {
    try {
      await revokeMachine(machine.id);
      toast.success(`Revoked ${machine.name}`);
      await fetchMachines();
    } catch (err) {
      toast.error(errMessage(err, `Failed to revoke ${machine.name}`));
    }
  };

  const handleDelete = async (machine: Machine) => {
    try {
      await deleteMachine(machine.id);
      toast.success(`Removed ${machine.name}`);
      await fetchMachines();
    } catch (err) {
      toast.error(errMessage(err, `Failed to remove ${machine.name}`));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <EnrollCodeModal
        machine={enrollMachine}
        onClose={() => setEnrollMachine(null)}
      />
      <DispatchMachineModal
        open={dispatchOpen}
        environments={environments}
        onClose={() => setDispatchOpen(false)}
        onDispatched={() => {
          setLoading(true);
          fetchMachines();
        }}
        onFallback={(machine) => setEnrollMachine(machine)}
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="size-5" />
            Machines
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Register machines and manage their enrollment credentials
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="brand-primary"
            size="sm"
            onClick={() => setDispatchOpen(true)}
          >
            Enroll a paired machine
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoading(true);
              fetchMachines();
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Add machine form */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium">Register Machine</h3>
          <p className="text-xs text-muted-foreground">
            A one-time enrollment code is shown immediately after registration
          </p>
        </div>
        <div className="p-4">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleAdd();
            }}
          >
            <Input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background border-border max-w-xs text-sm"
            />
            <Input
              type="text"
              placeholder="hostname (optional)"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              className="bg-background border-border max-w-[14rem] font-mono text-sm"
            />
            <Input
              type="text"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-background border-border max-w-sm text-sm"
            />
            <Button
              type="submit"
              variant="brand-primary"
              size="sm"
              disabled={adding || !name.trim()}
            >
              {adding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Register Machine
            </Button>
          </form>
        </div>
      </div>

      {/* Machine list */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Server className="size-4" />
              Registered Machines
            </h3>
            {machines.length > 0 && (
              <Badge variant="secondary">{machines.length}</Badge>
            )}
          </div>
        </div>
        <div className="p-4">
          {loadError && machines.length === 0 ? (
            <div className="text-center py-12">
              <AlertTriangle className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load machines.
              </p>
              <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setLoading(true);
                  fetchMachines();
                }}
              >
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </div>
          ) : machines.length === 0 ? (
            <div className="text-center py-12">
              <Server className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No machines registered yet. Register one above to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {machines.map((machine) => (
                <div
                  key={machine.id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Server className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {machine.name}
                        </p>
                        {machine.revoked ? (
                          <Badge variant="destructive">revoked</Badge>
                        ) : machine.enrolled ? (
                          <Badge variant="success">enrolled</Badge>
                        ) : (
                          <Badge variant="warning">pending</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                        {machine.hostname && (
                          <span className="font-mono">{machine.hostname}</span>
                        )}
                        {machine.key_prefix && (
                          <span className="font-mono">
                            key {machine.key_prefix}…
                          </span>
                        )}
                        <span>
                          last seen {relativeTime(machine.last_seen_at)}
                        </span>
                        {machine.coord_device_id && (
                          <Link
                            href={`/environments/sessions?device=${encodeURIComponent(machine.coord_device_id)}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <Activity className="size-3" />
                            sessions
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <MachineEnvironmentSelector
                      machine={machine}
                      environments={environments}
                      onBound={applyMachineUpdate}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRegenerate(machine)}
                    >
                      <KeyRound className="size-4" />
                      Re-enroll
                    </Button>

                    {!machine.revoked && machine.enrolled && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <ShieldX className="size-4 text-muted-foreground" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke machine?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This revokes{" "}
                              <span className="font-medium">
                                {machine.name}
                              </span>
                              &apos;s key. All future agent calls from it will be
                              rejected until it re-enrolls.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction asChild>
                              <DestructiveButton
                                onClick={() => handleRevoke(machine)}
                              >
                                Revoke
                              </DestructiveButton>
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove machine?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes{" "}
                            <span className="font-medium">{machine.name}</span>{" "}
                            and its config history.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction asChild>
                            <DestructiveButton
                              onClick={() => handleDelete(machine)}
                            >
                              Remove
                            </DestructiveButton>
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

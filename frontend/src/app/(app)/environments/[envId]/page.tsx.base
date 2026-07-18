"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Boxes,
  Crown,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { CanonicalSelector } from "../_components/CanonicalSelector";
import { DriftMatrix } from "../_components/DriftMatrix";
import {
  DevenvApiError,
  DRIFT_POLL_MS,
  getEnvironment,
  getEnvironmentDrift,
  listMachines,
  type Environment,
  type EnvironmentDrift,
  type Machine,
} from "@/services/devenv-api";

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof DevenvApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function EnvironmentDetailPage() {
  const params = useParams<{ envId: string }>();
  const envId = params.envId;

  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [drift, setDrift] = useState<EnvironmentDrift | null>(null);
  /** Truthy only for the 422 "no canonical machine set" case. */
  const [noCanonical, setNoCanonical] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Avoid overlapping drift fetches when a poll fires mid-request.
  const driftInFlight = useRef(false);

  const fetchEnvAndMachines = useCallback(async () => {
    const [env, machineList] = await Promise.all([
      getEnvironment(envId),
      listMachines(),
    ]);
    setEnvironment(env);
    setMachines(machineList);
    return env;
  }, [envId]);

  const fetchDrift = useCallback(async () => {
    if (driftInFlight.current) return;
    driftInFlight.current = true;
    try {
      const report = await getEnvironmentDrift(envId);
      setDrift(report);
      setNoCanonical(false);
    } catch (err) {
      if (err instanceof DevenvApiError && err.status === 422) {
        // No canonical machine set yet — expected state, not an error toast.
        setDrift(null);
        setNoCanonical(true);
      } else {
        toast.error(errMessage(err, "Failed to load drift"));
      }
    } finally {
      driftInFlight.current = false;
    }
  }, [envId]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const env = await fetchEnvAndMachines();
        if (cancelled) return;
        if (env.canonical_machine_id) {
          await fetchDrift();
        } else {
          setNoCanonical(true);
        }
      } catch (err) {
        if (!cancelled) toast.error(errMessage(err, "Failed to load environment"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchEnvAndMachines, fetchDrift]);

  // Poll drift every ~10s while a canonical machine is set.
  useEffect(() => {
    if (!environment?.canonical_machine_id) return;
    const handle = window.setInterval(fetchDrift, DRIFT_POLL_MS);
    return () => window.clearInterval(handle);
  }, [environment?.canonical_machine_id, fetchDrift]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const env = await fetchEnvAndMachines();
      if (env.canonical_machine_id) {
        await fetchDrift();
      } else {
        setDrift(null);
        setNoCanonical(true);
      }
    } catch (err) {
      toast.error(errMessage(err, "Failed to refresh"));
    } finally {
      setRefreshing(false);
    }
  }, [fetchEnvAndMachines, fetchDrift]);

  const handleCanonicalChange = useCallback(
    async (machineId: string) => {
      setEnvironment((prev) =>
        prev ? { ...prev, canonical_machine_id: machineId } : prev
      );
      await fetchDrift();
    },
    [fetchDrift]
  );

  /**
   * Machines eligible to be canonical: those that have reported a config for
   * this environment. The drift endpoint surfaces the canonical machine plus
   * every non-canonical machine with a config (in `reports`); we union those
   * machine ids against the full machine list to resolve names/state.
   */
  const eligibleMachines = useMemo<Machine[]>(() => {
    const ids = new Set<string>();
    if (drift?.canonical_machine_id) ids.add(drift.canonical_machine_id);
    for (const report of drift?.reports ?? []) {
      if (report.has_config && report.machine_id) ids.add(report.machine_id);
    }
    // Fall back to the env's canonical pointer when drift isn't loaded yet.
    if (environment?.canonical_machine_id) {
      ids.add(environment.canonical_machine_id);
    }
    return machines.filter((m) => ids.has(m.id));
  }, [drift, environment?.canonical_machine_id, machines]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!environment) {
    return (
      <div className="p-6">
        <Link
          href="/environments"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to environments
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">
          Environment not found.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href="/environments"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to environments
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Boxes className="size-5" />
            {environment.name}
          </h2>
          {environment.description && (
            <p className="text-sm text-muted-foreground mt-1">
              {environment.description}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw
            className={`size-4 ${refreshing ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {/* Canonical selector */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Crown className="size-4" />
            Canonical Machine
          </h3>
          <p className="text-xs text-muted-foreground">
            The source of truth all other machines are compared against
          </p>
        </div>
        <div className="p-4">
          <CanonicalSelector
            environmentId={environment.id}
            canonicalMachineId={environment.canonical_machine_id}
            eligibleMachines={eligibleMachines}
            onCanonicalChange={handleCanonicalChange}
          />
        </div>
      </div>

      {/* Drift */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <TriangleAlert className="size-4" />
            Drift
          </h3>
          <p className="text-xs text-muted-foreground">
            Each machine&apos;s config vs the canonical machine — refreshes
            every {Math.round(DRIFT_POLL_MS / 1000)}s
          </p>
        </div>
        <div className="p-4">
          {noCanonical ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-6 text-center">
              <TriangleAlert className="size-8 mx-auto mb-2 text-warning" />
              <p className="text-sm text-foreground">
                No canonical machine is set for this environment. Designate one
                above to compute drift.
              </p>
              {eligibleMachines.length === 0 && (
                <Badge variant="secondary" className="mt-3">
                  no machines have reported a config yet
                </Badge>
              )}
            </div>
          ) : drift ? (
            <DriftMatrix drift={drift} />
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { AlertTriangle, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSecretsBrokerDevice } from "../_hooks/useSecretsBrokerDevice";

/** A canonical UUID, the only shape coord's device ids take. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The tenant's designated secrets-broker device
 * (`coord.fleet_runtime_policy.secrets_broker_device_id`, plan
 * `2026-10-20-secrets-broker-agents-act-on-secrets-never-see-them` Phase 3).
 *
 * This is an authorization, not a preference: coord accepts the broker's
 * reports (its audit log, mints, inventory and exposure matrix, which the
 * `secrets_broker` digital-twin subspace serves) only from a device JWT whose
 * device id equals this value. A self-claimed capability is not enough.
 *
 * Three states the panel keeps apart:
 *
 * * `reported: false` — coord did not report the field. UNKNOWN, not "none".
 * * `device_id: null` — none designated: coord refuses every broker report.
 * * a failed read-back after a write — the write landed; what coord now
 *   resolves is UNKNOWN until a refresh.
 */
export function SecretsBrokerDevicePanel() {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<"set" | "clear" | null>(null);
  const {
    device,
    loading,
    saving,
    error,
    readbackError,
    reload,
    setBrokerDevice,
  } = useSecretsBrokerDevice();

  const canEdit = device?.can_edit === true;
  const reported = device?.reported === true;
  const current = reported ? (device?.device_id ?? null) : null;
  const candidate = draft.trim().toLowerCase();
  const draftValid = UUID_RE.test(candidate);
  const draftIsCurrent = draftValid && candidate === current;

  const write = (deviceId: string | null, which: "set" | "clear") => {
    setPending(which);
    setBrokerDevice(deviceId)
      .then((ok) => {
        if (ok && deviceId !== null) setDraft("");
      })
      .finally(() => setPending(null));
  };

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="secrets-broker-device"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Secrets broker device</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              The machine that runs this tenant&apos;s secrets broker. Agents
              ask the broker to act on secrets for them, and the broker reports
              every operation, credential and exposure to coord, which shows
              them on the digital twin. Coord accepts those reports only from
              the device named here.
            </p>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              With no device named, coord refuses every broker report for this
              tenant.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          data-testid="secrets-broker-device-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !device ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Coord accepts reports from</span>
            <Badge
              variant={current ? "default" : "outline"}
              className="font-mono"
              data-testid="secrets-broker-device-current"
            >
              {!device || !reported ? "unknown" : (current ?? "no device")}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Device id (UUID)"
              aria-label="Secrets broker device id"
              aria-invalid={draft.trim() !== "" && !draftValid}
              disabled={saving || !canEdit}
              className="h-8 max-w-sm font-mono text-xs"
              data-testid="secrets-broker-device-input"
            />
            <Button
              size="sm"
              disabled={saving || !canEdit || !draftValid || draftIsCurrent}
              onClick={() => write(candidate, "set")}
              data-testid="secrets-broker-device-set"
            >
              {saving && pending === "set" && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Designate
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || !canEdit || !reported || current === null}
              onClick={() => write(null, "clear")}
              data-testid="secrets-broker-device-clear"
            >
              {saving && pending === "clear" && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Clear
            </Button>
          </div>

          {draft.trim() !== "" && !draftValid && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="secrets-broker-device-invalid"
            >
              A device id is a UUID, for example
              0f8c2b1e-4d3a-4b5c-9e6f-7a8b9c0d1e2f.
            </p>
          )}

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="secrets-broker-device-readonly"
            >
              {device
                ? "Read-only: you are not an admin of this tenant, so coord would refuse the write (admin_required)."
                : "Read-only: your role could not be read, so whether the write would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {device && !reported && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="secrets-broker-device-unreported"
            >
              Coord did not report this setting, so which device it accepts
              broker reports from is unknown.
            </p>
          )}

          {readbackError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="secrets-broker-device-readback-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                After the last write, {readbackError}. The device above is the
                last one confirmed and may be stale. Refresh to re-check.
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="secrets-broker-device-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t read the secrets broker device: {error}.{" "}
                {device
                  ? "Showing the last value read, which may be out of date."
                  : "The current device is unknown."}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

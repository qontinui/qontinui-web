"use client";

/**
 * "Prepare for restart…" — the one dialog that opens a maintenance window.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place` §D7 +
 * §D4. The form is a consent surface, so it names everything it will touch
 * BEFORE the click — the workstation device id and coord's hostname for it,
 * every CI host — and after the window opens, every `(label, repo)` outcome
 * coord returned. Nothing identifying is truncated (`break-all`, never
 * `truncate`).
 *
 * ## The last-host question
 *
 * Coord refuses to delabel the last host that still matches the fleet's
 * `[self-hosted, qontinui]` routing (`last_matching_host`). With a window
 * that refusal becomes a question, because the window restores the label on
 * expiry (§D4): the dialog shows coord's own message and offers an explicit
 * "Pause anyway — CI will queue at GitHub until <until>", which resends with
 * `accept_ci_queueing: true`. The first request never sends it.
 *
 * ## Why pool health is information, not a refusal
 *
 * A maintenance restart is not a remedy for a pool-wide CI fault, so coord
 * does not refuse the window for one; it records the verdict on the window,
 * and this dialog says "CI is failing on every host right now — pausing this
 * one will not fix that".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DRAIN_PRESETS,
  MAX_DRAIN_DAYS,
  toLocalInputValue,
} from "@/components/operations/fleetDrain";
import {
  buildMaintenancePreview,
  errorWantsReread,
  maintenanceErrorGuidance,
  maintenancePageHref,
  formatUntil,
  machineEntryLabel,
  validateMaintenanceForm,
  type MachineEntry,
  type MaintenanceError,
  type MaintenanceLever,
  type MaintenanceWindow,
} from "@/components/operations/maintenanceWindow";
import { openMaintenanceWindow } from "@/components/operations/useMaintenanceWindow";
import { LastHostNotice } from "./LastHostNotice";

export interface PrepareForRestartDialogProps {
  entry: MachineEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which levers start ticked — both for "Prepare", one for a lever's Pause. */
  initialLevers: { agent_work: boolean; ci: boolean };
  /** Called once coord answered with an opened window. */
  onOpened: (window: MaintenanceWindow | null) => void;
  /** Called when a refusal says the page's view is stale; re-reads it. */
  onStale?: () => void;
  /**
   * Set when the page's selection no longer names the entry this form was
   * opened on: it MOVED to another entry (its identity), or the pinned entry
   * VANISHED from coord's list. Either way the form keeps its pinned target,
   * says so, and refuses to submit; its refusal or outcome stays up.
   */
  selectionShift?: SelectionShift | null;
}

export type SelectionShift =
  | { kind: "moved"; to: string }
  | { kind: "vanished" };

export function PrepareForRestartDialog({
  entry,
  open,
  onOpenChange,
  initialLevers,
  onOpened,
  onStale,
  selectionShift = null,
}: PrepareForRestartDialogProps) {
  const shifted = selectionShift !== null;
  const [untilLocal, setUntilLocal] = useState("");
  const [reason, setReason] = useState("");
  const [levers, setLevers] = useState(initialLevers);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<MaintenanceError | null>(null);
  const [lastHost, setLastHost] = useState<MaintenanceError | null>(null);
  const [opened, setOpened] = useState<MaintenanceWindow | null>(null);
  const [openedAny, setOpenedAny] = useState(false);

  // Every open starts clean: a dialog reopened after a refusal must not carry
  // the last attempt's "pause anyway" offer into a different request.
  useEffect(() => {
    if (!open) return;
    setUntilLocal("");
    setReason("");
    setLevers(initialLevers);
    setBusy(false);
    setRefusal(null);
    setLastHost(null);
    setOpened(null);
    setOpenedAny(false);
    // `initialLevers` is read at open time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const now = Date.now();
  const check = validateMaintenanceForm(
    { untilLocal, reason, levers },
    entry,
    now
  );
  const chosen: MaintenanceLever[] = check.ok
    ? check.levers
    : (["agent_work", "ci"] as const).filter((l) => levers[l]);
  const preview = useMemo(
    () => buildMaintenancePreview(entry, chosen, opened),
    // `chosen` is derived from `levers`; key on the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry, levers.agent_work, levers.ci, opened]
  );
  const identity = machineEntryLabel(entry);

  const submit = useCallback(
    async (acceptCiQueueing: boolean) => {
      if (!check.ok || busy || shifted) return;
      setBusy(true);
      setRefusal(null);
      const res = await openMaintenanceWindow({
        machineDeviceId: entry.kind === "machine" ? entry.deviceId : null,
        ciHost: entry.kind === "ci_host" ? entry.ciHost : null,
        levers: check.levers,
        untilIso: check.untilIso,
        reason,
        acceptCiQueueing,
      });
      setBusy(false);
      if (res.ok) {
        setLastHost(null);
        setOpened(res.window);
        setOpenedAny(true);
        onOpened(res.window);
        return;
      }
      if (res.code === "last_matching_host" && !acceptCiQueueing) {
        setLastHost(res);
        return;
      }
      setLastHost(null);
      setRefusal(res);
      // window_changed / window_busy / window_already_open /
      // ci_host_linked_to_machine: the list is stale — re-read it.
      if (errorWantsReread(res)) onStale?.();
    },
    [check, busy, entry, reason, onOpened, onStale, shifted]
  );

  const untilLabel = check.ok
    ? formatUntil(check.untilIso, now)
    : "the window ends";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        data-testid="coord-maintenance-prepare-dialog"
        className="max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>
            {openedAny ? "Maintenance window opened" : "Prepare for restart"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1 text-sm">
              <p className="break-words">
                Pause new work on{" "}
                <span className="font-mono break-all">{identity.primary}</span>{" "}
                (
                <span className="font-mono break-all">
                  {identity.secondary}
                </span>
                ) until a deadline. Work already running is not stopped — the
                page shows it under &ldquo;Still running&rdquo; until it
                finishes.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {selectionShift?.kind === "moved" && (
            <p
              role="alert"
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs break-words"
              data-testid="coord-maintenance-prepare-moved"
            >
              Selection moved to{" "}
              <span className="font-mono break-all">{selectionShift.to}</span>;
              this form still targets{" "}
              <span className="font-mono break-all">
                {identity.primary} ({identity.secondary})
              </span>
              . Close and reopen to act on the new one.
            </p>
          )}
          {selectionShift?.kind === "vanished" && (
            <p
              role="alert"
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs break-words"
              data-testid="coord-maintenance-prepare-vanished"
            >
              <span className="font-mono break-all">
                {identity.primary} ({identity.secondary})
              </span>{" "}
              is no longer in coord&apos;s machine list; this form cannot be
              sent.
            </p>
          )}
          {!openedAny && (
            <>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Pause</legend>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={levers.agent_work}
                    disabled={busy || entry.kind === "ci_host"}
                    onCheckedChange={(v) => {
                      setLastHost(null);
                      setLevers((p) => ({ ...p, agent_work: v === true }));
                    }}
                    data-testid="coord-maintenance-prepare-agent"
                  />
                  <span>
                    Agent work
                    <span className="block text-[11px] text-muted-foreground">
                      no new agent sessions or gate continuations on this
                      machine
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={levers.ci}
                    disabled={busy}
                    onCheckedChange={(v) => {
                      setLastHost(null);
                      setLevers((p) => ({ ...p, ci: v === true }));
                    }}
                    data-testid="coord-maintenance-prepare-ci"
                  />
                  <span>
                    CI
                    <span className="block text-[11px] text-muted-foreground">
                      coord&apos;s CI-node lane, merge capacity, and the routing
                      labels GitHub matches jobs against
                    </span>
                  </span>
                </label>
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="coord-maintenance-prepare-until">
                  Until (required)
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {DRAIN_PRESETS.map((preset) => (
                    <Button
                      key={preset.key}
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setLastHost(null);
                        setUntilLocal(
                          toLocalInputValue(
                            Date.now() + preset.hours * 3_600_000
                          )
                        );
                      }}
                      data-testid={`coord-maintenance-prepare-preset-${preset.key}`}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <Input
                  id="coord-maintenance-prepare-until"
                  type="datetime-local"
                  value={untilLocal}
                  disabled={busy}
                  onChange={(e) => {
                    setLastHost(null);
                    setUntilLocal(e.target.value);
                  }}
                  data-testid="coord-maintenance-prepare-until"
                />
                <p className="text-[11px] text-muted-foreground break-words">
                  Required, and capped at {MAX_DRAIN_DAYS} days: coord restores
                  everything it paused when the window ends, so a forgotten
                  pause cannot remove this machine from the fleet for good.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="coord-maintenance-prepare-reason">
                  Reason (required)
                </Label>
                <Textarea
                  id="coord-maintenance-prepare-reason"
                  rows={2}
                  value={reason}
                  disabled={busy}
                  placeholder="e.g. kernel update"
                  onChange={(e) => {
                    setLastHost(null);
                    setReason(e.target.value);
                  }}
                  data-testid="coord-maintenance-prepare-reason"
                />
              </div>
            </>
          )}

          <div
            className="space-y-1"
            data-testid="coord-maintenance-prepare-preview"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {openedAny ? "What coord did" : "What this will touch"}
            </p>
            {preview.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing — choose a lever.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {preview.map((line) => (
                  <li
                    key={line.key}
                    className="break-words"
                    data-testid="coord-maintenance-prepare-target"
                  >
                    {line.action}:{" "}
                    <span className="font-mono break-all">{line.target}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {opened?.poolHealth?.verdict === "pool_wide" && (
            <p
              role="status"
              className="text-xs text-muted-foreground break-words"
              data-testid="coord-maintenance-prepare-pool-wide"
            >
              CI is failing on every host right now — pausing this one will not
              fix that.
              {opened.poolHealth.detail ? ` (${opened.poolHealth.detail})` : ""}
            </p>
          )}

          {lastHost && (
            <LastHostNotice
              refusal={lastHost}
              until={untilLabel}
              busy={busy || shifted}
              onAccept={() => void submit(true)}
              testIdPrefix="coord-maintenance-prepare"
            />
          )}

          {refusal && (
            <p
              role="alert"
              className="text-xs text-destructive break-words"
              data-testid="coord-maintenance-prepare-error"
            >
              {refusal.message}
              {refusal.code ? ` (${refusal.code})` : ""}
              {maintenanceErrorGuidance(refusal) && (
                <span
                  className="block text-muted-foreground"
                  data-testid="coord-maintenance-prepare-error-guidance"
                >
                  {maintenanceErrorGuidance(refusal)}
                </span>
              )}
              {refusal.code === "ci_host_linked_to_machine" &&
                refusal.machineDeviceId && (
                  <Link
                    href={maintenancePageHref(refusal.machineDeviceId)}
                    onClick={() => onOpenChange(false)}
                    className="block underline underline-offset-2"
                    data-testid="coord-maintenance-prepare-select-machine"
                  >
                    Select machine{" "}
                    <span className="font-mono break-all">
                      {refusal.machineDeviceId}
                    </span>
                  </Link>
                )}
            </p>
          )}

          {!openedAny && !check.ok && (
            <p
              role="status"
              className="text-[11px] break-words text-amber-600 dark:text-amber-500"
              data-testid="coord-maintenance-prepare-invalid"
            >
              {check.message}
            </p>
          )}
        </div>

        <DialogFooter>
          {openedAny ? (
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              data-testid="coord-maintenance-prepare-done"
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => onOpenChange(false)}
                data-testid="coord-maintenance-prepare-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || !check.ok || lastHost !== null || shifted}
                onClick={() => void submit(false)}
                data-testid="coord-maintenance-prepare-submit"
              >
                Pause{" "}
                {chosen.length === 2
                  ? "both"
                  : chosen.length === 1
                    ? chosen[0] === "ci"
                      ? "CI"
                      : "agent work"
                    : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

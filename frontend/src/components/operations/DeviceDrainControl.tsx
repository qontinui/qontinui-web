"use client";

/**
 * Drain / Undrain for one Dev Ops machine row.
 *
 * Plan `2026-09-01-device-drain-does-not-reach-agent-session-spawning` Phase
 * 4b — the operator lever an operator rebuilding a machine did not have. Until
 * this shipped there was no way to stop new agent sessions landing on one box,
 * and the workaround was to race the scheduler.
 *
 * Every rule about WHAT a state means lives in `./fleetDrain.ts` and is
 * unit-tested without a DOM. This file is the rendering of it, and it holds
 * three commitments the plan makes executable:
 *
 * 1. **A row that cannot name its target never gets an enabled control.**
 *    `resolveDrainTarget` decides that, and the button is disabled with the
 *    reason spelled out in prose beside it — not merely in a `title`, which a
 *    reader on a touch device never sees. An enabled control that drains
 *    nothing is the predictability failure the plan's Risks section names
 *    twice: once for a row with no coord device link, and once for `spaceship`
 *    versus `gh-runner-spaceship-wsl`.
 * 2. **The target is labelled with coord's own identity**, never the card
 *    title. That title is `displayName ?? hostname` — an operator-settable
 *    alias — and the two CI/workstation registrations for one physical box
 *    differ precisely in the coord identity, so the alias is the one string
 *    that must not be trusted here.
 * 3. **Unknown renders UNKNOWN.** Not green, not "not drained", not a bare
 *    greyed-out button. `[policy: verification-and-evidence
 *    unknown-must-not-render-as-a-default]`.
 *
 * ## Why the state is always visible and only the FORM is behind a dialog
 *
 * R7 says secondary material collapses but its signal does not. "This machine
 * is out of the fleet" is not secondary material — it is the reason a row
 * showing zero sessions is not idle — so the state line renders inline, in
 * full, on every row. What hides is the *form*: an expiry and a reason are a
 * consent surface, and a page of them under a scrolling cursor is how an
 * operator drains the wrong machine.
 *
 * ## Nothing here may be truncated
 *
 * `[policy: ux-priorities no-widget-may-hide-identifying-text]`. The coord
 * hostname, the device id and the drain state are identifying text, so they
 * wrap (`break-words` / `break-all`) rather than clip. There is deliberately
 * no `truncate`, no `whitespace-nowrap` and no fixed height anywhere in this
 * component, and `DeviceDrainControl.test.tsx` asserts that structurally so a
 * later tidy-up cannot quietly reintroduce one.
 */

import { useCallback, useState } from "react";
import { CircleSlash, HelpCircle, PlayCircle, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { createLogger } from "@/lib/logger";
import { absoluteTime } from "@/components/console/time";
import {
  DRAIN_PRESETS,
  MAX_DRAIN_DAYS,
  describeDrainError,
  formatDrainRemaining,
  toLocalInputValue,
  validateDrainForm,
  type DeviceDrainState,
  type DrainTarget,
} from "./fleetDrain";
import { postDrain, postUndrain } from "./useFleetDrain";

const log = createLogger("DeviceDrainControl");

export interface DeviceDrainControlProps {
  /** What this row would drain — or why it cannot name anything. */
  target: DrainTarget;
  /** What coord says about that device right now. */
  drain: DeviceDrainState;
  /**
   * The row's own hostname (never the operator alias), used only in the
   * dialog's prose so the operator can see the row they clicked. The drain
   * itself is keyed on `target.deviceId` and never on this.
   */
  rowHostname: string;
  /** Forced re-read after a successful write — coord is the source of truth. */
  onActed?: () => void;
  /**
   * Injectable clock, so the remaining-time rendering is deterministic under
   * test. Defaults to `Date.now()` at render.
   */
  now?: number;
}

/** The one class of block used for every non-actionable state. */
function DrainNotice({
  tone,
  headline,
  children,
}: {
  tone: "waiting" | "muted";
  headline: string;
  children: React.ReactNode;
}) {
  // Amber for UNKNOWN, per the console palette's documented exception: an
  // amber painted on ignorance is a statement about our knowledge, and calm on
  // an unknown row would assert "nothing is wrong here", which is exactly what
  // we do not know. Muted for `no_device`, where we DO know the row's state —
  // the join is absent — and nothing is decaying.
  const shell =
    tone === "waiting"
      ? "border-amber-500/50 bg-amber-500/5"
      : "border-border bg-muted/30";
  const label =
    tone === "waiting"
      ? "text-amber-600 dark:text-amber-500"
      : "text-muted-foreground";
  const Icon = tone === "waiting" ? HelpCircle : CircleSlash;
  return (
    <div
      className={`rounded-md border border-dashed px-2 py-1.5 ${shell}`}
      role="status"
    >
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${label}`} />
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${label}`}
        >
          {headline}
        </span>
      </div>
      <p className="mt-1 text-[11px] break-words text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

/**
 * The line naming what a drain would actually act on.
 *
 * Rendered for every identified row, drained or not — an operator has to be
 * able to check the target BEFORE clicking, not only after. The id is
 * `break-all` because a UUID has no spaces to wrap at and clipping it would
 * hide the one field that distinguishes two registrations of the same box.
 */
function DrainTargetLine({
  deviceId,
  coordHostname,
}: {
  deviceId: string;
  coordHostname: string | null;
}) {
  return (
    <p
      className="text-[11px] leading-snug break-words text-muted-foreground"
      data-testid="device-drain-target"
      data-device-id={deviceId}
    >
      Drains coord device{" "}
      <span className="font-medium text-foreground">
        {coordHostname ?? "(coord reports no hostname)"}
      </span>{" "}
      <span className="font-mono break-all text-foreground">{deviceId}</span>
    </p>
  );
}

export function DeviceDrainControl({
  target,
  drain,
  rowHostname,
  onActed,
  now,
}: DeviceDrainControlProps) {
  const [mode, setMode] = useState<"drain" | "undrain" | null>(null);
  const [untilLocal, setUntilLocal] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const clock = now ?? Date.now();

  const deviceId = target.state === "identified" ? target.deviceId : null;

  // Not memoised: it is three string comparisons, and the submit path
  // re-validates against a fresh clock anyway — that second check is the one
  // that decides anything, this one only shapes the form.
  const check = validateDrainForm(untilLocal, reason, clock);

  const close = useCallback(() => {
    setMode(null);
    setUntilLocal("");
    setReason("");
  }, []);

  const submit = useCallback(async () => {
    if (deviceId === null || mode === null) return;
    const trimmed = reason.trim();
    if (mode === "drain") {
      const fresh = validateDrainForm(untilLocal, reason, Date.now());
      if (!fresh.ok) {
        toast.error("That drain was not accepted", {
          description: fresh.message,
        });
        return;
      }
      setBusy(true);
      const res = await postDrain({
        deviceId,
        untilIso: fresh.untilIso,
        reason: trimmed,
      });
      setBusy(false);
      if (!res.ok) {
        log.warn("drain failed", res.status, res.body);
        toast.error(`Couldn't drain ${rowHostname}`, {
          description:
            res.status === null
              ? res.body
              : describeDrainError(res.status, res.body),
        });
        return;
      }
      toast.success(
        `${rowHostname} drained — coord will send it no new work until the ` +
          `expiry. Work already running on it is not stopped.`
      );
      close();
      onActed?.();
      return;
    }

    if (trimmed === "") {
      toast.error("A reason is required", {
        description:
          "Coord records who released the machine and why; it rejects a " +
          "blank reason.",
      });
      return;
    }
    setBusy(true);
    const res = await postUndrain({ deviceId, reason: trimmed });
    setBusy(false);
    if (!res.ok) {
      log.warn("undrain failed", res.status, res.body);
      toast.error(`Couldn't release ${rowHostname}`, {
        description:
          res.status === null
            ? res.body
            : describeDrainError(res.status, res.body),
      });
      return;
    }
    toast.success(
      res.changed
        ? `${rowHostname} released — coord may send it work again.`
        : `${rowHostname} was not drained, so nothing was released.`
    );
    close();
    onActed?.();
  }, [close, deviceId, mode, onActed, reason, rowHostname, untilLocal]);

  // The state key the tests and the UI Bridge key on. `no_device` wins over
  // the drain state: with no device id there is nothing the drain map could
  // have been asked about, so reporting the read's health would be a
  // non-sequitur (the same short-circuit `resolveCiCapacity` makes).
  const stateKey = target.state === "no_device" ? "no_device" : drain.state;
  const actable = target.state === "identified" && drain.state !== "unknown";

  const stateLine = (() => {
    if (target.state === "no_device") {
      return (
        <DrainNotice tone="muted" headline="No coord device to drain">
          {target.reason}
        </DrainNotice>
      );
    }
    if (drain.state === "unknown") {
      return (
        <DrainNotice tone="waiting" headline="Drain state unknown">
          {drain.reason} This machine may or may not be taking new work — this
          is a statement about the read, not about the machine.
        </DrainNotice>
      );
    }
    if (drain.state === "drained") {
      return (
        <div
          className="rounded-md border border-amber-500/50 bg-amber-500/5 px-2 py-1.5"
          role="status"
        >
          <div className="flex items-center gap-1.5">
            <PowerOff className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
              Drained
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug break-words text-muted-foreground">
            Drained until{" "}
            <span className="font-medium text-foreground">
              {absoluteTime(drain.entry.until)}
            </span>{" "}
            ({formatDrainRemaining(drain.entry.until, clock)}) by{" "}
            <span className="font-medium text-foreground">
              {drain.entry.drainedBy ?? "an operator this read did not name"}
            </span>
            , reason{" "}
            <span className="font-medium text-foreground">
              {drain.entry.reason ?? "not recorded"}
            </span>
            .{" "}
            {drain.entry.drainedAt
              ? `Drained at ${absoluteTime(drain.entry.drainedAt)}. `
              : ""}
            Coord sends it no new work until then; anything already running on
            it keeps running.
          </p>
        </div>
      );
    }
    if (drain.state === "expired") {
      return (
        <p className="text-[11px] leading-snug break-words text-muted-foreground">
          Not drained — the last drain expired{" "}
          {formatDrainRemaining(drain.entry.until, clock)} (
          {absoluteTime(drain.entry.until)}) and coord released the machine on
          its own. Nobody undrained it.
        </p>
      );
    }
    return (
      <p className="text-[11px] leading-snug break-words text-muted-foreground">
        Not drained — coord may send this machine new work.
      </p>
    );
  })();

  return (
    <div
      className="space-y-1.5"
      data-testid="device-drain"
      data-device-drain={stateKey}
    >
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Drain
      </h4>

      {target.state === "identified" && (
        <DrainTargetLine
          deviceId={target.deviceId}
          coordHostname={target.coordHostname}
        />
      )}

      <div data-testid="device-drain-state">{stateLine}</div>

      <CoordAdminOnly fallback={<ReadOnlyNotice />}>
        <div className="flex flex-wrap items-center gap-2">
          {drain.state === "drained" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!actable || busy}
              title={actable ? undefined : disabledReason(target, drain)}
              onClick={() => setMode("undrain")}
              data-testid="device-drain-undrain"
            >
              <PlayCircle className="h-3.5 w-3.5" />
              Undrain
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={!actable || busy}
              title={actable ? undefined : disabledReason(target, drain)}
              onClick={() => {
                setUntilLocal("");
                setReason("");
                setMode("drain");
              }}
              data-testid="device-drain-open"
            >
              <PowerOff className="h-3.5 w-3.5" />
              Drain…
            </Button>
          )}
          {!actable && (
            <span
              className="text-[11px] break-words text-muted-foreground"
              data-testid="device-drain-disabled-reason"
            >
              {disabledReason(target, drain)}
            </span>
          )}
        </div>
      </CoordAdminOnly>

      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent data-testid="device-drain-dialog">
          <DialogHeader>
            <DialogTitle>
              {mode === "undrain"
                ? `Release ${rowHostname} back into the fleet?`
                : `Drain ${rowHostname}?`}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="break-words">
                  {mode === "undrain"
                    ? "Coord may send this machine new work again as soon as this lands."
                    : "Coord will stop sending this machine NEW work — CI jobs, builds, agent-session spawns and continuations. Work already running on it is not stopped, and no session is moved."}
                </p>
                {deviceId !== null && (
                  <p className="break-words">
                    This acts on coord device{" "}
                    <span className="font-mono break-all">{deviceId}</span>
                    {target.state === "identified" && target.coordHostname
                      ? ` (${target.coordHostname})`
                      : ""}
                    . A machine can hold more than one coord registration — a
                    workstation and its self-hosted CI runner are separate
                    devices — and draining one does nothing to the other.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {mode === "drain" && (
              <div className="space-y-1.5">
                <Label htmlFor="device-drain-until">
                  Expiry (required)
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {DRAIN_PRESETS.map((preset) => (
                    <Button
                      key={preset.key}
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        setUntilLocal(
                          toLocalInputValue(
                            Date.now() + preset.hours * 3_600_000
                          )
                        )
                      }
                      data-testid={`device-drain-preset-${preset.key}`}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <Input
                  id="device-drain-until"
                  type="datetime-local"
                  value={untilLocal}
                  disabled={busy}
                  onChange={(e) => setUntilLocal(e.target.value)}
                  data-testid="device-drain-until"
                />
                <p className="text-[11px] text-muted-foreground break-words">
                  Required, and there is no &ldquo;no expiry&rdquo; option: a
                  drain without a deadline is how a machine silently leaves the
                  fleet forever. Coord rejects anything further out than{" "}
                  {MAX_DRAIN_DAYS} days — re-drain instead.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="device-drain-reason">Reason (required)</Label>
              <Textarea
                id="device-drain-reason"
                rows={2}
                value={reason}
                disabled={busy}
                placeholder={
                  mode === "undrain"
                    ? "e.g. rebuild finished"
                    : "e.g. rebuilding the runner"
                }
                onChange={(e) => setReason(e.target.value)}
                data-testid="device-drain-reason"
              />
              <p className="text-[11px] text-muted-foreground break-words">
                Recorded on coord&apos;s audit row and raised as an alert other
                operators see, so it is what tells them why the machine is out.
              </p>
            </div>

            {mode === "drain" && !check.ok && (
              <p
                className="text-[11px] break-words text-amber-600 dark:text-amber-500"
                role="status"
                data-testid="device-drain-error"
              >
                {check.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={close}
              data-testid="device-drain-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                deviceId === null ||
                (mode === "drain" ? !check.ok : reason.trim() === "")
              }
              onClick={() => void submit()}
              data-testid="device-drain-submit"
            >
              {mode === "undrain" ? "Release" : "Drain machine"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Why the control is disabled — always a sentence, never a shrug.
 *
 * A greyed-out button with no explanation reads as "draining is off for this
 * machine", which is a claim about the machine. Both real reasons are claims
 * about the JOIN or about the READ, and the two are worded differently because
 * they call for different next steps.
 */
export function disabledReason(
  target: DrainTarget,
  drain: DeviceDrainState
): string | undefined {
  if (target.state === "no_device") return target.reason;
  if (drain.state === "unknown") {
    return (
      `${drain.reason} Draining is offered only against a state that was ` +
      `actually read — acting on an unknown one is how a machine gets ` +
      `drained twice or released by accident.`
    );
  }
  return undefined;
}

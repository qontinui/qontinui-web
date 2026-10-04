"use client";

/**
 * Set / clear the per-device worktree cap for one machine row.
 *
 * Amendment A3 / Phase 4 of plan
 * `2026-09-18-coord-allocation-budgets-ignore-the-machine-they-gate` — the
 * operator door for the override that beats coord's DERIVED worktree cap on one
 * box. Until this shipped there was no operator lever at all: coord derived
 * every device's cap from that machine's memory, the fleet-wide
 * `COORD_MAX_WORKTREES` it replaced having already been retired by this plan's
 * amendment A1.
 *
 * Every rule about WHAT a state means lives in `./fleetWorktreeCap.ts` and is
 * unit-tested without a DOM. This file is the rendering of it, and it holds
 * four commitments:
 *
 * 1. **A row that cannot name its target never gets an enabled control.** The
 *    same `DrainTarget` the drain control resolves decides that, because the
 *    two act on the same coord device identity. The button is disabled with the
 *    reason spelled out in prose beside it — not merely in a `title`, which a
 *    reader on a touch device never sees.
 * 2. **The target is labelled with coord's own identity**, never the card
 *    title. That title is an operator-settable alias, and a workstation and the
 *    CI runner registered under it are SEPARATE coord device registrations, so
 *    the alias is the one string that must not be trusted here.
 * 3. **Unknown renders UNKNOWN.** Not "no cap", not a bare greyed-out button
 *    [policy: `verification-and-evidence` `unknown-must-not-render-as-a-default`].
 * 4. **This is never described as a drain.** They sit on the same row and they
 *    are different acts: a drain stops NEW work reaching the machine and
 *    carries a mandatory deadline; a cap changes how many worktrees may exist
 *    there, has no deadline, and stops nothing. Every string here says which.
 *
 * ## Why the state is always visible and only the FORM is behind a dialog
 *
 * "This machine is held at 4 worktrees" is not secondary material — it is the
 * reason an allocate on it is being refused while the box looks idle — so the
 * state line renders inline on every row. What hides is the *form*: a number
 * and a reason are a consent surface, and a page of them under a scrolling
 * cursor is how an operator caps the wrong machine.
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Gauge, HelpCircle, CircleSlash, RotateCcw } from "lucide-react";
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
import { describeDrainError, type DrainTarget } from "./fleetDrain";
import { CONTROL_REASON_MAX_LENGTH } from "./runnerStatus";
import {
  parseWorktreeCapInput,
  validateWorktreeCap,
  type DeviceWorktreeCapState,
} from "./fleetWorktreeCap";
import { postClearWorktreeCap, postWorktreeCap } from "./useFleetWorktreeCap";

const log = createLogger("DeviceWorktreeCapControl");

export interface DeviceWorktreeCapControlProps {
  /**
   * What this row would act on — or why it cannot name anything. The SAME
   * target the drain control takes, because both write against one coord
   * device identity; resolving it twice is how the two controls end up acting
   * on different machines from one row.
   */
  target: DrainTarget;
  /** What coord says about that device's cap right now. */
  cap: DeviceWorktreeCapState;
  /**
   * The row's own hostname (never the operator alias), used only in prose so
   * the operator can see the row they clicked. The write is keyed on
   * `target.deviceId` and never on this.
   */
  rowHostname: string;
  /** Forced re-read after a successful write — coord is the source of truth. */
  onActed?: () => void;
}

/** The one class of block used for every non-actionable state. */
function CapNotice({
  tone,
  headline,
  children,
}: {
  tone: "waiting" | "muted";
  headline: string;
  children: React.ReactNode;
}) {
  // Amber for UNKNOWN, per the console palette's documented exception: an amber
  // painted on ignorance is a statement about our knowledge, and calm on an
  // unknown row would assert "nothing is wrong here", which is exactly what we
  // do not know. Muted for `no_device`, where we DO know the row's state.
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
    <div className={`rounded-md border px-2 py-1.5 ${shell}`} role="status">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${label}`} />
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${label}`}
        >
          {headline}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug break-words text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

/**
 * Why the control is disabled — always a sentence, never a shrug.
 *
 * A greyed-out button with no explanation reads as "capping is off for this
 * machine", which is a claim about the machine. Both real reasons are claims
 * about the JOIN or about the READ.
 */
export function capDisabledReason(
  target: DrainTarget,
  cap: DeviceWorktreeCapState
): string | undefined {
  if (target.state === "no_device") return target.reason;
  if (cap.state === "unknown") {
    return (
      `${cap.reason} A cap is offered only against a state that was actually ` +
      `read — acting on an unknown one is how an operator overwrites a limit ` +
      `somebody else set minutes ago.`
    );
  }
  return undefined;
}

export function DeviceWorktreeCapControl({
  target,
  cap,
  rowHostname,
  onActed,
}: DeviceWorktreeCapControlProps) {
  const [mode, setMode] = useState<"set" | "clear" | null>(null);
  const [value, setValue] = useState("");
  // Whether the operator has touched the number field. The error is suppressed
  // until then so an untouched dialog is not scolding, but NOT keyed on
  // `value !== ""`: a browser `<input type="number">` reports "" for an
  // unparseable entry (`--`, `1-2`, a bare `e`), so keying on emptiness hides
  // the message in exactly the case the operator most needs it — a disabled
  // submit with no sentence beside it, which this file's own rule forbids.
  const [valueTouched, setValueTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // A REF beside the state, and the ref is what guards the send. `setBusy(true)`
  // does not update the closure already running, so two clicks landing in one
  // render both pass a state-only guard — and each one writes an attributed,
  // numbered snapshot onto a versioned control row, so the duplicate is visible
  // in the audit trail for ever even though the stored value is the same. The
  // page's own device-action handler established this pattern deliberately
  // (`inFlight` there carries the same comment).
  const sending = useRef(false);

  const deviceId = target.state === "identified" ? target.deviceId : null;
  const valueError = validateWorktreeCap(value);
  // Whether to SHOW it — spelled once, because it now drives three things that
  // must agree: the message, `aria-invalid`, and `aria-describedby`. A field
  // marked invalid while pointing at an element that is not rendered is worse
  // than no marking at all.
  const showValueError = mode === "set" && valueError !== null && valueTouched;

  const close = useCallback(() => {
    setMode(null);
    setValue("");
    setValueTouched(false);
    setReason("");
  }, []);

  const submit = useCallback(async () => {
    if (deviceId === null || mode === null) return;
    if (sending.current) return;
    const trimmedReason = reason.trim();
    if (trimmedReason === "") {
      toast.error("A reason is required", {
        description:
          "Coord records who changed the cap and why, and shows the reason in " +
          "every refusal the cap produces; it rejects a blank one.",
      });
      return;
    }

    if (mode === "set") {
      // ONE parse, and the number it yields is both what is sent and what is
      // reported. Re-deriving it at either point is how the POST and the toast
      // end up naming different values for one write — `1e3` really does arrive
      // from a number input, and `max_worktrees: 1000` beside a toast saying
      // "at 1e3 worktrees" names a spelling coord never stored.
      const parsed = parseWorktreeCapInput(value);
      if (!parsed.ok) {
        toast.error("That cap was not accepted", {
          description: parsed.message,
        });
        return;
      }
      sending.current = true;
      setBusy(true);
      const res = await postWorktreeCap({
        deviceId,
        maxWorktrees: parsed.n,
        reason: trimmedReason,
      });
      sending.current = false;
      setBusy(false);
      if (!res.ok) {
        log.warn("worktree cap set failed", res.status, res.body);
        toast.error(`Couldn't cap ${rowHostname}`, {
          description:
            res.status === null
              ? res.body
              : describeDrainError(res.status, res.body),
        });
        return;
      }
      // Reports the REQUEST and nothing beyond it, because that is all this
      // build observes: the write response carries `changed` alone (see
      // `postCapChange`), never the stored number. The row's state line carries
      // the stored cap after the re-read `onActed` forces, and IT is the thing
      // entitled to state a number as being in force.
      //
      // It must NOT hedge that coord may raise the number either.
      // `MIN_DEVICE_WORKTREES` floors the value coord DERIVES from a machine's
      // memory, and the override is DESIGNED to replace that derivation rather
      // than be bounded by it: A3 puts `>= 1` on the write door and no other
      // bound anywhere. The clearest statement of the intent is coord's own
      // `isolation.rs` comment on that constant — "A3's per-device override is
      // the mechanism for a box that needs more — not a higher global floor".
      //
      // Stated as INTENT, deliberately, because the resolver arm that will read
      // the override is not on coord's `main` yet (it ships in the coord half of
      // A3, beside the route these three calls target). Today's `effective_budget`
      // matches on the device's memory alone and `BudgetSource::Override` is
      // reached only from the BUILD knob — coord's own test says so in as many
      // words: "The override is builds-only; worktrees still derive." An earlier
      // revision of this comment described that override arm in the present
      // tense, which asserted behaviour of an unwritten resolver.
      //
      // Either way this toast is correct: it reports the REQUEST and leaves every
      // claim about the number in force to the state line, which renders what
      // coord served back.
      toast.success(
        res.changed === "unknown"
          ? `Asked coord to cap ${rowHostname} at ${parsed.n} worktrees. Coord ` +
              `accepted it but its answer could not be read, so whether this ` +
              `changed anything is unknown — the row is re-reading from coord ` +
              `now and its line is the cap in force.`
          : res.changed
            ? `Asked coord to cap ${rowHostname} at ${parsed.n} worktrees. The ` +
                `row is re-reading from coord now, and its line is the cap in ` +
                `force. Work already on this machine is untouched; a cap only ` +
                `bounds new allocations.`
            : `Asked coord to cap ${rowHostname} at ${parsed.n} worktrees, and ` +
                `coord reports nothing changed. The row is re-reading from ` +
                `coord now.`
      );
      close();
      onActed?.();
      return;
    }

    sending.current = true;
    setBusy(true);
    const res = await postClearWorktreeCap({
      deviceId,
      reason: trimmedReason,
    });
    sending.current = false;
    setBusy(false);
    if (!res.ok) {
      log.warn("worktree cap clear failed", res.status, res.body);
      toast.error(`Couldn't clear the cap on ${rowHostname}`, {
        description:
          res.status === null
            ? res.body
            : describeDrainError(res.status, res.body),
      });
      return;
    }
    // "Cap removed" is a positive claim about what coord DID, so it is reserved
    // for the arm where coord said so. On an unreadable body the write landed and
    // the outcome did not: saying "removed" there asserts the complement of the
    // very uncertainty that made the default necessary.
    toast.success(
      res.changed === "unknown"
        ? `Asked coord to clear ${rowHostname}'s cap. Coord accepted it but its ` +
            `answer could not be read, so whether a cap was removed is unknown ` +
            `— the row is re-reading from coord now.`
        : res.changed
          ? `Cap removed — coord derives ${rowHostname}'s worktree limit from its memory again.`
          : `${rowHostname} carried no cap, so nothing was removed.`
    );
    close();
    onActed?.();
  }, [close, deviceId, mode, onActed, reason, rowHostname, value]);

  // The state key the tests and the UI Bridge key on. `no_device` wins over the
  // cap state: with no device id there is nothing the cap map could have been
  // asked about, so reporting the read's health would be a non-sequitur.
  const stateKey = target.state === "no_device" ? "no_device" : cap.state;
  const actable = target.state === "identified" && cap.state !== "unknown";

  const stateLine = (() => {
    if (target.state === "no_device") {
      return (
        <CapNotice tone="muted" headline="No coord device to cap">
          {target.reason}
        </CapNotice>
      );
    }
    if (cap.state === "unknown") {
      return (
        <CapNotice tone="waiting" headline="Worktree cap unknown">
          {cap.reason} This machine may or may not carry an operator cap — this
          is a statement about the read, not about the machine.
        </CapNotice>
      );
    }
    if (cap.state === "capped") {
      return (
        <div
          className="rounded-md border border-amber-500/50 bg-amber-500/5 px-2 py-1.5"
          role="status"
        >
          <div className="flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
              Capped at {cap.entry.maxWorktrees}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug break-words text-muted-foreground">
            An operator cap of{" "}
            <span className="font-medium text-foreground">
              {cap.entry.maxWorktrees}
            </span>{" "}
            worktrees overrides the limit coord would derive from this
            machine&apos;s memory. Set by{" "}
            <span className="font-medium text-foreground">
              {cap.entry.setBy}
            </span>
            , reason{" "}
            <span className="font-medium text-foreground">
              {cap.entry.reason}
            </span>
            .{" "}
            {cap.entry.setAt ? `Set at ${absoluteTime(cap.entry.setAt)}. ` : ""}
            It has no expiry and will stand until somebody clears it. It does
            not stop work already running here, and it is not a drain.
          </p>
        </div>
      );
    }
    return (
      <p className="text-[11px] leading-snug break-words text-muted-foreground">
        No operator cap — coord derives this machine&apos;s worktree limit from
        its memory.
      </p>
    );
  })();

  return (
    <div
      className="space-y-1.5"
      data-testid="device-worktree-cap"
      data-device-worktree-cap={stateKey}
    >
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Worktree cap
      </h4>

      {target.state === "identified" && (
        <p
          className="text-[11px] leading-snug break-words text-muted-foreground"
          data-testid="device-worktree-cap-target"
          data-device-id={target.deviceId}
        >
          Caps coord device{" "}
          <span className="font-medium text-foreground">
            {target.coordHostname ?? "(coord reports no hostname)"}
          </span>{" "}
          <span className="font-mono break-all text-foreground">
            {target.deviceId}
          </span>
        </p>
      )}

      <div data-testid="device-worktree-cap-state">{stateLine}</div>

      <CoordAdminOnly fallback={<ReadOnlyNotice />}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!actable || busy}
            title={actable ? undefined : capDisabledReason(target, cap)}
            onClick={() => {
              setValue(
                cap.state === "capped" ? String(cap.entry.maxWorktrees) : ""
              );
              setValueTouched(false);
              setReason("");
              setMode("set");
            }}
            data-testid="device-worktree-cap-open"
          >
            <Gauge className="h-3.5 w-3.5" />
            {cap.state === "capped" ? "Change cap…" : "Set cap…"}
          </Button>
          {cap.state === "capped" && (
            <Button
              size="sm"
              variant="outline"
              disabled={!actable || busy}
              title={actable ? undefined : capDisabledReason(target, cap)}
              onClick={() => {
                setReason("");
                setMode("clear");
              }}
              data-testid="device-worktree-cap-clear"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear cap
            </Button>
          )}
          {!actable && (
            <span
              className="text-[11px] break-words text-muted-foreground"
              data-testid="device-worktree-cap-disabled-reason"
            >
              {capDisabledReason(target, cap)}
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
        <DialogContent data-testid="device-worktree-cap-dialog">
          <DialogHeader>
            <DialogTitle>
              {mode === "clear"
                ? `Remove the worktree cap on ${rowHostname}?`
                : `Cap worktrees on ${rowHostname}?`}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="break-words">
                  {mode === "clear"
                    ? "Coord will go back to deriving this machine's worktree limit from its memory."
                    : "Coord will allow at most this many agent worktrees on this machine, overriding the limit it would derive from the machine's memory. This is NOT a drain: the machine keeps taking work, and nothing already running on it is stopped."}
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
                    devices — and capping one does nothing to the other.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {mode === "set" && (
              <div className="space-y-1.5">
                <Label htmlFor="device-worktree-cap-value">
                  Worktrees (required)
                </Label>
                <Input
                  id="device-worktree-cap-value"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={value}
                  disabled={busy}
                  // Linked programmatically, not merely rendered nearby: a
                  // screen-reader user tabbing into an invalid field otherwise
                  // meets no connection to the sentence explaining it, which is
                  // this file's commitment #1 one layer down.
                  aria-invalid={showValueError ? true : undefined}
                  aria-describedby={
                    showValueError ? "device-worktree-cap-error" : undefined
                  }
                  onChange={(e) => {
                    setValue(e.target.value);
                    setValueTouched(true);
                  }}
                  data-testid="device-worktree-cap-value"
                />
                {showValueError && (
                  <p
                    id="device-worktree-cap-error"
                    className="text-[11px] break-words text-amber-600 dark:text-amber-500"
                    role="status"
                    data-testid="device-worktree-cap-error"
                  >
                    {valueError}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground break-words">
                  There is no zero: a cap of 0 would refuse every allocation on
                  this machine, including the worktree you would need in order
                  to set it back. There is no upper bound either — a no-build
                  worktree costs disk rather than memory, and coord&apos;s disk
                  gate carries that. Coord&apos;s built-in minimum is a floor
                  under the limit it <em>derives</em> from this machine&apos;s
                  memory, and a cap is meant to replace that derivation rather
                  than be bounded by it. Whatever coord stores is what the
                  row&apos;s own line shows after the write.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="device-worktree-cap-reason">
                Reason (required)
              </Label>
              <Textarea
                id="device-worktree-cap-reason"
                rows={2}
                value={reason}
                disabled={busy}
                // The SAME bound the backend enforces (`reason` is
                // `max_length=2000` on both request models). Without it a longer
                // reason 422s from the console, and the field naming the
                // violation is dropped on the way back: the production error
                // envelope puts it in `details[]`, which `describeDrainError`
                // does not read, so the operator would see a bare
                // "VALIDATION_ERROR — Invalid request data".
                maxLength={CONTROL_REASON_MAX_LENGTH}
                placeholder={
                  mode === "clear"
                    ? "e.g. disk sweep finished"
                    : "e.g. holding this box down while the disk sweep runs"
                }
                onChange={(e) => setReason(e.target.value)}
                data-testid="device-worktree-cap-reason"
              />
              <p className="text-[11px] text-muted-foreground break-words">
                Recorded on coord&apos;s audit row and shown in every allocation
                refusal this cap produces, so it is what tells the next session
                why it was turned away.
              </p>
            </div>

          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={close}
              data-testid="device-worktree-cap-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                deviceId === null ||
                reason.trim() === "" ||
                (mode === "set" && valueError !== null)
              }
              onClick={() => void submit()}
              data-testid="device-worktree-cap-submit"
            >
              {mode === "clear" ? "Remove cap" : "Set cap"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

/**
 * GateActions — per-gate operator action controls for the admin gates table.
 *
 * Renders a compact overflow menu (⋯) whose items are gated by the gate's
 * current state, plus confirm dialogs for the destructive verbs. Every action
 * POSTs/PATCHes the EXISTING web-backend coord proxies under
 * `/operations/gates/{id}/*` through the typed client
 * (`@/lib/api/operations/coordGates`) — the same bearer-forwarding +
 * tenant-switcher (`X-Qontinui-Active-Tenant`) plumbing the read side
 * (`admin-dev-service`) already uses. The frontend never talks to coord
 * directly.
 *
 * These verbs were shared with `components/operations/GatesPanel` until
 * Phase 4 of `2026-08-25-coord-console-intent-and-devops-sections` deleted it.
 * That the two surfaces already mutated through ONE set of helpers is why the
 * delete cost no capability: this page's action set was a strict superset
 * (reject, force-clear, continuation-cancel and change-audience are here and
 * were never there).
 *
 * State → visible actions (task spec):
 *   - open + operator_approval → Approve, Reject…
 *   - open (any)               → Mute, Snooze, Force-clear…, Change audience
 *   - muted                    → Unmute
 *   - cleared / failed         → Reopen
 *   - armed/dispatched, live   → Cancel continuation…
 *
 * Destructive verbs (Reject, Force-clear, Cancel continuation) open an
 * `AlertDialog` with a reason field and a synthetic-click-gated
 * `DestructiveButton` confirm. Force-clear REQUIRES a reason (confirm disabled
 * until non-empty). On success we refetch via `onActed` (coord is the source of
 * truth — no optimistic mutation); on error we surface coord's message in a
 * toast.
 */

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  approveGate,
  cancelGateContinuation,
  forceClearGate,
  muteGate,
  rejectGate,
  reopenGate,
  setGateAudience,
  snoozeGate,
  unmuteGate,
} from "@/lib/api/operations/coordGates";
import type { GateOverviewRow } from "@/services/admin-dev-service";

const log = createLogger("GateActions");

// Snooze presets. These were mirrored from the operations `GatesPanel`, which
// no longer exists — this is now the only place they are defined.
const SNOOZE_PRESETS: { label: string; secs: number }[] = [
  { label: "1 hour", secs: 3_600 },
  { label: "1 day", secs: 86_400 },
  { label: "1 week", secs: 604_800 },
];

/** ISO timestamp `secs` from now — the `until` value for a snooze. */
function snoozeUntilIso(secs: number): string {
  return new Date(Date.now() + secs * 1_000).toISOString();
}

/** The verb-string coord actor label written into destructive audit fields. */
const OPERATOR_ACTOR = "operator-console";

type PendingDialog =
  | "approve"
  | "reject"
  | "force-clear"
  | "cancel-continuation"
  | null;

export function GateActions({
  gate,
  onActed,
}: {
  gate: GateOverviewRow;
  /** Refetch the overview after a successful action (coord is source of
   *  truth — we refetch rather than optimistically mutate). */
  onActed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<PendingDialog>(null);
  const [reason, setReason] = useState("");

  const verdict = gate.verdict.toLowerCase();
  const isOpen = verdict === "open";
  // `withdrawn` (registrant cancelled its own request — plan
  // `2026-07-27-configurable-gate-clearance-authority`) is deliberately NOT
  // in the Reopen set: coord's reopen semantics for withdrawn gates are
  // undefined until the clearance-authority coord PRs land, so a withdrawn
  // row offers no verdict-changing actions (mute/unmute still applies).
  const isClearedOrFailed = verdict === "cleared" || verdict === "failed";
  const isOperatorApproval =
    (gate.predicate?.kind as string | undefined) === "operator_approval";
  const audience = gate.clearance_audience ?? "operator";
  // A continuation is cancellable while it is armed (register-time spawn present)
  // or dispatched, and has NOT already been consumed, cancelled or EXPIRED.
  //
  // The expiry clause is not symmetry for its own sake. coord's cancel writer
  // (`gates.rs`) guards on `continuation_consumed_at IS NULL` and
  // `continuation_cancelled_at IS NULL` and NOT on
  // `continuation_expired_at IS NULL`, so a cancel posted against an expired
  // row is ACCEPTED. Offering the button there fails two UX gates at once:
  // it is not reversible (coord has no un-cancel), and it accomplishes
  // nothing an operator would want — the continuation was already never going
  // to dispatch, and coord had already raised a durable alert for the expiry.
  // `continuationStatus.ts` separately orders `expired` above `cancelled` so
  // a cancel arriving from any other door cannot erase the expiry from the
  // row's rendering either.
  const hasCancellableContinuation =
    (gate.continuation_spawn != null ||
      gate.continuation_dispatched_at != null) &&
    gate.continuation_consumed_at == null &&
    gate.continuation_cancelled_at == null &&
    gate.continuation_expired_at == null;

  // Shared action runner — surfaces coord's error message on failure and
  // refetches on success. `action` is one `coordGates` call. A non-2xx
  // rejects in `readJson`'s `<METHOD> <url> failed: <status> - <body>` shape
  // and is read back here, so a coord refusal still toasts "<verb> failed"
  // with coord's own text and only a transport error says "Action failed".
  const runAction = useCallback(
    async (
      action: () => Promise<unknown>,
      opts: { successMsg: string },
    ): Promise<boolean> => {
      setBusy(true);
      try {
        await action();
        toast.success(opts.successMsg);
        onActed();
        return true;
      } catch (err) {
        const status = httpStatusOf(err);
        if (status !== null) {
          const text = httpBodyOf(err) ?? "";
          log.warn("gate action failed", opts.successMsg, status, text);
          toast.error(opts.successMsg.replace(/…$/, "") + " failed", {
            description: text || `HTTP ${status}`,
          });
          return false;
        }
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("gate action threw", opts.successMsg, msg);
        toast.error("Action failed", { description: msg });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onActed],
  );

  const id = gate.gate_id;

  // ---- Approve (state-changing → attestation dialog + DestructiveButton) ---
  // Clearing a gate is a real state change; the codebase gates such actions
  // behind a `DestructiveButton` (synthetic-click protection), so Approve opens
  // a confirm dialog rather than firing straight from the menu item.
  const onConfirmApprove = useCallback(() => {
    void runAction(() => approveGate(id), { successMsg: "Gate approved" }).then(
      (ok) => {
        if (ok) setDialog(null);
      },
    );
  }, [runAction, id]);

  // ---- Non-destructive actions --------------------------------------------

  const onReopen = useCallback(() => {
    void runAction(() => reopenGate(id), { successMsg: "Gate reopened" });
  }, [runAction, id]);

  const onToggleMute = useCallback(() => {
    if (gate.muted) {
      void runAction(() => unmuteGate(id), { successMsg: "Gate unmuted" });
    } else {
      void runAction(() => muteGate(id), { successMsg: "Gate muted" });
    }
  }, [runAction, id, gate.muted]);

  const onSnooze = useCallback(
    (secs: number, label: string) => {
      void runAction(() => snoozeGate(id, snoozeUntilIso(secs)), {
        successMsg: `Gate snoozed for ${label}`,
      });
    },
    [runAction, id],
  );

  const onSetAudience = useCallback(
    (next: "operator" | "agent") => {
      void runAction(() => setGateAudience(id, next), {
        successMsg: `Audience set to ${next}`,
      });
    },
    [runAction, id],
  );

  // ---- Destructive actions (reason dialog) --------------------------------
  const closeDialog = useCallback(() => {
    setDialog(null);
    setReason("");
  }, []);

  const onConfirmReject = useCallback(() => {
    const body = reason.trim() ? { reason: reason.trim() } : {};
    void runAction(() => rejectGate(id, body), {
      successMsg: "Gate rejected",
    }).then((ok) => {
      if (ok) closeDialog();
    });
  }, [runAction, id, reason, closeDialog]);

  const onConfirmForceClear = useCallback(() => {
    void runAction(() => forceClearGate(id, reason.trim()), {
      successMsg: "Gate force-cleared",
    }).then((ok) => {
      if (ok) closeDialog();
    });
  }, [runAction, id, reason, closeDialog]);

  const onConfirmCancelContinuation = useCallback(() => {
    void runAction(
      () =>
        cancelGateContinuation(id, {
          cancelled_by: OPERATOR_ACTOR,
          reason: reason.trim(),
        }),
      { successMsg: "Continuation cancelled" },
    ).then((ok) => {
      if (ok) closeDialog();
    });
  }, [runAction, id, reason, closeDialog]);

  // No applicable actions (e.g. a cleared gate that can't be reopened in this
  // window) → render nothing rather than an empty menu.
  const hasAnyAction =
    isOpen || isClearedOrFailed || gate.muted || hasCancellableContinuation;
  if (!hasAnyAction) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Actions for gate ${gate.title}`}
            data-testid="gate-actions-trigger"
            data-gate-id={id}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Gate actions</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/* Approve / Reject — OPEN operator_approval gates only. */}
          {isOpen && isOperatorApproval && (
            <>
              <DropdownMenuItem
                onClick={() => setDialog("approve")}
                data-action="approve"
              >
                Approve…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setReason("");
                  setDialog("reject");
                }}
                data-action="reject"
              >
                Reject…
              </DropdownMenuItem>
            </>
          )}

          {/* Reopen — cleared/failed gates. */}
          {isClearedOrFailed && (
            <DropdownMenuItem onClick={onReopen} data-action="reopen">
              Reopen
            </DropdownMenuItem>
          )}

          {/* Mute / Unmute. Unmute whenever muted; Mute on open gates. */}
          {gate.muted ? (
            <DropdownMenuItem onClick={onToggleMute} data-action="unmute">
              Unmute
            </DropdownMenuItem>
          ) : (
            isOpen && (
              <DropdownMenuItem onClick={onToggleMute} data-action="mute">
                Mute
              </DropdownMenuItem>
            )
          )}

          {/* Snooze — open gates. */}
          {isOpen && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-action="snooze">
                Snooze…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SNOOZE_PRESETS.map((p) => (
                  <DropdownMenuItem
                    key={p.secs}
                    onClick={() => onSnooze(p.secs, p.label)}
                    data-action={`snooze-${p.secs}`}
                  >
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {/* Change audience — open gates. Offer the OTHER value. */}
          {isOpen && (
            <DropdownMenuItem
              onClick={() =>
                onSetAudience(audience === "operator" ? "agent" : "operator")
              }
              data-action="audience"
            >
              Set audience → {audience === "operator" ? "agent" : "operator"}
            </DropdownMenuItem>
          )}

          {/* Cancel continuation — armed/dispatched, not yet consumed. */}
          {hasCancellableContinuation && (
            <DropdownMenuItem
              onClick={() => {
                setReason("");
                setDialog("cancel-continuation");
              }}
              className="text-destructive focus:text-destructive"
              data-action="cancel-continuation"
            >
              Cancel continuation…
            </DropdownMenuItem>
          )}

          {/* Force-clear — open gates. DESTRUCTIVE. */}
          {isOpen && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setReason("");
                  setDialog("force-clear");
                }}
                className="text-destructive focus:text-destructive"
                data-action="force-clear"
              >
                Force-clear…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ---- Approve dialog (attestation) ---- */}
      <AlertDialog
        open={dialog === "approve"}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <AlertDialogContent data-testid="gate-approve-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this gate?</AlertDialogTitle>
            <AlertDialogDescription>
              Clears the approval gate as met. Coord stops watching it and any
              armed continuation fires. You can reopen it afterward if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <DestructiveButton onClick={onConfirmApprove} disabled={busy}>
              Approve gate
            </DestructiveButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Reject dialog (reason optional) ---- */}
      <AlertDialog
        open={dialog === "reject"}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <AlertDialogContent data-testid="gate-reject-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this gate?</AlertDialogTitle>
            <AlertDialogDescription>
              Marks the approval gate <span className="font-mono">failed</span>.
              Coord stops watching it. You can reopen it afterward if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="gate-reject-reason">Reason (optional)</Label>
            <Textarea
              id="gate-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this gate being rejected?"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <DestructiveButton onClick={onConfirmReject} disabled={busy}>
              Reject gate
            </DestructiveButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Force-clear dialog (reason REQUIRED) ---- */}
      <AlertDialog
        open={dialog === "force-clear"}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <AlertDialogContent data-testid="gate-force-clear-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Force-clear this gate?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears the gate even though its condition is NOT met,
              overriding the predicate. Any continuation armed on it will fire.
              This is destructive — a reason is required for the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="gate-force-clear-reason">Reason (required)</Label>
            <Textarea
              id="gate-force-clear-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you overriding the gate's condition?"
              rows={3}
              aria-required
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <DestructiveButton
              onClick={onConfirmForceClear}
              disabled={busy || reason.trim().length === 0}
            >
              Force-clear gate
            </DestructiveButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Cancel-continuation dialog (reason optional) ---- */}
      <AlertDialog
        open={dialog === "cancel-continuation"}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <AlertDialogContent data-testid="gate-cancel-continuation-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this gate&apos;s continuation?</AlertDialogTitle>
            <AlertDialogDescription>
              Clearing this gate will no longer spawn the armed follow-up
              session. The gate itself is unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="gate-cancel-continuation-reason">
              Reason (optional)
            </Label>
            <Textarea
              id="gate-cancel-continuation-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why cancel the continuation?"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <DestructiveButton
              onClick={onConfirmCancelContinuation}
              disabled={busy}
            >
              Cancel continuation
            </DestructiveButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

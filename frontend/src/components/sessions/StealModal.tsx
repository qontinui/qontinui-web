"use client";

/**
 * StealModal — Phase 6 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Triggered by `ConflictRow`'s Steal button (or by SessionDetail's
 * action strip on a session held by another machine). Captures the
 * 10-char-minimum reason mandated by plan §D14, posts to
 * `POST /api/v1/operations/sessions/:id/steal`, and bubbles success
 * up to the parent so it can refresh.
 *
 * Server-side enforces `reason.chars().count() >= 10`
 * (`qontinui-coord/src/sessions.rs::post_steal`); the modal's
 * client-side gate is convenience, not security.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { stealSession } from "./api";
import type { SessionRow } from "./types";

const MIN_REASON_CHARS = 10;

/**
 * Dashboard-originated steal calls still need a `machine_id` to
 * satisfy coord's wire shape. The dashboard isn't a machine in the
 * coord-devices sense, so we mint a per-browser-tab UUID once and
 * reuse it for every steal originating from this tab.
 *
 * Persistence: `sessionStorage` (per-tab) so closing the tab drops
 * the id without polluting `localStorage` cross-tabs. Lives at
 * `qontinui.sessions.dashboard-machine-id`.
 */
const DASHBOARD_MACHINE_ID_KEY = "qontinui.sessions.dashboard-machine-id";

export function getDashboardMachineId(): string {
  if (typeof window === "undefined") {
    // Server side render path — coord never sees the value, just
    // return a stable nil UUID so the type-checker is happy.
    return "00000000-0000-0000-0000-000000000000";
  }
  try {
    const existing = window.sessionStorage.getItem(DASHBOARD_MACHINE_ID_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  } catch {
    // sessionStorage may be unavailable (private mode); fall through.
  }
  const id = crypto.randomUUID();
  try {
    window.sessionStorage.setItem(DASHBOARD_MACHINE_ID_KEY, id);
  } catch {
    // ignore
  }
  return id;
}

export interface StealModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Session currently holding the contested claim. */
  session: SessionRow;
  /**
   * Optional — when the modal is opened from a ConflictRow we know
   * the local challenger session so we can surface its purpose for
   * context.
   */
  challenger?: SessionRow;
  /** Called after the steal POST resolves OK. */
  onSucceeded?: () => void;
  /** device_id → hostname resolver for context strings. */
  hostnameFor?: (deviceId: string) => string | undefined;
}

export function StealModal({
  open,
  onOpenChange,
  session,
  challenger,
  onSucceeded,
  hostnameFor,
}: StealModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state on close so a re-open shows a clean modal.
  useEffect(() => {
    if (!open) {
      setReason("");
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const charCount = useMemo(() => Array.from(reason).length, [reason]);
  const charsRemaining = Math.max(0, MIN_REASON_CHARS - charCount);
  const canSubmit = charsRemaining === 0 && !submitting;

  const holderIdentity = useMemo(() => {
    const host = hostnameFor?.(session.device_id);
    return host ?? `${session.device_id.slice(0, 8)}…`;
  }, [hostnameFor, session.device_id]);

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await stealSession(session.id, {
        reason,
        machine_id: getDashboardMachineId(),
      });
      onSucceeded?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "steal failed");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, reason, session.id, onSucceeded, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-ui-bridge-id="steal-modal">
        <DialogHeader>
          <DialogTitle>Steal claim from {holderIdentity}</DialogTitle>
          <DialogDescription>
            Stealing forces the other machine&apos;s next heartbeat to return{" "}
            <code className="font-mono text-xs">Stolen</code> and notifies its
            session. A reason ≥ 10 characters is required; it&apos;s recorded in
            the tenant&apos;s audit log per the{" "}
            <code className="font-mono text-xs">claim_steal_visibility</code>{" "}
            policy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {challenger && (
            <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Your session</p>
              <p
                className="font-medium"
                data-ui-bridge-id="steal-modal.challenger-purpose"
              >
                {(challenger.intent as { purpose?: string })?.purpose ??
                  "(no purpose declared)"}
              </p>
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Reason
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Explain why this steal is necessary right now. Async-message-first is usually better."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
              data-ui-bridge-id="steal-modal.reason-input"
              disabled={submitting}
              autoFocus
            />
            <p
              className="text-[11px] text-muted-foreground tabular-nums"
              data-ui-bridge-id="steal-modal.reason-counter"
              data-chars-ok={charsRemaining === 0 ? "true" : "false"}
            >
              {charsRemaining === 0
                ? `${charCount} chars — ready to steal`
                : `${charCount} chars — ${charsRemaining} more needed to proceed`}
            </p>
          </label>

          {error && (
            <div
              className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-300"
              data-ui-bridge-id="steal-modal.error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-ui-bridge-id="steal-modal.cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onSubmit}
            disabled={!canSubmit}
            data-ui-bridge-id="steal-modal.submit"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Stealing…
              </>
            ) : (
              "Steal claim"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

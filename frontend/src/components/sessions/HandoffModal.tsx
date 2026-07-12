"use client";

/**
 * HandoffModal — Phase 7 of
 * `2026-05-23-coord-native-sessions-phase-7-10.md`.
 *
 * Triggered by SessionDetail's "Continue elsewhere" action and reused
 * (with resume-specific copy) by the twin session page's ResumePanel
 * "Resume here…" flow. Picks a target machine and posts to
 * `POST /api/v1/operations/sessions/:id/handoff { target_device_id }`.
 *
 * Coord records a durable `handoff_request` event on the source session
 * and publishes the JetStream handoff subject scoped to the target
 * machine. The target runner's receiver loop materializes a child
 * session (`parent_session_id = source`) and closes this one — a one-way
 * move (no live mirror; that's Phase 8). The dashboard simply fires the
 * request and refreshes; the actual move happens on the two runners.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ArrowRightLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { handoffSession } from "./api";

/** One candidate target machine. */
export interface HandoffTarget {
  device_id: string;
  hostname: string;
}

export interface HandoffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The coord session being moved. */
  sessionId: string;
  /**
   * The device the session currently runs on, or null when unknown.
   * Rendered disabled + "(current)" in the picker so the operator can
   * see where the session lives; coord rejects a self-handoff with a
   * 400 anyway.
   */
  currentDeviceId: string | null;
  /** Devices the session can move to (deduped by the modal). */
  candidates: HandoffTarget[];
  /** Called with the chosen target after the handoff POST resolves OK. */
  onSucceeded?: (target: HandoffTarget) => void;
  /** Optional copy overrides — the "Resume here…" flow on the twin
   *  session page reuses this modal with resume-specific wording. */
  title?: string;
  description?: string;
  confirmLabel?: string;
}

export function HandoffModal({
  open,
  onOpenChange,
  sessionId,
  currentDeviceId,
  candidates,
  onSucceeded,
  title = "Continue elsewhere",
  description = "Move this session to another machine. The target runner picks up the request, recreates the session with the same working directory, held claims, and recent terminal scrollback, then this session closes. One-way move — no live mirror.",
  confirmLabel = "Continue elsewhere",
}: HandoffModalProps) {
  const [targetId, setTargetId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deduped candidates. The session's current device stays in the list
  // (marked + disabled) so the operator sees where the session lives.
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    const out: HandoffTarget[] = [];
    for (const c of candidates) {
      if (seen.has(c.device_id)) continue;
      seen.add(c.device_id);
      out.push(c);
    }
    return out;
  }, [candidates]);

  const eligible = useMemo(
    () => deduped.filter((c) => c.device_id !== currentDeviceId),
    [deduped, currentDeviceId]
  );

  // Reset on close; default the selection to the first eligible target
  // on open so a single-target case is one click.
  useEffect(() => {
    if (!open) {
      setTargetId("");
      setSubmitting(false);
      setError(null);
      return;
    }
    const first = eligible[0];
    if (first) {
      setTargetId((prev) => prev || first.device_id);
    }
  }, [open, eligible]);

  const canSubmit =
    targetId !== "" && targetId !== currentDeviceId && !submitting;

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await handoffSession(sessionId, { target_device_id: targetId });
      const target = eligible.find((c) => c.device_id === targetId) ?? {
        device_id: targetId,
        hostname: "",
      };
      onSucceeded?.(target);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "handoff failed");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, sessionId, targetId, eligible, onSucceeded, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-ui-bridge-id="handoff-modal">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {eligible.length === 0 ? (
            <div
              className="rounded-md border border-border/40 bg-muted/30 px-3 py-3 text-xs text-muted-foreground"
              data-ui-bridge-id="handoff-modal.no-targets"
            >
              No other machines are online in this tenant. A handoff needs a
              second runner connected to coord.
            </div>
          ) : (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Target machine
              </span>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                data-ui-bridge-id="handoff-modal.target-select"
                disabled={submitting}
                autoFocus
              >
                {deduped.map((c) => {
                  const isCurrent = c.device_id === currentDeviceId;
                  const label = c.hostname || `${c.device_id.slice(0, 8)}…`;
                  return (
                    <option
                      key={c.device_id}
                      value={c.device_id}
                      disabled={isCurrent}
                    >
                      {isCurrent ? `${label} (current)` : label}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          {error && (
            <div
              className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-300"
              data-ui-bridge-id="handoff-modal.error"
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
            data-ui-bridge-id="handoff-modal.cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!canSubmit}
            data-ui-bridge-id="handoff-modal.submit"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <ArrowRightLeft className="h-4 w-4 mr-2" />
                {confirmLabel}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

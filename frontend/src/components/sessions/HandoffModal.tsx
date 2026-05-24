"use client";

/**
 * HandoffModal — Phase 7 of
 * `2026-05-23-coord-native-sessions-phase-7-10.md`.
 *
 * Triggered by SessionDetail's "Continue elsewhere" action. Picks a
 * target machine and posts to
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
import type { SessionRow } from "./types";

/** One candidate target machine. */
export interface HandoffTarget {
  device_id: string;
  hostname: string;
}

export interface HandoffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The session being moved. */
  session: SessionRow;
  /**
   * Devices the session can move to. The session's own device is
   * filtered out by the modal (coord also rejects a self-handoff with
   * a 400, but filtering here keeps the picker clean).
   */
  candidates: HandoffTarget[];
  /** Called after the handoff POST resolves OK. */
  onSucceeded?: () => void;
}

export function HandoffModal({
  open,
  onOpenChange,
  session,
  candidates,
  onSucceeded,
}: HandoffModalProps) {
  const [targetId, setTargetId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Eligible targets = every candidate except the session's current
  // device. Deduped by device_id.
  const eligible = useMemo(() => {
    const seen = new Set<string>();
    const out: HandoffTarget[] = [];
    for (const c of candidates) {
      if (c.device_id === session.device_id) continue;
      if (seen.has(c.device_id)) continue;
      seen.add(c.device_id);
      out.push(c);
    }
    return out;
  }, [candidates, session.device_id]);

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

  const canSubmit = targetId !== "" && !submitting;

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await handoffSession(session.id, { target_device_id: targetId });
      onSucceeded?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "handoff failed");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, session.id, targetId, onSucceeded, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-ui-bridge-id="handoff-modal"
      >
        <DialogHeader>
          <DialogTitle>Continue elsewhere</DialogTitle>
          <DialogDescription>
            Move this session to another machine. The target runner picks
            up the request, recreates the session with the same working
            directory, held claims, and recent terminal scrollback, then
            this session closes. One-way move — no live mirror.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {eligible.length === 0 ? (
            <div
              className="rounded-md border border-border/40 bg-muted/30 px-3 py-3 text-xs text-muted-foreground"
              data-ui-bridge-id="handoff-modal.no-targets"
            >
              No other machines are online in this tenant. A handoff needs
              a second runner connected to coord.
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
                {eligible.map((c) => (
                  <option key={c.device_id} value={c.device_id}>
                    {c.hostname || `${c.device_id.slice(0, 8)}…`}
                  </option>
                ))}
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
                Continue elsewhere
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

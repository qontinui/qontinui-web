"use client";

/**
 * ResumePanel — restore capability badge + "Resume here…" action for the
 * twin session detail page (plan
 * `2026-07-09-runner-session-history-cloud-sync`, Phase 4).
 *
 * Reads the session's newest `restore-record` event (the runner's mirror
 * of its restore-registry record) via
 * `GET /api/v1/operations/sessions/:id/restore-record` and renders an
 * honest capability badge:
 *
 * - `restore_tier: "full"`          → conversation + terminal resume
 * - `restore_tier: "terminal_only"` → terminal/cwd/command only; a
 *                                     resume starts a fresh conversation
 * - no restore-record               → not resumable from this machine
 *
 * "Resume here…" opens a target-device picker (the tenant's machines
 * from the devenv twin — same data source as /environments/machines —
 * mapped to their paired coord devices) and confirms into the EXISTING
 * Phase-7 handoff API (`POST /sessions/:id/handoff {target_device_id}`).
 * The target runner materializes the session from the mirrored record.
 *
 * Edge states:
 * - 401/403 on the restore-record read → the whole action is hidden.
 * - already-pending handoff (a `handoff_request` event on the session)
 *   → a "handoff pending" chip replaces the button.
 * - closed session with no restore-record → badge only, no button.
 * - API errors surface inline, never as silent empty states.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Loader2, MonitorUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/components/operations/utils";
import { listMachines, type Machine } from "@/services/devenv-api";
import { getSessionRestoreRecord, SessionsApiError } from "./api";
import { HandoffModal, type HandoffTarget } from "./HandoffModal";
import type {
  RestoreRecordPayload,
  SessionEventRow,
  SessionRestoreRecordResponse,
} from "./types";

export interface ResumePanelProps {
  /** The session's coord/twin id (the detail card's `id`). */
  sessionId: string;
  /** True when the session is closed. */
  sessionClosed: boolean;
  /** The coord device the session currently runs on, or null. */
  currentDeviceId: string | null;
}

type RestoreState =
  | { kind: "loading" }
  /** 401/403 — the caller may not read this surface; hide the action. */
  | { kind: "unauthorized" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; data: SessionRestoreRecordResponse };

function payloadOf(event: SessionEventRow | null): RestoreRecordPayload {
  return (event?.payload ?? {}) as RestoreRecordPayload;
}

/** Machine → handoff target: only machines bridged to a coord device
 *  (`coord_device_id`) can receive a handoff. */
function machineTargets(machines: Machine[]): HandoffTarget[] {
  return machines
    .filter((m) => !m.revoked && m.coord_device_id)
    .map((m) => ({
      device_id: m.coord_device_id as string,
      hostname: m.hostname ? `${m.name} (${m.hostname})` : m.name,
    }));
}

function CapabilityBadge({ record }: { record: SessionEventRow | null }) {
  if (!record) {
    return (
      <Badge variant="secondary" data-testid="resume-capability-badge">
        Not resumable from this machine
      </Badge>
    );
  }
  const tier = payloadOf(record).restore_tier;
  if (tier === "full") {
    return (
      <Badge variant="success" data-testid="resume-capability-badge">
        Resumable: full (conversation + terminal)
      </Badge>
    );
  }
  if (tier === "terminal_only") {
    return (
      <Badge variant="warning" data-testid="resume-capability-badge">
        Resumable: terminal only — a resume starts a fresh conversation
      </Badge>
    );
  }
  // A restore-record with a tier this UI doesn't know — surface it
  // verbatim rather than guessing a capability.
  return (
    <Badge variant="outline" data-testid="resume-capability-badge">
      Resumable: {String(tier ?? "unknown tier")}
    </Badge>
  );
}

export function ResumePanel({
  sessionId,
  sessionClosed,
  currentDeviceId,
}: ResumePanelProps) {
  const [restore, setRestore] = useState<RestoreState>({ kind: "loading" });

  // Target machines — fetched on the first "Resume here…" click (same
  // data source as /environments/machines), then cached.
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [machinesLoading, setMachinesLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  /** Set after a handoff POST succeeds in this view. */
  const [requestedTarget, setRequestedTarget] = useState<HandoffTarget | null>(
    null
  );

  useEffect(() => {
    const controller = new AbortController();
    setRestore({ kind: "loading" });
    getSessionRestoreRecord(sessionId, controller.signal)
      .then((data) => setRestore({ kind: "loaded", data }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof SessionsApiError) {
          if (err.status === 401 || err.status === 403) {
            setRestore({ kind: "unauthorized" });
            return;
          }
          if (err.status === 404) {
            // Coord doesn't know the session — honestly "no
            // restore-record", not an error.
            setRestore({
              kind: "loaded",
              data: {
                session_id: sessionId,
                restore_record: null,
                handoff_request: null,
              },
            });
            return;
          }
        }
        setRestore({
          kind: "error",
          message:
            err instanceof Error ? err.message : "failed to load restore state",
        });
      });
    return () => controller.abort();
  }, [sessionId]);

  const openPicker = useCallback(async () => {
    setActionError(null);
    if (machines) {
      setPickerOpen(true);
      return;
    }
    setMachinesLoading(true);
    try {
      const data = await listMachines();
      setMachines(data);
      setPickerOpen(true);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "failed to load machines"
      );
    } finally {
      setMachinesLoading(false);
    }
  }, [machines]);

  if (restore.kind === "unauthorized") {
    // Not allowed to read the resume surface — no badge, no action.
    return null;
  }

  const record = restore.kind === "loaded" ? restore.data.restore_record : null;
  const pendingEvent =
    restore.kind === "loaded" ? restore.data.handoff_request : null;
  const payload = payloadOf(record);

  // A handoff_request event on a still-open session means the move is in
  // flight (the target runner closes the source once materialized) —
  // show that instead of offering a second one.
  const serverPending = pendingEvent !== null && !sessionClosed;
  const pendingTargetId =
    typeof payloadOf(pendingEvent).target_device_id === "string"
      ? (payloadOf(pendingEvent).target_device_id as string)
      : null;

  const showButton =
    restore.kind === "loaded" &&
    record !== null &&
    !serverPending &&
    requestedTarget === null;

  const targets = machines ? machineTargets(machines) : [];

  const confirmDescription =
    payload.restore_tier === "terminal_only"
      ? "Resume this session on another machine. Terminal-only restore: the working directory, launch command, and terminal come back, but the AI conversation starts fresh. The chosen runner picks up the handoff and materializes the session from its mirrored restore record."
      : "Resume this session on another machine. The chosen runner picks up the handoff and materializes the session from its mirrored restore record — conversation and terminal included.";

  return (
    <div data-testid="session-resume-panel">
      <h4 className="text-xs font-medium flex items-center gap-1.5 mb-1.5 text-muted-foreground">
        <MonitorUp className="size-3.5" />
        Resume
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        {restore.kind === "loading" ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Checking restore capability…
          </span>
        ) : restore.kind === "error" ? (
          <span
            className="text-xs text-destructive"
            data-testid="resume-restore-error"
          >
            Couldn&apos;t read restore state: {restore.message}
          </span>
        ) : (
          <>
            <CapabilityBadge record={record} />
            {record && payload.provider && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {payload.provider}
              </span>
            )}
            {record && payload.machine_id && (
              <span
                className="font-mono text-[10px] text-muted-foreground"
                title={String(payload.machine_id)}
              >
                on {String(payload.machine_id).slice(0, 8)}
              </span>
            )}
            {serverPending && (
              <Badge variant="outline" data-testid="resume-handoff-pending">
                <ArrowRightLeft className="size-3" />
                handoff pending
                {pendingTargetId
                  ? ` → ${pendingTargetId.slice(0, 8)}…`
                  : ""}{" "}
                {pendingEvent?.occurred_at
                  ? `(requested ${relativeTime(pendingEvent.occurred_at)})`
                  : ""}
              </Badge>
            )}
            {requestedTarget && (
              <Badge variant="info" data-testid="resume-handoff-requested">
                <ArrowRightLeft className="size-3" />
                Handoff requested →{" "}
                {requestedTarget.hostname ||
                  `${requestedTarget.device_id.slice(0, 8)}…`}
              </Badge>
            )}
            {showButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openPicker()}
                disabled={machinesLoading}
                data-testid="resume-here-button"
              >
                {machinesLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MonitorUp className="size-4" />
                )}
                Resume here…
              </Button>
            )}
          </>
        )}
      </div>
      {actionError && (
        <p
          className="mt-1.5 text-xs text-destructive"
          data-testid="resume-action-error"
        >
          {actionError}
        </p>
      )}

      <HandoffModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        sessionId={sessionId}
        currentDeviceId={currentDeviceId}
        candidates={targets}
        title="Resume on another machine"
        description={confirmDescription}
        confirmLabel="Request resume"
        onSucceeded={(target) => {
          setActionError(null);
          setRequestedTarget(target);
        }}
      />
    </div>
  );
}

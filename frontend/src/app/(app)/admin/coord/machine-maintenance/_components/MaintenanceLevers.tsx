"use client";

/**
 * The two lever rows — Agent work and CI — each with its state ALWAYS visible
 * and its own Pause / Resume.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place` §0 +
 * §D7. The levers stay individually controllable because pausing only CI is a
 * real use on its own (a WSL restart, a Docker prune) that must not cost the
 * operator their agent sessions; each row always shows its own state, so a
 * half-paused machine never reads as either fully paused or fully live.
 *
 * Not `RecordRow`s: a lever is a control with a state, not a record in a
 * list, and its action has to sit on the line rather than behind an expand
 * (the posture `DeviceDrainControl` documented: the state line is always
 * visible, only a FORM hides behind a dialog). The accent still comes from
 * the audited table through `rowAccentProps`.
 *
 * - With a window open, Pause / Resume is `PATCH …/{id}` on that one lever;
 *   a `partial` or `failed` hold offers Pause again — the retry.
 * - With no window, Pause needs a deadline and a reason, so it opens the
 *   Prepare dialog with only this lever ticked.
 * - A `last_matching_host` refusal on re-holding CI is the same question the
 *   dialog asks, answered on the row.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge, rowAccentProps } from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import {
  MAINTENANCE_LEVER_PALETTE,
  deriveLeverStatus,
} from "@/components/operations/maintenanceStatus";
import {
  describeMaintenanceError,
  drainLanesDetail,
  formatUntil,
  labelOutcomeLabel,
  leverActionPauses,
  type MachineEntry,
  type MaintenanceContext,
  type MaintenanceError,
  type MaintenanceLever,
  type MaintenanceWindow,
} from "@/components/operations/maintenanceWindow";
import { setMaintenanceLever } from "@/components/operations/useMaintenanceWindow";
import { postUndrain } from "@/components/operations/useFleetDrain";
import { unknownDrainLanes } from "@/components/operations/fleetDrain";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LastHostNotice } from "./LastHostNotice";

const LEVER_NAME: Record<MaintenanceLever, string> = {
  agent_work: "Agent work",
  ci: "CI",
};

function LeverRow({
  lever,
  entry,
  now,
  ctx,
  onRequestOpen,
  onChanged,
}: {
  lever: MaintenanceLever;
  entry: MachineEntry;
  now: number;
  ctx: MaintenanceContext;
  onRequestOpen: (lever: MaintenanceLever) => void;
  onChanged: (window: MaintenanceWindow | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MaintenanceError | null>(null);
  const [lastHost, setLastHost] = useState<MaintenanceError | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseReason, setReleaseReason] = useState("");
  const status = deriveLeverStatus(lever, entry, now, ctx);
  const window = entry.openWindow;
  const pauses = leverActionPauses(entry, lever);
  // No lever action on a state this page cannot read, on a window coord is
  // already winding down, or on a raw drain (which has its own release).
  const actionable =
    !entry.openWindowUnreadable &&
    !(lever === "agent_work" && entry.kind === "ci_host") &&
    status.kind !== "unknown" &&
    status.kind !== "window_expired" &&
    status.kind !== "drained_outside_window";
  const leverLane =
    lever === "agent_work" ? ("agent" as const) : ("ci" as const);
  // A lane coord records as drained but whose per-lane entry could not be read
  // is UNKNOWN — and releasing it is still the safe recovery, so it is
  // offered there too (plan review round 6).
  // Same preconditions as `deriveLeverStatus`'s drain arm: with an unreadable
  // window, or a machines list kept after a failed refresh, "no window" is
  // itself unknown — so nothing here may be offered as a drain "set outside
  // any maintenance window".
  const laneUnreadable =
    window === null &&
    !entry.openWindowUnreadable &&
    ctx.refreshError === null &&
    ctx.drain?.state === "drained" &&
    unknownDrainLanes(ctx.drain.entry).includes(leverLane);
  const drainRelease =
    (status.kind === "drained_outside_window" || laneUnreadable) &&
    entry.kind === "machine"
      ? {
          deviceId: entry.deviceId,
          lane: leverLane,
          unreadable: laneUnreadable,
        }
      : null;

  const release = async () => {
    if (drainRelease === null || busy || releaseReason.trim() === "") return;
    setBusy(true);
    setError(null);
    const res = await postUndrain({
      deviceId: drainRelease.deviceId,
      reason: releaseReason,
      lanes: [drainRelease.lane],
    });
    setBusy(false);
    setReleasing(false);
    setReleaseReason("");
    if (res.ok) {
      if (res.changed === null) {
        toast("Undrain accepted; whether it changed anything is UNKNOWN");
      } else {
        toast.success(
          res.changed
            ? `Released the ${LEVER_NAME[lever]} drain`
            : `The ${LEVER_NAME[lever]} lane was not drained — nothing changed`
        );
      }
      onChanged(null);
      return;
    }
    setError(
      res.status === null
        ? { code: null, message: res.body, poolKey: null }
        : describeMaintenanceError(res.status, res.body)
    );
  };
  const labels = lever === "ci" && window ? window.levers.ci.labels : [];

  const act = async (acceptCiQueueing?: boolean) => {
    if (busy) return;
    if (window === null) {
      onRequestOpen(lever);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setMaintenanceLever({
      windowId: window.id,
      lever,
      held: pauses,
      acceptCiQueueing,
    });
    setBusy(false);
    if (res.ok) {
      setLastHost(null);
      toast.success(`${LEVER_NAME[lever]} ${pauses ? "paused" : "resumed"}`);
      onChanged(res.window);
      return;
    }
    if (res.code === "last_matching_host" && acceptCiQueueing !== true) {
      setLastHost(res);
      return;
    }
    setLastHost(null);
    setError(res);
  };

  return (
    <div
      {...rowAccentProps(
        status,
        "rounded-md border border-border bg-card/30 px-3 py-2 space-y-1.5"
      )}
      data-testid={`coord-maintenance-lever-${lever === "ci" ? "ci" : "agent"}`}
      data-lever-kind={status.kind}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{LEVER_NAME[lever]}</span>
        <StatusBadge status={status} palette={MAINTENANCE_LEVER_PALETTE} />
        <span
          className="min-w-0 flex-1 text-xs text-muted-foreground break-words"
          data-testid={`coord-maintenance-lever-${lever === "ci" ? "ci" : "agent"}-state`}
        >
          {status.reason}
        </span>
        {actionable && (
          <CoordAdminOnly fallback={<ReadOnlyNotice />}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act()}
              data-testid={`coord-maintenance-lever-${lever === "ci" ? "ci" : "agent"}-toggle`}
            >
              {pauses ? (window === null ? "Pause…" : "Pause") : "Resume"}
            </Button>
          </CoordAdminOnly>
        )}
        {drainRelease && (
          <CoordAdminOnly fallback={<ReadOnlyNotice />}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReleaseReason("");
                setReleasing(true);
              }}
              data-testid={`coord-maintenance-lever-${lever === "ci" ? "ci" : "agent"}-release-drain`}
            >
              Release drain
            </Button>
          </CoordAdminOnly>
        )}
      </div>

      {window && lever === "agent_work" && entry.kind === "machine" && (
        <p className="text-[11px] text-muted-foreground break-words">
          Window until {formatUntil(window.until, now)} — &ldquo;
          {window.reason ?? "no reason recorded"}&rdquo; (
          {window.openedBy ?? "operator not recorded"}
          {window.openedAt ? `, ${formatUntil(window.openedAt, now)}` : ""}).
        </p>
      )}

      {labels.length > 0 && (
        <ul
          className="space-y-0.5 text-[11px]"
          data-testid="coord-maintenance-lever-ci-labels"
        >
          {labels.map((l) => (
            <li
              key={`${l.label}@${l.repo}`}
              className="break-words"
              data-testid="coord-maintenance-lever-ci-label"
              data-label-outcome={l.outcome ?? "unknown"}
            >
              <span className="font-mono break-all">{l.repo}</span> · label{" "}
              <span className="font-mono">{l.label}</span> —{" "}
              {labelOutcomeLabel(l)}
              {l.detail ? ` (${l.detail})` : ""}
            </li>
          ))}
        </ul>
      )}

      {lever === "ci" && window?.poolHealth?.verdict === "pool_wide" && (
        <p className="text-[11px] text-muted-foreground break-words">
          CI is failing on every host right now — pausing this one will not fix
          that.
          {window.poolHealth.detail ? ` (${window.poolHealth.detail})` : ""}
        </p>
      )}

      {lastHost && window && (
        <LastHostNotice
          refusal={lastHost}
          until={formatUntil(window.until, now)}
          busy={busy}
          onAccept={() => void act(true)}
          testIdPrefix="coord-maintenance-lever"
        />
      )}

      {error && (
        <p
          role="alert"
          className="text-xs text-destructive break-words"
          data-testid="coord-maintenance-lever-error"
        >
          {error.message}
          {error.code ? ` (${error.code})` : ""}
        </p>
      )}
      {drainRelease && (
        <ConfirmDestructiveDialog
          open={releasing}
          onOpenChange={(o) => {
            if (!o) setReleasing(false);
          }}
          title={`Release the ${LEVER_NAME[lever].toLowerCase()} drain?`}
          description={
            <p className="break-words">
              Releases the <strong>{drainRelease.lane}</strong> lane of the
              drain on device{" "}
              <span className="font-mono break-all">
                {drainRelease.deviceId}
              </span>{" "}
              (held lanes: {drainLanesDetail(ctx.drain, now)}). Coord may send
              this machine{" "}
              {drainRelease.lane === "agent" ? "agent work" : "CI work"} again
              as soon as this lands. The drain was set outside any maintenance
              window, so nothing else will release it early.
              {drainRelease.unreadable && (
                <span
                  className="mt-2 block"
                  data-testid="coord-maintenance-release-drain-unreadable"
                >
                  This lane&apos;s hold could not be read — coord records a
                  drain on it but its per-lane entry was unreadable, so its
                  deadline and reason are unknown. Releasing it is the safe way
                  back to a known state.
                </span>
              )}
            </p>
          }
          confirmLabel="Release drain"
          busy={busy}
          confirmDisabled={releaseReason.trim() === ""}
          onConfirm={() => void release()}
          testId={`coord-maintenance-release-drain-${drainRelease.lane}`}
          extra={
            <div className="space-y-1.5">
              <Label htmlFor={`coord-maintenance-release-reason-${lever}`}>
                Reason (required)
              </Label>
              <Textarea
                id={`coord-maintenance-release-reason-${lever}`}
                rows={2}
                value={releaseReason}
                onChange={(e) => setReleaseReason(e.target.value)}
                data-testid={`coord-maintenance-release-drain-${drainRelease.lane}-reason`}
              />
            </div>
          }
        />
      )}
    </div>
  );
}

export function MaintenanceLevers({
  entry,
  now,
  ctx,
  onRequestOpen,
  onChanged,
}: {
  entry: MachineEntry;
  now: number;
  ctx: MaintenanceContext;
  onRequestOpen: (lever: MaintenanceLever) => void;
  onChanged: (window: MaintenanceWindow | null) => void;
}) {
  return (
    <section className="space-y-2" data-testid="coord-maintenance-levers">
      <h2 className="text-sm font-semibold">Levers</h2>
      <LeverRow
        lever="agent_work"
        entry={entry}
        now={now}
        ctx={ctx}
        onRequestOpen={onRequestOpen}
        onChanged={onChanged}
      />
      <LeverRow
        lever="ci"
        entry={entry}
        now={now}
        ctx={ctx}
        onRequestOpen={onRequestOpen}
        onChanged={onChanged}
      />
    </section>
  );
}

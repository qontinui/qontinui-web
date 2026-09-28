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
  formatUntil,
  labelOutcomeLabel,
  leverActionPauses,
  type MachineEntry,
  type MaintenanceError,
  type MaintenanceLever,
  type MaintenanceWindow,
} from "@/components/operations/maintenanceWindow";
import { setMaintenanceLever } from "@/components/operations/useMaintenanceWindow";

const LEVER_NAME: Record<MaintenanceLever, string> = {
  agent_work: "Agent work",
  ci: "CI",
};

function LeverRow({
  lever,
  entry,
  now,
  onRequestOpen,
  onChanged,
}: {
  lever: MaintenanceLever;
  entry: MachineEntry;
  now: number;
  onRequestOpen: (lever: MaintenanceLever) => void;
  onChanged: (window: MaintenanceWindow | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MaintenanceError | null>(null);
  const [lastHost, setLastHost] = useState<MaintenanceError | null>(null);
  const status = deriveLeverStatus(lever, entry, now);
  const window = entry.openWindow;
  const pauses = leverActionPauses(entry, lever);
  const actionable =
    !entry.openWindowUnreadable &&
    !(lever === "agent_work" && entry.kind === "ci_host");
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
        <div
          role="alert"
          className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2"
          data-testid="coord-maintenance-lever-last-host"
        >
          <p className="text-xs break-words">{lastHost.message}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act(true)}
            data-testid="coord-maintenance-lever-accept-queueing"
          >
            Pause anyway — CI will queue at GitHub until{" "}
            {formatUntil(window.until, now)}
          </Button>
        </div>
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
    </div>
  );
}

export function MaintenanceLevers({
  entry,
  now,
  onRequestOpen,
  onChanged,
}: {
  entry: MachineEntry;
  now: number;
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
        onRequestOpen={onRequestOpen}
        onChanged={onChanged}
      />
      <LeverRow
        lever="ci"
        entry={entry}
        now={now}
        onRequestOpen={onRequestOpen}
        onChanged={onChanged}
      />
    </section>
  );
}

"use client";

/**
 * The agent-session half of "Still running": the runner's own readiness strip
 * and the session wind-down list.
 *
 * Moved here UNCHANGED in behaviour from the retired `/admin/coord/runners`
 * page (plan `2026-09-13-drained-runner-never-reaches-idle` Phase 8), which
 * `/admin/coord/machine-maintenance` replaces (plan
 * `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place` Phase 7).
 * Every honesty rule it carried stays: a stale or absent readiness report is
 * UNKNOWN and so is every count on it; a failed session read is UNKNOWN, not
 * "no sessions"; finish & close goes through a confirm that re-checks the
 * live row; one click sends one request. Every derivation still lives in
 * `components/operations/runnerStatus.ts`.
 *
 * The reads are owned by the page (so its one Refresh re-reads them) and
 * handed in; this component owns only the session-control writes.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import {
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  StatusBadge,
  type HealthBadge,
} from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import type { DeviceDrainState } from "@/components/operations/fleetDrain";
import {
  CONTROL_REASON_MAX_LENGTH,
  RUNNER_SESSION_PALETTE,
  blocksRestartLabel,
  countLabel,
  deriveReadinessHealth,
  deriveRunnerSessionStatus,
  drainBadgeLabel,
  idleEligibilityLabel,
  joinRunnerSessions,
  originLabel,
  readinessCounts,
  sessionActionGates,
  shortSessionId,
  sortRunnerSessions,
  workStatusLabel,
  type ControlWriteResult,
  type FleetSessionsRead,
  type ReadinessRead,
  type RunnerSessionRecord,
  type SessionControlAction,
} from "@/components/operations/runnerStatus";
import {
  FLEET_SESSIONS_LIMIT,
  postSessionControl,
} from "@/components/operations/useRunnerWindDown";

const ACTION_LABEL: Record<SessionControlAction, string> = {
  finish_and_close: "Finish & close",
  stop_at_boundary: "Stop at boundary",
};

function sessionName(rec: RunnerSessionRecord): string {
  return (
    rec.session?.claudeCodeSessionId ??
    rec.windDown?.claude_code_session_id ??
    rec.session?.sessionId ??
    "(unidentified session)"
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono break-all">{children}</dd>
    </>
  );
}

function RunnerSessionRow({
  rec,
  deviceId,
  expanded,
  onToggle,
  pending,
  outcome,
  onFinish,
  onStop,
}: {
  rec: RunnerSessionRecord;
  deviceId: string;
  expanded: boolean;
  onToggle: () => void;
  pending: boolean;
  outcome: ControlWriteResult | undefined;
  onFinish: () => void;
  onStop: () => void;
}) {
  const status = deriveRunnerSessionStatus(rec);
  const gates = sessionActionGates(rec);
  const s = rec.session;
  const via = [
    s?.dispatchSource ? `via ${s.dispatchSource}` : null,
    s?.continuationGateId ? `gate ${s.continuationGateId.slice(0, 8)}` : null,
  ].filter((part): part is string => part !== null);
  const scope = s?.workUnitSlug ?? s?.repo ?? null;
  const label =
    [originLabel(rec), ...via].join(" · ") + (scope ? ` — ${scope}` : "");
  const reason =
    `work ${workStatusLabel(rec)} · ${idleEligibilityLabel(rec)} · ` +
    `blocks restart ${blocksRestartLabel(rec)}`;

  return (
    <RecordRow
      data-testid="coord-maintenance-session-row"
      identity={shortSessionId(rec)}
      label={label}
      status={<StatusBadge status={status} palette={RUNNER_SESSION_PALETTE} />}
      reason={reason}
      attention={status.attention}
      time={
        <RowTime
          at={s?.startedAt}
          verb="Started"
          absent={{
            label: "age unknown",
            title: s
              ? "coord reports no start time for this session"
              : "coord's census has no row for this runner session",
          }}
        />
      }
      expanded={expanded}
      onToggle={onToggle}
    >
      <RecordDetail
        data-testid="coord-maintenance-session-detail"
        why={
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
            <DetailField label="Status">
              {status.label} — {status.reason}
            </DetailField>
            <DetailField label="Origin">{originLabel(rec)}</DetailField>
            <DetailField label="Dispatch source">
              {s?.dispatchSource ?? "none reported"}
            </DetailField>
            <DetailField label="Continuation gate">
              {s?.continuationGateId ?? "none reported"}
            </DetailField>
            <DetailField label="Coord work status">
              {workStatusLabel(rec)}
            </DetailField>
            <DetailField label="Idle · eligibility">
              {idleEligibilityLabel(rec)}
            </DetailField>
            <DetailField label="Blocks restart">
              {blocksRestartLabel(rec)}
            </DetailField>
            <DetailField label="Claude session">
              {rec.session?.claudeCodeSessionId ??
                rec.windDown?.claude_code_session_id ??
                "not reported"}
            </DetailField>
            <DetailField label="Coord session">
              {s?.sessionId ?? "no coord row"}
            </DetailField>
          </dl>
        }
        problems={
          outcome && !outcome.ok ? (
            <p
              role="alert"
              className="text-xs text-destructive"
              data-testid="coord-maintenance-action-error"
            >
              {outcome.message}
              {outcome.code ? ` (${outcome.code})` : ""}
            </p>
          ) : null
        }
        actions={
          <CoordAdminOnly fallback={<ReadOnlyNotice />}>
            <div className="flex flex-wrap items-center gap-2">
              {gates.finish_and_close.allowed ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={onFinish}
                  data-testid="coord-maintenance-finish-close"
                >
                  {ACTION_LABEL.finish_and_close}
                </Button>
              ) : (
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="coord-maintenance-finish-close-unavailable"
                >
                  Finish &amp; close unavailable —{" "}
                  {gates.finish_and_close.reason}
                </span>
              )}
              {gates.stop_at_boundary.allowed ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={onStop}
                  data-testid="coord-maintenance-stop-boundary"
                >
                  {ACTION_LABEL.stop_at_boundary}
                </Button>
              ) : (
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="coord-maintenance-stop-boundary-unavailable"
                >
                  Stop at boundary unavailable — {gates.stop_at_boundary.reason}
                </span>
              )}
            </div>
            {outcome?.ok && (
              <p
                role="status"
                className="text-xs text-muted-foreground"
                data-testid="coord-maintenance-action-accepted"
              >
                Request recorded
                {outcome.eventId
                  ? ` (event ${outcome.eventId.slice(0, 8)})`
                  : ""}
                . The runner acts on it at its next catch-up; readiness shows
                the result.
              </p>
            )}
          </CoordAdminOnly>
        }
        history={
          <Link
            href={`/sessions?device=${encodeURIComponent(deviceId)}`}
            className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
            data-testid="coord-maintenance-session-history"
          >
            Session history for this device on /sessions
          </Link>
        }
      />
    </RecordRow>
  );
}

export interface SessionWindDownProps {
  /** The workstation device — every read here is keyed on it. */
  deviceId: string;
  /** Coord's hostname for it, or the id when coord names none. */
  hostname: string;
  drainState: DeviceDrainState;
  readiness: { read: ReadinessRead; refresh: () => Promise<void> };
  sessions: { read: FleetSessionsRead; refresh: () => Promise<void> };
}

export function SessionWindDown({
  deviceId,
  hostname,
  drainState,
  readiness,
  sessions,
}: SessionWindDownProps) {
  const [confirming, setConfirming] = useState<RunnerSessionRecord | null>(
    null
  );
  const [confirmReason, setConfirmReason] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // Rows with a request out right now. A ref, not state: two clicks inside one
  // render (before `pending` disables the button) must still send only once.
  const inFlight = useRef(new Set<string>());
  const [outcomes, setOutcomes] = useState<Record<string, ControlWriteResult>>(
    {}
  );

  const records = useMemo(
    () =>
      sessions.read.kind === "ok"
        ? sortRunnerSessions(
            joinRunnerSessions(sessions.read.rows, readiness.read)
          )
        : [],
    [sessions.read, readiness.read]
  );
  const authorRows = records.filter(
    (r) => deriveRunnerSessionStatus(r).attention === "author"
  ).length;
  const health = deriveReadinessHealth(
    readiness.read,
    sessions.read.kind === "ok" ? authorRows : null
  );
  const counts = readinessCounts(readiness.read);

  const send = useCallback(
    async (
      rec: RunnerSessionRecord,
      action: SessionControlAction,
      reason?: string
    ) => {
      if (rec.session === null || inFlight.current.has(rec.key)) return;
      inFlight.current.add(rec.key);
      setPendingKey(rec.key);
      let res: ControlWriteResult;
      try {
        res = await postSessionControl({
          sessionId: rec.session.sessionId,
          action,
          reason,
        });
      } finally {
        inFlight.current.delete(rec.key);
        setPendingKey(null);
      }
      setOutcomes((prev) => ({ ...prev, [rec.key]: res }));
      if (res.ok) {
        toast.success(
          `${ACTION_LABEL[action]} requested for ${shortSessionId(rec)}`,
          {
            description:
              "Coord recorded the request for the runner. Nothing is killed; " +
              "the runner acts at its next catch-up.",
          }
        );
        void readiness.refresh();
        void sessions.refresh();
      } else {
        toast.error(`Couldn't request ${ACTION_LABEL[action].toLowerCase()}`, {
          description: res.message,
        });
      }
    },
    [readiness, sessions]
  );

  // The dialog was opened on a snapshot of the row; the polls keep running
  // underneath it. Whether finish & close is still allowed is decided against
  // the row as it stands NOW, both while the dialog is open (the confirm button
  // is disabled) and again at the moment of confirming.
  const confirmingCurrent =
    confirming === null
      ? null
      : (records.find((r) => r.key === confirming.key) ?? null);
  const confirmStillAllowed =
    confirmingCurrent !== null &&
    sessionActionGates(confirmingCurrent).finish_and_close.allowed;
  const confirmBlockedMessage =
    confirming === null || confirmStillAllowed
      ? null
      : confirmingCurrent === null
        ? "The session is no longer listed — not sent."
        : "The session is no longer idle — not sent.";

  const confirmFinish = useCallback(async () => {
    if (confirming === null) return;
    const target = confirming;
    const reason = confirmReason;
    setConfirming(null);
    setConfirmReason("");
    if (confirmingCurrent === null || !confirmStillAllowed) {
      const message =
        confirmBlockedMessage ?? "The session is no longer idle — not sent.";
      setOutcomes((prev) => ({
        ...prev,
        [target.key]: { ok: false, status: null, code: null, message },
      }));
      toast.error("Finish & close was not sent", { description: message });
      return;
    }
    await send(confirmingCurrent, "finish_and_close", reason);
  }, [
    confirming,
    confirmReason,
    confirmingCurrent,
    confirmStillAllowed,
    confirmBlockedMessage,
    send,
  ]);

  const badges: HealthBadge[] = [
    {
      key: "drain",
      label: drainBadgeLabel(drainState, Date.now()),
      tone: drainState.state === "unknown" ? "muted" : "default",
      title: drainState.state === "unknown" ? drainState.reason : undefined,
      "data-testid": "coord-maintenance-drain-badge",
    },
    {
      key: "blocking",
      label: `blocking ${countLabel(counts.blocking)}`,
      tone: counts.blocking === null ? "muted" : "default",
      "data-testid": "coord-maintenance-count-blocking",
    },
    {
      key: "finished",
      label: `finished ${countLabel(counts.finished)}`,
      tone: counts.finished === null ? "muted" : "default",
      "data-testid": "coord-maintenance-count-finished",
    },
    {
      key: "close-eligible",
      label: `close-eligible ${countLabel(counts.closeEligible)}`,
      tone: counts.closeEligible === null ? "muted" : "default",
      "data-testid": "coord-maintenance-count-close-eligible",
    },
    {
      key: "exit-stuck",
      label: `exit-stuck ${countLabel(counts.exitStuck)}`,
      tone:
        counts.exitStuck === null
          ? "muted"
          : counts.exitStuck > 0
            ? "attention"
            : "default",
      "data-testid": "coord-maintenance-count-exit-stuck",
    },
  ];

  const sample = readiness.read.kind === "fresh" ? readiness.read.sample : null;

  return (
    <section className="space-y-2" data-testid="coord-maintenance-sessions">
      <h3 className="text-sm font-semibold">Agent sessions</h3>
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={badges}
        data-testid="coord-maintenance-agent-health"
      />
      {sample?.truncated && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-maintenance-winddown-truncated"
        >
          Coord capped this runner&apos;s wind-down report, so sessions past the
          cap show as UNKNOWN.
        </p>
      )}
      {sample !== null && sample.unreadableSessions > 0 && (
        <p className="text-xs text-muted-foreground">
          {sample.unreadableSessions} wind-down entr
          {sample.unreadableSessions === 1 ? "y" : "ies"} carried no session id
          and could not be shown.
        </p>
      )}
      {sessions.read.kind === "ok" && sessions.read.hasMore && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-maintenance-sessions-more"
        >
          More sessions match than coord served ({FLEET_SESSIONS_LIMIT}), so
          this list is not the device&apos;s whole census.
        </p>
      )}
      {sessions.read.kind === "ok" && sessions.read.refreshError && (
        <p
          role="status"
          className="text-xs text-amber-600 dark:text-amber-400"
          data-testid="coord-maintenance-sessions-stale"
        >
          The last refresh failed, so this list may be out of date —{" "}
          {sessions.read.refreshError}.
        </p>
      )}
      {sessions.read.kind === "failed" ? (
        <HealthStrip
          level="amber"
          headline="Sessions UNKNOWN"
          detail={`${sessions.read.reason} — this is not "no sessions"`}
          data-testid="coord-maintenance-sessions-unknown"
        />
      ) : (
        <RecordList
          items={records}
          loaded={sessions.read.kind === "ok"}
          itemKey={(rec) => rec.key}
          renderRow={(rec, ctx) => (
            <RunnerSessionRow
              rec={rec}
              deviceId={deviceId}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              pending={pendingKey === rec.key}
              outcome={outcomes[rec.key]}
              onFinish={() => {
                setConfirmReason("");
                setConfirming(rec);
              }}
              onStop={() => void send(rec, "stop_at_boundary")}
            />
          )}
          empty={
            <p
              className="text-sm text-muted-foreground"
              data-testid="coord-maintenance-sessions-empty"
            >
              Coord&apos;s census names no live session on this device.
            </p>
          }
        />
      )}

      <ConfirmDestructiveDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          confirming
            ? `Finish & close session ${shortSessionId(confirming)}?`
            : "Finish & close session?"
        }
        description={
          confirming ? (
            <>
              <p>
                Session{" "}
                <span className="font-mono break-all">
                  {sessionName(confirming)}
                </span>{" "}
                ({originLabel(confirming)}
                {confirming.session?.repo
                  ? ` on ${confirming.session.repo}`
                  : ""}
                ) on runner{" "}
                <span className="font-mono break-all">{hostname}</span>.
              </p>
              <p className="mt-2">
                This declares the session finished — your click is the
                declaration the runner never infers — and asks the runner to
                close it with <code>/exit</code> once it is idle. It never kills
                the process.
              </p>
            </>
          ) : null
        }
        confirmLabel={ACTION_LABEL.finish_and_close}
        busy={pendingKey !== null}
        confirmDisabled={!confirmStillAllowed}
        onConfirm={() => void confirmFinish()}
        testId="coord-maintenance-finish-confirm"
        extra={
          <div className="space-y-1.5">
            {confirmBlockedMessage && (
              <p
                role="alert"
                className="text-xs text-destructive"
                data-testid="coord-maintenance-finish-blocked"
              >
                {confirmBlockedMessage}
              </p>
            )}
            <Label htmlFor="coord-maintenance-finish-reason">
              Reason{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="coord-maintenance-finish-reason"
              value={confirmReason}
              onChange={(e) => setConfirmReason(e.target.value)}
              maxLength={CONTROL_REASON_MAX_LENGTH}
              placeholder="e.g. rebuilding the runner"
              data-testid="coord-maintenance-finish-reason"
            />
          </div>
        }
      />
    </section>
  );
}

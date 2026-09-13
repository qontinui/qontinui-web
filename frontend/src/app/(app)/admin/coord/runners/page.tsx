"use client";

/**
 * /admin/coord/runners — per-runner drain, restart readiness, and session
 * wind-down.
 *
 * Plan `2026-09-13-drained-runner-never-reaches-idle` Phase 8 (D8, D9, D10).
 * A DEVICE MAINTENANCE surface, deliberately not a sixth session console
 * (D10): it answers "can I rebuild this machine yet, and if not, what is in
 * the way?" and links to `/sessions?device=` for everything historical.
 *
 * The runbook it serves: drain the runner, watch readiness, finish-and-close
 * the idle stragglers the runner will not close on its own, rebuild once the
 * strip reads safe, undrain.
 *
 * ## Composition (console style guide §3.2, §6.4)
 *
 * - `HealthStrip` — the drain state, the readiness verdict with its age, and
 *   the four counts. A stale or absent readiness report renders UNKNOWN, and
 *   so does every count on it: the last verdict of a runner that stopped
 *   reporting is not a verdict.
 * - `DeviceDrainControl` + `useFleetDrain`, reused as-is — the lever.
 * - `RecordList` of the device's live sessions, each a `RecordRow` whose
 *   `RecordDetail` carries the row's actions.
 *
 * Every derivation lives in `components/operations/runnerStatus.ts`; this
 * file only lays it out.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  RefreshButton,
  RowTime,
  StatusBadge,
  type HealthBadge,
} from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { DeviceDrainControl } from "@/components/operations/DeviceDrainControl";
import {
  DevicePicker,
  findRosterDevice,
} from "@/components/operations/DevicePicker";
import {
  resolveDeviceDrain,
  type DrainTarget,
} from "@/components/operations/fleetDrain";
import { useFleetDrain } from "@/components/operations/useFleetDrain";
import { useFleetHealth } from "@/components/operations/useFleetHealth";
import {
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
  type RunnerSessionRecord,
  type SessionControlAction,
} from "@/components/operations/runnerStatus";
import {
  FLEET_SESSIONS_LIMIT,
  RUNNER_POLL_MS,
  postSessionControl,
  useDeviceFleetSessions,
  useDeviceReadiness,
} from "@/components/operations/useRunnerWindDown";

const PAGE_PATH = "/admin/coord/runners";

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
      data-testid="coord-runners-session-row"
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
        data-testid="coord-runners-session-detail"
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
              data-testid="coord-runners-action-error"
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
                  data-testid="coord-runners-finish-close"
                >
                  {ACTION_LABEL.finish_and_close}
                </Button>
              ) : (
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="coord-runners-finish-close-unavailable"
                >
                  Finish &amp; close unavailable — {gates.finish_and_close.reason}
                </span>
              )}
              {gates.stop_at_boundary.allowed ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={onStop}
                  data-testid="coord-runners-stop-boundary"
                >
                  {ACTION_LABEL.stop_at_boundary}
                </Button>
              ) : (
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="coord-runners-stop-boundary-unavailable"
                >
                  Stop at boundary unavailable — {gates.stop_at_boundary.reason}
                </span>
              )}
            </div>
            {outcome?.ok && (
              <p
                role="status"
                className="text-xs text-muted-foreground"
                data-testid="coord-runners-action-accepted"
              >
                Request recorded
                {outcome.eventId ? ` (event ${outcome.eventId.slice(0, 8)})` : ""}.
                The runner acts on it at its next catch-up; readiness shows the
                result.
              </p>
            )}
          </CoordAdminOnly>
        }
        history={
          <Link
            href={`/sessions?device=${encodeURIComponent(deviceId)}`}
            className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
            data-testid="coord-runners-session-history"
          >
            Session history for this device on /sessions
          </Link>
        }
      />
    </RecordRow>
  );
}

export default function CoordRunnersPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const deviceId = searchParams?.get("device")?.trim() ?? "";

  const fleet = useFleetHealth();
  const drain = useFleetDrain();
  const readiness = useDeviceReadiness(deviceId);
  const sessions = useDeviceFleetSessions(deviceId);

  const [confirming, setConfirming] = useState<RunnerSessionRecord | null>(
    null
  );
  const [confirmReason, setConfirmReason] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, ControlWriteResult>>(
    {}
  );

  const selectDevice = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next) params.set("device", next);
      else params.delete("device");
      const qs = params.toString();
      setOutcomes({});
      router.replace(qs ? `${PAGE_PATH}?${qs}` : PAGE_PATH, { scroll: false });
    },
    [router, searchParams]
  );

  const devices = fleet.data?.devices ?? [];
  const rosterDevice = findRosterDevice(devices, deviceId);
  const hostname = rosterDevice?.hostname || deviceId;

  const records = useMemo(
    () =>
      sessions.read.kind === "ok"
        ? sortRunnerSessions(joinRunnerSessions(sessions.read.rows, readiness.read))
        : [],
    [sessions.read, readiness.read]
  );
  const authorRows = records.filter(
    (r) => deriveRunnerSessionStatus(r).attention === "author"
  ).length;
  const health = deriveReadinessHealth(readiness.read, authorRows);
  const counts = readinessCounts(readiness.read);
  const drainState = resolveDeviceDrain(drain.read, deviceId, Date.now());
  // The drain write is keyed on the coord device id, which the selection IS.
  // Coord re-checks tenant ownership (`device_not_in_tenant`), so a linked id
  // the roster does not list is still a legitimate target.
  const drainTarget: DrainTarget = {
    state: "identified",
    deviceId: rosterDevice?.device_id ?? deviceId,
    coordHostname: rosterDevice?.hostname ?? null,
  };

  const send = useCallback(
    async (rec: RunnerSessionRecord, action: SessionControlAction, reason?: string) => {
      if (rec.session === null) return;
      setPendingKey(rec.key);
      const res = await postSessionControl({
        sessionId: rec.session.sessionId,
        action,
        reason,
      });
      setPendingKey(null);
      setOutcomes((prev) => ({ ...prev, [rec.key]: res }));
      if (res.ok) {
        toast.success(`${ACTION_LABEL[action]} requested for ${shortSessionId(rec)}`, {
          description:
            "Coord recorded the request for the runner. Nothing is killed; " +
            "the runner acts at its next catch-up.",
        });
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

  const confirmFinish = useCallback(async () => {
    if (confirming === null) return;
    const target = confirming;
    const reason = confirmReason;
    setConfirming(null);
    setConfirmReason("");
    await send(target, "finish_and_close", reason);
  }, [confirming, confirmReason, send]);

  const refreshAll = useCallback(
    () =>
      Promise.all([
        fleet.refresh(),
        drain.refresh(),
        readiness.refresh(),
        sessions.refresh(),
      ]),
    [fleet, drain, readiness, sessions]
  );

  const badges: HealthBadge[] = [
    {
      key: "drain",
      label: drainBadgeLabel(drainState),
      tone: drainState.state === "unknown" ? "muted" : "default",
      title: drainState.state === "unknown" ? drainState.reason : undefined,
      "data-testid": "coord-runners-drain-badge",
    },
    {
      key: "blocking",
      label: `blocking ${countLabel(counts.blocking)}`,
      tone: counts.blocking === null ? "muted" : "default",
      "data-testid": "coord-runners-count-blocking",
    },
    {
      key: "finished",
      label: `finished ${countLabel(counts.finished)}`,
      tone: counts.finished === null ? "muted" : "default",
      "data-testid": "coord-runners-count-finished",
    },
    {
      key: "close-eligible",
      label: `close-eligible ${countLabel(counts.closeEligible)}`,
      tone: counts.closeEligible === null ? "muted" : "default",
      "data-testid": "coord-runners-count-close-eligible",
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
      "data-testid": "coord-runners-count-exit-stuck",
    },
  ];

  const rosterNotice = fleet.error
    ? `Could not load the device roster — ${fleet.error}. A device id in the link still works.`
    : fleet.data && devices.length === 0
      ? "Coord reported 0 live devices for this tenant. A device is listed only while it is bound to this tenant and heartbeating."
      : null;

  const sample = readiness.read.kind === "fresh" ? readiness.read.sample : null;

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-runners-page">
      <p className="text-xs text-muted-foreground">
        Drain one runner, watch whether it is safe to restart, and wind down the
        sessions that keep it from being safe. A drain stops coord sending the
        machine new work; finished, idle sessions then close on their own.
        Session history lives on{" "}
        <Link href="/sessions" className="underline underline-offset-2">
          /sessions
        </Link>
        .
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1 min-w-[16rem]">
          <Label htmlFor="coord-runners-device">Runner</Label>
          <DevicePicker
            id="coord-runners-device"
            devices={devices}
            value={deviceId}
            onChange={selectDevice}
            placeholder={fleet.loading ? "Loading devices…" : "Choose a device"}
            aria-describedby={rosterNotice ? "coord-runners-roster-notice" : undefined}
            data-testid="coord-runners-device-picker"
          />
        </div>
        <RefreshButton
          onRefresh={refreshAll}
          label="Refresh runner"
          title={`Re-reads the roster, drain, readiness and sessions now; also refreshes itself every ${RUNNER_POLL_MS / 1000} s`}
          data-testid="coord-runners-refresh"
        />
        {rosterNotice && (
          <p
            id="coord-runners-roster-notice"
            role="status"
            className={
              fleet.error
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
            data-testid="coord-runners-roster-notice"
          >
            {rosterNotice}
          </p>
        )}
      </div>

      {deviceId === "" ? (
        <HealthStrip
          level="amber"
          headline="No runner selected"
          detail="choose a device above — every read on this page is per machine"
          data-testid="coord-runners-no-device"
        />
      ) : (
        <>
          <HealthStrip
            level={health.level}
            headline={health.headline}
            detail={health.detail}
            badges={badges}
            data-testid="coord-runners-health"
          />

          <DeviceDrainControl
            target={drainTarget}
            drain={drainState}
            rowHostname={hostname}
            onActed={drain.refresh}
          />

          <section className="space-y-2" data-testid="coord-runners-sessions">
            <h2 className="text-sm font-semibold">Live sessions</h2>
            {sample?.truncated && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="coord-runners-winddown-truncated"
              >
                Coord capped this runner&apos;s wind-down report, so sessions
                past the cap show as UNKNOWN.
              </p>
            )}
            {sample !== null && sample.unreadableSessions > 0 && (
              <p className="text-xs text-muted-foreground">
                {sample.unreadableSessions} wind-down entr
                {sample.unreadableSessions === 1 ? "y" : "ies"} carried no
                session id and could not be shown.
              </p>
            )}
            {sessions.read.kind === "ok" && sessions.read.hasMore && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="coord-runners-sessions-more"
              >
                More sessions match than coord served ({FLEET_SESSIONS_LIMIT}), so
                this list is not the device&apos;s whole census.
              </p>
            )}
            {sessions.read.kind === "ok" && sessions.read.refreshError && (
              <p
                role="status"
                className="text-xs text-amber-600 dark:text-amber-400"
                data-testid="coord-runners-sessions-stale"
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
                data-testid="coord-runners-sessions-unknown"
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
                    data-testid="coord-runners-sessions-empty"
                  >
                    Coord&apos;s census names no live session on this device.
                  </p>
                }
              />
            )}
          </section>
        </>
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
                {confirming.session?.repo ? ` on ${confirming.session.repo}` : ""})
                on runner <span className="font-mono">{hostname}</span>.
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
        onConfirm={() => void confirmFinish()}
        testId="coord-runners-finish-confirm"
        extra={
          <div className="space-y-1.5">
            <Label htmlFor="coord-runners-finish-reason">
              Reason{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="coord-runners-finish-reason"
              value={confirmReason}
              onChange={(e) => setConfirmReason(e.target.value)}
              placeholder="e.g. rebuilding the runner"
              data-testid="coord-runners-finish-reason"
            />
          </div>
        }
      />
    </div>
  );
}

"use client";

/**
 * /admin/coord/machine-maintenance — one machine, one verdict, two levers,
 * one list of what is still running.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place`
 * Phase 7 (§0, §D6, §D7, §D8). It REPLACES `/admin/coord/runners` ("Runner
 * Drain"), which `next.config.mjs` now 308s here, `?device=` → `?machine=`.
 *
 * ## Why one page and not tabs
 *
 * Pausing CI and draining agent work answer the same question about the same
 * object — *can I restart THIS machine yet, and if not, what is in the way?*
 * — and the answer depends on both at once: a restart is safe only when no new
 * work is arriving (agent sessions AND CI jobs) and none is in flight. Tabs
 * would put the blocker on the tab the operator is not looking at.
 *
 * The runbook it serves: Prepare for restart (pause both levers) → watch the
 * verdict and the "Still running" lists → finish-and-close the idle
 * stragglers → restart once the verdict reads safe → Return to service.
 *
 * ## Composition (console style guide §3.2, §6.4)
 *
 * - `HealthStrip` — the verdict, from the window's readiness (§D6). Green only
 *   for coord's explicit, recent `safe`; every stale, absent or unread plane is
 *   UNKNOWN in amber.
 * - Two lever rows (`MaintenanceLevers`) — state always visible, the per-lever
 *   Pause / Resume on the line; the Prepare FORM behind a dialog.
 * - "Still running": the CI registrations `RecordList` beside the runner's
 *   session wind-down `RecordList`, which moved here unchanged from the
 *   retired Runner Drain page (`SessionWindDown`).
 * - `OperatorAuditPanel`, scoped to this machine's device id and host (§D8).
 *
 * Every derivation lives in `components/operations/maintenanceWindow.ts`
 * (and, for the sessions, `runnerStatus.ts`); this file only lays it out.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { HealthStrip, RefreshButton } from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { MachinePicker } from "@/components/operations/MachinePicker";
import { OperatorAuditPanel } from "@/components/operations/OperatorAuditPanel";
import { resolveDeviceDrain } from "@/components/operations/fleetDrain";
import { useFleetDrain } from "@/components/operations/useFleetDrain";
import { useCiRunnerMirror } from "@/components/operations/useCiRunnerMirror";
import {
  RUNNER_POLL_MS,
  useDeviceFleetSessions,
  useDeviceReadiness,
} from "@/components/operations/useRunnerWindDown";
import {
  deriveVerdictHealth,
  entryWindowId,
  findMachineEntry,
  agentLeverStateWords,
  errorWantsReread,
  labelOutcomeLabel,
  labelsSpanHosts,
  maintenanceErrorGuidance,
  machineEntryLabel,
  parseMachineParam,
  type MachineEntry,
  type MaintenanceContext,
  type MaintenanceLever,
  type MaintenanceWindow,
} from "@/components/operations/maintenanceWindow";
import {
  closeMaintenanceWindow,
  useFleetMachines,
  useWindowReadiness,
  type WindowWriteResult,
} from "@/components/operations/useMaintenanceWindow";
import { SessionWindDown } from "./_components/SessionWindDown";
import { PrepareForRestartDialog } from "./_components/PrepareForRestartDialog";
import { MaintenanceLevers } from "./_components/MaintenanceLevers";
import { CiHostLink } from "./_components/CiHostLink";
import { StillRunningCi } from "./_components/StillRunningCi";

const PAGE_PATH = "/admin/coord/machine-maintenance";

/** What the last Return to service did, per lever — shown until the next action. */
/**
 * Whether a closed window put CI back. A label whose restore failed, a host
 * left paused by quarantine, or any CI state other than released / nothing to
 * delabel means GitHub may still not route to this machine — which the
 * operator must hear loudly, not read as "back in service".
 */
function ciFullyRestored(w: MaintenanceWindow): boolean {
  const c = w.levers.ci;
  if (c.inWindow === false) return true;
  if (
    c.labels.some((l) => l.outcome === "restore_failed" || l.outcome === null)
  )
    return false;
  return c.state === "released" || c.state === "nothing_to_delabel";
}

function CloseResult({ result }: { result: WindowWriteResult }) {
  if (!result.ok) {
    return (
      <p
        role="alert"
        className="text-xs text-destructive break-words"
        data-testid="coord-maintenance-close-error"
      >
        Return to service failed — {result.message}
        {result.code ? ` (${result.code})` : ""}
        {maintenanceErrorGuidance(result) && (
          <span
            className="block text-muted-foreground"
            data-testid="coord-maintenance-close-error-guidance"
          >
            {maintenanceErrorGuidance(result)}
          </span>
        )}
      </p>
    );
  }
  const w = result.window;
  if (w === null) {
    return (
      <p
        role="status"
        className="text-xs text-muted-foreground"
        data-testid="coord-maintenance-close-result"
      >
        Coord accepted the release; its answer did not read as a window, so the
        per-lever outcome is shown by the lever rows once they refresh.
      </p>
    );
  }
  const restored = ciFullyRestored(w);
  return (
    <div
      role={restored ? "status" : "alert"}
      className={
        restored
          ? "space-y-1 text-xs"
          : "space-y-1 text-xs rounded-md border border-red-500/40 bg-red-500/5 p-2"
      }
      data-testid="coord-maintenance-close-result"
      data-ci-restored={restored ? "true" : "false"}
    >
      <p
        className="font-semibold"
        data-testid="coord-maintenance-close-headline"
      >
        {restored
          ? "Returned to service."
          : "Returned to service — CI not fully restored"}
      </p>
      <p>
        Agent work:{" "}
        <span data-testid="coord-maintenance-close-agent">
          {agentLeverStateWords(w.levers.agentWork.state)}
        </span>
        {w.levers.agentWork.detail ? ` — ${w.levers.agentWork.detail}` : ""}.
        CI:{" "}
        <span data-testid="coord-maintenance-close-ci">
          {w.levers.ci.state ?? "UNKNOWN"}
        </span>
        {w.levers.ci.detail ? ` — ${w.levers.ci.detail}` : ""}.
      </p>
      {w.levers.ci.labels.length > 0 && (
        <ul className="space-y-0.5 text-[11px]">
          {w.levers.ci.labels.map((l) => (
            <li
              key={`${l.label}@${l.repo}@${l.host ?? ""}`}
              className="break-words"
            >
              <span className="font-mono break-all">{l.repo}</span>
              {labelsSpanHosts(w.levers.ci.labels) && l.host
                ? ` on ${l.host}`
                : ""}{" "}
              · label <span className="font-mono">{l.label}</span> —{" "}
              {labelOutcomeLabel(l)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MachineMaintenancePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawMachine = searchParams?.get("machine")?.trim() ?? "";
  const selection = parseMachineParam(rawMachine);

  const machines = useFleetMachines();
  const drain = useFleetDrain();
  const mirror = useCiRunnerMirror();

  const entries = machines.read.state === "ok" ? machines.read.entries : [];
  const entry: MachineEntry | undefined = findMachineEntry(entries, selection);
  const openWindow: MaintenanceWindow | null = entry?.openWindow ?? null;
  // The id to act on — kept even when the window itself did not parse, so an
  // unreadable window can still be returned to service.
  const windowId = entry ? entryWindowId(entry) : null;
  const readiness = useWindowReadiness(windowId);

  // The workstation device every agent-plane read is keyed on. A deep link to
  // a device coord's machine list does not name still reads its sessions: the
  // device id IS the key, and coord re-checks tenant ownership on every read.
  const deviceId =
    entry?.kind === "machine"
      ? entry.deviceId
      : selection.kind === "machine"
        ? selection.deviceId
        : "";
  const runnerReadiness = useDeviceReadiness(deviceId);
  const sessions = useDeviceFleetSessions(deviceId);

  const [prepareOpen, setPrepareOpen] = useState(false);
  const [prepareLevers, setPrepareLevers] = useState({
    agent_work: true,
    ci: true,
  });
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<WindowWriteResult | null>(
    null
  );

  const selectMachine = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      // A leftover `?device=` from the old Runner Drain redirect is dropped:
      // it would otherwise ride along on every selection.
      params.delete("device");
      if (next) params.set("machine", next);
      else params.delete("machine");
      const qs = params.toString();
      setCloseResult(null);
      router.replace(qs ? `${PAGE_PATH}?${qs}` : PAGE_PATH, { scroll: false });
    },
    [router, searchParams]
  );

  const refreshAll = useCallback(
    () =>
      Promise.all([
        machines.refresh(),
        drain.refresh(),
        readiness.refresh(),
        runnerReadiness.refresh(),
        sessions.refresh(),
      ]),
    [machines, drain, readiness, runnerReadiness, sessions]
  );

  const afterWrite = useCallback(() => {
    void machines.refresh();
    void drain.refresh();
    void readiness.refresh();
  }, [machines, drain, readiness]);

  // The Prepare form is PINNED to the entry it was opened on. A re-read can
  // move the selection (a CI host that turned out to be linked now resolves
  // to its machine, or a poll lands mid-submit); the form must neither
  // silently retarget nor vanish with its refusal or outcome, so it keeps its
  // target and says the selection moved (`movedTo`). While the key is
  // unchanged, the pinned entry follows the fresh read.
  const [pinnedEntry, setPinnedEntry] = useState<MachineEntry | null>(null);
  const dialogEntry =
    pinnedEntry && entry && entry.key === pinnedEntry.key ? entry : pinnedEntry;
  const movedTo =
    pinnedEntry === null || (entry && entry.key === pinnedEntry.key)
      ? null
      : entry
        ? `${machineEntryLabel(entry).primary} (${machineEntryLabel(entry).secondary})`
        : "a machine coord's list does not name";

  const openPrepare = useCallback(
    (only?: MaintenanceLever) => {
      if (!entry) return;
      const agentPossible = entry.kind === "machine";
      setPrepareLevers(
        only
          ? { agent_work: only === "agent_work", ci: only === "ci" }
          : { agent_work: agentPossible, ci: true }
      );
      setCloseResult(null);
      setPinnedEntry(entry);
      setPrepareOpen(true);
    },
    [entry]
  );

  const submitClose = useCallback(async () => {
    if (windowId === null || closeReason.trim() === "" || closing) return;
    setClosing(true);
    const res = await closeMaintenanceWindow({
      windowId,
      reason: closeReason,
    });
    setClosing(false);
    setCloseResult(res);
    // A refusal that says the page is stale (window_changed / window_busy …)
    // re-reads, exactly like the lever and open paths.
    if (!res.ok && errorWantsReread(res)) afterWrite();
    if (res.ok) {
      setCloseOpen(false);
      setCloseReason("");
      toast.success("Returned to service");
      afterWrite();
    }
  }, [windowId, closeReason, closing, afterWrite]);

  const now = Date.now();
  const identity = entry ? machineEntryLabel(entry) : null;
  const drainState = resolveDeviceDrain(drain.read, deviceId || undefined, now);
  const ctx: MaintenanceContext = {
    drain: deviceId ? drainState : null,
    refreshError:
      machines.read.state === "ok" ? machines.read.refreshError : null,
  };

  const machinesNotice =
    machines.read.state === "unknown"
      ? `Could not load coord's machines — ${machines.read.reason}. A machine id in the link still reads its sessions.`
      : machines.read.state === "ok" && machines.read.refreshError
        ? `The last refresh failed, so this list may be out of date — ${machines.read.refreshError}.`
        : machines.read.state === "ok" && entries.length === 0
          ? "Coord lists no machine and no CI host for this tenant."
          : null;

  const auditPresets = [
    ...(deviceId ? [{ label: "Device", key: deviceId }] : []),
    ...(entry
      ? entry.kind === "machine"
        ? entry.ciHosts
        : [entry.ciHost]
      : []
    ).map((h) => ({ label: "CI host", key: h })),
    ...(windowId ? [{ label: "Window", key: windowId }] : []),
  ];

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-maintenance-page">
      <p className="text-xs text-muted-foreground">
        Take one machine out of the fleet before a restart: pause new agent work
        and CI, watch what is still running finish, then return it to service.
        Every pause expires on its own. Session history lives on{" "}
        <Link href="/sessions" className="underline underline-offset-2">
          /sessions
        </Link>
        .
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1 min-w-[16rem]">
          <Label htmlFor="coord-maintenance-machine">Machine</Label>
          <MachinePicker
            id="coord-maintenance-machine"
            entries={entries}
            drain={drain.read}
            refreshError={
              machines.read.state === "ok" ? machines.read.refreshError : null
            }
            value={entry?.key ?? rawMachine}
            onChange={selectMachine}
            placeholder={
              machines.read.state === "loading"
                ? "Loading machines…"
                : "Choose a machine"
            }
            aria-describedby={
              machinesNotice ? "coord-maintenance-machines-notice" : undefined
            }
            data-testid="coord-maintenance-machine-picker"
          />
        </div>
        <RefreshButton
          onRefresh={refreshAll}
          label="Refresh machine"
          title={`Re-reads the machine, its window, readiness and sessions now; also refreshes itself every ${RUNNER_POLL_MS / 1000} s`}
          data-testid="coord-maintenance-refresh"
        />
        {machinesNotice && (
          <p
            id="coord-maintenance-machines-notice"
            role="status"
            className={
              machines.read.state === "unknown" ||
              (machines.read.state === "ok" && machines.read.refreshError)
                ? "text-xs text-amber-600 dark:text-amber-400"
                : "text-xs text-muted-foreground"
            }
            data-testid="coord-maintenance-machines-notice"
          >
            {machinesNotice}
          </p>
        )}
      </div>

      {selection.kind === "none" ? (
        <HealthStrip
          level="amber"
          headline="No machine selected"
          detail="choose a machine above — every read on this page is per machine"
          data-testid="coord-maintenance-no-machine"
        />
      ) : (
        <>
          <p
            className="text-xs break-words"
            data-testid="coord-maintenance-identity"
          >
            {identity ? (
              <>
                <span className="font-mono break-all">{identity.primary}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="font-mono break-all text-muted-foreground">
                  {identity.secondary}
                </span>
              </>
            ) : (
              <span className="font-mono break-all">{rawMachine}</span>
            )}
          </p>

          {entry === undefined ? (
            <HealthStrip
              level="amber"
              headline="Restart readiness UNKNOWN"
              detail={
                machines.read.state === "loading"
                  ? "reading coord's machines…"
                  : machines.read.state === "unknown"
                    ? `${machines.read.reason} — nothing about this machine's pauses is known`
                    : "coord's machine list does not name this machine, so its maintenance state is not known"
              }
              data-testid="coord-maintenance-verdict"
            />
          ) : (
            (() => {
              const verdict = deriveVerdictHealth(
                openWindow,
                readiness.read,
                now,
                ctx
              );
              return (
                <HealthStrip
                  level={entry.openWindowUnreadable ? "amber" : verdict.level}
                  headline={
                    entry.openWindowUnreadable
                      ? "Restart readiness UNKNOWN"
                      : verdict.headline
                  }
                  detail={
                    entry.openWindowUnreadable
                      ? "coord reported a maintenance window this build could not read"
                      : verdict.detail
                  }
                  badges={verdict.badges}
                  data-testid="coord-maintenance-verdict"
                />
              );
            })()
          )}

          {entry !== undefined && (
            <>
              <CoordAdminOnly fallback={<ReadOnlyNotice />}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => openPrepare()}
                    disabled={windowId !== null || entry.openWindowUnreadable}
                    data-testid="coord-maintenance-prepare"
                  >
                    Prepare for restart…
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCloseReason("");
                      setCloseOpen(true);
                    }}
                    disabled={windowId === null}
                    data-testid="coord-maintenance-return"
                  >
                    Return to service
                  </Button>
                  {windowId !== null && (
                    <span
                      className="text-[11px] text-muted-foreground"
                      data-testid="coord-maintenance-prepare-disabled-reason"
                    >
                      A window is open — change one lever below, or return the
                      machine to service.
                    </span>
                  )}
                </div>
              </CoordAdminOnly>

              {closeResult?.ok && <CloseResult result={closeResult} />}

              <MaintenanceLevers
                entry={entry}
                now={now}
                ctx={ctx}
                onRequestOpen={(lever) => openPrepare(lever)}
                onChanged={afterWrite}
              />

              <CiHostLink entry={entry} onChanged={afterWrite} />
            </>
          )}

          <section
            className="space-y-3"
            data-testid="coord-maintenance-still-running"
          >
            <h2 className="text-sm font-semibold">Still running</h2>
            {entry !== undefined && (
              <StillRunningCi
                entry={entry}
                readiness={readiness.read}
                mirror={mirror}
              />
            )}
            {deviceId !== "" ? (
              <SessionWindDown
                deviceId={deviceId}
                hostname={
                  entry?.kind === "machine"
                    ? (entry.hostname ?? deviceId)
                    : deviceId
                }
                drainState={drainState}
                readiness={runnerReadiness}
                sessions={sessions}
              />
            ) : (
              <p
                className="text-xs text-muted-foreground"
                data-testid="coord-maintenance-no-device"
              >
                No workstation device is linked to this CI host, so there are no
                agent sessions to wind down here.
              </p>
            )}
          </section>

          <OperatorAuditPanel
            resourceKeyPresets={auditPresets}
            defaultFilterId="all"
            storageKey="machine-maintenance:operator-audit"
            intro={
              <>
                Coord&apos;s audit stamps for this machine — windows opened and
                closed, levers changed, drains and label changes — newest first.
                Pick a scope below; coord filters by one resource key at a time.
              </>
            }
          />
        </>
      )}

      {dialogEntry !== null && (
        <PrepareForRestartDialog
          entry={dialogEntry}
          movedTo={movedTo}
          open={prepareOpen}
          onOpenChange={setPrepareOpen}
          initialLevers={prepareLevers}
          onOpened={afterWrite}
          onStale={afterWrite}
        />
      )}

      <Dialog
        open={closeOpen}
        onOpenChange={(o) => !closing && setCloseOpen(o)}
      >
        <DialogContent data-testid="coord-maintenance-return-dialog">
          <DialogHeader>
            <DialogTitle>Return to service?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="break-words">
                  Releases every lever this window holds on{" "}
                  <span className="font-mono break-all">
                    {identity
                      ? `${identity.primary} (${identity.secondary})`
                      : rawMachine}
                  </span>
                  : coord may send it agent work again, and its routing labels
                  go back on at GitHub. The per-lever result is shown after.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="coord-maintenance-return-reason">
              Reason (required)
            </Label>
            <Textarea
              id="coord-maintenance-return-reason"
              rows={2}
              value={closeReason}
              disabled={closing}
              placeholder="e.g. restart finished"
              onChange={(e) => setCloseReason(e.target.value)}
              data-testid="coord-maintenance-return-reason"
            />
            {closeResult && !closeResult.ok && (
              <CloseResult result={closeResult} />
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={closing}
              onClick={() => setCloseOpen(false)}
              data-testid="coord-maintenance-return-cancel"
            >
              Cancel
            </Button>
            <Button
              disabled={closing || closeReason.trim() === ""}
              onClick={() => void submitClose()}
              data-testid="coord-maintenance-return-submit"
            >
              Return to service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

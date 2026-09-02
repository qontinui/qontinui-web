"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Monitor,
  Laptop,
  Terminal,
  Cpu,
  Circle,
  Pencil,
  Loader2,
  HardDrive,
  HelpCircle,
} from "lucide-react";
import type { Runner } from "@qontinui/shared-types";
import { httpClient } from "@/services/service-factory";
import {
  formatBytes,
  machineRenameUrl,
  percentFree,
  readingAgeMs,
  relativeTime,
  VOLUME_STALE_AFTER_MS,
  volumeSeverity,
} from "./utils";
import { CiRunnerBadge } from "./CiRunnerBadge";
import {
  DeviceCrossLinks,
  deviceStateBadgeVariant,
} from "./FleetHealthSummary";
import { CiCapacityDisclosure } from "./CiCapacityDisclosure";
import type { CiCapacityJoin } from "./ciCapacity";
import type { MachineGroup, MachineVolumes, VolumeReading } from "./types";

interface MachineCardProps {
  machine: MachineGroup;
  /**
   * Called after a successful rename so the parent can re-fetch the fleet
   * payload and reconcile the authoritative `machine_display_names`. Optional —
   * when absent, the optimistic local name + the 10s poll keep the card honest.
   */
  onRenamed?: () => void;
  /**
   * This row's CI-capacity join (plan
   * `2026-08-25-coord-console-intent-and-devops-sections` Phase 2), resolved by
   * `resolveCiCapacity` from the page's one read of the devenv machine roster.
   *
   * Present ONLY on a list built with that read — the Dev Ops Overview mount.
   * `undefined` means this list was built WITHOUT it (the pipeline page), so
   * the card renders no CI-capacity block at all: an absence of the READ is not
   * a fact about the machine, and a "no machine record linked" notice on a page
   * that never looked would be one.
   */
  ciCapacity?: CiCapacityJoin;
}

function OsIcon({ os }: { os: string }) {
  const lower = os.toLowerCase();
  if (lower === "windows" || lower.startsWith("win")) {
    return <Monitor className="h-4 w-4" />;
  }
  if (lower === "macos" || lower === "darwin") {
    return <Laptop className="h-4 w-4" />;
  }
  if (lower === "linux") {
    return <Terminal className="h-4 w-4" />;
  }
  return <Cpu className="h-4 w-4" />;
}

function osBadgeVariant(os: string): "default" | "secondary" | "outline" {
  const lower = os.toLowerCase();
  if (lower === "windows" || lower.startsWith("win")) return "default";
  if (lower === "macos" || lower === "darwin") return "secondary";
  return "outline";
}

/**
 * The three states a runner's health can be in.
 *
 * `unknown` is the state this dot GREW in disk-monitoring Phase 1 (plan
 * `2026-08-07-product-disk-monitoring-and-cleanup.md` step 11). The dot was
 * binary before, which meant a runner that had never reported rendered as the
 * same red as one that reported a problem — a read that failed and a
 * population that is genuinely bad must never render the same
 * (`silent-empty-is-unknown`).
 */
export type RunnerHealthState = "healthy" | "unhealthy" | "unknown";

/**
 * Classify a runner for {@link HealthDot}.
 *
 * A runner that has NEVER heartbeated is `unknown`, not `unhealthy`: nothing
 * has been measured about it. Likewise an unrecognised/absent `derivedStatus`
 * — an unreadable status is an unknown one, and must not be downgraded into a
 * verdict the data does not support.
 */
export function runnerHealthState(runner: Runner): RunnerHealthState {
  const status = runner.derivedStatus as string | null | undefined;
  if (status === "healthy") return "healthy";
  if (!runner.lastHeartbeat) return "unknown";
  if (!status || status === "unknown") return "unknown";
  return "unhealthy";
}

function HealthDot({
  state,
  heartbeat,
}: {
  state: RunnerHealthState;
  heartbeat: string | null;
}) {
  // The unknown state is distinguished by SHAPE as well as colour — a hollow
  // ring rather than a filled dot — so it is not lost to a red/grey confusion
  // or to a monochrome/colour-blind rendering.
  const className =
    state === "healthy"
      ? "h-3 w-3 fill-current text-green-500"
      : state === "unhealthy"
        ? "h-3 w-3 fill-current text-red-500"
        : "h-3 w-3 text-muted-foreground";

  const label =
    state === "healthy"
      ? `Healthy -- last seen ${relativeTime(heartbeat)}`
      : state === "unhealthy"
        ? `Unhealthy -- last seen ${relativeTime(heartbeat)}`
        : heartbeat
          ? `Unknown -- this runner's health has not been determined ` +
            `(last seen ${relativeTime(heartbeat)}). This is NOT the same as ` +
            `unhealthy: nothing has reported a problem, and nothing has ` +
            `reported health either.`
          : `Unknown -- this runner has NEVER reported. This is NOT the same ` +
            `as unhealthy: no health telemetry has ever been received from it.`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Circle
          className={className}
          aria-label={label}
          data-operations-health-dot={state}
        />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Per-volume free-space rows — the disk-monitoring Phase 1 surface.
 *
 * Honesty rules this renders, all of them load-bearing (plan D10 / INV-D1):
 *
 * - **No telemetry ⇒ `UNKNOWN`.** Never `0`, never green. A device that has
 *   never reported and a read that failed both render as UNKNOWN, each with
 *   the reason it is unknown, and they are worded differently because they are
 *   different facts.
 * - **Stale telemetry renders its age** from coord's `observed_at` — the value
 *   is still shown (hiding it would be indistinguishable from "no disks") with
 *   a STALE marker so it is never mistaken for current.
 * - **A number that could not be computed says so.** An unusable `total_bytes`
 *   produces "unknown", not a 0 % bar.
 */
function VolumeRows({ volumes }: { volumes: VolumeReading[] }) {
  return (
    <div className="space-y-2">
      {volumes.map((v, i) => {
        const pct = percentFree(v.free_bytes, v.total_bytes);
        const usable = pct !== null;
        const ageMs = readingAgeMs(v.observed_at);
        const stale = ageMs === null || ageMs > VOLUME_STALE_AFTER_MS;

        // A free-space figure that did not arrive as a number has NO
        // severity — `volumeSeverity` returns `null` for it rather than
        // banding it green, which is precisely the fabricated-healthy render
        // this feature exists to remove. It renders muted instead.
        const severity = volumeSeverity(v.free_bytes);

        const barColor =
          severity === "critical"
            ? "bg-red-500"
            : severity === "warn"
              ? "bg-amber-500"
              : severity === "ok"
                ? "bg-green-500"
                : "bg-muted-foreground/40";
        const textColor =
          severity === "critical"
            ? "text-red-500"
            : severity === "warn"
              ? "text-amber-600 dark:text-amber-500"
              : severity === "ok"
                ? "text-foreground"
                : "text-muted-foreground";

        // The volume name alone is NOT guaranteed unique: the tolerant flat
        // parse groups by device, so a payload carrying the same volume twice
        // for one device yields two rows here. A duplicate React key logs a
        // warning and can mis-reconcile, so the index disambiguates.
        return (
          <div key={`${i}-${v.volume}`} data-operations-volume={v.volume}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-sm font-medium">{v.volume}</span>
              <span className={`text-sm font-semibold ${textColor}`}>
                {formatBytes(v.free_bytes)} free
                <span className="text-muted-foreground font-normal">
                  {" of "}
                  {formatBytes(v.total_bytes)}
                </span>
              </span>
            </div>

            {/* Used/total bar. An unusable total renders no bar at all rather
                than a misleading empty one. */}
            {usable ? (
              <div
                className="mt-1 h-2 w-full rounded-full bg-muted overflow-hidden"
                role="img"
                aria-label={`${v.volume}: ${pct}% free`}
              >
                <div
                  className={`h-full ${barColor}`}
                  style={{ width: `${Math.min(100, Math.max(0, 100 - pct))}%` }}
                />
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground italic">
                Capacity unknown -- coord reported no usable total for this
                volume, so the percentage cannot be computed.
              </p>
            )}

            <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
              <span className={usable ? textColor : "text-muted-foreground"}>
                {usable ? `${pct}% free` : "percent free: unknown"}
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                {stale && (
                  <Badge
                    variant="outline"
                    className="px-1 py-0 text-[9px] uppercase tracking-wide"
                  >
                    stale
                  </Badge>
                )}
                {v.observed_at
                  ? `measured ${relativeTime(v.observed_at)}`
                  : "measurement time unknown"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The UNKNOWN presentation — deliberately not a zero and not a blank. */
function VolumesUnknown({
  headline,
  detail,
}: {
  headline: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <HelpCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500 shrink-0" />
        <span className="text-sm font-semibold text-amber-600 dark:text-amber-500 uppercase tracking-wide">
          Unknown
        </span>
        <span className="text-xs text-muted-foreground">-- {headline}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function DiskSection({ volumes }: { volumes: MachineVolumes }) {
  return (
    <div data-operations-machine-disk data-disk-state={volumes.state}>
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <HardDrive className="h-3.5 w-3.5" />
        Free disk space
      </h4>
      {volumes.state === "reported" ? (
        <VolumeRows volumes={volumes.volumes} />
      ) : volumes.state === "never_reported" ? (
        <VolumesUnknown
          headline="this device has never reported disk telemetry"
          detail={
            "The read succeeded and returned no volume rows for this device, " +
            "so nothing has been measured yet. That is not zero free space " +
            "and not a healthy disk -- it is an absence of measurement."
          }
        />
      ) : (
        <VolumesUnknown
          headline="disk telemetry could not be read"
          detail={volumes.reason}
        />
      )}
    </div>
  );
}

/**
 * MachineCard — device-hardware-only after Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Renders hostname, OS, runners + their health, and the per-machine
 * Claude Code session list. The "currently editing" + "current
 * activity" sub-lines shipped 2026-05-21 (Phase 1.3 + Phase 4.4 of
 * `coordination-improvements`) have moved to the new `/sessions`
 * panel — same-day ship→delete is intentional per the parent plan
 * ("delete over deprecate").
 *
 * The `MachineGroup` type still carries `currentActivity` and
 * `currentlyEditing` so the join in `FleetOverview` keeps compiling;
 * this component just no longer renders them. Phase 9 cleanup deletes
 * those fields entirely.
 */
export function MachineCard({
  machine,
  onRenamed,
  ciCapacity,
}: MachineCardProps) {
  const { hostname, displayName, runners, claudeSessions } = machine;

  // The shown title: an operator alias when set, otherwise the raw hostname.
  // Optimistic local override wins while a save is in flight / before the poll
  // reconciles the authoritative `machine_display_names`.
  const [optimisticName, setOptimisticName] = useState<string | null>(null);
  const shownName = optimisticName ?? displayName ?? hostname;

  // Inline-rename state (mirrors PrioritySetsSection's edit UX).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shownName);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against the blur-after-Enter (or blur-after-Escape) double-save.
  const committedRef = useRef(false);

  // A fresh authoritative name (poll reconciled) clears any optimistic override.
  useEffect(() => {
    setOptimisticName(null);
  }, [displayName]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    setRenameError(null);
    setDraft(displayName ?? optimisticName ?? hostname);
    committedRef.current = false;
    setEditing(true);
  };

  const cancelEditing = () => {
    committedRef.current = true;
    setEditing(false);
    setRenameError(null);
  };

  const saveRename = async () => {
    if (committedRef.current) return;
    committedRef.current = true;

    // Trimmed empty string clears the alias (reverts to hostname) per contract.
    const next = draft.trim();
    const current = displayName ?? "";
    setEditing(false);

    // No-op when nothing changed (e.g. blur with the title untouched).
    if (next === current) return;

    // Optimistic: an empty next clears back to the hostname.
    setOptimisticName(next === "" ? hostname : next);
    setSaving(true);
    setRenameError(null);

    try {
      const res = await httpClient.fetch(machineRenameUrl(hostname), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
        // Safe to re-issue: `rename_machine` UPSERTs the (user, hostname) row
        // (DELETEs it for an empty name) — pure assignment, repeat is a no-op.
        idempotent: true,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      // Re-fetch the fleet so the authoritative name lands; the
      // `displayName`-keyed effect then drops the optimistic override.
      onRenamed?.();
    } catch (err) {
      // Revert the optimistic name and surface a subtle inline error.
      setOptimisticName(null);
      setRenameError(
        err instanceof Error ? err.message : "Failed to rename machine"
      );
    } finally {
      setSaving(false);
    }
  };

  // Determine overall machine health. This derives from `runnerHealthState`,
  // the SAME classifier `HealthDot` uses — not from a second read of
  // `derivedStatus`. When the two disagreed, a machine whose only runner had
  // never heartbeated rendered a muted per-runner dot AND a solid red header
  // ("No runners healthy"), and the eye lands on the header: the never-reported
  // runner was announced as a problem by the louder of the two elements.
  const healthyRunners = runners.filter(
    (r) => runnerHealthState(r) === "healthy"
  );
  const unhealthyCount = runners.filter(
    (r) => runnerHealthState(r) === "unhealthy"
  ).length;
  const allHealthy =
    runners.length > 0 && healthyRunners.length === runners.length;
  const someHealthy = healthyRunners.length > 0;
  // Nothing healthy AND nothing unhealthy: every runner is UNKNOWN. Absence of
  // evidence is not evidence of a problem, so this is muted, never red.
  const allUnknown = runners.length > 0 && !someHealthy && unhealthyCount === 0;

  // A machine that reached this list only through coord's health read has NO
  // runner inventory to classify — that is `unknown`, and deliberately not the
  // "empty" state a machine with a read but no runners lands in. Absent
  // evidence and measured absence are different facts.
  const headerHealth: RunnerHealthState | "empty" | "mixed" =
    machine.coordHealthOnly
      ? "unknown"
      : runners.length === 0
        ? "empty"
        : allHealthy
          ? "healthy"
          : someHealthy
            ? "mixed"
            : allUnknown
              ? "unknown"
              : "unhealthy";

  const headerHealthClass =
    headerHealth === "healthy"
      ? "bg-green-500"
      : headerHealth === "mixed"
        ? "bg-yellow-500"
        : headerHealth === "unhealthy"
          ? "bg-red-500"
          : "bg-muted-foreground/40";

  const headerHealthLabel = machine.coordHealthOnly
    ? `Health unknown -- this device reports to coord, but appears in no ` +
      `runner, session, device-status or CI record. Nothing has been ` +
      `measured about what runs on it.`
    : headerHealth === "empty"
      ? "No runners reporting on this machine -- health unknown"
      : headerHealth === "healthy"
        ? "All runners healthy"
        : headerHealth === "mixed"
          ? "Some runners healthy"
          : headerHealth === "unknown"
            ? `Health unknown -- no runner on this machine has ever reported ` +
              `its health. Never-reported is NOT unhealthy: nothing has ` +
              `reported a problem, and nothing has reported health either.`
            : unhealthyCount < runners.length
              ? `No runners healthy -- ${unhealthyCount} of ${runners.length} ` +
                `unhealthy, the rest have never reported`
              : "No runners healthy";

  /**
   * coord's own liveness verdict for this machine, rendered BESIDE the runner
   * health rather than folded into it. They answer different questions —
   * "does coord still reach this device?" and "are the runners on it healthy?"
   * — and one list that silently picked whichever was worse would be the
   * two-definitions-of-healthy defect the merge exists to remove.
   *
   * Absent state and an unmatched host both render `unknown`; the tooltip is
   * what tells them apart.
   */
  const coordState = machine.coordHealth
    ? machine.coordHealth.matched
      ? (machine.coordHealth.state ?? "unknown")
      : "unknown"
    : null;
  const coordStateLabel = !machine.coordHealth
    ? ""
    : !machine.coordHealth.matched
      ? `Coord's fleet-health read carries no device row for this host, so ` +
        `its liveness state is UNKNOWN. That is a gap in the join, not a ` +
        `verdict about the machine.`
      : machine.coordHealth.state
        ? `Coord device state: ${machine.coordHealth.state} ` +
          `(device ${machine.coordHealth.device_id}).`
        : `Coord knows this device (${machine.coordHealth.device_id}) but ` +
          `reports no state for it. Unknown, not healthy.`;

  // Pick OS from first runner
  const os = runners[0]?.os ?? "unknown";
  const osVersion = runners[0]?.osVersion ?? null;

  return (
    <Card
      className="gap-3 py-4 transition-shadow"
      data-operations-machine-card
      data-hostname={hostname}
      data-runner-inventory={machine.coordHealthOnly ? "absent" : "present"}
    >
      <CardHeader className="pb-0 py-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* A machine with NO runners -- or only runners that have NEVER
                reported -- has nothing to be unhealthy about: it renders muted
                (unknown), not red. Same rule as `HealthDot`, and now the same
                classifier: absence of evidence is not evidence of a problem. */}
            <div
              className={`h-2.5 w-2.5 rounded-full shrink-0 ${headerHealthClass}`}
              aria-label={headerHealthLabel}
              data-operations-machine-health={headerHealth}
            />
            {editing ? (
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={saveRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditing();
                  }
                }}
                placeholder={hostname}
                aria-label={`Rename ${hostname}`}
                className="h-7 text-base"
              />
            ) : (
              <CardTitle className="text-base truncate">{shownName}</CardTitle>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!editing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={startEditing}
                    disabled={saving}
                    aria-label={`Rename ${hostname}`}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pencil className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Rename machine</TooltipContent>
              </Tooltip>
            )}

            {coordState && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant={deviceStateBadgeVariant(
                      machine.coordHealth?.matched
                        ? machine.coordHealth.state
                        : undefined
                    )}
                    data-coord-state={coordState}
                  >
                    {coordState}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  {coordStateLabel}
                </TooltipContent>
              </Tooltip>
            )}

            <Badge variant={osBadgeVariant(os)} className="gap-1">
              <OsIcon os={os} />
              {os}
              {osVersion ? ` ${osVersion}` : ""}
            </Badge>
          </div>
        </div>
        {renameError && (
          <p className="text-xs text-destructive mt-1">
            Rename failed: {renameError}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3 pb-0">
        {/* A device coord reports on that appears in NO runner, session,
            device-status or CI record. It must not render as a machine with
            zero of everything — that reads as an all-clear about a machine
            nothing has measured. The counts below are shown as unknown. */}
        {machine.coordHealthOnly && (
          <div
            className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-2 py-1.5"
            role="status"
            data-operations-machine-inventory-unknown
          >
            <div className="flex items-center gap-1.5">
              <HelpCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                Runner inventory unknown
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              This device reports to coord, but the fleet inventory names no
              runner, Claude Code session or CI runner on it. Nothing below is a
              count of zero -- nothing has been measured.
            </p>
          </div>
        )}

        {/* Free disk space (disk-monitoring Phase 1). Deliberately the FIRST
            section on the card: Phase 0 measured 3.57 TB of reclaimable cargo
            targets on a single box that had previously hit 0 bytes free, so
            this is the headline number, not a footnote. */}
        <DiskSection volumes={machine.volumes} />

        {/* Runner instances. Suppressed entirely when the runner inventory
            is UNKNOWN: "Runners (0)" there is a fabricated zero, and the
            notice above says what is actually true instead. */}
        {!machine.coordHealthOnly && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Runners ({runners.length})
            </h4>
            <div className="space-y-1.5">
              {runners.map((runner) => {
                const health = runnerHealthState(runner);
                return (
                  <div
                    key={runner.id}
                    className="flex items-center justify-between text-sm px-2 py-1.5 rounded-md bg-muted/40"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <HealthDot
                        state={health}
                        heartbeat={runner.lastHeartbeat ?? null}
                      />
                      {runner.port ? (
                        <span className="font-mono text-xs">
                          :{runner.port}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground text-xs truncate">
                        {runner.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {runner.derivedStatus ?? "unknown"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {relativeTime(runner.lastHeartbeat ?? null)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Claude Code sessions — same rule as the runner list above. */}
        {!machine.coordHealthOnly && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Claude Code Sessions ({claudeSessions.length})
            </h4>
            {claudeSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 italic">
                No active sessions
              </p>
            ) : (
              <div className="space-y-1">
                {claudeSessions.map((session) => (
                  <div
                    key={session.pid}
                    className="flex items-center justify-between text-xs px-2 py-1 rounded-md bg-muted/40"
                  >
                    <span className="font-mono">PID {session.pid}</span>
                    <span className="text-muted-foreground truncate max-w-[200px]">
                      {session.working_directory
                        ? session.working_directory
                            .split(/[/\\]/)
                            .slice(-2)
                            .join("/")
                        : "--"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CI Runner */}
        {machine.ciRunner && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              CI Runner
            </h4>
            <CiRunnerBadge ciRunner={machine.ciRunner} />
          </div>
        )}

        {/* CI capacity — how much CI this machine is ALLOWED to take, next to
            the telemetry that says what to set it to. Deliberately adjacent to
            the CI-runner badge above, which says what it is taking right now:
            the knob and its evidence in one viewport is the whole reason this
            page exists. Collapsed, so opening it is a deliberate act. */}
        {ciCapacity && <CiCapacityDisclosure join={ciCapacity} />}

        {/* Summary footer */}
        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border text-xs text-muted-foreground">
          {machine.coordHealthOnly ? (
            <span data-operations-machine-counts="unknown">
              runners: unknown &middot; CC sessions: unknown
            </span>
          ) : (
            <>
              <span>
                {healthyRunners.length} of {runners.length} healthy
              </span>
              <span>
                {claudeSessions.length} CC session
                {claudeSessions.length !== 1 ? "s" : ""}
              </span>
            </>
          )}
          {machine.ciRunner && machine.ciRunner.status !== "offline" && (
            <span>CI runner active</span>
          )}
          {/* The cross-links HealthSummaryCard carried per device. They only
              resolve for a matched coord device — the trees view is keyed on
              `device_id`. */}
          {machine.coordHealth?.matched && (
            <span className="ml-auto">
              <DeviceCrossLinks deviceId={machine.coordHealth.device_id} />
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

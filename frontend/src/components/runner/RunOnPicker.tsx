"use client";

/**
 * "Run on: <runner>" — where the work a surface STARTS will run.
 *
 * Plan 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 4.
 * One control, reused by every execution surface (Co-Pilot, Execute,
 * Capture). It shows the stored pick — or "Automatic (coord picks)" — and
 * every candidate runner with its MEASURED state: locality (the identity
 * probe: on this machine / another machine / not confirmed) and heartbeat
 * (online / degraded). Choosing stores the pick as a PREFERENCE for coord's
 * resolver; it changes no transport. "Automatic" clears it.
 *
 * It also says, on the surface and when it happens, what coord did with the
 * pick (plan D2):
 * - `placeable` work whose pick coord released → "Your pick X is offline —
 *   running on Y" (a live status region, never silent);
 * - `machine_bound` work whose pick coord refused → the reason, and the
 *   other online runners OFFERED as buttons. Choosing one sets the pick; the
 *   control never picks one itself.
 */

import { useId, useRef } from "react";
import { ChevronDown, Monitor } from "lucide-react";
import type { Runner } from "@qontinui/shared-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  runnerDisplayName,
  useActiveRunner,
  useDispatchTarget,
} from "@/contexts/active-runner-context";
import { describeRunnerInstances } from "@/lib/runner/instances";
import type { RunnerLocality } from "@/lib/runner/locality";
import type { ResolveWorkClass } from "@/lib/runner/resolve";
import { cn } from "@/lib/utils";
import {
  LOCALITY_PHRASE,
  RunnerStateDot,
  heartbeatPhrase,
  runnerLocality,
} from "./runner-state";

/** The radio value of "Automatic (coord picks)". Runner ids are UUIDs. */
const AUTOMATIC = "automatic";

export interface RunOnPickerProps {
  /** What kind of work the surface starts (plan D2). */
  workClass: ResolveWorkClass;
  className?: string;
}

export function RunOnPicker({ workClass, className }: RunOnPickerProps) {
  const { runners, pin, selectRunner, localityById, listState } =
    useActiveRunner();
  const dispatch = useDispatchTarget({ workClass });
  const labelId = useId();
  const triggerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const pinName = pin ? runnerDisplayName(pin.id, runners, pin) : null;
  const pinListed = pin !== null && runners.some((r) => r.id === pin.id);
  const runsOn =
    dispatch.runnerId === null
      ? null
      : runnerDisplayName(dispatch.runnerId, runners, pin);

  // The trigger: the pick (or Automatic), and where work goes when that is
  // somewhere else (coord's automatic device, or its re-target).
  const choice = pin ? pinName! : "Automatic";
  const destination =
    runsOn !== null && (pin === null || dispatch.runnerId !== pin.id)
      ? runsOn
      : null;
  const disabled = listState !== "loaded";

  // Offered after a machine-bound refusal: only runners that are plausibly
  // eligible — heartbeating now (the list holds only online runners) and not
  // the one coord refused. Coord still checks the one chosen.
  const alternatives: Runner[] = dispatch.pinRefused
    ? runners.filter((r) => r.id !== dispatch.pinRefused!.deviceId)
    : [];
  const chooseAlternative = (runnerId: string) => {
    selectRunner(runnerId);
    // The alternative buttons disappear with the refusal; keep the user's
    // place on the control that now shows the new pick.
    triggerRef.current?.focus();
  };

  // What the live region says: a re-target, or that coord is being asked
  // about the pick ("Checking <X>…").
  const liveText =
    dispatch.notice?.text ??
    (dispatch.reason === "resolving" && pin !== null ? dispatch.message : null);

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-ui-bridge-id={`run-on-picker-${workClass}`}
      data-testid="run-on-picker"
    >
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span id={labelId}>Run on:</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              ref={triggerRef}
              type="button"
              aria-labelledby={`${labelId} ${triggerId}`}
              id={triggerId}
              data-ui-bridge-id={`run-on-trigger-${workClass}`}
              className="inline-flex min-h-8 max-w-xs items-center gap-2 rounded-md border border-border-subtle px-2 text-text-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Monitor className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {choice}
                {destination && (
                  <span className="text-text-subtle"> → {destination}</span>
                )}
              </span>
              <ChevronDown className="size-3 shrink-0 opacity-50" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs">
              {workClass === "machine_bound"
                ? "Runs on one machine's screen"
                : "Any eligible runner can run this"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={pin?.id ?? AUTOMATIC}
              onValueChange={(v) => selectRunner(v === AUTOMATIC ? null : v)}
            >
              <DropdownMenuRadioItem value={AUTOMATIC} className="text-xs">
                <span className="flex flex-col">
                  <span>Automatic (coord picks)</span>
                  <span className="text-text-subtle">
                    Coord chooses an online, eligible runner
                  </span>
                </span>
              </DropdownMenuRadioItem>
              {runners.map((runner) => (
                <RunnerOption
                  key={runner.id}
                  runner={runner}
                  localityById={localityById}
                />
              ))}
              {pin && !pinListed && (
                <DropdownMenuRadioItem value={pin.id} className="text-xs">
                  <span className="flex items-center gap-2">
                    <RunnerStateDot status="unlisted" />
                    <span className="flex flex-col">
                      <span>{pinName}</span>
                      <span className="text-text-subtle">
                        not currently listed
                      </span>
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              )}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* The one live region, always mounted, so text that appears in it is
          announced. */}
      <div aria-live="polite" data-testid="run-on-notice-region">
        {liveText && (
          <p
            className={cn(
              "text-xs",
              dispatch.notice
                ? "status-banner status-warning"
                : "text-text-subtle"
            )}
            data-ui-bridge-id={`run-on-notice-${workClass}`}
            data-testid="run-on-notice"
          >
            {liveText}
          </p>
        )}
      </div>

      {dispatch.pinRefused && (
        <div
          role="alert"
          className="status-banner status-error flex flex-col gap-2 text-xs"
          data-ui-bridge-id={`run-on-refusal-${workClass}`}
          data-testid="run-on-refusal"
        >
          <p>{dispatch.message}</p>
          {alternatives.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Online runners — coord will check:</span>
              {alternatives.map((runner) => (
                <button
                  key={runner.id}
                  type="button"
                  className="btn-secondary btn-sm"
                  data-testid="run-on-alternative"
                  onClick={() => chooseAlternative(runner.id)}
                >
                  {runner.name} (
                  {LOCALITY_PHRASE[runnerLocality(runner, localityById)]})
                </button>
              ))}
            </div>
          ) : (
            <p>No other runner is online right now.</p>
          )}
        </div>
      )}
    </div>
  );
}

function RunnerOption({
  runner,
  localityById,
}: {
  runner: Runner;
  localityById: ReadonlyMap<string, RunnerLocality>;
}) {
  const locality = runnerLocality(runner, localityById);
  const instances = describeRunnerInstances(runner);
  return (
    <DropdownMenuRadioItem
      value={runner.id}
      className="text-xs"
      data-testid="run-on-option"
    >
      <span className="flex items-center gap-2">
        <RunnerStateDot status={locality} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate">
            {runner.name}
            {runner.port != null && (
              <span className="ml-1 text-text-subtle">:{runner.port}</span>
            )}
          </span>
          <span className="text-text-subtle">
            {LOCALITY_PHRASE[locality]} · {heartbeatPhrase(runner)}
          </span>
          {instances && (
            <span className="truncate text-text-subtle">{instances}</span>
          )}
        </span>
      </span>
    </DropdownMenuRadioItem>
  );
}

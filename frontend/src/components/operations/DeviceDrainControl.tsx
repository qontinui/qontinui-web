"use client";

/**
 * Drain / Undrain for one Dev Ops machine row.
 *
 * Plan `2026-09-01-device-drain-does-not-reach-agent-session-spawning` Phase
 * 4b — the operator lever an operator rebuilding a machine did not have. Until
 * this shipped there was no way to stop new agent sessions landing on one box,
 * and the workaround was to race the scheduler.
 *
 * Every rule about WHAT a state means lives in `./fleetDrain.ts` and is
 * unit-tested without a DOM. This file is the rendering of it, and it holds
 * three commitments the plan makes executable:
 *
 * 1. **A row that cannot name its target never gets an enabled control.**
 *    `resolveDrainTarget` decides that, and the button is disabled with the
 *    reason spelled out in prose beside it — not merely in a `title`, which a
 *    reader on a touch device never sees. An enabled control that drains
 *    nothing is the predictability failure the plan's Risks section names
 *    twice: once for a row with no coord device link, and once for a
 *    workstation versus the CI runner registered under it.
 * 2. **The target is labelled with coord's own identity**, never the card
 *    title. That title is `displayName ?? hostname` — an operator-settable
 *    alias — and the two CI/workstation registrations for one physical box
 *    differ precisely in the coord identity, so the alias is the one string
 *    that must not be trusted here.
 * 3. **Unknown renders UNKNOWN.** Not green, not "not drained", not a bare
 *    greyed-out button. `[policy: verification-and-evidence
 *    unknown-must-not-render-as-a-default]`.
 *
 * ## Why the state is always visible and only the FORM is behind a dialog
 *
 * R7 says secondary material collapses but its signal does not. "This machine
 * is out of the fleet" is not secondary material — it is the reason a row
 * showing zero sessions is not idle — so the state line renders inline, in
 * full, on every row. What hides is the *form*: an expiry and a reason are a
 * consent surface, and a page of them under a scrolling cursor is how an
 * operator drains the wrong machine.
 *
 * ## Nothing here may be truncated
 *
 * `[policy: ux-priorities no-widget-may-hide-identifying-text]`. The coord
 * hostname, the device id and the drain state are identifying text, so they
 * wrap (`break-words` / `break-all`) rather than clip. There is deliberately
 * no `truncate`, no `whitespace-nowrap` and no fixed height anywhere in this
 * component, and `DeviceDrainControl.test.tsx` asserts that structurally so a
 * later tidy-up cannot quietly reintroduce one.
 *
 * ## Presentation mode (plan `2026-10-23-console-presentation-spaces` Phase 7)
 *
 * An evaluator sees whether the machine is in service — drained until when,
 * back in service, or UNKNOWN — and nothing else. The block is one shell in
 * both modes, and each thing an outsider may not see has ONE guard of its own:
 *
 * - the lever and its consent dialog sit inside `OperatorOnly`, which
 *   unmounts them (D3.2);
 * - the target line names the coord hostname and device id, so it renders for
 *   the operator only (D3.3);
 * - the state line is `presentedStateLine`: no `drained by` and no reason (an
 *   operator's identity and free text), and an unknown state in fixed words,
 *   since the read's own reason can quote coord's free text (D3.3).
 *
 * The block carries `data-testid="device-drain-status"` rather than the
 * operator's `device-drain`, so "no drain control on the page" is checkable by
 * testid.
 *
 * ## Lanes (finding f802311d-aef5-40e8-a5f8-4bd3a554b37e)
 *
 * A drain holds coord's two lanes separately — `agent` (agent-session spawns
 * and gate continuations) and `ci` (CI-node, build and merge-capacity
 * dispatch). Until this lever offered a choice it always sent no `lanes`, so
 * it always held or released BOTH: on 2026-11-04 an operator who needed only
 * to stop spawns on one machine took its CI away with them. So:
 *
 * - the drain dialog offers both (the default, sent as NO `lanes` field — the
 *   request this lever always sent), agent sessions only, or CI only;
 * - a drained row names which lanes are held, each with its own deadline,
 *   from the read's `lanes` / `by_lane`, and a row held on one lane keeps a
 *   Drain… button for the other;
 * - the release dialog may release one lane of two. A read that did not say
 *   which lanes are held is UNKNOWN about them, and gets only the whole
 *   release — never a guess.
 */

import { useCallback, useId, useState } from "react";
import { CircleSlash, HelpCircle, PlayCircle, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { createLogger } from "@/lib/logger";
import { absoluteTime } from "@/components/console/time";
import { OperatorOnly, usePresentationMode } from "@/components/presentation";
import {
  DRAIN_LANES,
  DRAIN_LANE_HELP,
  DRAIN_LANE_LABEL,
  DRAIN_PRESETS,
  MAX_DRAIN_DAYS,
  describeDrainError,
  describeLanes,
  formatDrainRemaining,
  heldLanes,
  lanesForChoice,
  toLocalInputValue,
  validateDrainForm,
  type DeviceDrainState,
  type DrainLane,
  type DrainLaneChoice,
  type DrainLaneRecord,
  type DrainTarget,
} from "./fleetDrain";
import { postDrain, postUndrain } from "./useFleetDrain";

const log = createLogger("DeviceDrainControl");

export interface DeviceDrainControlProps {
  /** What this row would drain — or why it cannot name anything. */
  target: DrainTarget;
  /** What coord says about that device right now. */
  drain: DeviceDrainState;
  /**
   * The row's own hostname (never the operator alias), used only in the
   * dialog's prose so the operator can see the row they clicked. The drain
   * itself is keyed on `target.deviceId` and never on this.
   */
  rowHostname: string;
  /** Forced re-read after a successful write — coord is the source of truth. */
  onActed?: () => void;
  /**
   * Injectable clock, so the remaining-time rendering is deterministic under
   * test. Defaults to `Date.now()` at render.
   */
  now?: number;
}

/** The one class of block used for every non-actionable state. */
function DrainNotice({
  tone,
  headline,
  children,
}: {
  tone: "waiting" | "muted";
  headline: string;
  children: React.ReactNode;
}) {
  // Amber for UNKNOWN, per the console palette's documented exception: an
  // amber painted on ignorance is a statement about our knowledge, and calm on
  // an unknown row would assert "nothing is wrong here", which is exactly what
  // we do not know. Muted for `no_device`, where we DO know the row's state —
  // the join is absent — and nothing is decaying.
  const shell =
    tone === "waiting"
      ? "border-amber-500/50 bg-amber-500/5"
      : "border-border bg-muted/30";
  const label =
    tone === "waiting"
      ? "text-amber-600 dark:text-amber-500"
      : "text-muted-foreground";
  const Icon = tone === "waiting" ? HelpCircle : CircleSlash;
  return (
    <div
      className={`rounded-md border border-dashed px-2 py-1.5 ${shell}`}
      role="status"
    >
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${label}`} />
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${label}`}
        >
          {headline}
        </span>
      </div>
      <p className="mt-1 text-[11px] break-words text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

/**
 * The line naming what a drain would actually act on.
 *
 * Rendered for every identified row, drained or not — an operator has to be
 * able to check the target BEFORE clicking, not only after. The id is
 * `break-all` because a UUID has no spaces to wrap at and clipping it would
 * hide the one field that distinguishes two registrations of the same box.
 */
function DrainTargetLine({
  deviceId,
  coordHostname,
}: {
  deviceId: string;
  coordHostname: string | null;
}) {
  return (
    <p
      className="text-[11px] leading-snug break-words text-muted-foreground"
      data-testid="device-drain-target"
      data-device-id={deviceId}
    >
      Drains coord device{" "}
      <span className="font-medium text-foreground">
        {coordHostname ?? "(coord reports no hostname)"}
      </span>{" "}
      <span className="font-mono break-all text-foreground">{deviceId}</span>
    </p>
  );
}

/**
 * The amber block a drained machine's state renders in, in both modes. One
 * shell, so the operator's line and the evaluator's line cannot drift apart in
 * how loudly they say "out of the fleet".
 */
function DrainedNotice({
  headline,
  children,
}: {
  headline: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border border-amber-500/50 bg-amber-500/5 px-2 py-1.5"
      role="status"
    >
      <div className="flex items-center gap-1.5">
        <PowerOff className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
          {headline}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug break-words text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

interface StateLineInput {
  target: DrainTarget;
  drain: DeviceDrainState;
  clock: number;
}

/** The lanes a drained row holds now, or `null` when not drained / not said. */
type HeldLanes = Array<{ lane: DrainLane; record: DrainLaneRecord }> | null;

function heldLanesOf(drain: DeviceDrainState, clock: number): HeldLanes {
  if (drain.state !== "drained") return null;
  const held = heldLanes(drain.entry, clock);
  // An empty list cannot be told apart from a read that lost the lanes, so it
  // is UNKNOWN about them too. (The headline `until` is the LATEST lane's, so
  // a row still `drained` with no live lane should not occur.)
  return held && held.length > 0 ? held : null;
}

/**
 * A drain held on exactly ONE lane: that lane, its record, and the lane it
 * leaves FREE — or `null` for any other shape (both held, or unknown).
 */
function singleLane(
  held: HeldLanes
): { lane: DrainLane; record: DrainLaneRecord; free: DrainLane } | null {
  const only = held?.length === 1 ? held[0] : undefined;
  if (!only) return null;
  const free = DRAIN_LANES.find((l) => l !== only.lane);
  return free ? { ...only, free } : null;
}

/**
 * Per lane: held until when, by whom and why — or not held. Coord writes and
 * expires each lane on its own, so a two-lane drain can end at two times.
 */
function HeldLanesList({
  held,
  clock,
}: {
  held: NonNullable<HeldLanes>;
  clock: number;
}) {
  return (
    <span
      className="mt-1 block space-y-0.5"
      data-testid="device-drain-lanes-held"
    >
      {DRAIN_LANES.map((lane) => {
        const hit = held.find((h) => h.lane === lane);
        return (
          <span
            key={lane}
            className="block break-words"
            data-lane={lane}
            data-held={hit ? "true" : "false"}
          >
            <span className="font-medium text-foreground">
              {DRAIN_LANE_LABEL[lane]}
            </span>{" "}
            {hit ? (
              <>
                — held until{" "}
                <span className="font-medium text-foreground">
                  {absoluteTime(hit.record.until)}
                </span>{" "}
                ({formatDrainRemaining(hit.record.until, clock)}) by{" "}
                {hit.record.drainedBy ?? "an operator this read did not name"},
                reason {hit.record.reason ?? "not recorded"}.
              </>
            ) : (
              <>— not held; coord still sends it {DRAIN_LANE_HELP[lane]}.</>
            )}
          </span>
        );
      })}
    </span>
  );
}

interface LaneOption {
  value: DrainLaneChoice;
  label: string;
  detail: string;
}

/**
 * A lane choice, as a labelled radio group. It sits inside the consent dialog,
 * which `OperatorOnly` unmounts while presenting — every option is a write
 * scope, so none of it may be marked navigation-only.
 */
function LaneChoiceGroup({
  label,
  value,
  options,
  onChange,
  disabled,
  testIdPrefix,
}: {
  label: string;
  value: DrainLaneChoice;
  options: ReadonlyArray<LaneOption>;
  onChange: (next: DrainLaneChoice) => void;
  disabled: boolean;
  testIdPrefix: string;
}) {
  const baseId = useId();
  return (
    <div className="space-y-1.5">
      <Label id={`${baseId}-label`}>{label}</Label>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as DrainLaneChoice)}
        disabled={disabled}
        aria-labelledby={`${baseId}-label`}
        className="gap-2"
        data-testid={testIdPrefix}
      >
        {options.map((option) => {
          const id = `${baseId}-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <RadioGroupItem
                value={option.value}
                id={id}
                className="mt-0.5"
                data-testid={`${testIdPrefix}-${option.value}`}
              />
              <label htmlFor={id} className="cursor-pointer text-sm break-words">
                <span className="font-medium">{option.label}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {option.detail}
                </span>
              </label>
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
}

/** The drain dialog's lane options. `both` first: it is the default. */
const DRAIN_LANE_OPTIONS: ReadonlyArray<LaneOption> = [
  {
    value: "both",
    label: "Both lanes",
    detail: `Holds ${DRAIN_LANE_HELP.agent}, and ${DRAIN_LANE_HELP.ci}.`,
  },
  {
    value: "agent",
    label: "Agent sessions only",
    detail: `Holds ${DRAIN_LANE_HELP.agent}. CI keeps being sent here.`,
  },
  {
    value: "ci",
    label: "CI only",
    detail: `Holds ${DRAIN_LANE_HELP.ci}. Agent sessions keep landing here.`,
  },
];

/** The release dialog's lane options, for a row held on both lanes. */
function releaseLaneOptions(
  held: NonNullable<HeldLanes>,
  clock: number
): LaneOption[] {
  const stays = (lane: DrainLane) => {
    const rec = held.find((h) => h.lane === lane)?.record;
    return rec
      ? `${DRAIN_LANE_LABEL[lane]} stays held until ${absoluteTime(rec.until)} (${formatDrainRemaining(rec.until, clock)}).`
      : `${DRAIN_LANE_LABEL[lane]} stays held.`;
  };
  return [
    {
      value: "both",
      label: "Both lanes",
      detail: "Removes the drain: coord may send it any new work again.",
    },
    {
      value: "agent",
      label: "Agent sessions only",
      detail: `Coord may send it ${DRAIN_LANE_HELP.agent} again. ${stays("ci")}`,
    },
    {
      value: "ci",
      label: "CI only",
      detail: `Coord may send it ${DRAIN_LANE_HELP.ci} again. ${stays("agent")}`,
    },
  ];
}

/**
 * The lanes a release sends. A row held on ONE lane names that lane rather
 * than omitting the field: an omitted field releases every lane, which would
 * also release a lane another operator drained after this page last read.
 */
function releaseLanesFor(
  held: HeldLanes,
  choice: DrainLaneChoice
): DrainLane[] | undefined {
  if (held === null) return undefined;
  const only = singleLane(held);
  if (only) return [only.lane];
  return lanesForChoice(choice);
}

/**
 * The drain STATE as an external evaluator reads it: in service, out of
 * service until when, or unknown. No actor and no reason (an operator's
 * identity and free text), and the unknown arm states the fact in fixed words
 * rather than the read's own reason, which can quote coord's free text about a
 * device (plan `2026-10-23-console-presentation-spaces` D3.3). Every arm still
 * says what is true — a read that failed is UNKNOWN in words, never "in
 * service".
 */
function presentedStateLine({ target, drain, clock }: StateLineInput) {
  if (target.state === "no_device") {
    return (
      <DrainNotice tone="muted" headline="No drain state">
        This machine is not linked to a coordination-service device, so it has
        no drain state to show.
      </DrainNotice>
    );
  }
  if (drain.state === "unknown") {
    return (
      <DrainNotice tone="waiting" headline="Drain state unknown">
        Its drain state has not been read, so this machine may or may not be
        taking new work — this is a statement about the read, not about the
        machine.
      </DrainNotice>
    );
  }
  const held = heldLanesOf(drain, clock);
  const only = singleLane(held);
  if (drain.state === "drained" && only) {
    // Held on ONE lane: the machine is still in service for the other, and
    // "Out of service" would overstate it.
    const rec = only.record;
    return (
      <DrainedNotice headline="Partly out of service">
        No new {DRAIN_LANE_HELP[only.lane]} are sent to it until{" "}
        <span className="font-medium text-foreground">
          {absoluteTime(rec.until)}
        </span>{" "}
        ({formatDrainRemaining(rec.until, clock)}); {DRAIN_LANE_HELP[only.free]}{" "}
        still reach it, and anything already running on it keeps running.
      </DrainedNotice>
    );
  }
  if (drain.state === "drained") {
    return (
      <DrainedNotice headline="Out of service">
        Drained until{" "}
        <span className="font-medium text-foreground">
          {absoluteTime(drain.entry.until)}
        </span>{" "}
        ({formatDrainRemaining(drain.entry.until, clock)}). No new work is sent
        to it until then; anything already running on it keeps running.
      </DrainedNotice>
    );
  }
  if (drain.state === "expired") {
    return (
      <p className="text-[11px] leading-snug break-words text-muted-foreground">
        Back in service — its last drain expired{" "}
        {formatDrainRemaining(drain.entry.until, clock)} and it was released
        automatically.
      </p>
    );
  }
  return (
    <p className="text-[11px] leading-snug break-words text-muted-foreground">
      In service — new work may be sent to it.
    </p>
  );
}

/** The drain state as the operator reads it: everything coord said. */
function operatorStateLine({ target, drain, clock }: StateLineInput) {
  if (target.state === "no_device") {
    return (
      <DrainNotice tone="muted" headline="No coord device to drain">
        {target.reason}
      </DrainNotice>
    );
  }
  if (drain.state === "unknown") {
    return (
      <DrainNotice tone="waiting" headline="Drain state unknown">
        {drain.reason} This machine may or may not be taking new work — this is
        a statement about the read, not about the machine.
      </DrainNotice>
    );
  }
  if (drain.state === "drained") {
    const held = heldLanesOf(drain, clock);
    const only = singleLane(held);
    return (
      <DrainedNotice
        headline={
          only
            ? `Drained — ${DRAIN_LANE_LABEL[only.lane]} only`
            : "Drained"
        }
      >
        Drained until{" "}
        <span className="font-medium text-foreground">
          {absoluteTime(drain.entry.until)}
        </span>{" "}
        ({formatDrainRemaining(drain.entry.until, clock)}) by{" "}
        <span className="font-medium text-foreground">
          {drain.entry.drainedBy ?? "an operator this read did not name"}
        </span>
        , reason{" "}
        <span className="font-medium text-foreground">
          {drain.entry.reason ?? "not recorded"}
        </span>
        .{" "}
        {drain.entry.drainedAt
          ? `Drained at ${absoluteTime(drain.entry.drainedAt)}. `
          : ""}
        {only
          ? `Coord sends it no new ${DRAIN_LANE_HELP[only.lane]} until then, and still sends it ${DRAIN_LANE_HELP[only.free]}; `
          : held && new Set(held.map((h) => h.record.until)).size > 1
            ? "That is when the LAST lane ends — each lane comes back at its own time, below; "
            : "Coord sends it no new work until then; "}
        anything already running on it keeps running.
        {held ? (
          <HeldLanesList held={held} clock={clock} />
        ) : (
          <span className="mt-1 block" data-testid="device-drain-lanes-unknown">
            Coord&apos;s read did not say which lanes this drain holds, so only
            a release of every lane is offered.
          </span>
        )}
      </DrainedNotice>
    );
  }
  if (drain.state === "expired") {
    return (
      <p className="text-[11px] leading-snug break-words text-muted-foreground">
        Not drained — the last drain expired{" "}
        {formatDrainRemaining(drain.entry.until, clock)} (
        {absoluteTime(drain.entry.until)}) and coord released the machine on its
        own. Nobody undrained it.
      </p>
    );
  }
  return (
    <p className="text-[11px] leading-snug break-words text-muted-foreground">
      Not drained — coord may send this machine new work.
    </p>
  );
}

export function DeviceDrainControl({
  target,
  drain,
  rowHostname,
  onActed,
  now,
}: DeviceDrainControlProps) {
  const { presenting } = usePresentationMode();
  const [mode, setMode] = useState<"drain" | "undrain" | null>(null);
  const [untilLocal, setUntilLocal] = useState("");
  const [reason, setReason] = useState("");
  // Which lanes the open dialog acts on. `both` is the default every time a
  // dialog opens, and is sent as NO `lanes` field.
  const [laneChoice, setLaneChoice] = useState<DrainLaneChoice>("both");
  // The lanes held when Undrain was clicked. The release dialog renders and
  // submits from THIS, not from the live read: a poll or a lane expiring while
  // the operator types would otherwise change which lanes the release names
  // (a two-lane choice collapsing to "the one left", or a one-lane release
  // widening to both and taking another operator's new drain with it).
  const [releaseHeld, setReleaseHeld] = useState<HeldLanes>(null);
  const [busy, setBusy] = useState(false);
  const clock = now ?? Date.now();

  const deviceId = target.state === "identified" ? target.deviceId : null;
  const held = heldLanesOf(drain, clock);
  // The lane a single-lane drain leaves open — the one Drain… can still hold.
  const freeLane = singleLane(held)?.free ?? null;

  // Not memoised: it is three string comparisons, and the submit path
  // re-validates against a fresh clock anyway — that second check is the one
  // that decides anything, this one only shapes the form.
  const check = validateDrainForm(untilLocal, reason, clock);

  const close = useCallback(() => {
    setMode(null);
    setUntilLocal("");
    setReason("");
    setLaneChoice("both");
    setReleaseHeld(null);
  }, []);

  const submit = useCallback(async () => {
    if (deviceId === null || mode === null) return;
    const trimmed = reason.trim();
    if (mode === "drain") {
      const fresh = validateDrainForm(untilLocal, reason, Date.now());
      if (!fresh.ok) {
        toast.error("That drain was not accepted", {
          description: fresh.message,
        });
        return;
      }
      const lanes = lanesForChoice(laneChoice);
      setBusy(true);
      const res = await postDrain({
        deviceId,
        untilIso: fresh.untilIso,
        reason: trimmed,
        lanes,
      });
      setBusy(false);
      if (!res.ok) {
        log.warn("drain failed", res.status, res.body);
        toast.error(`Couldn't drain ${rowHostname}`, {
          description:
            res.status === null
              ? res.body
              : describeDrainError(res.status, res.body),
        });
        return;
      }
      toast.success(
        lanes
          ? `${rowHostname} drained for ${describeLanes(lanes)} only — coord ` +
              `will send it no new ${lanes.map((l) => DRAIN_LANE_HELP[l]).join(" or ")} ` +
              `until the expiry. Work already running on it is not stopped.`
          : `${rowHostname} drained — coord will send it no new work until the ` +
              `expiry. Work already running on it is not stopped.`
      );
      close();
      onActed?.();
      return;
    }

    if (trimmed === "") {
      toast.error("A reason is required", {
        description:
          "Coord records who released the machine and why; it rejects a " +
          "blank reason.",
      });
      return;
    }
    const releaseLanes = releaseLanesFor(releaseHeld, laneChoice);
    setBusy(true);
    const res = await postUndrain({
      deviceId,
      reason: trimmed,
      lanes: releaseLanes,
    });
    setBusy(false);
    if (!res.ok) {
      log.warn("undrain failed", res.status, res.body);
      toast.error(`Couldn't release ${rowHostname}`, {
        description:
          res.status === null
            ? res.body
            : describeDrainError(res.status, res.body),
      });
      return;
    }
    toast.success(
      !res.changed
        ? releaseLanes
          ? `${rowHostname} was not drained for ${describeLanes(releaseLanes)}, so nothing was released.`
          : `${rowHostname} was not drained, so nothing was released.`
        : releaseLanes && releaseLanes.length < DRAIN_LANES.length
          ? `${rowHostname}: ${describeLanes(releaseLanes)} released — coord may send it ${releaseLanes.map((l) => DRAIN_LANE_HELP[l]).join(" or ")} again.`
          : `${rowHostname} released — coord may send it work again.`
    );
    close();
    onActed?.();
  }, [
    close,
    deviceId,
    laneChoice,
    mode,
    onActed,
    reason,
    releaseHeld,
    rowHostname,
    untilLocal,
  ]);

  // The state key the tests and the UI Bridge key on. `no_device` wins over
  // the drain state: with no device id there is nothing the drain map could
  // have been asked about, so reporting the read's health would be a
  // non-sequitur (the same short-circuit `resolveCiCapacity` makes).
  const stateKey = target.state === "no_device" ? "no_device" : drain.state;
  const actable = target.state === "identified" && drain.state !== "unknown";

  // One shell in both modes. What changes while presenting (D3.2, D3.3): the
  // block's testid, the state line's wording, the target line (it names
  // coord's hostname and device id) — and the lever with its dialog, which
  // `OperatorOnly` unmounts.
  return (
    <div
      className="space-y-1.5"
      data-testid={presenting ? "device-drain-status" : "device-drain"}
      data-device-drain={stateKey}
    >
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Drain
      </h4>

      {!presenting && target.state === "identified" && (
        <DrainTargetLine
          deviceId={target.deviceId}
          coordHostname={target.coordHostname}
        />
      )}

      <div data-testid="device-drain-state">
        {presenting
          ? presentedStateLine({ target, drain, clock })
          : operatorStateLine({ target, drain, clock })}
      </div>

      {/* The lever and its consent dialog are write controls: never mounted
          in presentation mode (D3.2). */}
      <OperatorOnly>
        <CoordAdminOnly fallback={<ReadOnlyNotice />}>
          <div className="flex flex-wrap items-center gap-2">
            {drain.state === "drained" && (
              <Button
                size="sm"
                variant="outline"
                disabled={!actable || busy}
                title={actable ? undefined : disabledReason(target, drain)}
                onClick={() => {
                  setReason("");
                  setLaneChoice("both");
                  setReleaseHeld(held);
                  setMode("undrain");
                }}
                data-testid="device-drain-undrain"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                Undrain
              </Button>
            )}
            {/* Drain… stays offered on a row held on ONE lane, so the other
                lane can be held too without releasing the first. */}
            {(drain.state !== "drained" || freeLane !== null) && (
              <Button
                size="sm"
                variant="outline"
                disabled={!actable || busy}
                title={actable ? undefined : disabledReason(target, drain)}
                onClick={() => {
                  setUntilLocal("");
                  setReason("");
                  setLaneChoice(freeLane ?? "both");
                  setMode("drain");
                }}
                data-testid="device-drain-open"
              >
                <PowerOff className="h-3.5 w-3.5" />
                Drain…
              </Button>
            )}
            {!actable && (
              <span
                className="text-[11px] break-words text-muted-foreground"
                data-testid="device-drain-disabled-reason"
              >
                {disabledReason(target, drain)}
              </span>
            )}
          </div>
        </CoordAdminOnly>

        <Dialog
          open={mode !== null}
          onOpenChange={(open) => {
            if (!open) close();
          }}
        >
          <DialogContent data-testid="device-drain-dialog">
            <DialogHeader>
              <DialogTitle>
                {mode === "undrain"
                  ? `Release ${rowHostname} back into the fleet?`
                  : `Drain ${rowHostname}?`}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p className="break-words">
                    {mode === "undrain"
                      ? "Coord may send this machine new work again, on the lanes released, as soon as this lands."
                      : "Coord will stop sending this machine NEW work on the lanes chosen below — agent-session spawns and continuations, CI jobs, builds and merge capacity. Work already running on it is not stopped, and no session is moved."}
                  </p>
                  {deviceId !== null && (
                    <p className="break-words">
                      This acts on coord device{" "}
                      <span className="font-mono break-all">{deviceId}</span>
                      {target.state === "identified" && target.coordHostname
                        ? ` (${target.coordHostname})`
                        : ""}
                      . A machine can hold more than one coord registration — a
                      workstation and its self-hosted CI runner are separate
                      devices — and draining one does nothing to the other.
                    </p>
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {mode === "drain" && (
                <LaneChoiceGroup
                  label="Lanes to hold"
                  value={laneChoice}
                  options={DRAIN_LANE_OPTIONS}
                  onChange={setLaneChoice}
                  disabled={busy}
                  testIdPrefix="device-drain-lanes"
                />
              )}
              {mode === "drain" && held !== null && (
                <p
                  className="text-[11px] text-muted-foreground break-words"
                  data-testid="device-drain-lanes-already-held"
                >
                  Already held: {describeLanes(held.map((h) => h.lane))}.
                  Holding a lane that is already held replaces its deadline
                  and reason with these; a lane you do not choose keeps its
                  own.
                </p>
              )}
              {mode === "undrain" &&
                releaseHeld !== null &&
                releaseHeld.length > 1 && (
                <LaneChoiceGroup
                  label="Lanes to release"
                  value={laneChoice}
                  options={releaseLaneOptions(releaseHeld, clock)}
                  onChange={setLaneChoice}
                  disabled={busy}
                  testIdPrefix="device-drain-release-lanes"
                />
              )}
              {mode === "undrain" &&
                (releaseHeld === null || releaseHeld.length === 1) && (
                <p
                  className="text-[11px] text-muted-foreground break-words"
                  data-testid="device-drain-release-scope"
                >
                  {releaseHeld === null
                    ? "Coord's read did not say which lanes this drain holds, so this releases every lane."
                    : `Releases the ${describeLanes(releaseHeld.map((h) => h.lane))} hold — the only lane held.`}
                </p>
              )}
              {mode === "drain" && (
                <div className="space-y-1.5">
                  <Label htmlFor="device-drain-until">Expiry (required)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {DRAIN_PRESETS.map((preset) => (
                      <Button
                        key={preset.key}
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          setUntilLocal(
                            toLocalInputValue(
                              Date.now() + preset.hours * 3_600_000
                            )
                          )
                        }
                        data-testid={`device-drain-preset-${preset.key}`}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                  <Input
                    id="device-drain-until"
                    type="datetime-local"
                    value={untilLocal}
                    disabled={busy}
                    onChange={(e) => setUntilLocal(e.target.value)}
                    data-testid="device-drain-until"
                  />
                  <p className="text-[11px] text-muted-foreground break-words">
                    Required, and there is no &ldquo;no expiry&rdquo; option: a
                    drain without a deadline is how a machine silently leaves
                    the fleet forever. Coord rejects anything further out than{" "}
                    {MAX_DRAIN_DAYS} days — re-drain instead.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="device-drain-reason">Reason (required)</Label>
                <Textarea
                  id="device-drain-reason"
                  rows={2}
                  value={reason}
                  disabled={busy}
                  placeholder={
                    mode === "undrain"
                      ? "e.g. rebuild finished"
                      : "e.g. rebuilding the runner"
                  }
                  onChange={(e) => setReason(e.target.value)}
                  data-testid="device-drain-reason"
                />
                <p className="text-[11px] text-muted-foreground break-words">
                  Recorded on coord&apos;s audit row and raised as an alert
                  other operators see, so it is what tells them why the machine
                  is out.
                </p>
              </div>

              {mode === "drain" && !check.ok && (
                <p
                  className="text-[11px] break-words text-amber-600 dark:text-amber-500"
                  role="status"
                  data-testid="device-drain-error"
                >
                  {check.message}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={close}
                data-testid="device-drain-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  busy ||
                  deviceId === null ||
                  (mode === "drain" ? !check.ok : reason.trim() === "")
                }
                onClick={() => void submit()}
                data-testid="device-drain-submit"
              >
                {mode === "undrain"
                  ? "Release"
                  : laneChoice === "both"
                    ? "Drain machine"
                    : `Drain ${DRAIN_LANE_LABEL[laneChoice]} only`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </OperatorOnly>
    </div>
  );
}

/**
 * Why the control is disabled — always a sentence, never a shrug.
 *
 * A greyed-out button with no explanation reads as "draining is off for this
 * machine", which is a claim about the machine. Both real reasons are claims
 * about the JOIN or about the READ, and the two are worded differently because
 * they call for different next steps.
 */
export function disabledReason(
  target: DrainTarget,
  drain: DeviceDrainState
): string | undefined {
  if (target.state === "no_device") return target.reason;
  if (drain.state === "unknown") {
    return (
      `${drain.reason} Draining is offered only against a state that was ` +
      `actually read — acting on an unknown one is how a machine gets ` +
      `drained twice or released by accident.`
    );
  }
  return undefined;
}

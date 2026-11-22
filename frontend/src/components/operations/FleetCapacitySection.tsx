"use client";

/**
 * FleetCapacitySection — each machine's FREE capacity, as the one resource
 * model places work on it (plan
 * `2026-11-05-one-free-resource-model-places-sessions-builds-and-ci`
 * Phase 11). It is the Dev Ops page's capacity view; it supersedes the
 * separate Placement panel plan `2026-10-17-fleet-work-placement-…` Phase 8
 * described, which was never built, so there is one capacity surface and not
 * two.
 *
 * Per machine it shows free CPU and RAM with their units and the age of the
 * sample they were computed from, the resource that binds sessions, the slot
 * count of every work class with the basis of its cost, every UNKNOWN with
 * coord's reason, and the legacy-versus-model parity readout. Fleet-wide it
 * shows the misplaced-wait share, which coord does not serve yet, as UNKNOWN.
 *
 * UNKNOWN is rendered as the word UNKNOWN with its reason, never as `0`: a
 * machine coord could not measure is not a machine with no room, and the
 * placement consumers themselves treat it as "fall back to the legacy reader"
 * rather than as zero.
 *
 * The D9 dial (`capacity_model_mode`, `capacity_model_off_consumers`) is
 * editable here, inside `OperatorOnly`, for a tenant admin. An unread dial is
 * UNKNOWN and offers no editor: writing over a value nobody could read is not
 * an edit.
 */

import { useEffect, useMemo, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CollapsiblePanel, NAVIGATION_ONLY_PROPS } from "@/components/console";
import {
  OperatorOnly,
  SectionCaption,
  useMachineAliaser,
  usePresentationMode,
} from "@/components/presentation";
import {
  putCapacityModel,
  type CapacityModelDial,
  type CapacityModelView,
} from "@/lib/api/operations/coordFleet";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import { DEVOPS_SOURCES } from "./devOpsHeadline";
import {
  USAGE_BASIS_LABEL,
  MISPLACED_SHARE_UNKNOWN_REASON,
  WORK_CLASSES,
  WORK_CLASS_LABEL,
  formatCores,
  formatGib,
  humanize,
  parityTally,
  type CapacityDevice,
  type ClassSlots,
  type Known,
} from "./fleetCapacity";
import { formatAge } from "./fleetResources";
import {
  FAILURE_SENTENCE_WITHHELD,
  presentedFailureReason,
} from "./presentedFailure";
import type { UseFleetCapacityResult } from "./useFleetCapacity";

/** The word every UNKNOWN renders as, with its reason beside it. */
function UnknownValue({ reason }: { reason: string }) {
  const { presenting } = usePresentationMode();
  return (
    <span
      className="font-medium text-amber-700 dark:text-amber-400"
      title={presenting ? undefined : reason}
      data-testid="fleet-capacity-unknown"
      data-unknown-reason={presenting ? undefined : reason}
    >
      UNKNOWN
    </span>
  );
}

function KnownValue<T>({
  value,
  format,
}: {
  value: Known<T>;
  format: (v: T) => string;
}) {
  return value.state === "known" ? (
    <span className="tabular-nums">{format(value.value)}</span>
  ) : (
    <UnknownValue reason={value.reason} />
  );
}

function basisText(c: ClassSlots): string {
  const cpu = c.cpuBasis ? USAGE_BASIS_LABEL[c.cpuBasis] : "no CPU cost";
  const mem = c.memBasis ? USAGE_BASIS_LABEL[c.memBasis] : "no memory cost";
  return cpu === mem ? cpu : `CPU ${cpu}, memory ${mem}`;
}

/** Slots per class: the count, what bound it, and the basis of its costs. */
function ClassSlotsList({ device }: { device: CapacityDevice }) {
  return (
    <ul className="space-y-0.5 text-[11px]" data-testid="fleet-capacity-slots">
      {WORK_CLASSES.map((cls) => {
        const c = device.classes[cls];
        return (
          <li key={cls} data-work-class={cls}>
            <span className="font-mono" title={WORK_CLASS_LABEL[cls]}>
              {cls}
            </span>{" "}
            <KnownValue value={c.slots} format={(n) => String(n)} />
            <span className="text-muted-foreground">
              {c.binding ? ` · bound by ${humanize(c.binding)}` : ""} ·{" "}
              {basisText(c)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** UNKNOWN reasons and the parity readout, collapsed per row. */
function DeviceDetail({ device }: { device: CapacityDevice }) {
  const { presenting } = usePresentationMode();
  const tally = device.parity ? parityTally(device.parity) : null;
  const tallyLine = tally
    ? Object.entries(tally)
        .map(([state, n]) => `${n} ${humanize(state)}`)
        .join(", ")
    : null;
  return (
    <CollapsiblePanel
      data-testid="fleet-capacity-detail"
      defaultOpen={false}
      titleAs="div"
      title={
        tallyLine
          ? `Parity (${device.parity!.length} legacy deciders: ${tallyLine})`
          : "Parity UNKNOWN"
      }
      className="border-dashed p-2"
      contentClassName="mt-2 space-y-2"
    >
      {presenting ? (
        <p className="text-[11px] text-muted-foreground">
          The deciders&apos; answers are withheld in presentation mode.
        </p>
      ) : device.parity === null ? (
        <p className="text-[11px]">
          <UnknownValue reason="coord sent no parity readout for this machine" />{" "}
          coord sent no parity readout for this machine.
        </p>
      ) : (
        <ul
          className="space-y-0.5 text-[11px]"
          data-testid="fleet-capacity-parity"
        >
          {device.parity.map((p) => (
            <li key={`${p.row}:${p.decider}`} data-parity-state={p.state}>
              <span className="font-mono">#{p.row}</span> {p.decider}:{" "}
              {p.state === "unknown" || p.state === "unreadable" ? (
                <>
                  <UnknownValue reason={p.text} />{" "}
                  <span className="text-muted-foreground">{p.text}</span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {humanize(p.state)} — {p.text}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </CollapsiblePanel>
  );
}

function DeviceRow({ device }: { device: CapacityDevice }) {
  const { presenting } = usePresentationMode();
  const machineName = useMachineAliaser();
  const unknownCount = device.unknownReasons.length;
  return (
    <TableRow
      data-testid="fleet-capacity-row"
      data-device-id={presenting ? undefined : device.deviceId}
      data-capacity-state={unknownCount > 0 ? "unknown" : "known"}
      className="align-top"
    >
      <TableCell className="py-1.5">
        {machineName(
          { deviceId: device.deviceId, hostname: device.machineKey },
          device.label
        )}
        {device.sessionGate && (
          <Badge
            variant="outline"
            className="ml-1 text-[10px]"
            data-testid="fleet-capacity-session-gate"
          >
            no new sessions: {humanize(device.sessionGate)}
          </Badge>
        )}
      </TableCell>
      <TableCell
        className="py-1.5 text-[11px]"
        data-testid="fleet-capacity-free-cpu"
      >
        <KnownValue value={device.freeCpuCores} format={formatCores} />
      </TableCell>
      <TableCell
        className="py-1.5 text-[11px]"
        data-testid="fleet-capacity-free-ram"
      >
        <KnownValue value={device.freeMemBytes} format={formatGib} />
      </TableCell>
      <TableCell
        className="py-1.5 text-[11px]"
        data-testid="fleet-capacity-age"
      >
        {device.sampleAgeSecs === null ? (
          <UnknownValue reason="no runner sample in coord's lookback" />
        ) : (
          formatAge(device.sampleAgeSecs)
        )}
      </TableCell>
      <TableCell
        className="py-1.5 text-[11px]"
        data-testid="fleet-capacity-binding"
      >
        {device.sessionBinding ? (
          humanize(device.sessionBinding)
        ) : device.classes.S.slots.state === "unknown" ? (
          <UnknownValue reason={device.classes.S.slots.reason} />
        ) : (
          <span className="text-muted-foreground">none named</span>
        )}
      </TableCell>
      <TableCell className="py-1.5">
        <ClassSlotsList device={device} />
      </TableCell>
      <TableCell className="py-1.5 space-y-1">
        {unknownCount > 0 && (
          <ul
            className="space-y-0.5 text-[11px]"
            data-testid="fleet-capacity-unknown-reasons"
          >
            {presenting ? (
              <li className="text-muted-foreground">
                {unknownCount} value{unknownCount === 1 ? "" : "s"} UNKNOWN
                (reasons withheld in presentation mode)
              </li>
            ) : (
              device.unknownReasons.map((r) => (
                <li key={r}>
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    UNKNOWN
                  </span>{" "}
                  <span className="text-muted-foreground">{r}</span>
                </li>
              ))
            )}
          </ul>
        )}
        <DeviceDetail device={device} />
      </TableCell>
    </TableRow>
  );
}

/** The D9 dial's editor: a tenant admin's, and only over a dial that was read. */
function DialEditor({
  dial,
  onWritten,
}: {
  dial: CapacityModelDial;
  onWritten: () => void;
}) {
  const [mode, setMode] = useState(dial.mode);
  const [off, setOff] = useState<string[]>(dial.off_consumers);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // A fresh read (another operator's write, or our own read-back) resets the
  // form to what coord now resolves.
  useEffect(() => {
    setMode(dial.mode);
    setOff(dial.off_consumers);
  }, [dial]);

  const dirty =
    mode !== dial.mode ||
    off.length !== dial.off_consumers.length ||
    off.some((c) => !dial.off_consumers.includes(c));

  async function save() {
    setSaving(true);
    setRefusal(null);
    try {
      const result = await putCapacityModel({
        mode,
        // In the vocabulary's order, so the stored list reads the same way.
        off_consumers: dial.consumers.filter((c) => off.includes(c)),
        change_note: note.trim() || null,
      });
      if (result.effective?.dial) {
        toast.success(
          `Capacity model is now ${result.effective.dial.mode}` +
            (result.version !== null ? ` (version ${result.version})` : "")
        );
      } else {
        toast.warning(
          `Saved, but what coord now resolves is UNKNOWN: ${
            result.readback_error ??
            result.effective?.unknown_reason ??
            "no read-back"
          }`,
          { duration: Infinity, closeButton: true }
        );
      }
      setNote("");
      onWritten();
    } catch (err) {
      setRefusal(operationsErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="space-y-2 rounded-md border p-2"
      data-testid="fleet-capacity-dial-editor"
    >
      <RadioGroup
        value={mode}
        onValueChange={(v) => setMode(v === "off" ? "off" : "enforce")}
        className="flex flex-wrap items-center gap-3 text-[11px]"
        aria-label="Capacity-model mode"
      >
        {(["enforce", "off"] as const).map((m) => (
          <div key={m} className="flex items-center gap-1">
            <RadioGroupItem
              id={`capacity-model-mode-${m}`}
              value={m}
              data-testid={`fleet-capacity-dial-mode-${m}`}
            />
            <Label
              htmlFor={`capacity-model-mode-${m}`}
              className="text-[11px] font-normal"
            >
              {m === "enforce"
                ? "enforce (consumers read the model)"
                : "off (every consumer keeps its legacy reader)"}
            </Label>
          </div>
        ))}
      </RadioGroup>
      <fieldset className="text-[11px]">
        <legend className="font-medium">Consumers switched off</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {dial.consumers.map((c) => (
            <label key={c} className="flex items-center gap-1">
              <Checkbox
                checked={off.includes(c)}
                onCheckedChange={(v) =>
                  setOff((cur) =>
                    v === true ? [...cur, c] : cur.filter((x) => x !== c)
                  )
                }
                data-testid={`fleet-capacity-dial-off-${c}`}
              />
              {humanize(c)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <Label htmlFor="capacity-model-note" className="text-[11px]">
            Change note (optional)
          </Label>
          <Input
            id="capacity-model-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            className="h-7 text-xs"
          />
        </div>
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving}
          data-testid="fleet-capacity-dial-save"
        >
          {saving ? "Saving…" : "Save dial"}
        </Button>
      </div>
      {refusal && (
        <p
          className="text-[11px] text-destructive"
          data-testid="fleet-capacity-dial-refusal"
        >
          coord refused the write: {refusal}
        </p>
      )}
    </div>
  );
}

function DialBlock({
  view,
  error,
  onWritten,
}: {
  view: CapacityModelView | null;
  error: string | null;
  onWritten: () => void;
}) {
  const { presenting } = usePresentationMode();
  if (view === null) {
    return (
      <p className="text-[11px]" data-testid="fleet-capacity-dial">
        Capacity-model dial: <UnknownValue reason={error ?? "not read yet"} />{" "}
        <span className="text-muted-foreground">
          {error ? presentedFailureReason(error, presenting) : "reading…"}
        </span>
      </p>
    );
  }
  const dial = view.dial;
  return (
    <div className="space-y-2" data-testid="fleet-capacity-dial">
      <p className="text-[11px]">
        Capacity-model dial:{" "}
        {dial === null ? (
          <>
            <UnknownValue
              reason={view.unknown_reason ?? "coord gave no reason"}
            />{" "}
            <span className="text-muted-foreground">
              {presenting
                ? FAILURE_SENTENCE_WITHHELD
                : (view.unknown_reason ?? "coord gave no reason")}
            </span>
          </>
        ) : (
          <>
            <span
              className="font-medium"
              data-testid="fleet-capacity-dial-mode"
            >
              {dial.mode}
            </span>
            <span className="text-muted-foreground">
              {dial.mode_source === "default"
                ? " (default: nothing stored)"
                : " (stored)"}
              {" · "}
              {dial.off_consumers.length === 0
                ? "no consumer switched off"
                : `switched off: ${dial.off_consumers.map(humanize).join(", ")}`}
              {" · "}
              {dial.permitted_consumers.length} of {dial.consumers.length}{" "}
              consumers may read the model
            </span>
            {dial.ignored_off_consumers.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · stored names this coord does not know:{" "}
                {dial.ignored_off_consumers.join(", ")}
              </span>
            )}
          </>
        )}
      </p>
      {dial !== null && (
        <OperatorOnly>
          {view.can_edit ? (
            <DialEditor dial={dial} onWritten={onWritten} />
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Only a tenant admin can change the dial.
            </p>
          )}
        </OperatorOnly>
      )}
    </div>
  );
}

export function FleetCapacitySection({
  capacity: read,
}: {
  /** The section's two reads (`useFleetCapacity`), owned by the page. */
  capacity: UseFleetCapacityResult;
}) {
  const { capacity, capacityError, fetchedAtMs, loading, dial, dialError } =
    read;
  const { presenting } = usePresentationMode();

  const devices = useMemo(
    () => (capacity?.state === "known" ? capacity.devices : []),
    [capacity]
  );
  const unknownMachines = devices.filter(
    (d) => d.unknownReasons.length > 0
  ).length;

  return (
    <>
      <SectionCaption
        id="dev-ops.capacity"
        sources={[{ source: DEVOPS_SOURCES.fleetCapacity, asOf: fetchedAtMs }]}
      />
      <CollapsiblePanel
        data-testid="fleet-capacity-section"
        storageKey="fleet:capacity"
        icon={<Gauge className="h-4 w-4" />}
        title="Capacity"
        contentClassName="space-y-3"
        summary={
          <>
            <Badge variant="outline" className="ml-2">
              {devices.length} machines
            </Badge>
            {unknownMachines > 0 && (
              <Badge
                variant="outline"
                className="ml-1"
                data-testid="fleet-capacity-unknown-badge"
              >
                {unknownMachines} with UNKNOWN values
              </Badge>
            )}
          </>
        }
        headerActions={
          <Button
            {...NAVIGATION_ONLY_PROPS}
            variant="ghost"
            size="sm"
            onClick={read.refresh}
            aria-label="Refresh capacity"
            data-testid="fleet-capacity-refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        }
      >
        {capacityError && (
          <p
            className="text-sm text-destructive"
            data-testid="fleet-capacity-error"
          >
            Capacity unavailable:{" "}
            {presentedFailureReason(capacityError, presenting)}.
            {capacity ? " Rows below are last-known, not current." : ""}
          </p>
        )}

        <p className="text-[11px]" data-testid="fleet-capacity-misplaced-share">
          Misplaced-wait share (7 days):{" "}
          <UnknownValue reason={MISPLACED_SHARE_UNKNOWN_REASON} />{" "}
          <span className="text-muted-foreground">
            {MISPLACED_SHARE_UNKNOWN_REASON}.
          </span>
        </p>

        {capacity?.state === "known" && (
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="fleet-capacity-plan-age"
          >
            Costs and reservations from the model
            {capacity.modelVersion !== null
              ? ` v${capacity.modelVersion}`
              : ""}{" "}
            plan computed {formatAge(capacity.planAgeSecs)}; free capacity
            recomputed from each machine&apos;s newest sample on every read.
          </p>
        )}

        <DialBlock view={dial} error={dialError} onWritten={read.refreshDial} />

        {loading && capacity === null ? (
          <Skeleton className="h-24 w-full" />
        ) : capacity === null ? null : capacity.state === "no_plan_yet" ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="fleet-capacity-no-plan"
          >
            No capacity plan yet: {capacity.note}
          </p>
        ) : capacity.state === "unreadable" ? (
          <p className="text-sm" data-testid="fleet-capacity-unreadable">
            <UnknownValue reason={capacity.reason} />{" "}
            <span className="text-muted-foreground">{capacity.reason}.</span>
          </p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            coord&apos;s capacity plan lists no machines for this tenant.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead>Machine</TableHead>
                  <TableHead>Free CPU</TableHead>
                  <TableHead>Free RAM</TableHead>
                  <TableHead>Sample age</TableHead>
                  <TableHead>Binds sessions</TableHead>
                  <TableHead>Slots per class</TableHead>
                  <TableHead>UNKNOWN and parity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <DeviceRow key={d.deviceId} device={d} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CollapsiblePanel>
    </>
  );
}

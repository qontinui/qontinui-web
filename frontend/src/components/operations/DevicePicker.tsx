"use client";

/**
 * DevicePicker — choose one coord device from the `useFleetHealth` roster.
 *
 * Extracted by plan `2026-09-13-drained-runner-never-reaches-idle` Phase 8
 * out of `SpawnModal`, which rendered its own `<Select>` over
 * `GET /operations/fleet/health`. `/admin/coord/runners` needs the same
 * choice, and a second hand-rolled copy is how the two would drift on the
 * one thing that matters in a picker: whether a `stale` machine reads
 * differently from a dead one (see {@link deviceStateLabel}).
 *
 * **Presentation only.** It does not fetch: the caller owns the roster read
 * and its failure states, because "the roster is empty" and "the roster could
 * not be read" have opposite remedies and only the caller knows which it has.
 *
 * **A value the roster does not name still renders.** Coord's roster is
 * capped (`row_cap.soft`) and the picker offers only {@link pickableDevices},
 * so a deep link (`?device=`) to a machine missing from it is a real
 * selection, not an invalid one. It is shown as its id with "not in the live
 * roster" beside it rather than as a blank trigger, which would read as
 * "nothing is selected" while every read on the page is keyed on it.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FleetHealthDevice } from "@/lib/api/operations/coordFleet";
import { isCiRunnerDevice } from "./useFleetHealth";

/**
 * How one device's coord state reads in the picker.
 *
 * The verdict alone is not enough here. `stale` is coord's derived overlay —
 * the heartbeat is fine and the resource SAMPLER has gone quiet — so a `stale`
 * machine is reachable and perfectly usable, while `partitioned` and
 * `abandoned` mean coord cannot reach the box at all. Rendered as bare
 * `(stale)` beside a bare `(partitioned)` in the same muted grey, an operator
 * cannot tell the usable one from the dead one.
 *
 * coord ships `heartbeat_state` for exactly this: the persisted ladder state
 * underneath the overlay, so the overlay loses nothing. When it disagrees
 * with the verdict, both are shown.
 *
 * Deliberately NOT special-cased on the string `"stale"`: any future derived
 * overlay coord adds gets the same treatment, and a build that has never
 * heard of it still renders both halves truthfully. An absent
 * `heartbeat_state` (a coord predating the field) falls through to the
 * verdict alone rather than inventing agreement.
 *
 * Returns `""` when there is no verdict to qualify: `heartbeat_state`
 * explains a verdict and cannot stand in for a missing one, and an absent
 * state is `unknown` — a judgement this label does not own.
 */
export function deviceStateLabel(d: FleetHealthDevice): string {
  if (!d.state) return "";
  if (!d.heartbeat_state || d.heartbeat_state === d.state) return d.state;
  return `${d.state}, heartbeat ${d.heartbeat_state}`;
}

/** Coord serves canonical lowercase UUIDs; a typed or linked id may not be. */
export function normalizeDeviceId(id: string): string {
  return id.trim().toLowerCase();
}

/** The roster row for `deviceId`, or `undefined` when the roster omits it. */
export function findRosterDevice(
  devices: ReadonlyArray<FleetHealthDevice>,
  deviceId: string
): FleetHealthDevice | undefined {
  const wanted = normalizeDeviceId(deviceId);
  if (wanted === "") return undefined;
  return devices.find((d) => normalizeDeviceId(d.device_id) === wanted);
}

/** What the picker offers, and what it left out (so it can say so). */
export interface PickableDevices {
  shown: FleetHealthDevice[];
  /** Rows coord serves for a GitHub Actions CI runner registration. */
  hiddenCiRunners: number;
}

/**
 * The roster rows a person can pick: every Qontinui runner machine.
 *
 * Coord's fleet roster also carries one row per GitHub Actions runner
 * registration. None of them is a Qontinui runner: none can be drained,
 * spawned on, or asked for restart readiness. So both pickers
 * (`/admin/coord/runners`, `SpawnModal`) leave out every CI row
 * ({@link isCiRunnerDevice}) and say how many they left out.
 *
 * An `abandoned` machine IS offered. `abandoned` means coord has not heard
 * from the machine's runner for the full dwell; the machine still exists and
 * is one an operator looks for by name, so hiding it reads as "this machine
 * was never part of the fleet". It is listed after the reachable machines,
 * with its state beside it ({@link deviceStateLabel}). Coord itself retires
 * rows left unseen past its reaper grace period and stops serving them, so a
 * row that is served is one coord still counts.
 *
 * This leans on coord serving `ci_runner_status`: a coord predating that
 * field reads every row as a machine, and its abandoned one-job CI rows would
 * be offered too. The production coord serves it (measured 2026-11-10: 262 of
 * 271 roster rows carried it, and the other 9 were the tenant's machines).
 *
 * Callers still look a deep-linked id up in the FULL roster
 * ({@link findRosterDevice}). This only decides what is offered.
 */
export function pickableDevices(
  devices: ReadonlyArray<FleetHealthDevice>
): PickableDevices {
  const reachable: FleetHealthDevice[] = [];
  const abandoned: FleetHealthDevice[] = [];
  let hiddenCiRunners = 0;
  for (const d of devices) {
    if (isCiRunnerDevice(d)) hiddenCiRunners += 1;
    else if (d.state === "abandoned") abandoned.push(d);
    else reachable.push(d);
  }
  return { shown: [...reachable, ...abandoned], hiddenCiRunners };
}

/** "3 CI runner registrations hidden", or null. */
export function hiddenDevicesNote(p: PickableDevices): string | null {
  if (p.hiddenCiRunners === 0) return null;
  return `${p.hiddenCiRunners} CI runner registration${p.hiddenCiRunners === 1 ? "" : "s"} hidden`;
}

export interface DevicePickerProps {
  devices: ReadonlyArray<FleetHealthDevice>;
  /** The selected coord device id, or `""` for none. */
  value: string;
  onChange: (deviceId: string) => void;
  /** The trigger's id, so a `<Label htmlFor>` can name it. */
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  /** Put on the trigger — the element a test or spec clicks. */
  "data-testid"?: string;
}

export function DevicePicker({
  devices,
  value,
  onChange,
  id,
  placeholder = "Choose a device",
  disabled,
  "aria-describedby": describedBy,
  "data-testid": testId,
}: DevicePickerProps) {
  const pickable = pickableDevices(devices);
  const note = hiddenDevicesNote(pickable);
  const selectedRow = findRosterDevice(devices, value);
  const unlisted = value !== "" && selectedRow === undefined;
  // A deep link may select a row the picker would not offer. Still render
  // it, or the trigger reads blank as if nothing were selected.
  const selectedHidden =
    selectedRow !== undefined && !pickable.shown.includes(selectedRow)
      ? selectedRow
      : undefined;
  const noteId = note && id ? `${id}-hidden-note` : undefined;
  const describedByIds =
    [describedBy, noteId].filter(Boolean).join(" ") || undefined;
  const offered = selectedHidden
    ? [selectedHidden, ...pickable.shown]
    : pickable.shown;
  return (
    <>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          data-testid={testId}
          aria-describedby={describedByIds}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {unlisted && (
            <SelectItem value={value}>
              <span className="font-mono text-xs">{value}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                (not in the live roster)
              </span>
            </SelectItem>
          )}
          {offered.map((d) => (
            <SelectItem key={d.device_id} value={d.device_id}>
              <span className="font-mono text-xs">
                {d.hostname || d.device_id}
              </span>
              {d.state && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({deviceStateLabel(d)})
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {note && (
        <p
          id={noteId}
          className="text-xs text-muted-foreground"
          data-testid="device-picker-hidden-note"
        >
          {note}
        </p>
      )}
    </>
  );
}

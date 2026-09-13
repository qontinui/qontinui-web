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
 * **A value the roster does not name still renders.** Coord lists a device
 * only while it is bound to the tenant AND inside the liveness window, so a
 * deep link (`?device=`) to a machine that has just gone quiet is a real
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
import type { FleetHealthDevice } from "./useFleetHealth";

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
  const unlisted = value !== "" && findRosterDevice(devices, value) === undefined;
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        data-testid={testId}
        aria-describedby={describedBy}
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
        {devices.map((d) => (
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
  );
}

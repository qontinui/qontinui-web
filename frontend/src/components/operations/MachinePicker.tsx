"use client";

/**
 * MachinePicker — choose one MACHINE from coord's `GET /fleet/machines`.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place` §D7.
 * A machine is a workstation runner device plus the GitHub runner names
 * declared to be the same box; a GitHub runner name no machine claims is
 * listed as a machine of its own (`ci:<host>`), so it can still be paused.
 * That is why this is not `DevicePicker`: the unit here is the physical box,
 * not a coord device row.
 *
 * **Presentation only.** It does not fetch — the caller owns the read and its
 * failure states ("no machines" and "the list could not be read" have
 * opposite remedies).
 *
 * **Identity is coord's, never the alias.** Each option shows coord's own
 * hostname and the device id; the operator-settable display name is exactly
 * the string that must not decide which box gets paused.
 *
 * **A value the list does not name still renders**, as its raw key with "not
 * in coord's machine list" beside it: a `?machine=` deep link to a device
 * that has just gone quiet is a real selection, and a blank trigger would
 * read as "nothing selected" while the page is keyed on it.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  machineEntryLabel,
  machineEntryBadge,
  type MachineEntry,
} from "./maintenanceWindow";
import { resolveDeviceDrain, type FleetDrainRead } from "./fleetDrain";

export interface MachinePickerProps {
  entries: ReadonlyArray<MachineEntry>;
  /** The selected `?machine=` value — a device id or `ci:<host>` — or `""`. */
  value: string;
  onChange: (key: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "data-testid"?: string;
  /** Coord's raw drain read, so a drain outside any window marks its entry. */
  drain?: FleetDrainRead;
  /**
   * The machines read's last refresh error while its list is kept, so the
   * picker reads a stale "no window" as UNKNOWN exactly like the card.
   */
  refreshError?: string | null;
}

export function MachinePicker({
  entries,
  value,
  onChange,
  id,
  placeholder = "Choose a machine",
  disabled,
  "aria-describedby": describedBy,
  "data-testid": testId,
  drain,
  refreshError,
}: MachinePickerProps) {
  const unlisted = value !== "" && !entries.some((e) => e.key === value);
  const now = Date.now();
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
            <span className="font-mono text-xs break-all">{value}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              (not in coord&apos;s machine list)
            </span>
          </SelectItem>
        )}
        {entries.map((e) => {
          const { primary, secondary } = machineEntryLabel(e);
          return (
            <SelectItem
              key={e.key}
              value={e.key}
              data-testid="coord-maintenance-machine-option"
            >
              <span className="font-mono text-xs">{primary}</span>
              <span className="ml-2 font-mono text-[11px] text-muted-foreground break-all">
                {secondary}
              </span>
              {e.kind === "machine" && e.state && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({e.state})
                </span>
              )}
              {(() => {
                // The same badge the Dev Ops card shows: an unreadable window
                // is "maintenance UNKNOWN", a partial pause says so.
                const badge = machineEntryBadge(
                  e,
                  now,
                  e.kind === "machine" && drain
                    ? resolveDeviceDrain(drain, e.deviceId, now)
                    : null,
                  refreshError ?? null
                );
                return badge.state === "in_service" ? null : (
                  <span
                    className="ml-2 text-xs text-muted-foreground"
                    data-maintenance-state={badge.state}
                  >
                    · {badge.label}
                  </span>
                );
              })()}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

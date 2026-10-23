/**
 * How the operator audit feed reads in presentation mode — pure, and tested
 * (plan `2026-10-23-console-presentation-spaces` Phase 7, D3.3).
 *
 * An audit row's resource key, actor, reason and blast-radius values are all
 * identifiers or free text: a device id, an operator's id, a repository, a
 * tenant id, a sentence an operator typed. In front of an outsider the feed
 * says WHAT happened and WHEN, in a fixed vocabulary, and names a machine only
 * by its alias. This module makes the two decisions the panel needs:
 *
 * - **which rows are about a machine** — a resource key or a promoted
 *   `metadata.device_id` that is one of the fleet's device ids, or a resource
 *   kind that names devices; the panel then renders the machine's alias. An
 *   actor that is one of the fleet's devices is aliased the same way. A key
 *   that is NOT recognised as a machine is never guessed at: it goes through
 *   `RedactedText`, which withholds it unless it is provably first-party.
 * - **the descriptor's words** — the resource kind and the action family in
 *   the reader's words, from fixed tables, never from the row's own text.
 */

import type { MachineIdentity } from "@/components/presentation";
import type { FleetDeviceRef } from "./fleetResources";
import type { AuditRow } from "./operatorAudit";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The fleet's devices by lower-cased device id. */
export function indexDevices(
  devices: readonly FleetDeviceRef[]
): Map<string, FleetDeviceRef> {
  const byId = new Map<string, FleetDeviceRef>();
  for (const d of devices) byId.set(d.device_id.trim().toLowerCase(), d);
  return byId;
}

function identityOf(
  id: string,
  byId: Map<string, FleetDeviceRef>
): MachineIdentity | null {
  const device = byId.get(id.trim().toLowerCase());
  return device
    ? { deviceId: device.device_id, hostname: device.hostname }
    : null;
}

/** A resource kind that names a device row (`coord.devices`, `device`, …). */
const DEVICE_KIND = /(^|[._])devices?([._]|$)/i;

/**
 * The machine a row's RESOURCE is, when it is one — else `null`, and the
 * panel redacts the key instead.
 */
export function auditResourceMachine(
  row: AuditRow,
  byId: Map<string, FleetDeviceRef>
): MachineIdentity | null {
  const meta = asRecord(row.metadata);
  const promoted =
    typeof meta?.["device_id"] === "string" ? meta["device_id"] : null;
  for (const candidate of [row.resource_key, promoted]) {
    if (!candidate) continue;
    const known = identityOf(candidate, byId);
    if (known) return known;
  }
  if (
    row.resource_key &&
    row.resource_kind &&
    DEVICE_KIND.test(row.resource_kind)
  ) {
    // A device this page's list does not carry: still a machine, aliased by
    // its id alone rather than shown.
    return { deviceId: row.resource_key };
  }
  return null;
}

/** The machine a row's ACTOR is, when the actor is one of the fleet's devices. */
export function auditActorMachine(
  row: AuditRow,
  byId: Map<string, FleetDeviceRef>
): MachineIdentity | null {
  return row.operator_id ? identityOf(row.operator_id, byId) : null;
}

/** Resource kinds in the reader's words. Anything else is "a resource". */
const RESOURCE_KIND_WORD: Record<string, string> = {
  "coord.fleet_runtime_policy": "Fleet setting",
  "coord.fleet_policy": "Fleet setting",
  "coord.pr_events": "Pull request",
  "coord.prs": "Pull request",
  "http.route": "Access check",
};

/** The descriptor's `kind`: what the row's resource is, in fixed words. */
export function auditResourceKindWord(kind: string | null): string {
  if (!kind) return "Resource";
  if (DEVICE_KIND.test(kind)) return "Machine";
  return RESOURCE_KIND_WORD[kind] ?? "Resource";
}

/** Action families in the reader's words, most specific first. */
const ACTION_AREA: ReadonlyArray<readonly [prefix: string, word: string]> = [
  ["fleet_policy.", "fleet policy"],
  ["fleet.", "fleet"],
  ["pr_merge.", "merge train"],
];

/** The descriptor's `area`: the action's family, or `null` when unrecognised. */
export function auditAreaWord(action: string): string | null {
  for (const [prefix, word] of ACTION_AREA) {
    if (action.startsWith(prefix)) return word;
  }
  return null;
}

/** How many entries a promoted list key holds, read off the raw metadata. */
export function auditListCount(row: AuditRow, key: string): number | null {
  const value = asRecord(row.metadata)?.[key];
  return Array.isArray(value) ? value.length : null;
}

/** A promoted list key's entries as strings, read off the raw metadata. */
export function auditListValues(row: AuditRow, key: string): string[] {
  const value = asRecord(row.metadata)?.[key];
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

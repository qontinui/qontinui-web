/**
 * The soft, nullable join between a Dev Ops machine row and the devenv machine
 * record whose CI capacity `CiNodeConfigPanel` edits — plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 2.
 *
 * ## Why a join module exists at all
 *
 * The two surfaces are keyed on different things and neither key is derivable
 * from the other:
 *
 * | Surface | Key |
 * |---|---|
 * | Dev Ops machine rows (`/operations/fleet/health`, `/fleet/resource-samples`) | `coord.devices.device_id` |
 * | `CiNodeConfigPanel` (`GET`/`PUT /machines/{id}/ci-node`) | `devenv_machines.id` |
 *
 * The only bridge is `Machine.coord_device_id`, which `devenv-api.ts`
 * documents as a **soft pointer** — set at agent enroll or by the
 * unambiguous-hostname backfill, optional, and omitted entirely by older
 * backends. So the join can fail, and every way it can fail is a different
 * fact that has to be SAID rather than rendered as an absent control:
 *
 * * `no_machine` — coord knows this device; no devenv machine record points at
 *   it. The row says so and links to Environments. Never a disabled toggle:
 *   a disabled toggle reads as "CI is off here", which is a claim about the
 *   machine rather than about the join.
 * * `no_device` — this row reached the list through the runner inventory and
 *   coord's device read carries no row for it, so there is no `device_id` to
 *   match a machine record against.
 * * `ambiguous` — two machine records name the same coord device. Rendering
 *   one of them would silently offer to write CI settings for a machine the
 *   reader did not choose, so this state offers no panel at all.
 * * `unknown` — the machine read has not answered (yet, or at all). An
 *   unanswered read is not an empty tenant
 *   (`[policy: silent-empty-is-unknown]`).
 *
 * ## The direction this join CANNOT see
 *
 * A devenv machine with no `coord_device_id` produces no Dev Ops row at all —
 * this page's rows come from coord's device list, and such a machine is in
 * neither read that builds it. That is the honest consequence of keying on
 * coord devices, and the Dev Ops page states it once, in prose, rather than
 * leaving the reader to notice a machine missing.
 *
 * Deliberately NOT done here: a fallback join on hostname. The backend already
 * runs an *unambiguous-hostname backfill* into `coord_device_id`; a second,
 * client-side hostname match would be a different join with different
 * ambiguity rules, reachable only from this page, and it would write CI
 * settings on the strength of it.
 */

import type { Machine } from "@/services/devenv-api";

/**
 * The devenv machine roster, as far as this page got.
 *
 * `loading` and `unavailable` are separate from an empty `ok` on purpose: a
 * read that has not answered says nothing about how many machines exist.
 */
export type DevenvMachinesRead =
  | { state: "loading" }
  | { state: "ok"; byCoordDevice: Map<string, Machine[]> }
  | { state: "unavailable"; reason: string };

/** One machine row's resolved CI-capacity join. */
export type CiCapacityJoin =
  /** Exactly one devenv machine names this coord device. */
  | { state: "linked"; machine: Machine }
  /** More than one does — no panel, because picking one would be a guess. */
  | { state: "ambiguous"; deviceId: string; machines: Machine[] }
  /** The read answered and no machine record names this coord device. */
  | { state: "no_machine"; deviceId: string }
  /** This row carries no coord `device_id`, so there is nothing to join on. */
  | { state: "no_device" }
  /** The machine read did not answer. Not "there are none". */
  | { state: "unknown"; reason: string };

/**
 * Index a machine roster by its `coord_device_id`.
 *
 * Values are ARRAYS because nothing guarantees the pointer is unique: it is a
 * nullable column two writers populate, not a foreign key with a unique
 * constraint. Collapsing duplicates to "the first one" here would move the
 * ambiguity out of sight of the reader who has to resolve it.
 */
export function indexMachinesByCoordDevice(
  machines: Machine[]
): Map<string, Machine[]> {
  const byDevice = new Map<string, Machine[]>();
  for (const machine of machines) {
    const deviceId = machine.coord_device_id;
    if (!deviceId) continue;
    const bucket = byDevice.get(deviceId);
    if (bucket) {
      bucket.push(machine);
    } else {
      byDevice.set(deviceId, [machine]);
    }
  }
  return byDevice;
}

/**
 * Resolve one row's join.
 *
 * `deviceId` absent short-circuits BEFORE the read state is consulted: with no
 * device id there is nothing to look up, so the read's health is irrelevant
 * and reporting it would be a non-sequitur.
 */
export function resolveCiCapacity(
  read: DevenvMachinesRead,
  deviceId: string | undefined
): CiCapacityJoin {
  if (!deviceId) return { state: "no_device" };
  if (read.state === "loading") {
    return {
      state: "unknown",
      reason: "The machine records for this tenant are still being read.",
    };
  }
  if (read.state === "unavailable") {
    return { state: "unknown", reason: read.reason };
  }
  const matches = read.byCoordDevice.get(deviceId) ?? [];
  const only = matches[0];
  if (matches.length === 1 && only) return { state: "linked", machine: only };
  if (matches.length > 1) {
    return { state: "ambiguous", deviceId, machines: matches };
  }
  return { state: "no_machine", deviceId };
}

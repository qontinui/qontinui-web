/**
 * spawnAdmission — what coord's spawn admission states, read for
 * `/admin/coord/spawns` from `GET /coord/fleet/spawn-admission`: how many
 * coord-dispatched allocations each machine carries, the ceilings it is held to,
 * how many holds coord recorded and why, and the admission-stall knob as coord
 * resolves it. Pure; every arm is unit-tested (`spawnAdmission.test.ts`).
 *
 * ## An unreadable figure is UNKNOWN, on its own
 *
 * Coord answers 200 with each figure null and its reason beside it, so one
 * failed count does not take the ceilings or the knob with it. A count that
 * is malformed is not dropped: a dropped row would read as a machine carrying
 * nothing, so the whole per-machine map is UNKNOWN instead.
 *
 * ## A machine coord's map does not list carries none
 *
 * Coord builds `counts.device_inflight` from every device holding a
 * coord-dispatched worktree in a status its count can include, when this tenant
 * owns that worktree or is bound to that device (`read_tenant_surface_counts`,
 * `spawn_admission.rs`). So once that map was read, a machine of this tenant
 * missing from it holds no row the count could see, under any tenant, and 0 is
 * coord's own answer rather than a default. That rests on the roster reaching
 * a machine through the same binding (`device_state.rs`): a roster arm the map
 * lacks would make the zero false. A listed count is the DEVICE's across
 * tenants, because that is what its ceiling grades; the total is this tenant's
 * alone, so the cells need not sum to it.
 */

/** The ceiling keys coord's surface uses (`spawn_admission.rs`, `ENV_MAX_*`). */
export const CEILING_PER_DEVICE_KEY =
  "COORD_AUTODISPATCH_MAX_INFLIGHT_PER_DEVICE";
export const CEILING_PER_TENANT_KEY =
  "COORD_AUTODISPATCH_MAX_INFLIGHT_PER_TENANT";

export interface SpawnAdmissionFacts {
  /** In flight per device, keyed by lowercased device id; `null` when unknown. */
  deviceInflight: Readonly<Record<string, number>> | null;
  tenantInflight: number | null;
  countsUnknownReason: string | null;
  ceilingPerDevice: number | null;
  ceilingPerTenant: number | null;
  /** Holds recorded in the last 24 hours (records, not spawns), by coord's reason key. */
  heldByReason: Readonly<Record<string, number>> | null;
  heldUnknownReason: string | null;
  /** The admission-stall knob as coord resolves it; `null` when unknown. */
  stallKnob: boolean | null;
  stallKnobUnknownReason: string | null;
}

export type SpawnAdmissionRead =
  | { state: "loading" }
  | { state: "unknown"; reason: string }
  /** `staleReason` is set when these are the last good facts: a refresh failed. */
  | { state: "known"; facts: SpawnAdmissionFacts; staleReason: string | null };

const NO_REASON = "coord did not say why";

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reasonOf(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : NO_REASON;
}

/** Every value a count, or `null`: one bad entry makes the map unusable. */
function countMap(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(value)) {
    if (!isCount(n)) return null;
    out[key] = n;
  }
  return out;
}

function lowercasedKeys(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(map).map(([key, n]) => [key.trim().toLowerCase(), n])
  );
}

/** Whether any figure was actually read: what entitles a read to a date. */
export function admissionFigureRead(facts: SpawnAdmissionFacts): boolean {
  return (
    facts.deviceInflight !== null ||
    facts.heldByReason !== null ||
    facts.stallKnob !== null
  );
}

export function parseSpawnAdmission(
  body: unknown
): Extract<SpawnAdmissionRead, { state: "known" | "unknown" }> {
  if (
    !isRecord(body) ||
    !["counts", "ceilings", "auto_fix_admission_stall"].some((k) => k in body)
  ) {
    return {
      state: "unknown",
      reason:
        "Coord's spawn admission read did not answer a body it recognises.",
    };
  }
  const counts = isRecord(body.counts) ? body.counts : null;
  const perDevice = counts ? countMap(counts.device_inflight) : null;
  const ceilings = isRecord(body.ceilings) ? body.ceilings : null;
  const perDeviceCeiling = ceilings?.[CEILING_PER_DEVICE_KEY];
  const perTenantCeiling = ceilings?.[CEILING_PER_TENANT_KEY];
  const held = countMap(body.shepherd_deferrals_24h_by_held_by);
  return {
    state: "known",
    staleReason: null,
    facts: {
      deviceInflight: perDevice ? lowercasedKeys(perDevice) : null,
      tenantInflight:
        counts && isCount(counts.tenant_inflight)
          ? counts.tenant_inflight
          : null,
      countsUnknownReason: perDevice
        ? null
        : counts
          ? "coord's per-machine counts were not a map of counts"
          : reasonOf(body.counts_unknown_reason),
      ceilingPerDevice: isCount(perDeviceCeiling) ? perDeviceCeiling : null,
      ceilingPerTenant: isCount(perTenantCeiling) ? perTenantCeiling : null,
      heldByReason: held,
      heldUnknownReason: held
        ? null
        : reasonOf(body.shepherd_deferrals_unknown_reason),
      stallKnob:
        typeof body.auto_fix_admission_stall === "boolean"
          ? body.auto_fix_admission_stall
          : null,
      stallKnobUnknownReason:
        typeof body.auto_fix_admission_stall === "boolean"
          ? null
          : reasonOf(body.auto_fix_admission_stall_unknown_reason),
    },
  };
}

/** What the matrix's stalled-train knob gate takes from this read. */
export interface StallKnobRead {
  value: boolean | null;
  /** Why `value` is `null`, in the operator's words. */
  reason: string;
  /** `value` is from the last good read. */
  stale: boolean;
}

export function stallKnobOf(read: SpawnAdmissionRead): StallKnobRead {
  switch (read.state) {
    case "loading":
      return {
        value: null,
        reason: "coord's spawn admission is still being read",
        stale: false,
      };
    case "unknown":
      return { value: null, reason: read.reason, stale: false };
    case "known":
      return {
        value: read.facts.stallKnob,
        reason: read.facts.stallKnobUnknownReason ?? NO_REASON,
        stale: read.staleReason !== null,
      };
  }
}

/** Coord's held-reason keys in words (`spawn_admission.rs`, `held_by`). */
const HELD_WORDS: Readonly<Record<string, string>> = {
  inflight_cap: "at the in-flight limit",
  rate_cap: "at the hourly limit",
  device_pressure: "machine under pressure",
  pressure_unknown: "machine pressure unreadable",
  count_unknown: "in-flight count unreadable",
  device_drained: "machine out of service",
  drain_unreadable: "drain state unreadable",
  role_closes_agent_lane: "machine's role takes no sessions",
  not_leader: "the service changed leader",
  publish_veto: "path switched off as it started",
  deferred_load: "machine refused it under load",
  claim_lost: "another session took the pull request",
  allocation_refused: "no worktree budget on the machine",
  no_admissible_device: "no machine could take it",
  author_grace: "waiting on the pull request's author",
  registry_unreadable: "agent registry unreadable",
  unspecified: "no reason recorded",
};

/** A held reason in words; a key this table does not know is not guessed at. */
export function heldReasonText(key: string, presenting: boolean): string {
  const words = Object.hasOwn(HELD_WORDS, key) ? HELD_WORDS[key] : undefined;
  return words ?? (presenting ? "another reason" : key);
}

/** The fixed sentence while presenting: never coord's own words. */
export const IN_FLIGHT_UNKNOWN_PRESENTED =
  "How much automated work this machine carries against its limit could not be read.";

/** The list's one note: what holds across the machines, and what is unknown. */
export function machineListNote(
  read: SpawnAdmissionRead,
  presenting: boolean
): { text: string; unknown: boolean } {
  if (read.state !== "known") {
    const why =
      read.state === "loading"
        ? "it is still being read"
        : presenting
          ? "it could not be read"
          : read.reason;
    return {
      text: `In flight against ceiling, and the reasons work was held: UNKNOWN — ${why}.`,
      unknown: true,
    };
  }
  const { facts, staleReason } = read;
  const parts: string[] = [];
  let unknown = staleReason !== null;
  const owner = presenting ? "project" : "tenant";

  if (facts.deviceInflight === null) {
    unknown = true;
    parts.push(
      `In flight against ceiling: UNKNOWN — ${presenting ? "it could not be read" : facts.countsUnknownReason}.`
    );
  } else if (facts.tenantInflight === null) {
    unknown = true;
    parts.push(
      `This ${owner}'s total across machines: UNKNOWN — it was not in the answer.`
    );
  } else {
    parts.push(
      facts.ceilingPerTenant !== null
        ? `This ${owner}, across machines: ${facts.tenantInflight} of ${facts.ceilingPerTenant} in flight.`
        : `This ${owner}, across machines: ${facts.tenantInflight} in flight.`
    );
  }

  if (facts.heldByReason === null) {
    unknown = true;
    parts.push(
      `Merge-shepherd holds recorded in the last 24 hours: UNKNOWN — ${presenting ? "it could not be read" : facts.heldUnknownReason}.`
    );
  } else {
    // Reasons merged by their words: two keys this table does not know read as
    // one "another reason" while presenting, not as the same words twice.
    const byWords = new Map<string, number>();
    for (const [key, n] of Object.entries(facts.heldByReason)) {
      if (n <= 0) continue;
      const words = heldReasonText(key, presenting);
      byWords.set(words, (byWords.get(words) ?? 0) + n);
    }
    const held = [...byWords].sort(
      ([ka, a], [kb, b]) => b - a || ka.localeCompare(kb)
    );
    // Coord's rows, not spawns: one held pull request can record repeatedly, and
    // a recorder failure records nothing.
    parts.push(
      held.length === 0
        ? "No merge-shepherd hold was recorded in the last 24 hours."
        : `Merge-shepherd holds recorded in the last 24 hours (records, not spawns: a held pull request can record again): ${held
            .map(([words, n]) => `${words} ${n}`)
            .join(", ")}.`
    );
  }

  if (staleReason !== null) {
    parts.push(
      presenting
        ? "These figures are from the last good read."
        : `These figures are from the last good read: ${staleReason}.`
    );
  }
  return { text: parts.join(" "), unknown };
}

/**
 * The Dev Ops Capacity panel's model (plan
 * `2026-11-05-one-free-resource-model-places-sessions-builds-and-ci`
 * Phase 11): coord's per-device capacity read, parsed field by field.
 *
 * The wire is coord's `GET /coord/fleet/capacity/operator`
 * (`fleet_placement::capacity_read`), passed through the operations proxy
 * verbatim. Every value that may be UNKNOWN arrives as
 * `{"state":"known","value":…}` or `{"state":"unknown","reason":…}` (coord's
 * `Known<T>`). This module keeps that distinction all the way to the render:
 * a field coord did not send, or sent in a shape this parser cannot read, is
 * UNKNOWN with a reason naming that — never `0`, never a default
 * [policy: verification-and-evidence unknown-must-not-render-as-a-default].
 *
 * PURE: no React, no I/O.
 */

import type {
  CapacityModelDial,
  CapacityModelView,
} from "@/lib/api/operations/coordFleet";

/** A value that may be UNKNOWN, with the reason it is. */
export type Known<T> =
  | { state: "known"; value: T }
  | { state: "unknown"; reason: string };

/** The work classes, in coord's D5 arbitration order (highest first). */
export const WORK_CLASSES = ["S", "C3", "C1", "C2", "B"] as const;
export type WorkClass = (typeof WORK_CLASSES)[number];

/** What each class is, in the operator's words (coord `costs::WorkClass`). */
export const WORK_CLASS_LABEL: Record<WorkClass, string> = {
  S: "Sessions",
  C3: "Session verification builds",
  C1: "Merge-candidate CI",
  C2: "PR and main-push CI",
  B: "Background builds",
};

/** Where a class's cost came from (coord's `CostBasis`, D3's fallback order). */
export type UsageBasis = "device_p90" | "fleet_p90" | "seed";

export const USAGE_BASIS_LABEL: Record<UsageBasis, string> = {
  device_p90: "this machine's p90",
  fleet_p90: "fleet p90",
  seed: "seed",
};

/** One class's slot count and what decided it. */
export interface ClassSlots {
  slots: Known<number>;
  /** The resource or check that set the count (coord `Binding`); `null` = none named. */
  binding: string | null;
  /** The CPU and memory cost bases, or UNKNOWN when coord sent no cost. */
  cpuBasis: UsageBasis | null;
  memBasis: UsageBasis | null;
}

/** One legacy decider's answer beside the model (coord `parity::ParityRow`). */
export interface ParityRow {
  row: number;
  decider: string;
  /** `known` | `unknown` | `not_on_main` | `runner_local`, or `unreadable`. */
  state: string;
  /** The answer, as a short line: the value, the reason, or the detail. */
  text: string;
}

export interface CapacityDevice {
  deviceId: string;
  machineKey: string;
  label: string;
  /** Seconds since the runner sample the row was computed from; `null` = no sample. */
  sampleAgeSecs: number | null;
  freeCpuCores: Known<number>;
  freeMemBytes: Known<number>;
  /** The binding resource for sessions (class S), the panel's headline. */
  sessionBinding: string | null;
  /** The box-level condition under which it takes no new session, if any. */
  sessionGate: string | null;
  classes: Record<WorkClass, ClassSlots>;
  /** Every reason coord gave for an UNKNOWN on this row. */
  unknownReasons: string[];
  parity: ParityRow[] | null;
}

export type FleetCapacityRead =
  | {
      state: "known";
      modelVersion: number | null;
      /** Age of the stored plan row (costs, reservations), seconds. */
      planAgeSecs: number | null;
      cacheAgeSecs: number | null;
      devices: CapacityDevice[];
    }
  | { state: "no_plan_yet"; note: string }
  | { state: "unreadable"; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Read one coord `Known<number>`. Anything else is UNKNOWN, with why. */
export function parseKnownNumber(raw: unknown, field: string): Known<number> {
  if (isObject(raw)) {
    if (raw.state === "known") {
      const value = finiteNumber(raw.value);
      if (value !== null) return { state: "known", value };
    } else if (raw.state === "unknown" && typeof raw.reason === "string") {
      return { state: "unknown", reason: raw.reason };
    }
  }
  return {
    state: "unknown",
    reason: `coord sent no readable ${field}`,
  };
}

function usageBasis(raw: unknown): UsageBasis | null {
  if (!isObject(raw)) return null;
  const b = raw.basis;
  return b === "device_p90" || b === "fleet_p90" || b === "seed" ? b : null;
}

function perClass(raw: unknown, cls: WorkClass): unknown {
  return isObject(raw) ? raw[cls] : undefined;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** A compact JSON line for a parity answer's free-form value. */
function compact(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? "null";
  } catch {
    return String(v);
  }
}

function parseParity(raw: unknown): ParityRow[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((entry, i): ParityRow => {
    const row = isObject(entry) ? finiteNumber(entry.row) : null;
    const decider =
      isObject(entry) && typeof entry.decider === "string"
        ? entry.decider
        : `row ${i + 1}`;
    const answer = isObject(entry) ? entry.answer : undefined;
    if (!isObject(answer) || typeof answer.state !== "string") {
      return {
        row: row ?? i + 1,
        decider,
        state: "unreadable",
        text: "coord sent no readable answer",
      };
    }
    let text: string;
    switch (answer.state) {
      case "known":
        text = compact(answer.value);
        break;
      case "unknown":
        text = stringOrNull(answer.reason) ?? "no reason given";
        break;
      case "runner_local":
        text = `${stringOrNull(answer.detail) ?? "decided in the runner"}; coord observes ${compact(answer.observed)}`;
        break;
      default:
        text = stringOrNull(answer.detail) ?? answer.state;
    }
    return { row: row ?? i + 1, decider, state: answer.state, text };
  });
}

function parseDevice(raw: unknown): CapacityDevice | null {
  if (!isObject(raw) || typeof raw.device_id !== "string") return null;
  const binding = isObject(raw.binding) ? raw.binding : {};
  // Coord calls a class's per-unit resource use its "costs" (cores and bytes,
  // never money); bound under a name that says what it is.
  const { costs: perUnitUsage } = raw;
  const classes = Object.fromEntries(
    WORK_CLASSES.map((cls): [WorkClass, ClassSlots] => {
      const usage = perClass(perUnitUsage, cls);
      return [
        cls,
        {
          slots: parseKnownNumber(
            perClass(raw.slots, cls),
            `${cls} slot count`
          ),
          binding: stringOrNull(binding[cls]),
          cpuBasis: isObject(usage) ? usageBasis(usage.cpu_cores) : null,
          memBasis: isObject(usage) ? usageBasis(usage.mem_bytes) : null,
        },
      ];
    })
  ) as Record<WorkClass, ClassSlots>;
  return {
    deviceId: raw.device_id,
    machineKey: stringOrNull(raw.machine_key) ?? raw.device_id,
    label:
      stringOrNull(raw.label) ?? stringOrNull(raw.machine_key) ?? raw.device_id,
    sampleAgeSecs: finiteNumber(raw.sample_age_s),
    freeCpuCores: parseKnownNumber(raw.free_cpu_cores, "free CPU"),
    freeMemBytes: parseKnownNumber(raw.free_mem_bytes, "free memory"),
    sessionBinding: classes.S.binding,
    sessionGate: stringOrNull(raw.session_gate),
    classes,
    unknownReasons: Array.isArray(raw.unknown_reason)
      ? raw.unknown_reason.filter((r): r is string => typeof r === "string")
      : [],
    parity: parseParity(raw.parity),
  };
}

/**
 * Parse coord's capacity body. A body with no `state` this panel knows is
 * `unreadable`, never an empty fleet; `no_plan_yet` is coord's own statement
 * that the 300 s worker has not written a model-v3 row for the tenant.
 */
export function parseFleetCapacity(body: unknown): FleetCapacityRead {
  if (!isObject(body)) {
    return {
      state: "unreadable",
      reason: "coord's capacity read was not a JSON object",
    };
  }
  if (body.state === "no_plan_yet") {
    return {
      state: "no_plan_yet",
      note:
        stringOrNull(body.note) ??
        "coord has not written a capacity plan for this tenant yet",
    };
  }
  if (body.state !== "known" || !Array.isArray(body.devices)) {
    return {
      state: "unreadable",
      reason:
        "coord's capacity read carried no device list this panel can read",
    };
  }
  const devices = body.devices
    .map(parseDevice)
    .filter((d): d is CapacityDevice => d !== null);
  const plan = isObject(body.plan) ? body.plan : {};
  return {
    state: "known",
    modelVersion: finiteNumber(body.model_version),
    planAgeSecs: finiteNumber(plan.age_secs),
    cacheAgeSecs: finiteNumber(body.cache_age_secs),
    devices,
  };
}

/** Cores to one decimal, with the unit. */
export function formatCores(cores: number): string {
  return `${cores.toFixed(1)} cores`;
}

/**
 * Bytes as GiB (one decimal) with the unit. Negative free memory is real —
 * coord serves free memory net of the memory floor — and keeps its sign.
 */
export function formatGib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/** A binding or gate name in words (`memory_pressure` → `memory pressure`). */
export function humanize(name: string): string {
  return name.replace(/_/g, " ");
}

/** Parity rows tallied by answer state, for the one-line summary. */
export function parityTally(rows: ParityRow[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const r of rows) tally[r.state] = (tally[r.state] ?? 0) + 1;
  return tally;
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
}

/**
 * Check the proxy's dial body. Anything this cannot read whole is an UNKNOWN
 * dial with a reason — never `enforce`, which D9 forbids an unread dial to
 * resolve to — and offers no editor (`can_edit: false`).
 */
export function parseCapacityModelView(body: unknown): CapacityModelView {
  const unreadable = (reason: string): CapacityModelView => ({
    dial: null,
    unknown_reason: reason,
    can_edit: false,
  });
  if (!isObject(body)) return unreadable("the dial read was not a JSON object");
  const canEdit = body.can_edit === true;
  if (body.dial === null) {
    return {
      dial: null,
      unknown_reason: stringOrNull(body.unknown_reason) ?? "no reason given",
      can_edit: canEdit,
    };
  }
  const d = body.dial;
  if (!isObject(d)) return unreadable("the dial read carried no dial");
  const off = stringList(d.off_consumers);
  const ignored = stringList(d.ignored_off_consumers);
  const permitted = stringList(d.permitted_consumers);
  const consumers = stringList(d.consumers);
  if (
    (d.mode !== "off" && d.mode !== "enforce") ||
    (d.mode_source !== "default" && d.mode_source !== "stored") ||
    !off ||
    !ignored ||
    !permitted ||
    !consumers
  ) {
    return unreadable("the dial read was not in a shape this page can read");
  }
  const dial: CapacityModelDial = {
    mode: d.mode,
    mode_source: d.mode_source,
    off_consumers: off,
    ignored_off_consumers: ignored,
    permitted_consumers: permitted,
    consumers,
  };
  return { dial, unknown_reason: null, can_edit: canEdit };
}

/**
 * Why the misplaced-wait share is UNKNOWN. Coord serves no such figure yet:
 * the plan's named query `capacity_misplaced_share_7d` (its "Done when"
 * claim `ops-decide-capacity-misplaced-wait-share-under-5pct`) is still a
 * `none` anchor. The panel says so instead of showing a share.
 */
export const MISPLACED_SHARE_UNKNOWN_REASON =
  "coord does not serve the misplaced-wait share yet (named query capacity_misplaced_share_7d is pending)";

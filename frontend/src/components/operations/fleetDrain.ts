/**
 * Machine drain — the READ: the wire contract, its parse, and one device's
 * resolution, plus the deadline presets the maintenance-window form shares.
 *
 * Plan `2026-09-01-device-drain-does-not-reach-agent-session-spawning` Phase
 * 4b, narrowed by plan
 * `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place` Phase 7:
 * the console no longer WRITES drains. A machine is paused by opening a
 * maintenance window, which coord composes from a lane drain, a `drain-host`
 * and the GitHub label change (§D3) — so the per-row Drain/Undrain control and
 * its target/validation helpers were deleted with the Runner Drain page. What
 * stays is the read: a drain set outside any window (an agent's
 * `coord_fleet_drain`, say) is still a real fact, and the Machine Maintenance
 * page's agent strip shows it.
 *
 * ## What a drain is
 *
 * `POST /coord/fleet/drain` stops coord sending a machine NEW work on the
 * lanes it names — `agent` (agent-session spawns and continuations) and/or
 * `ci` (coord's CI-node dispatch, builds and merge capacity); a row with no
 * lanes holds both. It is the one deliberate HARD filter in a ladder that
 * otherwise only deprioritises, and it carries a **mandatory expiry**. It does
 * **not** stop work already running on the machine, and it does not stop
 * GitHub routing jobs to a self-hosted runner by label.
 *
 * ## Unknown is never "not drained"
 *
 * `[policy: verification-and-evidence unknown-must-not-render-as-a-default]`.
 * A read that did not answer, a route that 404s, a body in a shape this build
 * does not recognise, and an entry whose `until` will not parse are all
 * UNKNOWN for the devices they concern. None of them is evidence that a
 * machine is taking work, and this module has no path that turns one into
 * `not_drained`.
 */

/**
 * One entry from coord's drain map, as this UI holds it.
 *
 * Coord's `DrainEntry` (`fleet_drain.rs`) has all four fields non-optional, so
 * a well-formed entry populates all four. Three are typed nullable here
 * anyway, because a field this build did not find must render as "not
 * recorded" rather than as an invented value — and because `drained_by` is
 * subject to coord's `REDACTED_ACTOR` substitution for principals that may not
 * see operator identities, which is a real string (`[redacted]`) and not an
 * absence. `until` is the exception: an entry without a parseable deadline is
 * not an entry at all, and is reported as an unreadable DEVICE instead.
 */
export interface DrainEntry {
  /** RFC 3339, verbatim from coord. Parseable by construction — see the parse. */
  until: string;
  /** Coord requires it non-blank on the write; `null` if this read lost it. */
  reason: string | null;
  /** The operator's email, or coord's `[redacted]` placeholder. */
  drainedBy: string | null;
  /** RFC 3339. */
  drainedAt: string | null;
  /**
   * The drain LANES held (plan
   * `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place` §D3):
   * `agent` = agent-session spawns and continuations, `ci` = coord's CI-node
   * lane, builds and merge capacity. `null` means coord sent none — a legacy
   * row, which coord reads as BOTH lanes, so it is rendered as both.
   */
  lanes: DrainLane[] | null;
}

/** One drain lane. */
export type DrainLane = "agent" | "ci";

/**
 * The fleet-wide drain read, as far as this page got.
 *
 * `unknown` is a first-class arm rather than an empty `ok`, for the reason the
 * module doc gives: coord's own `DrainSet` keeps `Known(vec![])` and `Unknown`
 * apart, and flattening them here would undo that at the last hop.
 */
export type FleetDrainRead =
  | { state: "loading" }
  | {
      state: "ok";
      /** device_id (lower-cased) -> entry. Only ACTIVE drains appear. */
      entries: Map<string, DrainEntry>;
      /**
       * Devices coord named in the map whose entry this build could not read.
       * They are UNKNOWN individually — the rest of the read is still good,
       * so one malformed entry does not blind the whole page.
       */
      unreadableDevices: Set<string>;
    }
  | { state: "unknown"; reason: string };

/** One device row's drain state. */
export type DeviceDrainState =
  /** Coord holds an ACTIVE drain for this device. */
  | { state: "drained"; entry: DrainEntry }
  /**
   * The last drain we read has passed its `until` while this page held the
   * payload. Coord evaluates expiry on READ and has no sweeper, so this device
   * is taking work again — reported as its own state rather than folded into
   * `not_drained`, so "it expired" cannot be misread as "my undrain worked".
   */
  | { state: "expired"; entry: DrainEntry }
  /** The read answered and holds no active drain for this device. */
  | { state: "not_drained" }
  /** Nothing here is a claim that the device is taking work. */
  | { state: "unknown"; reason: string };

/** Coord's ceiling on a drain deadline (`fleet_drain::MAX_DRAIN_DAYS`). */
export const MAX_DRAIN_DAYS = 30;

/** Normalise a device id for map lookup. Coord serves canonical UUIDs. */
function normalizeDeviceId(id: string): string {
  return id.trim().toLowerCase();
}

/** A finite epoch for an RFC 3339 string, or `null` if it will not parse. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read one map value as a {@link DrainEntry}.
 *
 * Mirrors coord's `parse_drain_entry`: tolerant by row, strict by field. The
 * ONE strict field is `until` — without a parseable deadline there is nothing
 * to say about when this drain ends, and a drain whose end is unknown is not
 * something to render as a drain.
 */
export function parseDrainEntry(value: unknown): DrainEntry | null {
  if (!isRecord(value)) return null;
  const until = optionalString(value.until);
  if (until === null || parseTimestamp(until) === null) return null;
  return {
    until,
    reason: optionalString(value.reason),
    drainedBy: optionalString(value.drained_by),
    drainedAt: optionalString(value.drained_at),
    lanes: parseLanes(value.lanes),
  };
}

/**
 * Read an entry's `lanes`. Absent, or a list naming no lane this build knows,
 * is `null` — both lanes, coord's reading of a lane-less row — rather than an
 * empty set, which would claim the drain holds nothing.
 */
function parseLanes(value: unknown): DrainLane[] | null {
  if (!Array.isArray(value)) return null;
  const lanes = value.filter(
    (l): l is DrainLane => l === "agent" || l === "ci"
  );
  return lanes.length === 0 ? null : [...new Set(lanes)];
}

/**
 * The keys a container of drain entries may arrive under.
 *
 * Coord's read route is being added alongside this UI (plan Phase 4a) and is
 * specified only as *"the active drain entries with their `until`, `reason`,
 * `drained_by`, `drained_at`"*, reusing `DrainSet` so that unknown stays
 * distinguishable. So the parse accepts the small set of shapes that
 * specification admits, and treats everything else as UNKNOWN rather than as
 * an empty fleet — which is the only reading that is safe to be wrong about.
 */
const ENTRY_CONTAINER_KEYS = ["drained", "drains", "entries", "devices"];

/** Top-level keys that, set to a falsy/negative value, declare the read failed. */
const KNOWN_FLAG_KEYS = ["known", "readable", "ok"];

/** A key that looks like a device UUID — the bare-map shape's signature. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function collectEntries(
  container: unknown
): { entries: Map<string, DrainEntry>; unreadable: Set<string> } | null {
  const entries = new Map<string, DrainEntry>();
  const unreadable = new Set<string>();

  // Shape A — an object keyed by device id, which is how the column stores it.
  if (isRecord(container)) {
    for (const [key, value] of Object.entries(container)) {
      const deviceId = normalizeDeviceId(key);
      if (deviceId === "") continue;
      const entry = parseDrainEntry(value);
      if (entry) entries.set(deviceId, entry);
      else unreadable.add(deviceId);
    }
    return { entries, unreadable };
  }

  // Shape B — a list of entries that name their own device.
  if (Array.isArray(container)) {
    for (const row of container) {
      if (!isRecord(row)) continue;
      const rawId = optionalString(row.device_id) ?? optionalString(row.id);
      if (rawId === null) continue;
      const deviceId = normalizeDeviceId(rawId);
      const entry = parseDrainEntry(row);
      if (entry) entries.set(deviceId, entry);
      else unreadable.add(deviceId);
    }
    return { entries, unreadable };
  }

  return null;
}

/**
 * Parse `GET /coord/fleet/drain` (through the web proxy) into a read.
 *
 * The precedence is deliberate, and the first rule is the important one: an
 * EXPLICIT unknown from coord wins over any entry container that might sit
 * beside it. Coord's `DrainSet::Unknown` means "I could not determine the
 * drained set", and a body that says so while also carrying a stale or partial
 * map must not be read off the map.
 *
 * Everything this build does not recognise lands on `unknown` WITH a reason.
 * The one shape that must never be invented is the empty success: a body we
 * cannot read is not a fleet with nothing drained.
 */
export function parseFleetDrain(payload: unknown): FleetDrainRead {
  if (payload === null || payload === undefined) {
    return {
      state: "unknown",
      reason:
        "Coord's drain read returned an empty body, so no drain state could " +
        "be determined. This is not a claim that no machine is drained.",
    };
  }

  // Coord's bare `DrainSet` serialises its unit variant as the string
  // "Unknown"; a route that passes the enum through unwrapped lands here.
  if (typeof payload === "string") {
    if (payload.trim().toLowerCase() === "unknown") {
      return {
        state: "unknown",
        reason: "Coord reported that it could not determine the drained set.",
      };
    }
    return {
      state: "unknown",
      reason:
        `Coord's drain read answered with the bare string ${JSON.stringify(payload)}, ` +
        "which this build does not recognise as a drain state.",
    };
  }

  if (!isRecord(payload)) {
    // A bare array at the top level is a list of entries, which IS a shape the
    // specification admits.
    const listed = collectEntries(payload);
    if (listed) {
      return {
        state: "ok",
        entries: listed.entries,
        unreadableDevices: listed.unreadable,
      };
    }
    return {
      state: "unknown",
      reason:
        "Coord's drain read answered with a body this build cannot read as a " +
        "drain state, so no machine's drain state is known from it.",
    };
  }

  // 1. An explicit unknown, in any of the spellings the contract admits.
  const declaredState = optionalString(payload.state ?? payload.drain_state);
  if (declaredState !== null && declaredState.trim().toLowerCase() === "unknown") {
    return {
      state: "unknown",
      reason:
        optionalString(payload.reason) ??
        optionalString(payload.detail) ??
        "Coord reported that it could not determine the drained set.",
    };
  }
  if (payload.unknown === true) {
    return {
      state: "unknown",
      reason:
        optionalString(payload.reason) ??
        "Coord reported that it could not determine the drained set.",
    };
  }
  if ("Unknown" in payload && !("Known" in payload)) {
    return {
      state: "unknown",
      reason:
        optionalString(payload.reason) ??
        "Coord reported that it could not determine the drained set.",
    };
  }
  for (const flag of KNOWN_FLAG_KEYS) {
    if (payload[flag] === false) {
      return {
        state: "unknown",
        reason:
          optionalString(payload.reason) ??
          optionalString(payload.error) ??
          `Coord's drain read reported \`${flag}: false\` — it could not ` +
            "determine the drained set.",
      };
    }
  }
  if (optionalString(payload.error) !== null) {
    return {
      state: "unknown",
      reason: `Coord's drain read reported an error: ${optionalString(payload.error)}`,
    };
  }

  // 2. A named container of entries.
  for (const key of [...ENTRY_CONTAINER_KEYS, "Known"]) {
    if (!(key in payload)) continue;
    const container = payload[key];
    // An explicit null container is UNKNOWN, not "none drained": a route that
    // means "none" sends an empty object or list, exactly as coord's
    // `Known(vec![])` does.
    if (container === null) {
      return {
        state: "unknown",
        reason:
          `Coord's drain read served \`${key}: null\`, which says nothing ` +
          "about which machines are drained.",
      };
    }
    const collected = collectEntries(container);
    if (collected) {
      return {
        state: "ok",
        entries: collected.entries,
        unreadableDevices: collected.unreadable,
      };
    }
    return {
      state: "unknown",
      reason:
        `Coord's drain read served a \`${key}\` this build cannot read as a ` +
        "set of drain entries.",
    };
  }

  // 3. The bare map — the shape the column itself stores. Accepted only when
  //    every key looks like a device UUID, so an unrecognised envelope cannot
  //    be mistaken for an empty drain map.
  const keys = Object.keys(payload);
  if (keys.length > 0 && keys.every((k) => UUID_RE.test(k.trim()))) {
    const collected = collectEntries(payload);
    if (collected) {
      return {
        state: "ok",
        entries: collected.entries,
        unreadableDevices: collected.unreadable,
      };
    }
  }

  return {
    state: "unknown",
    reason:
      "Coord's drain read answered in a shape this build does not recognise " +
      "(no drain entries and no explicit unknown), so no machine's drain " +
      "state is known from it. This is not a claim that no machine is drained.",
  };
}

/**
 * Resolve one row's drain state.
 *
 * `deviceId` absent short-circuits BEFORE the read state is consulted, the
 * same way `resolveCiCapacity` does: with no device id there is nothing to
 * look up, and reporting the read's health would be a non-sequitur.
 */
export function resolveDeviceDrain(
  read: FleetDrainRead,
  deviceId: string | undefined,
  now: number
): DeviceDrainState {
  if (!deviceId) {
    return {
      state: "unknown",
      reason:
        "This row carries no coord device id, so there is nothing to look up " +
        "in the drain map.",
    };
  }
  if (read.state === "loading") {
    return {
      state: "unknown",
      reason: "Coord's drain state is still being read.",
    };
  }
  if (read.state === "unknown") {
    return { state: "unknown", reason: read.reason };
  }
  const key = normalizeDeviceId(deviceId);
  if (read.unreadableDevices.has(key)) {
    return {
      state: "unknown",
      reason:
        "Coord named this device in its drain map, but this build could not " +
        "read the entry (no usable `until`), so whether it is drained is " +
        "unknown.",
    };
  }
  const entry = read.entries.get(key);
  if (!entry) return { state: "not_drained" };
  const untilMs = parseTimestamp(entry.until);
  if (untilMs !== null && untilMs <= now) {
    return { state: "expired", entry };
  }
  return { state: "drained", entry };
}

// ---------------------------------------------------------------------------
// Deadline presets — shared by the maintenance-window form
// ---------------------------------------------------------------------------

/**
 * The preset deadlines offered beside the free field.
 *
 * Two-and-a-bit, deliberately: enough that the common cases (a reboot, a
 * rebuild, a day out of the fleet) are one click, few enough that none of them
 * reads as a default. **None is pre-selected** — the operator picks, which is
 * the whole point of a mandatory expiry.
 */
export const DRAIN_PRESETS: ReadonlyArray<{
  key: string;
  label: string;
  hours: number;
}> = [
  { key: "1h", label: "1 hour", hours: 1 },
  { key: "4h", label: "4 hours", hours: 4 },
  { key: "24h", label: "24 hours", hours: 24 },
];

/**
 * Render an epoch as the `YYYY-MM-DDTHH:mm` a `datetime-local` input takes, in
 * the viewer's own timezone — which is the timezone an operator reasons about
 * a rebuild window in.
 */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

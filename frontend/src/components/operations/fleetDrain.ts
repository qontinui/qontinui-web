/**
 * Machine drain — the pure half: the wire contract, its parse, and the two
 * resolutions a device row needs.
 *
 * Plan `2026-09-01-device-drain-does-not-reach-agent-session-spawning` Phase
 * 4b. Coord owns the state; this file owns nothing but the reading of it, so
 * every rule below is unit-testable without a DOM or a network.
 *
 * ## What a drain is
 *
 * `POST /coord/fleet/drain` stops coord sending a machine NEW work — CI jobs,
 * builds, and (this plan's Phases 1-3) agent-session spawning and continuation
 * dispatch. It is the one deliberate HARD filter in a ladder that otherwise
 * only deprioritises, and coord's own module doc says why that is safe: it is
 * an explicit operator action, and it carries a **mandatory expiry**. A drain
 * with no deadline is how a machine silently leaves the fleet forever, so
 * `until` is required by coord (`DrainRequest::until` is not an `Option`) and
 * it is required by this UI — never defaulted in, never offered as "no expiry".
 *
 * It does **not** stop work already running on the machine. Nothing here may
 * imply that it does.
 *
 * ## The keying, and the correction this file records
 *
 * Coord's drain map is keyed by **device UUID**
 * (`{"<device_uuid>": {until, reason, drained_by, drained_at}}`, stored on
 * `coord.fleet_runtime_policy.drain`), and both writes take a `device_id`. The
 * Dev Ops machine list, by contrast, is built in a `byHost` map keyed by
 * **hostname** (`FleetOverview.buildMachineGroups`). Something has to bridge
 * them, and picking the wrong bridge is the phase's real hazard.
 *
 * The plan's keying note named `Machine.coord_device_id` — the devenv machine
 * roster's soft, nullable pointer — as "the only bridge". **It is not the one
 * used here, and the difference is a correctness improvement rather than a
 * shortcut.** Every row on this list already carries coord's OWN device row,
 * merged in by `buildMachineGroups` from `GET /operations/fleet/health`:
 * `MachineGroup.coordHealth`, which is `{matched: true, device_id, hostname}`
 * or `{matched: false}`. That id comes from the same `coord.devices` registry
 * the drain routes write against, so it is the identity, not a pointer at it.
 * Routing the drain through `Machine.coord_device_id` instead would add a
 * second, weaker path to the same id and would render "not drainable" for a
 * machine coord names on this very page merely because nobody enrolled it
 * under Environments. That is the exact silent-inertness failure the plan asks
 * this phase to prevent, reached from the other side.
 *
 * The requirement the plan is actually making still holds in full, and
 * {@link resolveDrainTarget} is where it is enforced: a row with no resolvable
 * coord device id has **no drainable identity**, and must render a control
 * that is disabled WITH THE REASON — never one that is enabled and silently
 * inert.
 *
 * ## Why the target is labelled, always
 *
 * `spaceship` (a workstation that hosts agent sessions) and
 * `gh-runner-spaceship-wsl` (the GitHub self-hosted CI runner registered under
 * a synthetic `gh-runner-{name}` identity) are SEPARATE coord device
 * registrations. Draining one does nothing to the other, and coord returns no
 * error for it — the drain simply lands on a machine the operator did not
 * mean. So the control names the device id and coord's own hostname it will
 * act on, and it takes neither from the card title: that title is
 * `displayName ?? hostname`, an operator-settable ALIAS, which is precisely
 * the string that must not be trusted to identify a drain target.
 *
 * ## Unknown is never "not drained"
 *
 * `[policy: verification-and-evidence unknown-must-not-render-as-a-default]`.
 * A read that did not answer, a route that 404s (the deploy window before
 * coord's `GET /coord/fleet/drain` lands), a body in a shape this build does
 * not recognise, and an entry whose `until` will not parse are all UNKNOWN for
 * the devices they concern. None of them is evidence that a machine is taking
 * work, and this module has no path that turns one into `not_drained`.
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
}

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

/** What a row would actually drain, if anything. */
export type DrainTarget =
  | {
      state: "identified";
      /** The coord device UUID the write is keyed on. */
      deviceId: string;
      /**
       * Coord's OWN hostname for that device — never the card's display
       * alias. `null` when coord's device row carries none, in which case the
       * id is the only identity there is and the control says so.
       */
      coordHostname: string | null;
    }
  | { state: "no_device"; reason: string };

/**
 * The coord-health join this module reads, structurally.
 *
 * Declared locally rather than imported from `./types` so the pure layer has
 * no dependency on the machine-card model: the only thing a drain needs from a
 * row is whether coord named a device for it.
 */
export interface DrainTargetSource {
  matched: boolean;
  device_id?: string;
  hostname?: string;
}

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
  };
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

/**
 * Resolve what a row would drain.
 *
 * The `no_device` arm is the plan's keying requirement made executable: it is
 * the ONLY thing that may put an enabled drain button on the page, so a row
 * that reaches it renders a disabled control and the reason it is disabled.
 */
export function resolveDrainTarget(
  coordHealth: DrainTargetSource | undefined
): DrainTarget {
  if (!coordHealth) {
    return {
      state: "no_device",
      reason:
        "This machine list was built without coord's device read, so no row " +
        "on it carries a coord device id. A drain is keyed on that id and " +
        "there is nothing here to key it on.",
    };
  }
  if (!coordHealth.matched) {
    return {
      state: "no_device",
      reason:
        "Coord's fleet-health read carries no device row for this host, so " +
        "there is no coord device id to drain. That is a gap in the join, " +
        "not a statement that the machine cannot be drained — find it under " +
        "coord's device registry and drain it there.",
    };
  }
  const deviceId = coordHealth.device_id?.trim();
  if (!deviceId) {
    return {
      state: "no_device",
      reason:
        "Coord matched a device to this host but served no device id for it, " +
        "so there is no key to drain on.",
    };
  }
  return {
    state: "identified",
    deviceId,
    coordHostname: optionalString(coordHealth.hostname),
  };
}

/** Whether a drain control may be enabled at all. */
export function canActOnDrain(
  target: DrainTarget,
  drain: DeviceDrainState
): boolean {
  return target.state === "identified" && drain.state !== "unknown";
}

// ---------------------------------------------------------------------------
// The write side — expiry presets and validation
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

/**
 * How long a drain has left, or how long ago it lapsed.
 *
 * `relativeTime` cannot serve this: it renders every future stamp as
 * `"just now"` (a deliberate choice for clock skew on PAST events), and
 * "Drained until just now" is the opposite of what a deadline four hours out
 * means. This one is signed and says which side of `now` the deadline is on.
 */
export function formatDrainRemaining(untilIso: string, now: number): string {
  const untilMs = parseTimestamp(untilIso);
  if (untilMs === null) return "an unknown time";
  const deltaMs = untilMs - now;
  const past = deltaMs < 0;
  const minutes = Math.floor(Math.abs(deltaMs) / 60_000);
  let magnitude: string;
  if (minutes < 1) magnitude = "under a minute";
  else if (minutes < 60) magnitude = `${minutes}m`;
  else if (minutes < 60 * 24) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    magnitude = m === 0 ? `${h}h` : `${h}h ${m}m`;
  } else {
    const d = Math.floor(minutes / (60 * 24));
    const h = Math.floor((minutes % (60 * 24)) / 60);
    magnitude = h === 0 ? `${d}d` : `${d}d ${h}h`;
  }
  return past ? `${magnitude} ago` : `in ${magnitude}`;
}

export type DrainFormCheck =
  | { ok: true; untilIso: string }
  | { ok: false; message: string };

/**
 * Validate the drain form against `now`. PURE.
 *
 * Mirrors coord's `validate_drain` exactly — non-blank reason, a future
 * `until`, and a deadline within {@link MAX_DRAIN_DAYS}. Duplicated here not
 * to replace coord's check (which is the one that counts) but so the operator
 * is told what is wrong before a round trip, and so the submit control can be
 * honestly disabled rather than optimistically enabled.
 */
export function validateDrainForm(
  untilLocal: string,
  reason: string,
  now: number
): DrainFormCheck {
  if (reason.trim() === "") {
    return {
      ok: false,
      message:
        "A reason is required — it is what the audit row and the other " +
        "operators' alert will say.",
    };
  }
  if (untilLocal.trim() === "") {
    return {
      ok: false,
      message:
        "An expiry is required. A drain with no deadline is how a machine " +
        "silently leaves the fleet forever, so there is no 'no expiry' option.",
    };
  }
  const untilMs = Date.parse(untilLocal);
  if (!Number.isFinite(untilMs)) {
    return { ok: false, message: "That expiry is not a time this build can read." };
  }
  if (untilMs <= now) {
    return {
      ok: false,
      message:
        "The expiry must be in the future — a drain that has already expired " +
        "would be a no-op reported as a success.",
    };
  }
  const ceiling = now + MAX_DRAIN_DAYS * 24 * 60 * 60 * 1000;
  if (untilMs > ceiling) {
    return {
      ok: false,
      message:
        `The expiry must be within ${MAX_DRAIN_DAYS} days — coord rejects a ` +
        "longer one, because a deadline that far out is a permanent removal " +
        "wearing an expiry's clothes. Re-drain instead.",
    };
  }
  return { ok: true, untilIso: new Date(untilMs).toISOString() };
}

/**
 * Turn a failed drain/undrain response into a human line.
 *
 * Coord's refusals are machine-readable and mean genuinely different things —
 * `admin_required` (you are not an operator admin) versus
 * `device_not_in_tenant` (the drain reaches every tenant sharing the machine,
 * so the caller must be one of them) versus a 400 from `validate_drain`. The
 * web proxy nests coord's body under `detail`, so both levels are unwrapped.
 * Same shape as `describeDraftStateError`, which learned this first.
 */
export function describeDrainError(status: number, body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body.trim() ? `HTTP ${status} — ${body.trim()}` : `HTTP ${status}`;
  }
  if (!isRecord(parsed)) {
    return body.trim() ? `HTTP ${status} — ${body.trim()}` : `HTTP ${status}`;
  }
  const inner = isRecord(parsed.detail) ? parsed.detail : parsed;
  const code = optionalString(inner.error);
  const message =
    optionalString(inner.message) ??
    optionalString(inner.detail) ??
    (typeof parsed.detail === "string" ? parsed.detail : null);
  const parts: string[] = [`HTTP ${status}`];
  if (code) parts.push(code);
  if (message) parts.push(message);
  return parts.join(" — ");
}

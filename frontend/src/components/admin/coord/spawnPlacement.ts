/**
 * Where a spawn goes, and why coord refused one — the pure derivation behind
 * `SpawnModal`'s placement choice.
 *
 * Plan `2026-09-20-runner-selector-drives-a-transport-not-a-target` Phase 5
 * (web half; coord half is qontinui-coord#2403). `POST /agents/spawn` no
 * longer requires `target_device_id`:
 *
 *   - **omitted** — coord PLACES the session: tenant-bound, heartbeat-fresh,
 *     not a CI runner, advertises every `required_capabilities` entry, not
 *     drained, below its `max_concurrent_agents` cap. The response says
 *     `placed_by: "coord"`.
 *   - **named** — a CHECKED PIN. Coord refuses an ineligible pin (409
 *     `pin_ineligible`) and never re-targets it. `placed_by: "pin"`.
 *
 * Everything here is data in, data out, so every refusal arm is a unit test
 * rather than a JSX branch (console style guide R8). The modal only lays the
 * result out.
 */

export type PlacedBy = "coord" | "pin";

/** Split the free-text capability field into coord's `required_capabilities`.
 *
 *  Comma- or whitespace-separated, trimmed, de-duplicated in first-seen
 *  order. Coord trims too, but an empty list must reach the builder as `[]`
 *  so the key is OMITTED rather than sent as `[""]`. */
export function parseRequiredCapabilities(raw: string): string[] {
  const seen = new Set<string>();
  for (const token of raw.split(/[,\s]+/)) {
    const t = token.trim();
    if (t !== "") seen.add(t);
  }
  return Array.from(seen);
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function parseObject(text: unknown): JsonObject | null {
  if (typeof text !== "string") return null;
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function hasErrorCode(obj: JsonObject | null): obj is JsonObject {
  return obj !== null && typeof obj.error === "string";
}

/** Coord's refusal object, out of whichever envelope carried it.
 *
 *  The web proxy (`operations.py` `post_agents_spawn`) forwards coord's
 *  refusal with `structured_errors=True`, and the app's HTTP-exception
 *  handler splices it into the top level of its envelope — so `error`,
 *  `reason`, `outcome`, `hint`, … arrive as top-level keys. Two other shapes
 *  are still read, because a build of either side may lag the other:
 *
 *    - `{"detail": {…}}` — FastAPI's own shape, with no envelope handler;
 *    - `{"message": "<coord's JSON as text>"}` — the proxy before it opted in,
 *      which stringified coord's body.
 *
 *  Returns `null` when the text is not a JSON object at all (an HTML 502 from
 *  an intermediary, an empty body). */
export function extractCoordRefusal(text: string): JsonObject | null {
  const outer = parseObject(text);
  if (outer === null) return null;
  const detailObj = asObject(outer.detail);
  if (hasErrorCode(detailObj)) return detailObj;
  const detailText = parseObject(outer.detail);
  if (hasErrorCode(detailText)) return detailText;
  const messageText = parseObject(outer.message);
  if (hasErrorCode(messageText)) return messageText;
  return outer;
}

export type SpawnRefusalKind =
  | "pin_ineligible"
  | "device_not_found_in_tenant"
  | "no_eligible_device"
  | "device_drained"
  | "drain_unreadable"
  | "override_drain_requires_target"
  | "automatic_unsupported"
  | "unreachable"
  | "outcome_unknown"
  | "other";

export interface SpawnRefusal {
  kind: SpawnRefusalKind;
  /** One line: what happened. */
  headline: string;
  /** Coord's own specifics, when it gave any. May be `""`. */
  detail: string;
  /** What the operator can do next. */
  remedy: string;
  /** Offer "spawn on this drained device anyway". True ONLY for a drained
   *  device the operator NAMED — coord 400s an unnamed `override_drain`, and a
   *  coord-placed device is never knowingly drained. */
  offerOverride: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x !== "")
    : [];
}

/** The error codes the web app's own envelope stamps on a status that
 *  carried no coord object (`app/core/error_codes.py` `DEFAULT_ERROR_CODES`).
 *  A 502/503/504 bearing one of these is the proxy or an intermediary
 *  speaking; bearing anything else, coord answered and said so. */
const ENVELOPE_TRANSPORT_CODES = new Set([
  "",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
]);

/** The request may have reached coord and been acted on, but no readable
 *  answer came back: a timeout, a transport failure after send, or a 2xx
 *  whose body could not be read. Never "failed" — a retry could make two. */
export function outcomeUnknownRefusal(detail: string): SpawnRefusal {
  return {
    kind: "outcome_unknown",
    headline: "The spawn may or may not have landed",
    detail: detail.slice(0, 300),
    remedy:
      "Check the sessions list before spawning again, or you may get two.",
    offerOverride: false,
  };
}

/** Prefix coord's own detail with the device id, so the id is on the detail
 *  line and never in the headline (style guide R8). */
function withDeviceId(detail: string, deviceId: string): string {
  const idLine = deviceId !== "" ? `device id ${deviceId}` : "";
  return [idLine, detail].filter(Boolean).join(" · ");
}

/** Turn a non-2xx spawn response into a specific, actionable refusal.
 *
 *  `pinned` is what WE sent — whether `target_device_id` was on the body. It
 *  decides the drain arm: only a named device may be overridden.
 *  `deviceName` is the operator-facing name for the headline (a hostname, or
 *  a generic phrase when the roster does not know one); `deviceId` goes on
 *  the detail line only. */
export function describeSpawnRefusal(
  status: number,
  text: string,
  ctx: { pinned: boolean; deviceName: string; deviceId: string }
): SpawnRefusal {
  const body = extractCoordRefusal(text);
  const code = body !== null ? str(body.error) : "";
  const device = ctx.deviceName;
  const id = ctx.pinned ? ctx.deviceId : "";

  if (code === "pin_ineligible" && body !== null) {
    const reason = str(body.reason);
    const missing = strList(body.missing_capabilities);
    const headline =
      reason === "offline"
        ? `${device} is offline`
        : reason === "missing_capabilities"
          ? missing.length > 0
            ? `${device} lacks ${missing.length === 1 ? "a required capability" : "required capabilities"}: ${missing.join(", ")}`
            : `${device} lacks a required capability`
          : reason === "not_an_agent_host"
            ? `${device} is a CI runner, not an agent host`
            : `${device} cannot take this session`;
    const known = [
      "offline",
      "missing_capabilities",
      "not_an_agent_host",
    ].includes(reason);
    return {
      kind: "pin_ineligible",
      headline,
      detail: withDeviceId(
        [!known && reason ? `reason: ${reason}` : "", str(body.detail)]
          .filter(Boolean)
          .join(" · "),
        id
      ),
      remedy:
        "Coord does not move a session off a device you named. Switch to " +
        "automatic placement to let coord pick one, or name an eligible device.",
      offerOverride: false,
    };
  }

  if (code === "device_not_found_in_tenant") {
    return {
      kind: "device_not_found_in_tenant",
      headline: `${device} is not registered to your tenant`,
      detail: withDeviceId(
        body !== null ? str(body.detail) || str(body.message) : "",
        id
      ),
      remedy:
        "Check the id, or switch to automatic placement to let coord pick one of your devices.",
      offerOverride: false,
    };
  }

  if (code === "no_eligible_device" && body !== null) {
    const outcome = str(body.outcome);
    const missing = strList(body.missing_capabilities);
    const detail = str(body.detail);
    if (outcome === "no_capable_device") {
      return {
        kind: "no_eligible_device",
        headline:
          missing.length > 0
            ? `No online device advertises ${missing.join(", ")}`
            : "No online device of this tenant can take this session",
        detail,
        remedy:
          missing.length > 0
            ? "Start a machine that has those capabilities, or drop the requirement."
            : "Start one of this tenant's machines, then spawn again.",
        offerOverride: false,
      };
    }
    if (outcome === "all_capable_drained") {
      return {
        kind: "no_eligible_device",
        headline: "Every device that could take this session is drained",
        detail,
        remedy:
          "Release a drain, or name a drained device and choose to override its drain.",
        offerOverride: false,
      };
    }
    if (outcome === "all_capable_at_capacity") {
      return {
        kind: "no_eligible_device",
        headline:
          "Every device that could take this session is at its session cap",
        detail,
        remedy:
          "Wait for a session to finish, raise a device's limit on concurrent " +
          "sessions, " +
          "or name a device — a named device is never refused for capacity.",
        offerOverride: false,
      };
    }
    return {
      kind: "no_eligible_device",
      headline: "Coord found no device for this session",
      detail: [outcome ? `outcome: ${outcome}` : "", detail]
        .filter(Boolean)
        .join(" · "),
      remedy: "Name a device, or spawn again once the fleet changes.",
      offerOverride: false,
    };
  }

  if (code === "device_drained" && body !== null) {
    const facts = [
      str(body.reason) && `reason: ${str(body.reason)}`,
      str(body.drained_by) && `drained by ${str(body.drained_by)}`,
      str(body.until) && `until ${str(body.until)}`,
    ].filter(Boolean);
    if (ctx.pinned) {
      return {
        kind: "device_drained",
        headline: `${device} is drained`,
        detail: withDeviceId(facts.join(" · "), id),
        remedy:
          "An operator took this machine out of service. Switch to automatic " +
          "placement, or override the drain if you mean to use it anyway.",
        offerOverride: true,
      };
    }
    return {
      kind: "device_drained",
      headline: "The device coord picked was drained before the spawn went out",
      detail: facts.join(" · "),
      remedy:
        "Spawn again and coord will place it on another device, or name the " +
        "device if you mean to override its drain.",
      offerOverride: false,
    };
  }

  if (code === "drain_unreadable") {
    return {
      kind: "drain_unreadable",
      headline:
        "Coord cannot read which devices are drained, so it is refusing spawns",
      detail: body !== null ? str(body.hint) : "",
      remedy:
        "This fails closed until coord's drain read recovers — retry shortly. " +
        "Overriding a drain does not cover this case.",
      offerOverride: false,
    };
  }

  if (code === "override_drain_requires_target") {
    return {
      kind: "override_drain_requires_target",
      headline: "Overriding a drain needs a named device",
      detail: body !== null ? str(body.detail) : "",
      remedy: "Name the drained device, then override.",
      offerOverride: false,
    };
  }

  // A coord that predates automatic placement types `target_device_id` as a
  // REQUIRED `Uuid`, so an unnamed spawn 422s at deserialization, before any
  // handler — with serde's "missing field" text, not a JSON code.
  if (!ctx.pinned && status === 422 && /target_device_id/.test(text)) {
    return {
      kind: "automatic_unsupported",
      headline: "This coord does not support automatic placement yet",
      detail: "",
      remedy: "Name a device to spawn on.",
      offerOverride: false,
    };
  }

  // The web proxy's own answers when coord never replied (`operations.py`
  // `_proxy_coord_post`: 502 unreachable, 504 timeout) and a 503 from an
  // intermediary. Not refusals — and after a timeout the spawn MAY have
  // landed, so say that rather than "refused".
  // Only when the body carries no coord error code: a 502/503/504 that DOES
  // carry one is coord's own answer, and falls through to show it.
  if (
    (status === 502 || status === 503 || status === 504) &&
    ENVELOPE_TRANSPORT_CODES.has(code)
  ) {
    const said = body !== null ? str(body.message) || text : text;
    if (status === 504) return outcomeUnknownRefusal(said);
    return {
      kind: "unreachable",
      headline: "The spawn did not reach coord",
      detail: said.slice(0, 300),
      remedy: "Spawn again once coord is reachable.",
      offerOverride: false,
    };
  }

  const fallbackDetail =
    body !== null
      ? str(body.detail) || str(body.hint) || str(body.message) || text
      : text;
  return {
    kind: "other",
    headline: `Spawn refused — HTTP ${status}`,
    // Coord's own code lives on the detail line, not the headline (R8).
    detail: [code ? `coord error: ${code}` : "", fallbackDetail.slice(0, 300)]
      .filter(Boolean)
      .join(" · "),
    remedy: "",
    offerOverride: false,
  };
}

/** The success line: where the session went, and who chose it.
 *
 *  `placed_by` is new in coord#2403 and rides the RESPONSE only. A coord that
 *  predates it says nothing, and that is reported as not reported — never
 *  guessed from what we sent. */
export function describeSpawnPlacement(
  result: { target_device_id?: unknown; placed_by?: unknown },
  deviceLabel: (deviceId: string) => string,
  /** Whether the request carried `required_capabilities`. A coord that
   *  predates capability placement IGNORES the field (no
   *  `deny_unknown_fields`), and its tell is the missing `placed_by`. */
  capabilitiesSent = false
): {
  placedBy: PlacedBy | null;
  text: string;
  /** True when capabilities were sent to a coord that cannot have checked
   *  them — the caller must not present this as a plain success. */
  capabilitiesUnchecked: boolean;
} {
  const target = str(result.target_device_id);
  const where =
    target !== "" ? deviceLabel(target) : "a device coord did not name";
  if (result.placed_by === "coord") {
    return {
      placedBy: "coord",
      text: `on ${where} — placed by coord`,
      capabilitiesUnchecked: false,
    };
  }
  if (result.placed_by === "pin") {
    return {
      placedBy: "pin",
      text: `on ${where} — the device you named`,
      capabilitiesUnchecked: false,
    };
  }
  return {
    placedBy: null,
    text:
      `on ${where} (coord did not report who chose the device)` +
      (capabilitiesSent
        ? ". The required capabilities were NOT checked: this coord does " +
          "not support them and ignored the list."
        : ""),
    capabilitiesUnchecked: capabilitiesSent,
  };
}

/**
 * "Which of my runners should this work run on?" — answered by coord.
 *
 * Plan 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3.
 * The browser asks the web backend's `POST /api/v1/devices/resolve`, which
 * forwards AS the caller to coord's `POST /coord/devices/resolve` — coord's
 * capability-checked, heartbeat-fresh, drain-filtered pick among the CALLER's
 * paired devices (plan D1/D3). The answer is always a 200 with an `outcome`
 * tag; this module turns it into a `ResolvedRunnerState`.
 *
 * `unavailable` is UNKNOWN: the resolver could not be asked or did not answer
 * (coord unreachable, the door not deployed yet, a refused credential, the web
 * backend itself unreachable). It names no device, and no caller may turn it
 * into a pick by list order — see `resolveRunnerTarget` in
 * `contexts/active-runner-context.tsx`.
 *
 * No `user_id` is ever sent: coord takes the user from the forwarded bearer.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

export const DEVICE_RESOLVE_PATH = "/api/v1/devices/resolve";

/**
 * `machine_bound` — an ineligible pin is refused, never re-targeted (plan D2).
 * `placeable`     — an ineligible pin is released and the pool pick says so.
 */
export type ResolveWorkClass = "machine_bound" | "placeable";

export type PinIneligibility =
  | "not_a_paired_device"
  | "offline"
  | "missing_capabilities"
  | "drained";

/** Why a pin was dropped on the way to a `placeable` answer. */
export interface PinReleased {
  reason: PinIneligibility;
  detail: string | null;
}

export type ResolvedRunnerState =
  /** No answer yet (the first request is in flight, or not enabled yet). */
  | { status: "loading" }
  | {
      status: "resolved";
      deviceId: string;
      via: "pin" | "pool";
      /** Set when a `placeable` pin was ineligible and coord picked from the pool. */
      pinReleased: PinReleased | null;
    }
  | {
      /** A `machine_bound` pin coord refused — never re-targeted. */
      status: "pin_ineligible";
      deviceId: string;
      reason: PinIneligibility;
      detail: string;
      missingCapabilities: string[];
    }
  | {
      status: "no_capable";
      missing: string[];
      onlineDevices: number;
      pinReleased: PinReleased | null;
    }
  | { status: "all_drained"; pinReleased: PinReleased | null }
  /** Coord could not read the drain set, so it names no device (fail-closed). */
  | { status: "drain_unreadable" }
  | {
      /** UNKNOWN — the resolver's answer could not be obtained. */
      status: "unavailable";
      reason: string;
      httpStatus: number | null;
      code: string | null;
    };

export interface DeviceResolveInput {
  /** Capability tokens every candidate must advertise. Required; may be []. */
  capabilities: readonly string[];
  workClass: ResolveWorkClass;
  /** The pin (a coord device id); still has to pass eligibility. */
  preferred?: string | null;
}

/** The request body — exactly coord's, and nothing that names a user. */
export function deviceResolveBody(input: DeviceResolveInput): {
  required_capabilities: string[];
  work_class: ResolveWorkClass;
  preferred_device?: string;
} {
  return {
    required_capabilities: [...input.capabilities],
    work_class: input.workClass,
    ...(input.preferred ? { preferred_device: input.preferred } : {}),
  };
}

function unavailable(
  reason: string,
  httpStatus: number | null = null,
  code: string | null = null
): ResolvedRunnerState {
  return { status: "unavailable", reason, httpStatus, code };
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

const PIN_REASONS: readonly PinIneligibility[] = [
  "not_a_paired_device",
  "offline",
  "missing_capabilities",
  "drained",
];

function pinReason(v: unknown): PinIneligibility | null {
  return PIN_REASONS.includes(v as PinIneligibility)
    ? (v as PinIneligibility)
    : null;
}

function pinReleased(body: Record<string, unknown>): PinReleased | null {
  const reason = pinReason(body.pin_released_reason);
  return reason ? { reason, detail: str(body.pin_released_detail) } : null;
}

/**
 * The typed state for one response body. Anything that is not the contract
 * is `unavailable / malformed_response` — never a device.
 */
export function parseDeviceResolve(body: unknown): ResolvedRunnerState {
  if (typeof body !== "object" || body === null) {
    return unavailable("malformed_response");
  }
  const b = body as Record<string, unknown>;
  switch (b.outcome) {
    case "resolved": {
      const deviceId = str(b.device_id);
      if (!deviceId || (b.via !== "pin" && b.via !== "pool")) break;
      return {
        status: "resolved",
        deviceId,
        via: b.via,
        pinReleased: pinReleased(b),
      };
    }
    case "pin_ineligible": {
      const deviceId = str(b.device_id);
      const reason = pinReason(b.reason);
      if (!deviceId || !reason) break;
      return {
        status: "pin_ineligible",
        deviceId,
        reason,
        detail: str(b.detail) ?? "",
        missingCapabilities: strList(b.missing_capabilities),
      };
    }
    case "no_capable_device":
      return {
        status: "no_capable",
        missing: strList(b.missing),
        onlineDevices:
          typeof b.online_devices === "number" ? b.online_devices : 0,
        pinReleased: pinReleased(b),
      };
    case "all_capable_drained":
      return { status: "all_drained", pinReleased: pinReleased(b) };
    case "drain_unreadable":
      return { status: "drain_unreadable" };
    case "unavailable":
      return unavailable(
        str(b.reason) ?? "unknown",
        typeof b.status === "number" ? b.status : null,
        str(b.code)
      );
  }
  return unavailable("malformed_response");
}

/**
 * Ask the web backend. Never throws for a resolver condition: a transport
 * failure or a non-2xx from the web backend is `unavailable` too. Only an
 * abort (the caller superseded this request) rejects.
 */
export async function requestDeviceResolve(
  input: DeviceResolveInput,
  signal?: AbortSignal
): Promise<ResolvedRunnerState> {
  let resp: Response;
  try {
    resp = await httpClient.fetch(
      `${ApiConfig.API_BASE_URL}${DEVICE_RESOLVE_PATH}`,
      {
        method: "POST",
        body: JSON.stringify(deviceResolveBody(input)),
        // A read: the resolver is re-asked on the next refresh, so one failure
        // surfaces as UNKNOWN at once instead of a retry chain.
        maxRetries: 0,
        signal,
      }
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    return unavailable("backend_unreachable");
  }
  if (!resp.ok) return unavailable("backend_error", resp.status);
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return unavailable("malformed_response", resp.status);
  }
  return parseDeviceResolve(body);
}

"use client";

/**
 * The two reads and one write behind `/admin/coord/runners`.
 *
 * Plan `2026-09-13-drained-runner-never-reaches-idle` Phase 8. Everything
 * these return is interpreted in `runnerStatus.ts`; this module only moves
 * bytes and keeps two rules about failure:
 *
 * - **A failed readiness read is UNKNOWN, full stop.** The verdict is only
 *   meaningful while fresh, and a sample held across a failed refresh ages
 *   with no server to say by how much, so it is not kept.
 * - **A failed session read after a good one keeps the rows and says so.**
 *   Emptying the list would assert "no sessions" on no evidence; keeping it
 *   silently would pass the old list off as current.
 *
 * Both reads are keyed on the device: a response for a device the operator
 * has since switched away from is dropped, and switching renders `loading`
 * rather than the previous machine's answer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import {
  describeControlError,
  parseFleetSessions,
  resolveReadiness,
  type ControlWriteResult,
  type FleetSessionsRead,
  type ReadinessRead,
  type SessionControlAction,
} from "./runnerStatus";

/** The runner pushes a sample every 30 s; half that notices it promptly. */
export const RUNNER_POLL_MS = 15_000;

/** Coord's `MAX_LIMIT` on the census. Coord clamps; `nextCursor` says the rest. */
export const FLEET_SESSIONS_LIMIT = 500;

export function deviceReadinessUrl(deviceId: string): string {
  return (
    `${OPERATIONS_API}/fleet/resource-samples?device_id=` +
    `${encodeURIComponent(deviceId)}&history=false`
  );
}

export function deviceFleetSessionsUrl(deviceId: string): string {
  return (
    `${OPERATIONS_API}/sessions/fleet?device_id=` +
    `${encodeURIComponent(deviceId)}&limit=${FLEET_SESSIONS_LIMIT}`
  );
}

export function sessionControlUrl(sessionId: string): string {
  return `${OPERATIONS_API}/sessions/${encodeURIComponent(sessionId)}/control`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A device-keyed state cell: a value for a device other than the current one reads as loading. */
interface Keyed<T> {
  deviceId: string;
  value: T;
}

/**
 * Poll `load` for `deviceId`, delivering only answers for the device still
 * selected. `deviceId === ""` issues no request.
 */
function useDevicePoll<T>(
  deviceId: string,
  loading: T,
  load: (deviceId: string, previous: T | null) => Promise<T>
): { value: T; refresh: () => Promise<void> } {
  const [cell, setCell] = useState<Keyed<T> | null>(null);
  const current = useRef(deviceId);
  current.current = deviceId;
  const latest = useRef<Keyed<T> | null>(null);
  latest.current = cell;

  const refresh = useCallback(async () => {
    if (deviceId === "") return;
    const previous =
      latest.current && latest.current.deviceId === deviceId
        ? latest.current.value
        : null;
    const next = await load(deviceId, previous);
    if (current.current === deviceId) setCell({ deviceId, value: next });
  }, [deviceId, load]);

  useEffect(() => {
    if (deviceId === "") return;
    void refresh();
    const id = setInterval(() => void refresh(), RUNNER_POLL_MS);
    return () => clearInterval(id);
  }, [deviceId, refresh]);

  const value = cell && cell.deviceId === deviceId ? cell.value : loading;
  return { value, refresh };
}

const READINESS_LOADING: ReadinessRead = { kind: "loading" };
const SESSIONS_LOADING: FleetSessionsRead = { kind: "loading" };

async function loadReadiness(deviceId: string): Promise<ReadinessRead> {
  try {
    const res = await httpClient.fetch(deviceReadinessUrl(deviceId));
    if (!res.ok) {
      return {
        kind: "read_failed",
        reason:
          `the resource-sample read returned HTTP ${res.status}, so nothing ` +
          "is known about this runner's readiness",
      };
    }
    return resolveReadiness(await res.json(), deviceId);
  } catch (err) {
    return {
      kind: "read_failed",
      reason: `the resource-sample read failed — ${errorText(err)}`,
    };
  }
}

async function loadFleetSessions(
  deviceId: string,
  previous: FleetSessionsRead | null
): Promise<FleetSessionsRead> {
  const fail = (reason: string): FleetSessionsRead =>
    previous?.kind === "ok"
      ? { ...previous, refreshError: reason }
      : { kind: "failed", reason };
  try {
    const res = await httpClient.fetch(deviceFleetSessionsUrl(deviceId));
    if (res.status === 404) {
      return fail(
        "coord serves no per-device session census on this deployment " +
          "(GET /coord/sessions/fleet answered 404)"
      );
    }
    if (!res.ok) {
      return fail(`the session census returned HTTP ${res.status}`);
    }
    const parsed = parseFleetSessions(await res.json());
    if (!parsed.ok) return fail(parsed.reason);
    return {
      kind: "ok",
      rows: parsed.rows,
      hasMore: parsed.hasMore,
      workAxisColumnsPresent: parsed.workAxisColumnsPresent,
      refreshError: null,
    };
  } catch (err) {
    return fail(`the session census could not be read — ${errorText(err)}`);
  }
}

export function useDeviceReadiness(deviceId: string): {
  read: ReadinessRead;
  refresh: () => Promise<void>;
} {
  const { value, refresh } = useDevicePoll(
    deviceId,
    READINESS_LOADING,
    loadReadiness
  );
  return { read: value, refresh };
}

export function useDeviceFleetSessions(deviceId: string): {
  read: FleetSessionsRead;
  refresh: () => Promise<void>;
} {
  const { value, refresh } = useDevicePoll(
    deviceId,
    SESSIONS_LOADING,
    loadFleetSessions
  );
  return { read: value, refresh };
}

/**
 * `POST /api/v1/operations/sessions/{session_id}/control`.
 *
 * The body carries exactly the contract's two keys. There is no
 * `requested_by`: coord stamps the author from the authenticated operator.
 */
export async function postSessionControl(input: {
  sessionId: string;
  action: SessionControlAction;
  reason?: string;
}): Promise<ControlWriteResult> {
  const body: { action: SessionControlAction; reason?: string } = {
    action: input.action,
  };
  const reason = input.reason?.trim();
  if (reason) body.reason = reason;
  try {
    const res = await httpClient.fetch(sessionControlUrl(input.sessionId), {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const described = describeControlError(res.status, text);
      return { ok: false, status: res.status, ...described };
    }
    let eventId: string | null = null;
    try {
      const parsed: unknown = await res.json();
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { event_id?: unknown }).event_id === "string"
      ) {
        eventId = (parsed as { event_id: string }).event_id;
      }
    } catch {
      // A 202 whose body will not parse still recorded the request.
    }
    return { ok: true, eventId };
  } catch (err) {
    return {
      ok: false,
      status: null,
      code: null,
      message: `The request could not be sent — ${errorText(err)}`,
    };
  }
}

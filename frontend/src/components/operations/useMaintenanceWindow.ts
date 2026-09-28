"use client";

/**
 * The reads and writes behind `/admin/coord/machine-maintenance`.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place`
 * Phase 7. Everything these return is interpreted in `maintenanceWindow.ts`;
 * this module moves bytes and keeps the failure rules:
 *
 * - **A failed machines read after a good one keeps the list and says so.**
 *   Emptying it would assert "no machine is in maintenance" on no evidence.
 * - **A failed readiness read is UNKNOWN, full stop.** A verdict held across a
 *   failed refresh ages with no server to say by how much, so it is dropped —
 *   the same rule `useRunnerWindDown` keeps for the runner's own readiness.
 * - **A 404 names the deploy window.** Coord's routes land in a separate
 *   deploy; a console a deploy ahead reads UNKNOWN with the reason, not an
 *   empty fleet.
 *
 * Every write returns a typed outcome rather than throwing, so the page can
 * branch on coord's refusal code — `last_matching_host` is a question to the
 * operator, not a failure.
 */

import { useCallback, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";
import { RUNNER_POLL_MS } from "./useRunnerWindDown";
import {
  describeMaintenanceError,
  parseMachines,
  parseMaintenanceWindow,
  parseWindowReadiness,
  type MachinesRead,
  type MaintenanceError,
  type MaintenanceLever,
  type MaintenanceWindow,
  type WindowReadinessRead,
} from "./maintenanceWindow";

export const FLEET_MACHINES_API = `${OPERATIONS_API}/fleet/machines`;
export const MAINTENANCE_WINDOW_API = `${OPERATIONS_API}/fleet/maintenance-window`;

export function machineCiHostsUrl(deviceId: string): string {
  return `${FLEET_MACHINES_API}/${encodeURIComponent(deviceId)}/ci-hosts`;
}

export function windowUrl(windowId: string): string {
  return `${MAINTENANCE_WINDOW_API}/${encodeURIComponent(windowId)}`;
}

export function windowReadinessUrl(windowId: string): string {
  return `${windowUrl(windowId)}/readiness`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const MACHINES_LOADING: MachinesRead = { state: "loading" };

export interface UseFleetMachinesResult {
  read: MachinesRead;
  refresh: () => Promise<void>;
}

/**
 * `GET /fleet/machines`, polled at the runner page's cadence: a window
 * expires by itself (coord evaluates `until` on read), so a once-only read
 * would leave "paused until 14:03" on screen at 15:00.
 */
export function useFleetMachines(): UseFleetMachinesResult {
  const [read, setRead] = useState<MachinesRead>(MACHINES_LOADING);
  const latest = useRef<MachinesRead>(MACHINES_LOADING);
  latest.current = read;

  const poll = useCallback(async (isCurrent: () => boolean) => {
    const previous = latest.current;
    const fail = (reason: string): MachinesRead =>
      previous.state === "ok"
        ? { ...previous, refreshError: reason }
        : { state: "unknown", reason };
    let next: MachinesRead;
    try {
      const res = await httpClient.fetch(
        FLEET_MACHINES_API,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (res.status === 404) {
        next = fail(
          "coord serves no machines read on this deployment (GET " +
            "/coord/fleet/machines answered 404) — expected while coord is a " +
            "deploy behind this console. Machines may still be in maintenance."
        );
      } else if (res.status === 403) {
        next = fail(
          "the machines read is for coord tenant admins (HTTP 403) — this " +
            "says nothing about whether any machine is in maintenance"
        );
      } else if (!res.ok) {
        next = fail(`the machines read returned HTTP ${res.status}`);
      } else {
        let body: unknown;
        try {
          body = await res.json();
        } catch (err) {
          throw new Error(
            `the machines read did not return valid JSON: ${errorText(err)}`
          );
        }
        const parsed = parseMachines(body);
        next = parsed.state === "unknown" ? fail(parsed.reason) : parsed;
      }
    } catch (err) {
      next = fail(`coord's machines could not be read — ${errorText(err)}`);
    }
    if (isCurrent()) setRead(next);
  }, []);

  const { refresh } = useSingleFlightPoll(poll, RUNNER_POLL_MS);
  return { read, refresh };
}

interface KeyedReadiness {
  windowId: string;
  value: WindowReadinessRead;
}

/**
 * `GET /fleet/maintenance-window/{id}/readiness` for the machine's open
 * window. `windowId === null` issues no request and reads `no_window`: there
 * is no verdict without a window, because with nothing paused the answer is
 * always "not yet" and coord does not compute one.
 */
export function useWindowReadiness(windowId: string | null): {
  read: WindowReadinessRead;
  refresh: () => Promise<void>;
} {
  const [cell, setCell] = useState<KeyedReadiness | null>(null);
  const current = useRef(windowId);
  current.current = windowId;
  const issued = useRef(0);
  const applied = useRef(0);

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      if (windowId === null) return;
      const seq = ++issued.current;
      let next: WindowReadinessRead;
      try {
        const res = await httpClient.fetch(
          windowReadinessUrl(windowId),
          COORD_DASHBOARD_POLL_OPTIONS
        );
        if (res.status === 404) {
          next = {
            state: "unknown",
            reason:
              "coord serves no readiness for this window (HTTP 404) — either " +
              "coord is a deploy behind this console or the window just closed",
          };
        } else if (!res.ok) {
          next = {
            state: "unknown",
            reason: `the readiness read returned HTTP ${res.status}, so the verdict is not known`,
          };
        } else {
          next = parseWindowReadiness(await res.json());
        }
      } catch (err) {
        next = {
          state: "unknown",
          reason: `the readiness read failed — ${errorText(err)}`,
        };
      }
      if (!isCurrent()) return;
      // An answer for a window no longer selected, or older than one already
      // applied, would put a stale verdict back on screen.
      if (current.current !== windowId || seq <= applied.current) return;
      applied.current = seq;
      setCell({ windowId, value: next });
    },
    [windowId]
  );

  const { refresh } = useSingleFlightPoll(poll, RUNNER_POLL_MS);
  const read: WindowReadinessRead =
    windowId === null
      ? { state: "no_window" }
      : cell && cell.windowId === windowId
        ? cell.value
        : { state: "loading" };
  return { read, refresh };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** The outcome of a window write. */
export type WindowWriteResult =
  | { ok: true; window: MaintenanceWindow | null }
  | ({ ok: false; status: number | null } & MaintenanceError);

async function sendWindowWrite(
  url: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>
): Promise<WindowWriteResult> {
  try {
    const res = await httpClient.fetch(url, {
      method,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        ...describeMaintenanceError(res.status, text),
      };
    }
    // A success whose body does not read as a window still succeeded; the
    // page re-reads the machines list, which is the source of truth.
    let window: MaintenanceWindow | null = null;
    try {
      window = parseMaintenanceWindow(await res.json());
    } catch {
      window = null;
    }
    return { ok: true, window };
  } catch (err) {
    return {
      ok: false,
      status: null,
      code: null,
      message: `The request could not be sent — ${errorText(err)}`,
      poolKey: null,
      machineDeviceId: null,
    };
  }
}

/**
 * `POST /fleet/maintenance-window`. `acceptCiQueueing` is sent only as the
 * operator's explicit answer to a `last_matching_host` refusal — the first
 * request always sends `false`. No author field: coord stamps it.
 */
export function openMaintenanceWindow(input: {
  machineDeviceId: string | null;
  ciHost: string | null;
  levers: MaintenanceLever[];
  untilIso: string;
  reason: string;
  acceptCiQueueing: boolean;
}): Promise<WindowWriteResult> {
  return sendWindowWrite(MAINTENANCE_WINDOW_API, "POST", {
    machine_device_id: input.machineDeviceId,
    ci_host: input.ciHost,
    levers: input.levers,
    until: input.untilIso,
    reason: input.reason.trim(),
    accept_ci_queueing: input.acceptCiQueueing,
  });
}

/** `PATCH /fleet/maintenance-window/{id}` — hold or release one lever. */
export function setMaintenanceLever(input: {
  windowId: string;
  lever: MaintenanceLever;
  held: boolean;
  acceptCiQueueing?: boolean;
}): Promise<WindowWriteResult> {
  const body: Record<string, unknown> = {
    lever: input.lever,
    held: input.held,
  };
  if (input.acceptCiQueueing !== undefined)
    body.accept_ci_queueing = input.acceptCiQueueing;
  return sendWindowWrite(windowUrl(input.windowId), "PATCH", body);
}

/** `POST /fleet/maintenance-window/{id}/close` — return to service. */
export function closeMaintenanceWindow(input: {
  windowId: string;
  reason: string;
}): Promise<WindowWriteResult> {
  return sendWindowWrite(`${windowUrl(input.windowId)}/close`, "POST", {
    reason: input.reason.trim(),
  });
}

/** The outcome of a link/unlink write. */
export type CiHostLinkResult =
  | { ok: true; ciHosts: string[] | null }
  | ({ ok: false; status: number | null } & MaintenanceError);

async function sendLinkWrite(
  url: string,
  init: RequestInit
): Promise<CiHostLinkResult> {
  try {
    const res = await httpClient.fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        ...describeMaintenanceError(res.status, text),
      };
    }
    let ciHosts: string[] | null = null;
    try {
      const body: unknown = await res.json();
      if (
        typeof body === "object" &&
        body !== null &&
        Array.isArray((body as { ci_hosts?: unknown }).ci_hosts)
      ) {
        ciHosts = (body as { ci_hosts: unknown[] }).ci_hosts.filter(
          (h): h is string => typeof h === "string"
        );
      }
    } catch {
      ciHosts = null;
    }
    return { ok: true, ciHosts };
  } catch (err) {
    return {
      ok: false,
      status: null,
      code: null,
      message: `The request could not be sent — ${errorText(err)}`,
      poolKey: null,
      machineDeviceId: null,
    };
  }
}

/** `POST /fleet/machines/{device_id}/ci-hosts` — declare a host is this machine. */
export function linkCiHost(input: {
  deviceId: string;
  ciHost: string;
}): Promise<CiHostLinkResult> {
  return sendLinkWrite(machineCiHostsUrl(input.deviceId), {
    method: "POST",
    body: JSON.stringify({ ci_host: input.ciHost.trim() }),
  });
}

/** `DELETE /fleet/machines/{device_id}/ci-hosts/{ci_host}`. */
export function unlinkCiHost(input: {
  deviceId: string;
  ciHost: string;
}): Promise<CiHostLinkResult> {
  return sendLinkWrite(
    `${machineCiHostsUrl(input.deviceId)}/${encodeURIComponent(input.ciHost)}`,
    { method: "DELETE" }
  );
}

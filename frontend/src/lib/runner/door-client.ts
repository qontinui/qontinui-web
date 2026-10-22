/**
 * The browser half of the runner door proxy.
 *
 * Plan `2026-09-17-retire-the-runner-origin-guard-dev-grace`, Phase 4. A call
 * to a runner credential door (see ./door-routes) over a LOOPBACK route is
 * sent to this page's own `/api/runner-doors${path}` instead of straight to
 * `http://localhost:<port>`. The `next dev` server forwards it to
 * `127.0.0.1:<port>` after checking the origin and the operator's bearer, so
 * the runner no longer needs to admit the `:3001` origin to its doors.
 *
 * `runnerRequest` (./api-client) is the only caller: every runner request in
 * this app goes through it, so routing doors here covers runnerFetch,
 * useRunnerQuery, useRunnerMutation and the runner-client sub-clients alike.
 *
 * Kill switch: `NEXT_PUBLIC_RUNNER_DOOR_TRANSPORT=direct` (a build-time public
 * env, so a `next dev` restart) sends door calls straight to the runner again.
 * They then work only while the runner still admits the dev origin.
 */

import { tokenManager } from "@/services/service-factory";
import { matchRunnerDoorRoute } from "./door-routes";

/** Same-origin prefix of the door proxy route. */
export const RUNNER_DOOR_PROXY_PREFIX = "/api/runner-doors";

/** The header naming which loopback runner port the proxy forwards to. */
export const RUNNER_PORT_HEADER = "X-Qontinui-Runner-Port";

/** Door transport: `proxy` (default) or `direct` (the kill switch). */
export type RunnerDoorTransport = "proxy" | "direct";

export function runnerDoorTransport(): RunnerDoorTransport {
  return process.env.NEXT_PUBLIC_RUNNER_DOOR_TRANSPORT === "direct"
    ? "direct"
    : "proxy";
}

/** The loopback port in a runner base such as `http://localhost:9877`, or
 * null when the base is not a loopback http URL. */
export function loopbackPortOf(base: string): number | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "http:" ||
    !(host === "localhost" || host === "127.0.0.1" || host === "[::1]")
  ) {
    return null;
  }
  const port = Number(url.port || "80");
  return Number.isInteger(port) ? port : null;
}

/** Where a loopback request goes, and the headers to add for it. */
export interface DoorRouting {
  url: string;
  headers: Record<string, string>;
}

/**
 * The proxied URL and headers for `method path` against the loopback runner
 * at `base`, or null when the request should go straight to the runner (not
 * a door, the kill switch is on, or the base is not loopback).
 */
export function runnerDoorRouting(
  base: string,
  path: string,
  method: string
): DoorRouting | null {
  if (runnerDoorTransport() === "direct") return null;
  if (matchRunnerDoorRoute(method, path) === null) return null;
  const port = loopbackPortOf(base);
  if (port === null) return null;
  const headers: Record<string, string> = {
    [RUNNER_PORT_HEADER]: String(port),
  };
  const token = tokenManager.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url: `${RUNNER_DOOR_PROXY_PREFIX}${path}`, headers };
}

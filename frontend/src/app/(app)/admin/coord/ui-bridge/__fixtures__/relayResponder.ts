/**
 * A fake of the web backend's runner relay for the dashboard's page tests:
 * one handler per runner route, defaulting to what a CURRENT runner answers
 * (qontinui-runner `be39991d2` plus Phase 6's runner half). In particular the
 * runner's own app list (`GET /apps`) and the occlusion sweep are refused as
 * not carried, because no runner's relay allowlist carries them yet.
 *
 * Every request is recorded as `"<METHOD> <runner path>"`, so a test can
 * assert what was — and was not — asked for; `requestsFor` adds the device id
 * the relay was asked to reach, for a test about WHICH runner was asked.
 */

import {
  COMPONENTS_BODY,
  HEALTH_BODY,
  NOT_CARRIED_BODY,
  PAGE_HEALTH_BODY,
  SNAPSHOT_BODY,
  SPEC_GRAPH_BODY,
  SPEC_LIST_BODY,
} from "./runnerBodies";

export type RelayRoute =
  | "health"
  | "components"
  | "apps"
  | "specList"
  | "specGraph"
  | "snapshot"
  | "pageHealth"
  | "visibility";

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const DEFAULTS: Record<RelayRoute, () => Response> = {
  health: () => json(200, HEALTH_BODY),
  components: () => json(200, COMPONENTS_BODY),
  apps: () => json(403, NOT_CARRIED_BODY),
  specList: () => json(200, SPEC_LIST_BODY),
  specGraph: () => json(200, SPEC_GRAPH_BODY),
  snapshot: () => json(200, SNAPSHOT_BODY),
  pageHealth: () => json(200, PAGE_HEALTH_BODY),
  visibility: () => json(403, NOT_CARRIED_BODY),
};

const PREFIX = "/api/v1/device-bridge/runner-proxy/";

/** The route a runner path is, or null for one this page never reads. */
function routeOf(path: string): RelayRoute | null {
  if (path === "health") return "health";
  if (path === "apps") return "apps";
  if (path === "ui-bridge/control/components") return "components";
  if (path === "ui-bridge/control/snapshot") return "snapshot";
  if (path === "ui-bridge/control/page-health") return "pageHealth";
  if (path === "ui-bridge/control/visibility") return "visibility";
  if (/^apps\/[^/]+\/spec\/list$/.test(path)) return "specList";
  if (/^apps\/[^/]+\/spec\/graph$/.test(path)) return "specGraph";
  return null;
}

export interface RelayFake {
  /** Stands in for `httpClient.fetch`. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Every relayed request, as `"<METHOD> <runner path>"`. */
  readonly requests: string[];
  /** The same, as `"<METHOD> <runner path> for <device id>"`. */
  readonly requestsFor: string[];
}

/** The device id a relayed request names (`relay.ts` `DEVICE_ID_HEADER`). */
function deviceOf(init: RequestInit | undefined): string {
  const headers = new Headers(init?.headers);
  return headers.get("X-Qontinui-Device-Id") ?? "(no device)";
}

export function relayFake(
  overrides: Partial<Record<RelayRoute, () => Response>> = {}
): RelayFake {
  const requests: string[] = [];
  const requestsFor: string[] = [];
  return {
    requests,
    requestsFor,
    fetch: async (url: string, init?: RequestInit) => {
      const at = url.indexOf(PREFIX);
      if (at < 0) throw new Error(`unexpected fetch ${url}`);
      const path = url.slice(at + PREFIX.length).split("?")[0] ?? "";
      const method = init?.method ?? "GET";
      requests.push(`${method} ${path}`);
      requestsFor.push(`${method} ${path} for ${deviceOf(init)}`);
      const route = routeOf(path);
      if (route === null) return json(404, { detail: "no such route" });
      return (overrides[route] ?? DEFAULTS[route])();
    },
  };
}

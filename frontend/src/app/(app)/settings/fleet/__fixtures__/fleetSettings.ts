/**
 * Wire fixtures for `/settings/fleet`, shaped by `lib/api/fleet.ts` and
 * `lib/api/runners.ts`, plus a responder that answers the page's calls the
 * way `httpClient.fetch` resolves them (a real `Response`, so `fleet.ts`'s own
 * error handling runs as in production). Shared by the page's test files.
 */

export const DEVICE_ID = "66666666-6666-6666-6666-666666666666";
export const APP_ID = "qontinui-web";

/**
 * `require_admin`'s refusal in the production error envelope: the top level
 * `app/middleware/error_handler.py` composes, with the typed refusal
 * `app/core/refusal.py` nests under `refusal` (the body the backend's
 * `tests/test_fleet_apps_platform_admin_gate.py` pins). The sentence is a
 * LITERAL on purpose: the fleet UI keys on it, so a rewording on either side
 * must turn these tests red.
 */
export const ADMIN_REFUSAL = {
  error: "FORBIDDEN",
  message: "Not authorized. Admin access required.",
  timestamp: 1790000000,
  path: "https://api.test/api/v1/fleet/apps",
  refusal: {
    code: "permission_denied",
    discriminator: "platform_admin_required",
    next_action: { kind: "none_terminal" },
    glossary_terms: [],
    detail: "Not authorized. Admin access required.",
    observed_at: "2026-10-27T12:00:00+00:00",
    source: "web_backend",
  },
};

export const PULL_BUILD_APP = {
  app_id: APP_ID,
  display_name: "Qontinui Web",
  repo_root: "/code/qontinui-web",
  update_strategy: "pull_build",
  build_command: "npm run build",
  start_command: "npm start",
};

export const DESIGNATION = {
  device_id: DEVICE_ID,
  app_id: APP_ID,
  auto_fresh: true,
  device_name: "build-box",
  hostname: "build-box.local",
  derived_status: "healthy",
  freshness: null,
  deployed_sha: null,
  deployed_at: null,
  created_at: "2026-10-27T12:00:00Z",
  updated_at: "2026-10-27T12:00:00Z",
};

export const FRESHNESS_ROW = {
  device_id: DEVICE_ID,
  app_id: APP_ID,
  device_name: "build-box",
  hostname: "build-box.local",
  freshness: "fresh",
  deployed_sha: "0123456789abcdef0123456789abcdef01234567",
  deployed_at: "2026-10-27T12:00:00Z",
  last_error: null,
  updated_at: "2026-10-27T12:00:00Z",
};

/** A `/devices` row: what the add form's Device choice lists. */
export const DEVICE = {
  id: DEVICE_ID,
  name: "build-box",
  hostname: "build-box.local",
  derivedStatus: "healthy",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Answer = () => Response | Promise<Response>;

/** One answer per read the page makes; each defaults to a good one. */
export interface FleetReads {
  apps?: Answer;
  targets?: Answer;
  freshness?: Answer;
  devices?: Answer;
  /** Any write: `PATCH /fleet/apps/{id}`, `PUT`/`DELETE /fleet/test-targets/…`. */
  write?: (method: string, url: string) => Response | Promise<Response>;
}

/**
 * A `httpClient.fetch` stand-in for the page. The defaults are the registry
 * with one app, one designation, no freshness rows and no devices. A call
 * nobody answers throws, so a test cannot pass on a request it did not expect.
 */
export function fleetResponder(reads: FleetReads = {}) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      if (reads.write) return reads.write(method, url);
    } else if (url.endsWith("/fleet/apps")) {
      return (reads.apps ?? (() => json(200, [PULL_BUILD_APP])))();
    } else if (url.endsWith("/fleet/test-targets")) {
      return (reads.targets ?? (() => json(200, [DESIGNATION])))();
    } else if (url.endsWith("/fleet/freshness")) {
      return (reads.freshness ?? (() => json(200, [])))();
    } else if (url.endsWith("/devices")) {
      return (reads.devices ?? (() => json(200, [])))();
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
}

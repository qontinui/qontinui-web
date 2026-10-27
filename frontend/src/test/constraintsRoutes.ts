/**
 * A scripted stand-in for the backend's `/api/v1/constraints` routes, for the
 * constraints UI tests. It answers `httpClient.fetch` by method and route, the
 * way the backend does: the runner's `{ success, data }` envelope on success,
 * and the production error envelope on a refusal or a failure.
 */

import type { Constraint } from "@qontinui/shared-types/constraints";
import { PLATFORM_ADMIN_REFUSAL } from "@/lib/api/fleet";

export interface RouteAnswer {
  status: number;
  body: unknown;
}

/** One built-in constraint, as the runner lists it. */
export const NO_SECRETS: Constraint = {
  id: "builtin:no-secrets",
  name: "No secrets",
  description: "Refuses committed credentials.",
  severity: "block",
  enabled: true,
  check: { type: "grep_forbidden", pattern: "AKIA" },
};

export function ok(data: unknown): RouteAnswer {
  return { status: 200, body: { success: true, data } };
}

/** The production 403 the backend's `require_admin` answers a non-admin with. */
export const ADMIN_REFUSED: RouteAnswer = {
  status: 403,
  body: {
    error: "FORBIDDEN",
    message: PLATFORM_ADMIN_REFUSAL,
    timestamp: 1790000000,
    path: "https://api.test/api/v1/constraints",
    refusal: {
      code: "permission_denied",
      discriminator: "platform_admin_required",
      next_action: { kind: "none_terminal" },
      glossary_terms: [],
      detail: PLATFORM_ADMIN_REFUSAL,
      source: "web_backend",
    },
  },
};

export const RUNNER_UNREACHABLE_SENTENCE =
  "The runner on this backend's host is not reachable. Start the desktop " +
  "runner, then try again.";

/** The backend's typed 502 for a runner it cannot reach. */
export const RUNNER_UNREACHABLE: RouteAnswer = {
  status: 502,
  body: {
    error: "BAD_GATEWAY",
    message: RUNNER_UNREACHABLE_SENTENCE,
    refusal: {
      code: "upstream_unavailable",
      discriminator: "constraints_runner_unreachable",
      next_action: { kind: "retry_later" },
      glossary_terms: ["runner"],
      detail: RUNNER_UNREACHABLE_SENTENCE,
      source: "web_backend",
    },
  },
};

/** What every route answers when a test scripts nothing else. */
export function readableRoutes(): Record<string, RouteAnswer> {
  return {
    "GET /active": ok([NO_SECRETS]),
    "GET /config": ok({ toml: "", path: null }),
    "POST /validate": ok({ valid: true, errors: [], constraints: [] }),
    "POST /config": ok({
      valid: true,
      errors: [],
      path: "/srv/acme/.qontinui/constraints.toml",
    }),
  };
}

/** `METHOD /route` of a call to the constraints API, e.g. `GET /active`. */
export function routeKey(url: unknown, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = new URL(String(url), "https://api.test").pathname;
  return `${method} ${path.replace(/^.*\/api\/v1\/constraints/, "")}`;
}

/** A `Response` carrying `answer`. */
export function respond(answer: RouteAnswer): Response {
  return new Response(JSON.stringify(answer.body), {
    status: answer.status,
    headers: { "Content-Type": "application/json" },
  });
}

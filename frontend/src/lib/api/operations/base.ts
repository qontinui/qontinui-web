/**
 * The one base every module of the typed `/operations` client builds its URLs
 * over — RELATIVE, i.e. same-origin — and the one reader every module parses
 * its responses through.
 *
 * Plan `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D6 chose the relative form over `${ApiConfig.API_BASE_URL}/api/v1/operations`.
 * Production sets `NEXT_PUBLIC_API_URL`, so an absolute base is a CROSS-origin
 * request from `qontinui.io` to `api.qontinui.io`, while the relative form goes
 * same-origin through the `/api/:path*` rewrite in `next.config.mjs`. Relative
 * needs no CORS dependency and keeps the cookie path that a cross-origin fetch
 * with default credentials drops; `httpClient` attaches the bearer and
 * `X-Qontinui-Active-Tenant` on either form.
 *
 * The defect that settled it, measured against production on 2026-10-05: the
 * spawn modal's bare `fetch` to the absolute base carried neither a bearer nor
 * (cross-origin, default `credentials: "same-origin"`) a cookie, and the
 * identical unauthenticated `GET https://api.qontinui.io/api/v1/operations/fleet/health`
 * answers `401 not_authenticated`. The relative form through the Vercel
 * rewrite reaches the same backend.
 *
 * ## One transport: `httpClient.fetch`
 *
 * Only `httpClient.fetch` sends a relative URL as written. `httpClient.get` /
 * `post` / `put` / `patch` / `delete` prefix `ApiConfig.getBaseUrl()` onto any
 * URL that does not start with `http`, so a helper-method call over this base
 * is absolute (cross-origin) wherever `NEXT_PUBLIC_API_URL` is set. So every
 * client function calls `httpClient.fetch` (the D6 amendment) and parses
 * through {@link readJson}, which rejects in the helpers' own error shape.
 *
 * Every client function inlines its URL as a template over this constant and
 * calls `httpClient.fetch` directly — never through a shared `request(path)`
 * helper, which `route-walker.test.ts` cannot resolve (it follows wrappers one
 * level deep only). The reader below takes the `Response`, never the URL, so
 * it is not a wrapper and the walker still sees every call site.
 */

import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { ApiConfig } from "@/services/api-config";
import {
  MAX_SENTENCE_LENGTH,
  messageFromErrorBody,
} from "@/lib/errors/backend-error-message";

export const OPERATIONS_BASE = "/api/v1/operations";

/**
 * The WebSocket URL of an `/operations` push channel: `path` (which starts
 * with `/`, and carries its own query string) under the operations base,
 * with the scheme translated for a WS upgrade.
 *
 * Unlike every REST read here this is ABSOLUTE — `ApiConfig.API_BASE_URL`
 * plus {@link OPERATIONS_BASE} — because a WebSocket upgrade cannot ride the
 * Next.js `/api/:path*` rewrite the relative REST form goes through. It is
 * built exactly as `operationsWsBase()` in `components/operations/utils.ts`
 * builds it: `https://` → `wss://`, `http://` → `ws://`, and a base with no
 * scheme (an unset `NEXT_PUBLIC_API_URL`) prefixed with `ws://`. Auth is not
 * this helper's business: each channel's builder puts its own `token` (and
 * {@link activeTenantWsParam}) into `path`, since a browser WebSocket cannot
 * set headers on the upgrade.
 */
export function wsUrl(path: string): string {
  const base = `${ApiConfig.API_BASE_URL}${OPERATIONS_BASE}`;
  if (base.startsWith("https://")) {
    return "wss://" + base.slice("https://".length) + path;
  }
  if (base.startsWith("http://")) {
    return "ws://" + base.slice("http://".length) + path;
  }
  return "ws://" + base + path;
}

/**
 * The dashboard tenant-switcher selection as a WS query param
 * (`&active_tenant=<id>`), or `""` when none is selected or storage is
 * unreadable. A browser WebSocket cannot send the `X-Qontinui-Active-Tenant`
 * header the REST calls carry (HttpClient attaches it from the same
 * localStorage key), so the WS bridges read `active_tenant` from the query
 * string instead; the backend membership-validates it. Same reading as the
 * private helper of the same name in `components/operations/utils.ts`.
 */
export function activeTenantWsParam(): string {
  if (typeof window === "undefined") return "";
  try {
    const active = window.localStorage.getItem("qontinui.active_tenant_id");
    return active ? `&active_tenant=${encodeURIComponent(active)}` : "";
  } catch {
    return "";
  }
}

/** How {@link readJson} treats a 2xx whose body does not parse as JSON. */
export interface ReadJsonOptions {
  /**
   * `"null"` resolves `null` for a 2xx with an unparseable body instead of
   * rejecting. For a WRITE whose 2xx is the fact that matters (the change
   * landed) and whose body is only a bonus — see `patchRepoProfile`. A
   * non-2xx rejects either way.
   */
  unparseable: "null";
}

/**
 * The shared response reader for the `/operations` client.
 *
 * A non-2xx rejects with an `Error` whose message is exactly
 * `<request> failed: <status> - <body>` — `request` being the call's
 * `<METHOD> <url>`, e.g. `GET /api/v1/operations/fleet/health`. That is the
 * shape `httpClient.get` / `post` / … throw (`services/http-client.ts`, one
 * line per verb, including its `"Unknown error"` stand-in for a body that
 * cannot be read), so `httpStatusOf` / `httpBodyOf` and
 * `describeCoordPollError` read a rejection from here exactly as they read
 * one from the helpers. A 2xx resolves the parsed JSON body.
 *
 * `request` only words the error; it is never fetched, so this is not a URL
 * wrapper and `route-walker.test.ts` resolves the caller's own
 * `httpClient.fetch` as usual.
 */
export async function readJson<T>(res: Response, request: string): Promise<T>;
export async function readJson<T>(
  res: Response,
  request: string,
  options: ReadJsonOptions
): Promise<T | null>;
export async function readJson<T>(
  res: Response,
  request: string,
  options?: ReadJsonOptions
): Promise<T | null> {
  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`${request} failed: ${res.status} - ${errorText}`);
  }
  if (options?.unparseable === "null") {
    return (await res.json().catch(() => null)) as T | null;
  }
  return (await res.json()) as T;
}

/**
 * The operator-facing sentence for a rejection from a client function.
 *
 * A {@link readJson} status rejection is read back through the anchored
 * `httpStatusOf` / `httpBodyOf` (the console's only parsers of that shape) and
 * handed to `messageFromErrorBody` — so it says exactly what
 * `backendErrorMessage(res)` said about the same `Response` before the client
 * returned parsed data. Anything else (a network `TypeError`, a malformed-body
 * error a caller threw itself) is its own `message`, unchanged.
 *
 * `limit` is the surface's bound, as for `backendErrorMessage`.
 */
export function operationsErrorMessage(
  err: unknown,
  limit: number = MAX_SENTENCE_LENGTH
): string {
  const status = httpStatusOf(err);
  if (status !== null) {
    return messageFromErrorBody(httpBodyOf(err) ?? "", status, limit);
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * The terse `HTTP <status>` wording the dashboard's polling streams have
 * always shown for a non-2xx (`useCiStatusStream`, `useSymbolClaimsStream`,
 * `useDevActionsStream`, `useMigrationQueueStream`, the dev-action detail and
 * `notify-when-green` writes), applied to a client-function rejection.
 *
 * Those call sites threw `new Error(\`HTTP ${resp.status}\`)` themselves before
 * the reads moved onto {@link readJson}; this keeps the text they render
 * unchanged. A {@link readJson} status rejection becomes `HTTP <status>`;
 * any other `Error` (network `TypeError`, a malformed body) is its own
 * `message`; a non-`Error` throw is `fallback`.
 */
export function statusOnlyErrorText(err: unknown, fallback: string): string {
  const status = httpStatusOf(err);
  if (status !== null) return `HTTP ${status}`;
  return err instanceof Error ? err.message : fallback;
}

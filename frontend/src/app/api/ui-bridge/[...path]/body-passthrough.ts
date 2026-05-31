/**
 * UI Bridge Proxy — Request Body Pass-Through
 *
 * For POST/PUT/PATCH requests, this helper pre-reads the inbound request
 * body once and re-wraps it in a fresh `NextRequest` carrying the same
 * bytes, with an explicit `Content-Type: application/json` header set.
 *
 * Why: when the proxy is served behind Vercel (or any other CDN layer that
 * touches `Request` internals), passing the original `NextRequest` straight
 * through to the SDK's `request.json()` has been observed to drop JSON
 * fields by name — e.g. `POST /ai/find {"text":"X"}` arrived at the relay
 * with `text` missing, so the downstream `elementText` came out empty.
 *
 * The pre-read + re-wrap pattern eliminates that whole class of bug by
 * forcing the body to flow through as a single Buffer with an unambiguous
 * Content-Type, leaving zero ambiguity for the SDK or any downstream layer
 * about how to deserialize it.
 *
 * GET / DELETE / HEAD / OPTIONS never have bodies, so we skip the wrap and
 * pass the original request through unchanged (preserves query params +
 * headers + cookies).
 */

import { NextRequest } from "next/server";

/** HTTP methods that may carry a request body. */
export const BODY_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
]);

/**
 * Pre-read the request body once and return a fresh `NextRequest` carrying
 * the same bytes. Returns the original `request` unchanged when:
 *   - The method has no body (GET/DELETE/HEAD/OPTIONS).
 *   - The body is empty (zero bytes).
 *   - Reading the body throws (then the SDK's own error path takes over).
 */
export async function passThroughBody(
  request: NextRequest,
  method: string
): Promise<NextRequest> {
  const { request: out } = await passThroughBodyWithPeek(request, method);
  return out;
}

/**
 * Pre-read the request body once and return both the fresh `NextRequest`
 * AND a best-effort parsed JSON peek of the body — without reading the
 * bytes twice. The peek lets the audit-log middleware extract a safe
 * summary (elementId, action, textLength) on the same single read.
 *
 * Returns `{request, parsedBody: undefined}` when:
 *   - The method has no body (GET/DELETE/HEAD/OPTIONS).
 *   - The body is empty.
 *   - Reading the body throws.
 *   - The body is non-JSON / unparseable.
 *
 * The returned `request` carries the same bytes as the original (re-wrapped
 * with `Content-Type: application/json`) so the SDK's `request.json()`
 * still works downstream.
 */
export async function passThroughBodyWithPeek(
  request: NextRequest,
  method: string
): Promise<{ request: NextRequest; parsedBody: unknown | undefined }> {
  if (!BODY_METHODS.has(method)) {
    return { request, parsedBody: undefined };
  }
  let raw: ArrayBuffer;
  try {
    raw = await request.arrayBuffer();
  } catch {
    return { request, parsedBody: undefined };
  }
  if (raw.byteLength === 0) {
    return { request, parsedBody: undefined };
  }

  // Best-effort JSON peek. If the body isn't JSON the audit summary just
  // gets `undefined` here and the row records the command without a
  // summary — never blocks the request.
  let parsedBody: unknown | undefined;
  try {
    parsedBody = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch {
    parsedBody = undefined;
  }

  // Copy ALL inbound headers, then force Content-Type to JSON. Some clients
  // (curl without `-H` for instance) post bodies with no Content-Type at
  // all; the SDK then can't parse and returns `{}`. Forcing the header here
  // means the proxy ALWAYS hands the SDK a well-formed JSON request.
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");

  // `NextRequest` extends `Request`. Re-construct from the original URL so
  // `request.nextUrl.searchParams` keeps working downstream. We use the
  // constructor pulled off the original request (instead of `new
  // NextRequest(...)` literally) so this helper stays compatible with any
  // NextRequest subclass Vercel / Next.js may swap in at runtime.
  const NextRequestCtor = request.constructor as new (
    input: string | URL,
    init?: RequestInit
  ) => NextRequest;
  const out = new NextRequestCtor(request.url, {
    method,
    headers,
    body: raw,
  });
  return { request: out, parsedBody };
}

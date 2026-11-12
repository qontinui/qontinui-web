/**
 * UI Bridge Proxy — Request Body Pass-Through
 *
 * For POST/PUT/PATCH/DELETE requests, this helper pre-reads the inbound
 * request body once and re-wraps it in a fresh `NextRequest` carrying the
 * same bytes, with an explicit `Content-Type: application/json` header set.
 *
 * Why: when the proxy is served behind Vercel (or any other CDN layer that
 * touches `Request` internals), passing the original `NextRequest` straight
 * through to the SDK has been observed to drop JSON fields by name — e.g.
 * `POST /ai/find {"text":"X"}` arrived at the relay with `text` missing, so
 * the downstream `elementText` came out empty.
 *
 * The pre-read + re-wrap pattern eliminates that whole class of bug by
 * forcing the body to flow through as a single Buffer with an unambiguous
 * Content-Type, leaving zero ambiguity for the SDK or any downstream layer
 * about how to deserialize it.
 *
 * GET / HEAD / OPTIONS never have bodies, so we skip the wrap and pass the
 * original request through unchanged (preserves query params + headers +
 * cookies). DELETE is read like POST: the SDK declares a DELETE route that
 * takes a body (`DELETE /control/media/override`).
 */

import { NextRequest } from "next/server";

/** HTTP methods that may carry a request body. */
export const BODY_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Pre-read the request body once and return a fresh `NextRequest` carrying
 * the same bytes. Returns the original `request` unchanged when:
 *   - The method has no body (GET/HEAD/OPTIONS).
 *   - Reading the body throws (then the SDK's own error path takes over).
 * An empty body comes back as a fresh request with no body at all.
 */
export async function passThroughBody(
  request: NextRequest,
  method: string
): Promise<NextRequest> {
  const { request: out } = await passThroughBodyWithPeek(request, method);
  return out;
}

/**
 * What the route knows about a request body, read by the SDK's own rule
 * ({@link readBodyAsTheSdkDoes}).
 *
 *  - `absent`      — the method carries no body here, or the body is empty or
 *                    blank, which the SDK reads as no body.
 *  - `parsed`      — the body parses; `parsedBody` is the value the SDK reads.
 *  - `unparseable` — the body is not JSON, which the SDK refuses (400).
 *  - `unreadable`  — reading the bytes threw, so nothing is known about them.
 */
export type BodyState = "absent" | "parsed" | "unparseable" | "unreadable";

/**
 * The SDK's rule for what a request body means, applied to the request this
 * route forwards. Since 0.46 the SDK's Next adapter reads every body through
 * `readJsonBody` (ui-bridge `src/server/request-body.ts`): a default
 * `TextDecoder` decodes the bytes (dropping one leading byte-order mark), a
 * blank result is no body, and anything else is `JSON.parse`d. The forwarded
 * request always declares JSON (see the re-wrap below), so a body that does
 * not parse is refused; the reader's "declared as another type" arm, which
 * reads such a body as none, never runs.
 *
 * The peek must reach the SDK's verdict on every body: the caller-identity
 * strip in `route.ts` only strips a body the peek parsed, so a body the SDK
 * reads a value from but the peek did not would reach a handler unstripped.
 * `body-passthrough.differential.test.ts` holds this function to the
 * installed SDK's handler case by case. (The platform's `Request.json()` is
 * NOT that rule: on Node 24 it drops two leading byte-order marks where the
 * SDK drops one, and refuses a blank body the SDK reads as none.)
 *
 * The SDK's 10 MB cap is its own to enforce (413); a body over it parses
 * here and is refused there.
 */
function readBodyAsTheSdkDoes(raw: ArrayBuffer): {
  bodyState: "absent" | "parsed" | "unparseable";
  parsedBody: unknown;
} {
  const text = new TextDecoder().decode(raw);
  if (!text.trim()) return { bodyState: "absent", parsedBody: undefined };
  try {
    return { bodyState: "parsed", parsedBody: JSON.parse(text) as unknown };
  } catch {
    return { bodyState: "unparseable", parsedBody: undefined };
  }
}

/**
 * Pre-read the request body once and return both the fresh `NextRequest`
 * AND the body as the SDK will read it — without reading the bytes twice.
 * The parsed peek lets the audit-log middleware extract a safe summary
 * (elementId, action, textLength), and lets `route.ts` remove a caller
 * identity the body names, on the same single read.
 *
 * `parsedBody` is set only when `bodyState` is `parsed`. When the method has
 * no body, or reading it throws, the original `request` is returned
 * unchanged. An empty body is returned as a fresh request with NO body: the
 * read disturbed the original's (zero-byte) stream, which the SDK's reader
 * would refuse.
 *
 * Otherwise the returned `request` carries the same bytes as the original
 * (re-wrapped with `Content-Type: application/json`) for the SDK's JSON body
 * reader downstream.
 */
export async function passThroughBodyWithPeek(
  request: NextRequest,
  method: string
): Promise<{
  request: NextRequest;
  parsedBody: unknown | undefined;
  bodyState: BodyState;
}> {
  if (!BODY_METHODS.has(method)) {
    return { request, parsedBody: undefined, bodyState: "absent" };
  }
  let raw: ArrayBuffer;
  try {
    raw = await request.arrayBuffer();
  } catch {
    return { request, parsedBody: undefined, bodyState: "unreadable" };
  }

  // `NextRequest` extends `Request`. Re-construct from the original URL so
  // `request.nextUrl.searchParams` keeps working downstream. We use the
  // constructor pulled off the original request (instead of `new
  // NextRequest(...)` literally) so this helper stays compatible with any
  // NextRequest subclass Vercel / Next.js may swap in at runtime.
  const NextRequestCtor = request.constructor as new (
    input: string | URL,
    init?: RequestInit
  ) => NextRequest;

  if (raw.byteLength === 0) {
    // Next gives every non-GET/HEAD request a body stream, a zero-byte one
    // included, and reading it above disturbed it. Hand the SDK a request
    // with no body at all, which its reader reads as no body.
    const empty = new NextRequestCtor(request.url, {
      method,
      headers: request.headers,
    });
    return { request: empty, parsedBody: undefined, bodyState: "absent" };
  }

  const { bodyState, parsedBody } = readBodyAsTheSdkDoes(raw);

  // Copy ALL inbound headers, then force Content-Type to JSON. Some clients
  // (curl without `-H` for instance) post bodies with no Content-Type at
  // all, or a non-JSON one, and the SDK's reader reads a body declared as
  // another type that does not parse as NO body instead of refusing it.
  // Forcing the header means the SDK always reads the forwarded body by the
  // rule the peek above applied.
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");

  const out = new NextRequestCtor(request.url, {
    method,
    headers,
    body: raw,
  });
  return { request: out, parsedBody, bodyState };
}

/**
 * The typed refusal `route.ts` returns, with the auth gate on, for a body it
 * cannot read the way the SDK reads it (`bodyState` `unparseable` or
 * `unreadable`). A caller identity cannot be removed from a body that cannot
 * be parsed, so such a body is refused rather than forwarded as it came.
 */
export function unreadableBodyResponse(
  bodyState: "unparseable" | "unreadable"
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: bodyState === "unparseable" ? "BODY_NOT_JSON" : "BODY_UNREADABLE",
      message:
        bodyState === "unparseable"
          ? "UI Bridge relay request bodies must be JSON; this body could not be parsed as JSON"
          : "UI Bridge relay could not read this request body",
    }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }
  );
}

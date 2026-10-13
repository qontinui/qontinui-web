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
 * What the route knows about a request body, read the way the SDK reads it.
 *
 *  - `absent`      — the method carries no body here, or the body is empty.
 *  - `parsed`      — the SDK's parser parsed it; `parsedBody` is the result.
 *  - `unparseable` — bytes are present and the SDK's parser refused them.
 *  - `unreadable`  — reading the bytes threw, so nothing is known about them.
 */
export type BodyState = "absent" | "parsed" | "unparseable" | "unreadable";

/**
 * Pre-read the request body once and return both the fresh `NextRequest`
 * AND the body as the SDK will parse it — without reading the bytes twice.
 * The parsed peek lets the audit-log middleware extract a safe summary
 * (elementId, action, textLength), and lets `route.ts` remove a caller
 * identity the body names, on the same single read.
 *
 * `parsedBody` is set only when `bodyState` is `parsed`. When the method has
 * no body, the body is empty, or reading it throws, the original `request`
 * is returned unchanged.
 *
 * The returned `request` carries the same bytes as the original (re-wrapped
 * with `Content-Type: application/json`) so the SDK's `request.json()`
 * still works downstream.
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
  if (raw.byteLength === 0) {
    return { request, parsedBody: undefined, bodyState: "absent" };
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

  // The peek parses with the SDK's own parser. The SDK reads every body it
  // reads with `request.json()`, called on the request this route forwards:
  // an instance of `NextRequestCtor` carrying these same bytes. So the peek
  // calls exactly that — `.json()` on a throwaway instance of the same class
  // built from the same bytes — rather than imitating it. Whatever that
  // parser accepts (however many leading byte-order marks it drops, whatever
  // it does with invalid UTF-8) the peek accepts identically, and whatever it
  // refuses the peek refuses. The caller-identity strip in `route.ts` depends
  // on that: a body the peek could not parse but the SDK could would reach
  // the SDK unstripped.
  let parsedBody: unknown | undefined;
  let bodyState: BodyState;
  try {
    parsedBody = await new NextRequestCtor(request.url, {
      method,
      body: raw,
    }).json();
    bodyState = "parsed";
  } catch {
    parsedBody = undefined;
    bodyState = "unparseable";
  }

  // Copy ALL inbound headers, then force Content-Type to JSON. Some clients
  // (curl without `-H` for instance) post bodies with no Content-Type at
  // all; the SDK then can't parse and returns `{}`. Forcing the header here
  // means the proxy ALWAYS hands the SDK a well-formed JSON request.
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

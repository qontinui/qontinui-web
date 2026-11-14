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
 * A body the SDK reads as none comes back as a fresh request with no body.
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
 *  - `absent`      — the method carries no body here, or the body is within
 *                    the SDK's cap and the SDK reads it as none: empty,
 *                    blank, or declared as a non-JSON type and not JSON.
 *  - `parsed`      — the body parses; `parsedBody` is the value the SDK reads.
 *  - `unparseable` — the body is declared JSON (or declared as nothing) and is
 *                    not JSON, which the SDK refuses (400).
 *  - `oversized`   — the body is over the SDK's cap ({@link overTheSdkCap}),
 *                    which the SDK refuses (413) before reading what it means;
 *                    it is forwarded as it came, for the SDK to refuse.
 *  - `unreadable`  — reading the bytes threw, so nothing is known about them.
 */
export type BodyState =
  | "absent"
  | "parsed"
  | "unparseable"
  | "oversized"
  | "unreadable";

/**
 * The SDK's body cap, in bytes: `MAX_BODY_BYTES` in ui-bridge
 * `src/server/request-body.ts` (10 MiB).
 */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Whether the SDK refuses this body as too large (413), as `readJsonBody`
 * decides it before reading what the body means: a declared Content-Length
 * over the cap (`Number.isFinite(declared) && declared > MAX_BODY_BYTES`),
 * or bytes running past it (`total > MAX_BODY_BYTES`). A body of exactly
 * `MAX_BODY_BYTES` is read.
 */
function overTheSdkCap(request: NextRequest, raw: ArrayBuffer): boolean {
  const declared = Number(request.headers.get("content-length"));
  return (
    (Number.isFinite(declared) && declared > MAX_BODY_BYTES) ||
    raw.byteLength > MAX_BODY_BYTES
  );
}

/**
 * A content type that declares JSON: `application/json`, `application/x+json`,
 * … — the SDK's own spelling (`JSON_CONTENT_TYPE`, ui-bridge
 * `src/server/request-body.ts`).
 */
const JSON_CONTENT_TYPE = /[/+]json\b/i;

/**
 * The SDK's rule for what the client's request body means. Since 0.46 the
 * SDK's Next adapter reads every body it reads through `readJsonBody`
 * (ui-bridge `src/server/request-body.ts`, `interpretJsonBody`): a default
 * `TextDecoder` decodes the bytes (dropping one leading byte-order mark), a
 * blank result is no body, anything else is `JSON.parse`d, and a body that
 * does not parse is refused — unless it was declared as a non-JSON type, in
 * which case it is no body. A declared type does not stop a body that DOES
 * parse from being read: the parse runs first.
 *
 * The peek must reach the verdict the SDK reaches on the client's request
 * wherever the SDK reads a body: the caller-identity strip in `route.ts` only
 * strips a body the peek parsed, so a body the SDK reads a value from but the
 * peek did not would reach a handler unstripped.
 * `body-passthrough.differential.test.ts` holds this function to the
 * installed SDK's handler case by case, under every content type a client
 * may declare. (The platform's `Request.json()` is NOT that rule: on Node 24
 * it drops two leading byte-order marks where the SDK drops one, and refuses
 * a blank body the SDK reads as none.)
 *
 * A body over the SDK's cap never reaches this function:
 * `passThroughBodyWithPeek` checks the cap first ({@link overTheSdkCap}), as
 * `readJsonBody` does, and the SDK refuses such a body (413) whatever it
 * holds.
 */
function readBodyAsTheSdkDoes(
  raw: ArrayBuffer,
  contentType: string | null
): {
  bodyState: "absent" | "parsed" | "unparseable";
  parsedBody: unknown;
} {
  const text = new TextDecoder().decode(raw);
  if (!text.trim()) return { bodyState: "absent", parsedBody: undefined };
  try {
    return { bodyState: "parsed", parsedBody: JSON.parse(text) as unknown };
  } catch {
    if (contentType && !JSON_CONTENT_TYPE.test(contentType)) {
      return { bodyState: "absent", parsedBody: undefined };
    }
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
 * unchanged. A body within the SDK's cap that the SDK reads as none
 * (`absent`: empty, blank, or a non-JSON-declared body that is not JSON) is
 * returned as a fresh request with NO body; a body over the cap
 * (`oversized`) keeps its bytes, for the SDK to refuse.
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

  // In the SDK's own order: the cap first, then what the body means.
  const { bodyState, parsedBody } = overTheSdkCap(request, raw)
    ? { bodyState: "oversized" as const, parsedBody: undefined }
    : raw.byteLength === 0
      ? { bodyState: "absent" as const, parsedBody: undefined }
      : readBodyAsTheSdkDoes(raw, request.headers.get("content-type"));

  if (bodyState === "absent") {
    // A body within the SDK's cap that it reads as none goes on as a request
    // with NO body, which its reader reads as none whatever it declares. That
    // includes an empty one: Next gives every non-GET/HEAD request a body
    // stream, a zero-byte one included, and reading it above disturbed it,
    // which the SDK's reader would refuse. A body over the cap is never
    // taken this way (it is `oversized`): the SDK refuses it (413), where a
    // bodyless request would run the handler.
    const bodyless = new NextRequestCtor(request.url, {
      method,
      headers: request.headers,
    });
    return { request: bodyless, parsedBody: undefined, bodyState };
  }

  // Copy ALL inbound headers, then force Content-Type to JSON. Some clients
  // (curl without `-H` for instance) post bodies with no Content-Type at
  // all, or a non-JSON one. What reaches here is over the cap (the SDK
  // refuses it before reading its type), parses (the SDK parses it whatever
  // it declares) or was declared JSON or nothing and does not (the SDK
  // refuses it), so the forced header changes no verdict and hands the SDK
  // an unambiguous JSON request.
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

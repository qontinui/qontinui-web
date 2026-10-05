/**
 * The one cookie-to-bearer hop for the `app/api/v1/**` proxy route handlers.
 *
 * Next.js rewrites do not forward the HttpOnly `access_token` cookie to the
 * backend, so a handler reads it here and forwards it as
 * `Authorization: Bearer …`. The handlers historically differed in how they
 * did that; each difference is a named option, so a handler states its
 * contract instead of re-implementing it.
 *
 * Route handlers only; this imports `next/headers` and `next/server`.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { backendBaseOrResponse } from "@/lib/errors/endpoint-response";
import { createLogger } from "@/lib/logger";

const log = createLogger("proxyToBackend");

/** Where the bearer token may come from, in order of preference. */
export type TokenSource = "cookie" | "header";

/** The 500 body a caught error answers with, or `"throw"` to let it propagate. */
export type ErrorBody =
  /** `{detail: "Failed to proxy request to backend", error: <message>}` */
  | "detail"
  /** `{error: "Failed to proxy request to backend", details: <message>, name: <name>}` */
  | "details"
  /** `{error: <message>}` with a fixed message */
  | { error: string }
  /** No catch: the error propagates to Next.js. */
  | "throw";

export type ProxyOptions = {
  tokenSources: readonly ["cookie"] | readonly ["cookie", "header"];
  /**
   * The request body forwarded for POST / PUT / PATCH (never for other
   * verbs): `"json"` parses and re-stringifies it (an unparseable body is a
   * caught error), `"text"` forwards it verbatim. Default `"none"`.
   */
  forwardBody?: "none" | "json" | "text";
  /**
   * The query string forwarded: `"raw"` is the request's own `search`,
   * `"reencoded"` is `searchParams.toString()`. Default `"drop"`.
   */
  query?: "drop" | "raw" | "reencoded";
  errorBody: ErrorBody;
} & (
  | { onMissingToken: "401"; unauthorizedBodyKey: "detail" | "error" }
  | { onMissingToken: "forward" }
);

const BODY_VERBS = new Set(["POST", "PUT", "PATCH"]);

/**
 * Upstream statuses a `Response` must carry no body for. (101 is one too, but
 * `fetch` never yields it and a `Response` cannot be built with it.)
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** The upstream `Content-Type` passes through, so never let a browser sniff. */
const NOSNIFF = { "X-Content-Type-Options": "nosniff" } as const;

async function readToken(
  request: NextRequest,
  sources: readonly TokenSource[]
): Promise<string | null> {
  const cookie = (await cookies()).get("access_token")?.value;
  if (cookie) return cookie;
  const header = request.headers.get("Authorization");
  if (sources.includes("header") && header?.startsWith("Bearer ")) {
    return header.substring(7) || null;
  }
  return null;
}

function queryOf(request: NextRequest, mode: ProxyOptions["query"]): string {
  if (mode === "raw") return new URL(request.url).search;
  if (mode === "reencoded") {
    const qs = request.nextUrl.searchParams.toString();
    return qs ? `?${qs}` : "";
  }
  return "";
}

function errorResponse(shape: Exclude<ErrorBody, "throw">, err: Error) {
  const body =
    shape === "detail"
      ? { detail: "Failed to proxy request to backend", error: err.message }
      : shape === "details"
        ? {
            error: "Failed to proxy request to backend",
            details: err.message,
            name: err.name,
          }
        : shape;
  return NextResponse.json(body, { status: 500 });
}

async function forward(
  request: NextRequest,
  backendPath: string,
  options: ProxyOptions
): Promise<NextResponse> {
  const token = await readToken(request, options.tokenSources);
  if (!token && options.onMissingToken === "401") {
    return NextResponse.json(
      { [options.unauthorizedBodyKey]: "Not authenticated" },
      { status: 401 }
    );
  }

  // Resolve the base before touching the body: an unresolved backend answers
  // its structured 503 even when the body is malformed.
  const base = backendBaseOrResponse();
  if (base instanceof NextResponse) return base;

  const forwardBody = BODY_VERBS.has(request.method)
    ? (options.forwardBody ?? "none")
    : "none";
  const body =
    forwardBody === "json"
      ? JSON.stringify(await request.json())
      : forwardBody === "text"
        ? await request.text()
        : undefined;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  log.debug(`${request.method} -> ${backendPath}`);
  const response = await fetch(
    `${base}${backendPath}${queryOf(request, options.query)}`,
    // Next.js serves an un-exported HEAD with the GET handler; forward GET.
    {
      method: request.method === "HEAD" ? "GET" : request.method,
      headers,
      body,
    }
  );

  if (NULL_BODY_STATUSES.has(response.status)) {
    return new NextResponse(null, {
      status: response.status,
      headers: NOSNIFF,
    });
  }
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") || "application/json",
      ...NOSNIFF,
    },
  });
}

/**
 * Forward `request` to `${backend}${backendPath}` with the caller's bearer
 * token, and pass the upstream answer through as it came: its status, its
 * text and its `Content-Type` (`application/json` when it sends none), with a
 * 204 / 205 / 304 kept empty, and always `X-Content-Type-Options: nosniff`.
 * An unresolved backend base answers the structured 503 from
 * `backendBaseOrResponse()`; a missing token answers 401 before that.
 */
export async function proxyToBackend(
  request: NextRequest,
  backendPath: string,
  options: ProxyOptions
): Promise<NextResponse> {
  const { errorBody } = options;
  if (errorBody === "throw") return forward(request, backendPath, options);
  try {
    return await forward(request, backendPath, options);
  } catch (error) {
    console.error(`[proxyToBackend ${backendPath}] Error:`, error);
    return errorResponse(errorBody, error as Error);
  }
}

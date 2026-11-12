/**
 * Tests for the UI Bridge proxy's request body pass-through.
 *
 * Regression test for the field-strip bug observed via curl:
 *   POST /api/ui-bridge/ai/find {"text":"X"}
 * arriving at the relay with `text` missing. The pass-through must preserve
 * EVERY field of the inbound JSON body — including known-bad-historically
 * fields like `text` — and the rewrapped request must expose those fields
 * to the SDK's JSON body reader downstream.
 */

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  passThroughBody,
  passThroughBodyWithPeek,
  BODY_METHODS,
} from "./body-passthrough";

function makeRequest(
  url: string,
  init?: RequestInit & { body?: string }
): NextRequest {
  return new NextRequest(url, init);
}

describe("passThroughBody", () => {
  it("preserves a {text:'hello'} body verbatim for POST", async () => {
    const original = makeRequest("http://localhost/api/ui-bridge/ai/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    const forwarded = await passThroughBody(original, "POST");
    const parsed = await forwarded.json();
    expect(parsed).toEqual({ text: "hello" });
  });

  it("preserves multi-field bodies including 'text', 'query', and nested objects", async () => {
    const body = {
      text: "find the close button",
      query: "X",
      context: { tabId: "abc", url: "https://example.com" },
      confidenceThreshold: 0.5,
      strict: true,
    };
    const original = makeRequest("http://localhost/api/ui-bridge/ai/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const forwarded = await passThroughBody(original, "POST");
    const parsed = await forwarded.json();
    expect(parsed).toEqual(body);
  });

  it("forces Content-Type: application/json even when the client omits it", async () => {
    const original = makeRequest("http://localhost/api/ui-bridge/ai/find", {
      method: "POST",
      // No Content-Type header — simulates `curl -d ...` with no `-H`.
      body: JSON.stringify({ text: "hello" }),
    });
    const forwarded = await passThroughBody(original, "POST");
    expect(forwarded.headers.get("Content-Type")).toBe("application/json");
  });

  it("returns the original request unchanged for GET (no body to re-wrap)", async () => {
    const original = makeRequest(
      "http://localhost/api/ui-bridge/ai/snapshot?detailed=true",
      { method: "GET" }
    );
    const forwarded = await passThroughBody(original, "GET");
    expect(forwarded).toBe(original);
  });

  it("re-wraps and peeks a DELETE body, as the SDK reads one on DELETE /control/media/override", async () => {
    const original = makeRequest(
      "http://localhost/api/ui-bridge/control/media/override",
      { method: "DELETE", body: JSON.stringify({ elementId: "img-1" }) }
    );
    const { request, parsedBody, bodyState } = await passThroughBodyWithPeek(
      original,
      "DELETE"
    );
    expect(bodyState).toBe("parsed");
    expect(parsedBody).toEqual({ elementId: "img-1" });
    expect(request).not.toBe(original);
    expect(request.method).toBe("DELETE");
    expect(request.headers.get("Content-Type")).toBe("application/json");
    expect(await request.json()).toEqual({ elementId: "img-1" });
  });

  it("hands an empty body on as a fresh request with no body, never the read original", async () => {
    // Next gives every non-GET/HEAD request a body stream, a zero-byte one
    // included. Reading it to learn it is empty disturbs it, and the SDK's
    // reader refuses a disturbed body (400 "Request body could not be read").
    const original = makeRequest(
      "http://localhost/api/ui-bridge/control/find?tabId=t1",
      {
        method: "POST",
        headers: { "x-ui-bridge-tab-id": "t1" },
        body: "",
      }
    );
    // Precondition: a zero-byte STREAM, not a missing body.
    expect(original.body).not.toBeNull();

    const { request, parsedBody, bodyState } = await passThroughBodyWithPeek(
      original,
      "POST"
    );
    expect(bodyState).toBe("absent");
    expect(parsedBody).toBeUndefined();
    expect(request).not.toBe(original);
    expect(request.body).toBeNull();
    expect(request.bodyUsed).toBe(false);
    expect(request.method).toBe("POST");
    expect(request.url).toBe(original.url);
    expect(request.nextUrl.searchParams.get("tabId")).toBe("t1");
    expect(request.headers.get("x-ui-bridge-tab-id")).toBe("t1");
  });

  it("re-wraps PUT and PATCH requests too", async () => {
    for (const method of ["PUT", "PATCH"]) {
      const original = makeRequest("http://localhost/api/ui-bridge/x", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "X" }),
      });
      const forwarded = await passThroughBody(original, method);
      expect(forwarded).not.toBe(original);
      const parsed = await forwarded.json();
      expect(parsed).toEqual({ text: "X" });
    }
  });

  it("preserves the original URL so downstream nextUrl.searchParams still works", async () => {
    const original = makeRequest(
      "http://localhost/api/ui-bridge/ai/find?recency=current&debug=1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "X" }),
      }
    );
    const forwarded = await passThroughBody(original, "POST");
    expect(forwarded.nextUrl.searchParams.get("recency")).toBe("current");
    expect(forwarded.nextUrl.searchParams.get("debug")).toBe("1");
  });

  it("peeks a body with one leading byte-order mark, which the SDK's reader drops", async () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('{"text":"X"}'),
    ]);
    const req = new NextRequest("http://localhost/api/ui-bridge/ai/find", {
      method: "POST",
      body: bytes,
    });
    const { request, parsedBody, bodyState } = await passThroughBodyWithPeek(
      req,
      "POST"
    );
    expect(bodyState).toBe("parsed");
    expect(parsedBody).toEqual({ text: "X" });
    expect(await request.json()).toEqual({ text: "X" });
  });

  it("reports a body as absent for a bodiless method or an empty body", async () => {
    const get = await passThroughBodyWithPeek(
      makeRequest("http://localhost/api/ui-bridge/control/snapshot"),
      "GET"
    );
    expect(get.bodyState).toBe("absent");
    const empty = await passThroughBodyWithPeek(
      makeRequest("http://localhost/api/ui-bridge/ai/find", { method: "POST" }),
      "POST"
    );
    expect(empty.bodyState).toBe("absent");
    expect(empty.parsedBody).toBeUndefined();
  });

  it("reports a body the SDK's reader refuses as unparseable, and still forwards its bytes", async () => {
    const req = makeRequest("http://localhost/api/ui-bridge/ai/find", {
      method: "POST",
      body: "text=X",
    });
    const { request, parsedBody, bodyState } = await passThroughBodyWithPeek(
      req,
      "POST"
    );
    expect(bodyState).toBe("unparseable");
    expect(parsedBody).toBeUndefined();
    expect(await request.text()).toBe("text=X");
  });

  it("reports a body whose stream fails as unreadable", async () => {
    const req = new NextRequest("http://localhost/api/ui-bridge/ai/find", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("the client went away"));
        },
      }),
    });
    const { parsedBody, bodyState } = await passThroughBodyWithPeek(
      req,
      "POST"
    );
    expect(bodyState).toBe("unreadable");
    expect(parsedBody).toBeUndefined();
  });

  it("reports a body behind two byte-order marks as unparseable, as the SDK's reader refuses it", async () => {
    // The platform's `Request.json()` drops both marks (measured on Node 24);
    // the SDK's `TextDecoder` drops one and refuses the rest.
    const bytes = new Uint8Array([
      ...[0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf],
      ...new TextEncoder().encode('{"text":"X"}'),
    ]);
    const { parsedBody, bodyState } = await passThroughBodyWithPeek(
      new NextRequest("http://localhost/api/ui-bridge/ai/find", {
        method: "POST",
        body: bytes,
      }),
      "POST"
    );
    expect(bodyState).toBe("unparseable");
    expect(parsedBody).toBeUndefined();
  });

  it("reports a blank body as absent, as the SDK's reader reads it as no body, and forwards its bytes", async () => {
    for (const blank of [" \t\r\n ", "\ufeff", "\u00a0"]) {
      const { request, parsedBody, bodyState } = await passThroughBodyWithPeek(
        makeRequest("http://localhost/api/ui-bridge/ai/find", {
          method: "POST",
          body: blank,
        }),
        "POST"
      );
      expect(bodyState).toBe("absent");
      expect(parsedBody).toBeUndefined();
      expect([...new Uint8Array(await request.arrayBuffer())]).toEqual([
        ...new TextEncoder().encode(blank),
      ]);
    }
  });

  it("BODY_METHODS contains exactly POST/PUT/PATCH/DELETE", () => {
    expect(new Set(BODY_METHODS)).toEqual(
      new Set(["POST", "PUT", "PATCH", "DELETE"])
    );
  });
});

/**
 * Tests for the UI Bridge proxy's request body pass-through.
 *
 * Regression test for the field-strip bug observed via curl:
 *   POST /api/ui-bridge/ai/find {"text":"X"}
 * arriving at the relay with `text` missing. The pass-through must preserve
 * EVERY field of the inbound JSON body — including known-bad-historically
 * fields like `text` — and the rewrapped request must expose those fields
 * when the SDK does `await request.json()`.
 */

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { passThroughBody, BODY_METHODS } from "./body-passthrough";

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

  it("returns the original request unchanged for DELETE", async () => {
    const original = makeRequest("http://localhost/api/ui-bridge/state/x", {
      method: "DELETE",
    });
    const forwarded = await passThroughBody(original, "DELETE");
    expect(forwarded).toBe(original);
  });

  it("returns the original request when body is empty (zero bytes)", async () => {
    const original = makeRequest("http://localhost/api/ui-bridge/something", {
      method: "POST",
    });
    const forwarded = await passThroughBody(original, "POST");
    expect(forwarded).toBe(original);
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

  it("BODY_METHODS contains exactly POST/PUT/PATCH", () => {
    expect(new Set(BODY_METHODS)).toEqual(new Set(["POST", "PUT", "PATCH"]));
  });
});

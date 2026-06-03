/**
 * Tests for the UI Bridge co-pilot audit-log middleware.
 *
 * Covers the three building blocks in `_audit.ts`:
 *
 *   - `isAuditablePath` — the path/method classifier.
 *   - `commandNameFromPath` — canonical command names.
 *   - `summarizeBody` — SAFE summary extractor (NEVER raw payload).
 *   - `targetElementIdFor` / `tabIdFor` — column extraction.
 *   - `recordAudit` — fire-and-forget POST to the backend.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.8.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  commandNameFromPath,
  deriveExecutionStatus,
  isAuditablePath,
  recordAudit,
  summarizeBody,
  tabIdFor,
  targetElementIdFor,
} from "./_audit";

describe("deriveExecutionStatus (Bug 3b: receipt vs execution)", () => {
  it("HTTP >= 400 → failed regardless of body", () => {
    expect(deriveExecutionStatus(500, { success: true })).toBe("failed");
    expect(deriveExecutionStatus(503, null)).toBe("failed");
  });
  it("body success:true → executed", () => {
    expect(deriveExecutionStatus(200, { success: true })).toBe("executed");
  });
  it("body success:false → failed even on a 200 receipt", () => {
    // The relay returned 200 (delivered) but the tab reported non-execution.
    expect(
      deriveExecutionStatus(200, { success: false, code: "UB-ACTION-TIMEOUT" }),
    ).toBe("failed");
    expect(
      deriveExecutionStatus(200, { success: false, code: "NO_BROWSER_CONNECTED" }),
    ).toBe("failed");
  });
  it("no success field → received (don't over-claim execution)", () => {
    expect(deriveExecutionStatus(200, { data: { foo: 1 } })).toBe("received");
    expect(deriveExecutionStatus(200, null)).toBe("received");
    expect(deriveExecutionStatus(200, "not-json")).toBe("received");
  });
});

describe("isAuditablePath", () => {
  it("audits POST /control/element/:id/action", () => {
    expect(isAuditablePath("/control/element/btn-1/action", "POST")).toBe(true);
  });
  it("audits POST /control/page/navigate", () => {
    expect(isAuditablePath("/control/page/navigate", "POST")).toBe(true);
  });
  it("audits POST /control/batch-execute / batch-actions / batch", () => {
    expect(isAuditablePath("/control/batch-execute", "POST")).toBe(true);
    expect(isAuditablePath("/control/batch-actions", "POST")).toBe(true);
    expect(isAuditablePath("/control/batch", "POST")).toBe(true);
  });
  it("audits POST /ai/find + /ai/wait-for-element", () => {
    expect(isAuditablePath("/ai/find", "POST")).toBe(true);
    expect(isAuditablePath("/ai/wait-for-element", "POST")).toBe(true);
  });
  it("audits PUT/DELETE under /control/* + /ai/*", () => {
    expect(isAuditablePath("/control/page/navigate", "PUT")).toBe(true);
    expect(isAuditablePath("/ai/find", "DELETE")).toBe(true);
  });
  it("does NOT audit GET (reads, not writes)", () => {
    expect(isAuditablePath("/control/snapshot", "GET")).toBe(false);
    expect(isAuditablePath("/control/element/btn-1", "GET")).toBe(false);
    expect(isAuditablePath("/ai/find", "GET")).toBe(false);
  });
  it("does NOT audit SDK transport endpoints", () => {
    expect(isAuditablePath("/heartbeat", "POST")).toBe(false);
    expect(isAuditablePath("/commands", "POST")).toBe(false);
    expect(isAuditablePath("/commands/stream", "POST")).toBe(false);
  });
  it("does NOT audit /control/render-log/* (dev telemetry, not a user command)", () => {
    expect(isAuditablePath("/control/render-log/append", "POST")).toBe(false);
    expect(isAuditablePath("/control/render-log/foo", "PUT")).toBe(false);
  });
  it("does NOT audit unrelated namespaces", () => {
    expect(isAuditablePath("/health", "POST")).toBe(false);
    expect(isAuditablePath("/tabs", "POST")).toBe(false);
  });
  it("does NOT audit PATCH (not in {POST,PUT,DELETE})", () => {
    expect(isAuditablePath("/control/page/navigate", "PATCH")).toBe(false);
  });
});

describe("commandNameFromPath", () => {
  it("maps /control/element/:id/action → element.action", () => {
    expect(commandNameFromPath("/control/element/btn-42/action")).toBe(
      "element.action",
    );
  });
  it("maps /control/page/<verb> → page.<verb>", () => {
    expect(commandNameFromPath("/control/page/navigate")).toBe("page.navigate");
  });
  it("maps batch endpoints to their canonical names", () => {
    expect(commandNameFromPath("/control/batch-execute")).toBe("batch.execute");
    expect(commandNameFromPath("/control/batch-actions")).toBe("batch.actions");
    expect(commandNameFromPath("/control/batch")).toBe("batch");
  });
  it("maps /ai/<verb> → ai.<verb>", () => {
    expect(commandNameFromPath("/ai/find")).toBe("ai.find");
    expect(commandNameFromPath("/ai/wait-for-element")).toBe(
      "ai.wait-for-element",
    );
  });
  it("falls back to flat name for unknown paths", () => {
    expect(commandNameFromPath("/control/something-new")).toBe(
      "control.something-new",
    );
  });
});

describe("summarizeBody", () => {
  it("returns null for non-object / null / array bodies", () => {
    expect(summarizeBody(null, "ai.find")).toBeNull();
    expect(summarizeBody("plain string", "ai.find")).toBeNull();
    expect(summarizeBody([1, 2, 3], "ai.find")).toBeNull();
  });

  it("records elementId verbatim (safe identifier)", () => {
    expect(
      summarizeBody({ elementId: "btn-42", action: "click" }, "element.action"),
    ).toEqual({
      action: "element.action",
      elementId: "btn-42",
      bodyAction: "click",
    });
  });

  it("records textLength but NEVER the raw text from a type command", () => {
    const out = summarizeBody(
      {
        elementId: "input-3",
        action: "type",
        text: "hunter2-this-is-secret",
      },
      "element.action",
    );
    expect(out).toMatchObject({
      action: "element.action",
      elementId: "input-3",
      bodyAction: "type",
      textLength: "hunter2-this-is-secret".length,
    });
    // Critical: the raw text MUST NOT leak into the summary anywhere.
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("records selector + url + batchSize but not their bodies", () => {
    expect(
      summarizeBody(
        { selector: ".save-btn", url: "/dashboard" },
        "ai.find",
      ),
    ).toEqual({
      action: "ai.find",
      selector: ".save-btn",
      url: "/dashboard",
    });
    expect(
      summarizeBody(
        { actions: [{ kind: "click" }, { kind: "type" }] },
        "batch.actions",
      ),
    ).toEqual({ action: "batch.actions", batchSize: 2 });
  });

  it("caps string fields at 256 chars (DoS / column-bloat defense)", () => {
    const huge = "x".repeat(1000);
    const out = summarizeBody({ elementId: huge }, "element.action");
    expect(out).not.toBeNull();
    const id = (out as Record<string, unknown>).elementId as string;
    expect(id.length).toBeLessThanOrEqual(257); // 256 + ellipsis
    expect(id.endsWith("…")).toBe(true);
  });

  it("returns null when no safe fields beyond the bare action are present", () => {
    expect(summarizeBody({}, "ai.find")).toBeNull();
    expect(summarizeBody({ unknown: "x" }, "ai.find")).toBeNull();
  });
});

describe("targetElementIdFor", () => {
  it("extracts the id from /control/element/:id/action", () => {
    expect(
      targetElementIdFor("/control/element/btn-1/action", null),
    ).toBe("btn-1");
  });
  it("falls back to body.elementId for other paths", () => {
    expect(
      targetElementIdFor("/ai/find", { elementId: "input-3" }),
    ).toBe("input-3");
  });
  it("returns null when neither path nor body name an element", () => {
    expect(targetElementIdFor("/control/page/navigate", null)).toBeNull();
    expect(targetElementIdFor("/ai/find", { selector: ".foo" })).toBeNull();
  });
  it("caps long ids at 256 chars", () => {
    const huge = "y".repeat(1000);
    expect(
      targetElementIdFor(`/control/element/${huge}/action`, null)?.length,
    ).toBe(256);
  });
});

describe("tabIdFor", () => {
  it("prefers the header (server-trusted) when present", () => {
    expect(tabIdFor({ targetTabId: "tab-from-body" }, "tab-from-header")).toBe(
      "tab-from-header",
    );
  });
  it("falls back to body.targetTabId when no header", () => {
    expect(tabIdFor({ targetTabId: "tab-x" }, null)).toBe("tab-x");
  });
  it("returns null when neither carries a string", () => {
    expect(tabIdFor({}, null)).toBeNull();
    expect(tabIdFor({ targetTabId: 42 }, null)).toBeNull();
  });
  it("ignores absurdly long values (defense)", () => {
    const huge = "z".repeat(1000);
    expect(tabIdFor({}, huge)).toBeNull();
    expect(tabIdFor({ targetTabId: huge }, null)).toBeNull();
  });
});

describe("recordAudit", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("BACKEND_URL", "http://backend.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POSTs to /api/v1/users/me/co-pilot/activity with the Bearer", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    await recordAudit({
      token: "tok",
      sessionId: null,
      tabId: "tab-1",
      commandName: "element.action",
      targetElementId: "btn-1",
      path: "/control/element/btn-1/action",
      method: "POST",
      origin: "https://qontinui.io",
      statusCode: 200,
      executionStatus: "executed",
      payloadSummary: { action: "element.action", elementId: "btn-1" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://backend.test/api/v1/users/me/co-pilot/activity",
    );
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toMatchObject({
      command_name: "element.action",
      target_element_id: "btn-1",
      status_code: 200,
      execution_status: "executed",
    });
  });

  it("swallows network errors (fire-and-forget contract)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    // Must not throw — the route handler awaits a `.catch`-able promise
    // and we contract that this never bubbles.
    await expect(
      recordAudit({
        token: "tok",
        sessionId: null,
        tabId: null,
        commandName: "ai.find",
        targetElementId: null,
        path: "/ai/find",
        method: "POST",
        origin: null,
        statusCode: 200,
        executionStatus: "received",
        payloadSummary: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("swallows non-2xx backend responses (fire-and-forget contract)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(
      recordAudit({
        token: "tok",
        sessionId: null,
        tabId: null,
        commandName: "ai.find",
        targetElementId: null,
        path: "/ai/find",
        method: "POST",
        origin: null,
        statusCode: 200,
        executionStatus: "received",
        payloadSummary: null,
      }),
    ).resolves.toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins `wsUrl` to the three arms `operationsWsBase()` in
 * `components/operations/utils.ts` has always had, plus
 * `activeTenantWsParam` and `statusOnlyErrorText`.
 */

const apiConfig = vi.hoisted(() => ({ API_BASE_URL: "" }));

vi.mock("@/services/api-config", () => ({ ApiConfig: apiConfig }));

const { activeTenantWsParam, readJson, statusOnlyErrorText, wsUrl } =
  await import("./base");

describe("wsUrl", () => {
  afterEach(() => {
    apiConfig.API_BASE_URL = "";
  });

  it("translates an https:// base to wss://", () => {
    apiConfig.API_BASE_URL = "https://api.qontinui.io";
    expect(wsUrl("/x/ws?token=t")).toBe(
      "wss://api.qontinui.io/api/v1/operations/x/ws?token=t"
    );
  });

  it("translates an http:// base to ws://", () => {
    apiConfig.API_BASE_URL = "http://localhost:8000";
    expect(wsUrl("/x/ws")).toBe("ws://localhost:8000/api/v1/operations/x/ws");
  });

  it("prefixes ws:// onto a base with no scheme, as operationsWsBase did", () => {
    expect(wsUrl("/x/ws")).toBe("ws:///api/v1/operations/x/ws");
  });
});

describe("activeTenantWsParam", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("is empty with no selection", () => {
    expect(activeTenantWsParam()).toBe("");
  });

  it("appends the encoded selection", () => {
    window.localStorage.setItem("qontinui.active_tenant_id", "a&b");
    expect(activeTenantWsParam()).toBe("&active_tenant=a%26b");
  });
});

describe("statusOnlyErrorText", () => {
  it("words a readJson status rejection as HTTP <status>", async () => {
    const err = await readJson(
      new Response("body", { status: 503 }),
      "GET /api/v1/operations/ci-status"
    ).catch((e: unknown) => e);
    expect(statusOnlyErrorText(err, "fetch failed")).toBe("HTTP 503");
  });

  it("keeps any other Error's own message", () => {
    expect(
      statusOnlyErrorText(new TypeError("Failed to fetch"), "fetch failed")
    ).toBe("Failed to fetch");
  });

  it("falls back for a non-Error throw", () => {
    expect(statusOnlyErrorText("nope", "fetch failed")).toBe("fetch failed");
  });
});

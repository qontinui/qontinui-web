import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the coord-events bridge URL. Moved here, test names unchanged, from
 * `components/operations/utils.test.ts` with the builder itself (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * Phase 7 batch 7).
 */

const apiConfig = vi.hoisted(() => ({ API_BASE_URL: "" }));

vi.mock("@/services/api-config", () => ({ ApiConfig: apiConfig }));

const { coordEventsWsUrl } = await import("./coordEvents");

describe("operations WS URL builders", () => {
  afterEach(() => {
    apiConfig.API_BASE_URL = "";
    window.localStorage.clear();
  });

  // The coord-events bridge derives from the operations base (http[s]:// →
  // ws[s]://), carries the session token as `token=`, and adds the fixed
  // subscription name that coord's closed set resolves server-side.
  it("coordEventsWsUrl targets the backend bridge with subscribe + token", () => {
    const url = coordEventsWsUrl("merge", "a b+c");
    expect(url).toMatch(/^wss?:\/\//);
    expect(url).toContain("/api/v1/operations/coord-events/ws?");
    expect(url).toContain("subscribe=merge");
    // The token is URL-encoded; the subscription name never is (it is a
    // closed-set literal).
    expect(url).toContain(`token=${encodeURIComponent("a b+c")}`);
    // Never coord's own socket, never a caller-chosen glob.
    expect(url).not.toContain("pattern=");
    expect(url).not.toContain("9870");
  });

  it("coordEventsWsUrl carries the merge name (coord maps it to events.merge.*)", () => {
    expect(coordEventsWsUrl("merge", "t")).toContain("subscribe=merge&token=t");
  });

  it("coordEventsWsUrl is the exact absolute wss:// URL, with the active tenant appended", () => {
    apiConfig.API_BASE_URL = "https://api.qontinui.io";
    window.localStorage.setItem("qontinui.active_tenant_id", "t-1");
    expect(coordEventsWsUrl("merge", "a b")).toBe(
      "wss://api.qontinui.io/api/v1/operations/coord-events/ws?subscribe=merge&token=a%20b&active_tenant=t-1"
    );
  });
});

/**
 * relayExecutor.test.ts
 *
 * Regression tests for `resolveTabTarget` — the fix for the live co-pilot
 * failure "Step 1 failed: tabId is not in connectedTabs". The executor used to
 * send a bare `sessionStorage["__uiBridge_tabId"]` id, which goes stale once
 * the relay drops the tab on its ~30s heartbeat TTL (or it re-registers under a
 * new id). These pin that resolution now consults the relay's LIVE tab list and
 * degrades sensibly (sole-tab fallback, omit-for-primary, or a clear
 * not-connected signal) instead of hard-failing every step.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared HTTP client so we control `GET /tabs`.
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { resolveTabTarget } from "./relayExecutor";

/** A successful `GET /tabs` envelope carrying the given tab descriptors. */
function tabsOk(tabs: unknown[]) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { tabs, staleHeartbeatMs: 30000 },
    }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("resolveTabTarget", () => {
  it("uses the cached id when it is present in the live tab list", async () => {
    window.sessionStorage.setItem("__uiBridge_tabId", "tab-A");
    fetchMock.mockResolvedValue(tabsOk([{ tabId: "tab-A" }, { tabId: "tab-B" }]));
    expect(await resolveTabTarget()).toEqual({
      targetTabId: "tab-A",
      hasConnectedTab: true,
    });
  });

  it("falls back to the sole live tab when the cached id is stale", async () => {
    // The reported bug: cached id no longer matches the one live tab.
    window.sessionStorage.setItem("__uiBridge_tabId", "stale-id");
    fetchMock.mockResolvedValue(tabsOk([{ tabId: "live-only" }]));
    expect(await resolveTabTarget()).toEqual({
      targetTabId: "live-only",
      hasConnectedTab: true,
    });
  });

  it("omits the id (relay primary) when cached is stale and multiple tabs are live", async () => {
    window.sessionStorage.setItem("__uiBridge_tabId", "stale-id");
    fetchMock.mockResolvedValue(tabsOk([{ tabId: "x" }, { tabId: "y" }]));
    expect(await resolveTabTarget()).toEqual({
      targetTabId: null,
      hasConnectedTab: true,
    });
  });

  it("reports no connected tab when the live list is empty", async () => {
    window.sessionStorage.setItem("__uiBridge_tabId", "tab-A");
    fetchMock.mockResolvedValue(tabsOk([]));
    expect(await resolveTabTarget()).toEqual({
      targetTabId: "tab-A",
      hasConnectedTab: false,
    });
  });

  it("best-effort sends the cached id when the tabs fetch fails (non-OK)", async () => {
    window.sessionStorage.setItem("__uiBridge_tabId", "tab-A");
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await resolveTabTarget()).toEqual({
      targetTabId: "tab-A",
      hasConnectedTab: true,
    });
  });

  it("best-effort sends the cached id when the tabs fetch throws", async () => {
    window.sessionStorage.setItem("__uiBridge_tabId", "tab-A");
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await resolveTabTarget()).toEqual({
      targetTabId: "tab-A",
      hasConnectedTab: true,
    });
  });

  it("accepts plain-string tab entries, not just objects", async () => {
    window.sessionStorage.setItem("__uiBridge_tabId", "tab-A");
    fetchMock.mockResolvedValue(tabsOk(["tab-A"]));
    expect(await resolveTabTarget()).toEqual({
      targetTabId: "tab-A",
      hasConnectedTab: true,
    });
  });
});

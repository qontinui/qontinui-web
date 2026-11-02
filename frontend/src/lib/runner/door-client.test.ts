/**
 * The browser half of the runner door proxy (plan
 * `2026-09-17-retire-the-runner-origin-guard-dev-grace`, Phase 4, test 6).
 *
 * A door call over a loopback route goes to this page's own
 * `/api/runner-doors`, never to `http://localhost:<port>`; a non-door call is
 * unchanged; `NEXT_PUBLIC_RUNNER_DOOR_TRANSPORT=direct` restores the direct
 * call (the kill switch, proven).
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: vi.fn() },
  tokenManager: { getAccessToken: () => "operator-bearer" },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));
vi.mock("@/contexts/active-runner-context", () => ({
  useRunnerTarget: () => ({ kind: "default_local" }),
  useDispatchRunnerTarget: () => ({}),
}));

import { runnerFetch } from "./api-client";
import { loopbackPortOf, runnerDoorRouting } from "./door-client";
import { matchRunnerDoorRoute } from "./door-routes";
import { useRunnerApi } from "./runner-api-object";
import type { RunnerTarget } from "./target";

const DEFAULT: RunnerTarget = { kind: "default_local" };
const originalLocation = window.location;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: {
      ...originalLocation,
      origin: "http://localhost:3001",
      href: "http://localhost:3001/settings",
    },
    writable: true,
  });
  fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function api() {
  return renderHook(() => useRunnerApi()).result.current;
}

describe("door calls go through the same-origin door proxy", () => {
  it("runnerApi.saveAiApiKey issues exactly one fetch, to /api/runner-doors", async () => {
    await api().saveAiApiKey("anthropic", "k");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/runner-doors/settings/ai/api-key");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer operator-bearer");
    expect(headers.get("x-qontinui-runner-port")).toBe("9876");
    expect(
      fetchSpy.mock.calls.some(([u]) =>
        /^http:\/\/(localhost|127\.0\.0\.1):9876/.test(String(u))
      )
    ).toBe(false);
  });

  it("with NEXT_PUBLIC_RUNNER_DOOR_TRANSPORT=direct it goes to the runner base", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNNER_DOOR_TRANSPORT", "direct");
    await api().saveAiApiKey("anthropic", "k");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "http://127.0.0.1:9876/settings/ai/api-key"
    );
  });

  it("a non-door call is unchanged", async () => {
    await runnerFetch(DEFAULT, "/health");
    expect(fetchSpy.mock.calls[0]![0]).toBe("http://127.0.0.1:9876/health");
  });

  it("the method decides: GET /hooks is a door, GET /hooks/{id} is not listed", () => {
    expect(matchRunnerDoorRoute("GET", "/hooks")).toBe("/hooks");
    expect(matchRunnerDoorRoute("POST", "/hooks/abc/test")).toBe(
      "/hooks/{id}/test"
    );
    expect(matchRunnerDoorRoute("GET", "/hooks/abc/test")).toBeNull();
    expect(matchRunnerDoorRoute("GET", "/settings/backup/summary?x=1")).toBe(
      "/settings/backup/summary"
    );
  });

  it("the proxy's own refusal is not rendered as the runner refusing this origin", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          code: "RUNNER_HOP_CROSS_ORIGIN_REFUSED",
          message: "refused",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    );
    const err = (await api()
      .saveAiApiKey("anthropic", "k")
      .catch((e: unknown) => e)) as Error & { status?: number };
    expect(err.status).toBe(403);
    expect(err.message).not.toContain("QONTINUI_RUNNER_ALLOWED_ORIGINS");
  });

  it("a runner literal route a {param} door pattern would swallow is not a door", () => {
    expect(
      matchRunnerDoorRoute("GET", "/state-explorer/history?limit=5")
    ).toBeNull();
    expect(matchRunnerDoorRoute("GET", "/state-explorer/run-1")).toBe(
      "/state-explorer/{run_id}"
    );
    expect(matchRunnerDoorRoute("PUT", "/hooks/reorder")).toBe(
      "/hooks/reorder"
    );
  });

  it("only a loopback http base is routed", () => {
    expect(loopbackPortOf("http://localhost:9877")).toBe(9877);
    expect(loopbackPortOf("http://127.0.0.1:9876")).toBe(9876);
    expect(loopbackPortOf("https://runner.example:9876")).toBeNull();
    expect(
      runnerDoorRouting("https://runner.example:9876", "/hooks", "GET")
    ).toBeNull();
  });
});

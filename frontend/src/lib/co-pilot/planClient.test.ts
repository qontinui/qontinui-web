/**
 * The co-pilot planner goes through the one runner transport resolver (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 2): the
 * relay for a runner not proven local (with the planner's long relay wait),
 * loopback for one that is.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const relayFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));
vi.mock("./pageCatalog", () => ({ buildPageCatalog: () => [] }));

import { PlanError, requestPlan } from "./planClient";
import type { RunnerTarget } from "@/lib/runner/target";

const PLAN = {
  success: true,
  data: {
    summary: "s",
    steps: [{ type: "navigate", target: "home", explanation: "e" }],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function target(locality: "local" | "not_local"): RunnerTarget {
  return {
    kind: "runner",
    runner: { id: "dev-1", port: 9877, name: "box" },
    locality,
  };
}

const originalLocation = window.location;
let loopbackFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, origin: "http://localhost:3001" },
    writable: true,
  });
  relayFetch.mockReset();
  loopbackFetch = vi.fn(async () => jsonResponse(PLAN));
  vi.stubGlobal("fetch", loopbackFetch);
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
  vi.unstubAllGlobals();
});

describe("requestPlan transport", () => {
  it("a remote runner plans over the relay, with the device id and the 55 s relay wait", async () => {
    relayFetch.mockResolvedValue(jsonResponse(PLAN));

    await expect(
      requestPlan({
        prompt: "go home",
        target: target("not_local"),
        explain: false,
      })
    ).resolves.toEqual(PLAN.data);

    expect(loopbackFetch).not.toHaveBeenCalled();
    const [url, init] = relayFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.test/api/v1/device-bridge/runner-proxy/prompt-home/plan"
    );
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Qontinui-Device-Id"]).toBe("dev-1");
    expect(headers["X-Qontinui-Timeout-Ms"]).toBe("55000");
    expect(init.method).toBe("POST");
  });

  it("a proven-local runner plans over loopback", async () => {
    await requestPlan({
      prompt: "go home",
      target: target("local"),
      explain: false,
    });
    expect(relayFetch).not.toHaveBeenCalled();
    expect(String(loopbackFetch.mock.calls[0]![0])).toBe(
      "http://127.0.0.1:9877/prompt-home/plan"
    );
  });

  it("a target with no route carries the resolver's typed message (not 'no paired runner'), and nothing is sent", async () => {
    const err = await requestPlan({
      prompt: "go home",
      target: { kind: "unavailable", reason: "resolver_unavailable" },
      explain: false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanError);
    expect((err as PlanError).reason).toBe("no-device-id");
    expect((err as PlanError).message).toMatch(
      /device resolver did not answer/
    );
    expect((err as PlanError).message).not.toMatch(/No paired runner/);
    expect(relayFetch).not.toHaveBeenCalled();
    expect(loopbackFetch).not.toHaveBeenCalled();
  });

  it("a pending target waits for the provider, then plans on the runner it settles to", async () => {
    relayFetch.mockResolvedValue(jsonResponse(PLAN));
    let settle!: (t: RunnerTarget) => void;
    const pending: RunnerTarget = {
      kind: "pending",
      settle: () => new Promise<RunnerTarget>((r) => (settle = r)),
    };
    const call = requestPlan({
      prompt: "go home",
      target: pending,
      explain: false,
    });
    await Promise.resolve();
    expect(relayFetch).not.toHaveBeenCalled();
    settle(target("not_local"));
    await expect(call).resolves.toEqual(PLAN.data);
    expect(relayFetch).toHaveBeenCalledTimes(1);
  });

  it("a relay path refusal is planning-failed with the needs-local message", async () => {
    relayFetch.mockResolvedValue(
      jsonResponse(
        { error: "this path is not carried by the HTTP relay — x" },
        403
      )
    );
    const err = (await requestPlan({
      prompt: "go home",
      target: target("not_local"),
      explain: false,
    }).catch((e: unknown) => e)) as PlanError;
    expect(err.reason).toBe("planning-failed");
    expect(err.message).toMatch(/needs the runner on this machine/);
  });

  it("a relay 503 keeps its runner-not-connected reason", async () => {
    relayFetch.mockResolvedValue(
      jsonResponse({ detail: "runner not connected" }, 503)
    );
    const err = (await requestPlan({
      prompt: "go home",
      target: target("not_local"),
      explain: false,
    }).catch((e: unknown) => e)) as PlanError;
    expect(err.reason).toBe("runner-not-connected");
    expect(err.message).toBe("runner not connected");
  });
});

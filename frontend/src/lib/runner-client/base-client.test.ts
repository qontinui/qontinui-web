/**
 * The runner-client family renders the runner's origin-guard refusal
 * (plan 2026-09-17-runner-loopback-api-accepts-any-origin) as a typed message
 * instead of "<prefix>: 403 - <raw JSON>", and availability checks do not
 * report a refusing (running) runner as "not connected".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunnerTarget } from "@/lib/runner/target";
import { httpClient } from "@/services/service-factory";
import { BaseClient } from "./base-client";
import { ClickCaptureClient } from "./click-capture-client";
import { ConfigClient } from "./config-client";
import { ModelClient } from "./model-client";
import { PlaywrightClient } from "./playwright-client";
import { WorkflowClient } from "./workflow-client";

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: vi.fn() },
}));

/** A runner proven to be on this machine: requests go over loopback. */
const BASE: RunnerTarget = {
  kind: "runner",
  runner: { id: "runner-local", port: 9877, name: "Local" },
  locality: "local",
};

/** A runner on another machine: requests go over the backend relay. */
const REMOTE: RunnerTarget = {
  kind: "runner",
  runner: { id: "runner-remote", port: 9877, name: "Remote Box" },
  locality: "not_local",
};

function refusal(route: string, method = "POST") {
  return new Response(
    JSON.stringify({
      success: false,
      code: "CROSS_ORIGIN_REFUSED",
      context: {
        origin: "http://localhost:3001",
        class: "trusted",
        method,
        route_pattern: route,
      },
    }),
    { status: 403 }
  );
}

function stubFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function expectRefusalMessage(error: string | undefined, route: string) {
  expect(error).toContain("CROSS_ORIGIN_REFUSED");
  expect(error).toContain(route);
  expect(error).toContain("QONTINUI_RUNNER_ALLOWED_ORIGINS");
  expect(error).not.toMatch(/: 403/);
}

describe("runner-client origin-guard refusal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("BaseClient.sendCommand describes CROSS_ORIGIN_REFUSED", async () => {
    stubFetch(refusal("/command"));
    const result = await new BaseClient(BASE).sendCommand("noop");
    expect(result.success).toBe(false);
    expectRefusalMessage(result.error, "POST /command");
  });

  it("BaseClient.sendCommand goes to the target's loopback base", async () => {
    const spy = stubFetch(new Response("{}", { status: 200 }));
    await new BaseClient(BASE).sendCommand("noop");
    expect(spy.mock.calls[0][0]).toBe("http://127.0.0.1:9877/command");
  });

  it("BaseClient.sendCommand keeps the generic message otherwise", async () => {
    stubFetch(new Response("boom", { status: 500 }));
    const result = await new BaseClient(BASE).sendCommand("noop");
    expect(result.error).toBe("Command failed: 500 - boom");
  });

  it("WorkflowClient.runWorkflow (body-carrying branch)", async () => {
    stubFetch(refusal("/run-workflow"));
    const result = await new WorkflowClient(new BaseClient(BASE)).runWorkflow(
      "wf"
    );
    expectRefusalMessage(result.error, "POST /run-workflow");
  });

  it("ModelClient.listModels (body-carrying branch)", async () => {
    stubFetch(refusal("/models", "GET"));
    const result = await new ModelClient(new BaseClient(BASE)).listModels();
    expect(result.success).toBe(false);
    expectRefusalMessage(result.error, "GET /models");
  });

  it("ClickCaptureClient.getClickCaptureStatus (status-only branch)", async () => {
    stubFetch(refusal("/click-capture/status", "GET"));
    const result = await new ClickCaptureClient(
      new BaseClient(BASE)
    ).getClickCaptureStatus();
    expectRefusalMessage(result.error, "GET /click-capture/status");
  });

  it("a status-only branch does not read a non-403 body", async () => {
    const resp = new Response("ignored", { status: 500 });
    stubFetch(resp);
    const result = await new ClickCaptureClient(
      new BaseClient(BASE)
    ).getClickCaptureStatus();
    expect(result.error).toBe("Failed to get click capture status: 500");
    expect(resp.bodyUsed).toBe(false);
  });

  it("ConfigClient.getStatus throws the refusal, not a raw 403", async () => {
    stubFetch(refusal("/status", "GET"));
    const err = await new ConfigClient(new BaseClient(BASE))
      .getStatus()
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expectRefusalMessage((err as Error).message, "GET /status");
  });
});

describe("ConfigClient availability", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a refused /status is not reported as 'not connected'", async () => {
    stubFetch(refusal("/status", "GET"));
    const config = new ConfigClient(new BaseClient(BASE));
    const availability = await config.getAvailability();
    expect(availability.available).toBe(false);
    expect(availability.refusalMessage).toContain("CROSS_ORIGIN_REFUSED");
    expect(availability.refusalMessage).toContain("GET /status");
  });

  it("an unreachable runner has no refusal message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );
    const config = new ConfigClient(new BaseClient(BASE));
    expect(await config.getAvailability()).toEqual({
      available: false,
      refusalMessage: null,
    });
    expect(await config.isAvailable()).toBe(false);
  });

  it("a relay-refused /status surfaces the needs-local message", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.mocked(httpClient.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "this path is not carried by the HTTP relay — GET /status",
        }),
        { status: 403 }
      )
    );
    const config = new ConfigClient(new BaseClient(REMOTE));
    const availability = await config.getAvailability();
    expect(availability.available).toBe(false);
    expect(availability.refusalMessage).toContain(
      "needs the runner on this machine"
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an OK /status is available", async () => {
    stubFetch(new Response("{}", { status: 200 }));
    const config = new ConfigClient(new BaseClient(BASE));
    expect(await config.getAvailability()).toEqual({
      available: true,
      refusalMessage: null,
    });
    expect(await config.isAvailable()).toBe(true);
  });
});

/**
 * A runner-client budget must REACH the relay: a private
 * `AbortController` + `setTimeout(abort, N)` passed only as `signal` cannot
 * tell the backend how long to wait, so it fell back to its 30 s default and
 * a 120 s command 504'd at 30 s. The budget is passed as `timeoutMs`, which
 * the relay client sends as `X-Qontinui-Timeout-Ms`.
 */
describe("runner-client deadlines reach the relay", () => {
  beforeEach(() => vi.mocked(httpClient.fetch).mockReset());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(httpClient.fetch).mockReset();
  });

  /** Relay one call and return the wait header and client deadline it sent. */
  async function relayedBudget(call: () => Promise<unknown>) {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(httpClient.fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    await call();
    expect(httpClient.fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(httpClient.fetch).mock.calls[0][1] as {
      headers: Record<string, string>;
      timeoutMs?: number;
    };
    return {
      waitMs: Number(init.headers["X-Qontinui-Timeout-Ms"]),
      clientDeadlineMs: init.timeoutMs,
    };
  }

  it("a relayed sendCommand sends its 120 s budget", async () => {
    const sent = await relayedBudget(() =>
      new BaseClient(REMOTE).sendCommand("noop")
    );
    expect(sent.waitMs).toBe(120000);
    expect(sent.clientDeadlineMs).toBe(123000);
  });

  it("a relayed sendCommand sends a caller-chosen budget", async () => {
    const sent = await relayedBudget(() =>
      new BaseClient(REMOTE).sendCommand("noop", {}, 45000)
    );
    expect(sent.waitMs).toBe(45000);
  });

  it("a relayed /status availability check is floored for the relay", async () => {
    const sent = await relayedBudget(() =>
      new ConfigClient(new BaseClient(REMOTE)).getAvailability()
    );
    // The 2 s loopback budget would time out a healthy relay round trip.
    expect(sent.waitMs).toBeGreaterThanOrEqual(10000);
    expect(sent.waitMs).not.toBe(30000);
  });

  it("relayed Playwright collection calls send their budgets", async () => {
    const client = new PlaywrightClient(new BaseClient(REMOTE));
    expect(
      (
        await relayedBudget(() =>
          client.startPlaywrightCollection(
            {} as Parameters<typeof client.startPlaywrightCollection>[0]
          )
        )
      ).waitMs
    ).toBe(60000);
    vi.mocked(httpClient.fetch).mockReset();
    expect(
      (await relayedBudget(() => client.getPlaywrightCollectionResults()))
        .waitMs
    ).toBe(120000);
  });

  it("a relayed click-capture stop sends its 120 s budget", async () => {
    const sent = await relayedBudget(() =>
      new ClickCaptureClient(new BaseClient(REMOTE)).stopClickCapture()
    );
    expect(sent.waitMs).toBe(120000);
  });
});

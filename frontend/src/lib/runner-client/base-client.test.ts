/**
 * The runner-client family renders the runner's origin-guard refusal
 * (plan 2026-09-17-runner-loopback-api-accepts-any-origin) as a typed message
 * instead of "<prefix>: 403 - <raw JSON>", and availability checks do not
 * report a refusing (running) runner as "not connected".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { BaseClient } from "./base-client";
import { ClickCaptureClient } from "./click-capture-client";
import { ConfigClient } from "./config-client";
import { ModelClient } from "./model-client";
import { WorkflowClient } from "./workflow-client";

const BASE = "http://127.0.0.1:9876";

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

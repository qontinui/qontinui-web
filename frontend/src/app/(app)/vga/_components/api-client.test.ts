import { afterEach, describe, expect, it, vi } from "vitest";

import { captureScreenshot, listMonitors } from "./api-client";

const UNRESOLVED = {
  code: "endpoint_unresolved",
  endpoint: "runner",
  env_var: "QONTINUI_RUNNER_URL",
  error:
    "This deployment is misconfigured — the runner that server-side proxies reach address is not set. Set QONTINUI_RUNNER_URL to the base URL of the runner that server-side proxies reach.",
  next_action:
    "Set QONTINUI_RUNNER_URL to the base URL of the runner that server-side proxies reach.",
};

function respond(status: number, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, statusText: "X" }))
  );
}

describe("vga api-client error surfacing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("captureScreenshot carries the 503's next action to the caller", async () => {
    respond(503, JSON.stringify(UNRESOLVED));
    await expect(captureScreenshot(0)).rejects.toThrow(
      /Capture failed: 503 .*Set QONTINUI_RUNNER_URL/
    );
  });

  it("JSON routes carry it too", async () => {
    respond(503, JSON.stringify(UNRESOLVED));
    await expect(listMonitors()).rejects.toThrow(/Set QONTINUI_RUNNER_URL/);
  });

  it("never renders an HTML gateway page", async () => {
    respond(502, "<html><body>Bad gateway</body></html>");
    await expect(captureScreenshot(0)).rejects.toThrow(
      /^Capture failed: 502 X$/
    );
  });
});

/**
 * BaseClient.sendCommand renders the runner's origin-guard refusal
 * (plan 2026-09-17-runner-loopback-api-accepts-any-origin) as a typed message
 * instead of "Command failed: 403 - <raw JSON>".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { BaseClient } from "./base-client";

describe("BaseClient.sendCommand origin-guard refusal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("describes CROSS_ORIGIN_REFUSED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            code: "CROSS_ORIGIN_REFUSED",
            context: {
              origin: "http://localhost:3001",
              class: "trusted",
              method: "POST",
              route_pattern: "/command",
            },
          }),
          { status: 403 }
        )
      )
    );

    const result = await new BaseClient("http://127.0.0.1:9876").sendCommand(
      "noop"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("CROSS_ORIGIN_REFUSED");
    expect(result.error).toContain("POST /command");
    expect(result.error).toContain("QONTINUI_RUNNER_ALLOWED_ORIGINS");
    expect(result.error).not.toContain("Command failed: 403");
  });

  it("keeps the generic message for any other failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 }))
    );
    const result = await new BaseClient("http://127.0.0.1:9876").sendCommand(
      "noop"
    );
    expect(result.error).toBe("Command failed: 500 - boom");
  });
});

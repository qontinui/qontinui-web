/**
 * Every /api/vga/* route that reaches another service answers an unset base
 * with a structured 503 naming the variable to set — never a fetch to a
 * dev-stack loopback (plan B5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET as captureGET } from "./capture/route";
import { GET as monitorsGET } from "./monitors/route";
import { POST as groundPOST } from "./ground/route";
import { POST as proposePOST } from "./propose/route";

vi.mock("@/lib/vga/shadow-log", () => ({ logShadowSample: vi.fn() }));

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("QONTINUI_RUNNER_URL", "");
  vi.stubEnv("QONTINUI_LLAMA_SWAP_URL", "");
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function expectUnresolved(res: Response, envVar: string) {
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.code).toBe("endpoint_unresolved");
  expect(body.env_var).toBe(envVar);
  expect(body.next_action).toContain(`Set ${envVar}`);
  expect(fetchSpy).not.toHaveBeenCalled();
}

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://app.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/vga/* with no base configured", () => {
  it("capture → 503 naming QONTINUI_RUNNER_URL", async () => {
    const res = await captureGET(
      new NextRequest("http://app.test/api/vga/capture?monitor=0")
    );
    await expectUnresolved(res, "QONTINUI_RUNNER_URL");
  });

  it("monitors → 503 naming QONTINUI_RUNNER_URL", async () => {
    await expectUnresolved(await monitorsGET(), "QONTINUI_RUNNER_URL");
  });

  it("ground → 503 naming QONTINUI_LLAMA_SWAP_URL", async () => {
    const res = await groundPOST(
      post("/api/vga/ground", { imageBase64: "aGVsbG8=", prompt: "the button" })
    );
    await expectUnresolved(res, "QONTINUI_LLAMA_SWAP_URL");
  });

  it("propose → 503 naming QONTINUI_LLAMA_SWAP_URL", async () => {
    const res = await proposePOST(
      post("/api/vga/propose", {
        imageBase64: "aGVsbG8=",
        categories: ["Button"],
      })
    );
    await expectUnresolved(res, "QONTINUI_LLAMA_SWAP_URL");
  });
});

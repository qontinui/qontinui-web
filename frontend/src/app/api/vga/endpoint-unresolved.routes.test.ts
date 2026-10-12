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
import { POST as correctionPOST } from "./correction/route";
import { GET as runsGET } from "./runs/route";
import { GET as runGET } from "./runs/[runId]/route";
import { GET as statesGET } from "./state/route";
import { GET as stateGET, DELETE as stateDELETE } from "./state/[id]/route";
import { GET as stateExportGET } from "./state/[id]/export/route";

vi.mock("@/lib/vga/shadow-log", () => ({ logShadowSample: vi.fn() }));

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("QONTINUI_RUNNER_URL", "");
  vi.stubEnv("QONTINUI_LLAMA_SWAP_URL", "");
  vi.stubEnv("RUNNER_DATABASE_URL", "");
  vi.stubEnv("DATABASE_URL", "");
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

/**
 * The DB-backed routes resolve the runner database DSN through
 * resolveEndpoint("runner_db", …): unset outside development is a 503 naming
 * RUNNER_DATABASE_URL — never a connection to the dev-stack Postgres on this
 * server's own loopback with the dev password.
 */
describe("/api/vga/* DB routes with no runner database configured", () => {
  const ID = "123e4567-e89b-42d3-a456-426614174000";
  const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

  it.each([
    [
      "GET runs",
      () => runsGET(new NextRequest("http://app.test/api/vga/runs")),
    ],
    [
      "GET runs/[runId]",
      () =>
        runGET(
          new NextRequest(`http://app.test/api/vga/runs/${ID}`),
          params({ runId: ID })
        ),
    ],
    [
      "GET state",
      () => statesGET(new NextRequest("http://app.test/api/vga/state")),
    ],
    [
      "GET state/[id]",
      () =>
        stateGET(
          new NextRequest(`http://app.test/api/vga/state/${ID}`),
          params({ id: ID })
        ),
    ],
    [
      "DELETE state/[id]",
      () =>
        stateDELETE(
          new NextRequest(`http://app.test/api/vga/state/${ID}`, {
            method: "DELETE",
          }),
          params({ id: ID })
        ),
    ],
    [
      "GET state/[id]/export",
      () =>
        stateExportGET(
          new NextRequest(`http://app.test/api/vga/state/${ID}/export`),
          params({ id: ID })
        ),
    ],
    [
      "POST correction",
      () =>
        correctionPOST(
          post("/api/vga/correction", {
            stateMachineId: ID,
            imageBase64: "aGVsbG8=",
            prompt: "the button",
            correctedBbox: { x: 1, y: 2, w: 3, h: 4 },
            source: "builder",
          })
        ),
    ],
  ] as const)("%s → 503 naming RUNNER_DATABASE_URL", async (_name, call) => {
    await expectUnresolved(await call(), "RUNNER_DATABASE_URL");
  });
});

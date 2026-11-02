/**
 * The switches hook over the REAL `HttpClient` (only the network is stubbed),
 * for the two rules no page test can see:
 *
 * 1. **Its own reads poll with no client retries.** A failing read is one
 *    request per tick — the next tick is the retry — so a coord outage is not
 *    multiplied by the client's retry budget on every poll.
 * 2. **One write per switch at a time.** A second write to a switch whose
 *    first has not read back is refused with an error (what a UI Bridge
 *    caller sees), and nothing second is sent.
 * 3. **What the real client throws is classified.** A fetch that rejected leaves
 *    the write open, and an offline browser sent nothing: only the real client
 *    turns the second into the message the classifier reads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TokenManager } from "@/services/auth/token-manager";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/services/service-factory", () => ({
  get httpClient() {
    return holder.client;
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { HttpClient } from "@/services/http-client";
import {
  defaultsBody,
  effectiveBody,
  mergeSettingsBody,
} from "../__fixtures__/spawnPaths";
import { NO_CONNECTION_MESSAGE } from "@/services/http-client";
import { WRITE_IN_FLIGHT, useSpawnPathSwitches } from "./useSpawnPathSwitches";

function tokenManager(): TokenManager {
  return {
    getAccessToken: () => "tok",
    getRefreshToken: () => "refresh",
    getAccessTokenExpiry: () => Date.now() + 3_600_000,
    isAccessTokenExpired: () => false,
    isAccessTokenExpiringSoon: () => false,
    isAuthenticated: () => true,
    clearTokens: () => {},
  } as unknown as TokenManager;
}

const requests: Array<{ path: string; method: string }> = [];
let answer: (path: string, method: string) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  requests.length = 0;
  for (const k of ["warn", "error", "log", "debug"] as const) {
    vi.spyOn(console, k).mockImplementation(() => {});
  }
  holder.client = new HttpClient(tokenManager());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : String((input as Request).url ?? input);
      const path = new URL(raw, "http://localhost").pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      requests.push({ path, method });
      return answer(path, method);
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The three reads this hook owns and polls. */
const OWN_READS = [
  "/api/v1/agent-registry",
  "/api/v1/agent-registry/admin/registry",
  "/api/v1/operations/coord/next-step-settings",
];

describe("useSpawnPathSwitches", () => {
  it("sends each of its own polled reads once per tick when they fail — no client retries", async () => {
    vi.useFakeTimers();
    answer = async () => json({ error: "unavailable" }, 503);
    renderHook(() => useSpawnPathSwitches());
    // Long enough for the client's whole retry backoff, short of the next tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    for (const path of OWN_READS) {
      expect(
        requests.filter((r) => r.path === path && r.method === "GET"),
        path
      ).toHaveLength(1);
    }
  });

  it("refuses a second write to a switch while the first has not read back, and sends nothing second", async () => {
    let releasePut: () => void = () => {};
    const putHeld = new Promise<void>((r) => {
      releasePut = r;
    });
    answer = async (path, method) => {
      if (method === "PUT") {
        await putHeld;
        return json({});
      }
      if (path === "/api/v1/agent-registry/admin/registry") {
        return json(
          defaultsBody({ merge_shepherd: { default_enabled: false } })
        );
      }
      if (path === "/api/v1/agent-registry") return json(effectiveBody());
      return json({ error: "not in this test" }, 404);
    };
    const { result } = renderHook(() => useSpawnPathSwitches());
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.setRegistryDefault("merge_shepherd", false);
    });
    await expect(
      result.current.setRegistryDefault("merge_shepherd", true)
    ).rejects.toThrow(WRITE_IN_FLIGHT);
    await act(async () => {
      releasePut();
      await first;
    });
    const puts = requests.filter((r) => r.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(result.current.writes["registry:merge_shepherd"]).toMatchObject({
      asked: "off",
      phase: "written",
      readbackError: null,
    });
    // Once read back, the switch takes a new write.
    await act(async () => {
      await result.current.setRegistryDefault("merge_shepherd", true);
    });
    expect(requests.filter((r) => r.method === "PUT")).toHaveLength(2);
  });

  it("answers a PUT whose fetch rejected with the read it settled on, not as refused", async () => {
    answer = async (path, method) => {
      if (method === "PUT") throw new TypeError("Failed to fetch");
      if (path === "/api/v1/agent-registry/admin/registry") {
        return json(
          defaultsBody({ merge_shepherd: { default_enabled: false } })
        );
      }
      if (path === "/api/v1/agent-registry") return json(effectiveBody());
      return json({ error: "not in this test" }, 404);
    };
    const { result } = renderHook(() => useSpawnPathSwitches());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.setRegistryDefault(
        "merge_shepherd",
        false
      );
    });
    expect(outcome).toMatchObject({ outcome: "read_back", readBack: "off" });
    expect(result.current.writes["registry:merge_shepherd"]).toMatchObject({
      phase: "written",
      outcomeUnknown: true,
      settledState: "off",
    });
  });

  it("does not answer a lost dial write as read back when the re-read's source is unknown", async () => {
    let unreadable = false;
    answer = async (path, method) => {
      if (method === "PATCH") throw new TypeError("Failed to fetch");
      if (path === "/api/v1/operations/pr-merge/settings") {
        return json(
          unreadable
            ? mergeSettingsBody({
                tenant: null,
                resolved: false,
                source: "unknown",
              })
            : mergeSettingsBody({
                tenant: false,
                resolved: false,
                source: "tenant",
              })
        );
      }
      if (path === "/api/v1/agent-registry/admin/registry") {
        return json(defaultsBody());
      }
      if (path === "/api/v1/agent-registry") return json(effectiveBody());
      return json({ error: "not in this test" }, 404);
    };
    const { result } = renderHook(() => useSpawnPathSwitches());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    unreadable = true;
    let outcome: unknown;
    await act(async () => {
      // `null` in the tenant field is what Default asks for, and is not what
      // this read says: coord could not read the column.
      outcome = await result.current.setFixerDial("default");
    });
    expect(outcome).toMatchObject({ outcome: "unknown", readBack: null });
    expect(result.current.writes["dial:auto_fix_pr"]).toMatchObject({
      phase: "written",
      outcomeUnknown: true,
      settledState: null,
    });
  });

  it("answers the deploy-order 502 as refused, keeping coord's route and remedy", async () => {
    const detail =
      "coord does not serve PUT /coord/agent-registry/{agent_name} yet — " +
      "deploy qontinui-coord first";
    answer = async (path, method) => {
      if (method === "PUT") {
        return json({ error: "BAD_GATEWAY", message: detail }, 502);
      }
      if (path === "/api/v1/agent-registry/admin/registry") {
        return json(defaultsBody());
      }
      if (path === "/api/v1/agent-registry") return json(effectiveBody());
      return json({ error: "not in this test" }, 404);
    };
    const { result } = renderHook(() => useSpawnPathSwitches());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.setRegistryDefault(
        "merge_shepherd",
        false
      );
    });
    expect(outcome).toMatchObject({
      outcome: "refused",
      message: expect.stringContaining("deploy qontinui-coord first"),
    });
    const record = result.current.writes["registry:merge_shepherd"];
    expect(record).toMatchObject({ phase: "refused", error: detail });
    expect(record?.outcomeUnknown).toBeFalsy();
  });

  it("records the knob door's open outcome with the status it got, until its re-read answers", async () => {
    let holdMerge = false;
    let releaseMerge: () => void = () => {};
    const merge = () =>
      json(
        mergeSettingsBody({ tenant: false, resolved: false, source: "tenant" })
      );
    answer = async (path, method) => {
      if (method === "PATCH") return json({ error: "boom" }, 500);
      if (path === "/api/v1/operations/pr-merge/settings") {
        if (holdMerge) {
          await new Promise<void>((r) => {
            releaseMerge = r;
          });
        }
        return merge();
      }
      if (path === "/api/v1/agent-registry/admin/registry") {
        return json(defaultsBody());
      }
      if (path === "/api/v1/agent-registry") return json(effectiveBody());
      return json({ error: "not in this test" }, 404);
    };
    const { result } = renderHook(() => useSpawnPathSwitches());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    holdMerge = true;
    let done: Promise<unknown> = Promise.resolve();
    await act(async () => {
      done = result.current.setRedMainKnob(false);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.writes["knob:auto_fix_red_main"]).toMatchObject({
      phase: "unconfirmed",
      error: "no usable answer from coord (HTTP 500), so it may have landed",
    });
    await act(async () => {
      releaseMerge();
      await done;
    });
    expect(result.current.writes["knob:auto_fix_red_main"]).toMatchObject({
      phase: "written",
      outcomeUnknown: true,
    });
  });

  it("answers a PUT made while the browser is offline as refused", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    answer = async (path, method) => {
      if (method === "PUT") throw new TypeError("Failed to fetch");
      if (path === "/api/v1/agent-registry/admin/registry") {
        return json(defaultsBody());
      }
      if (path === "/api/v1/agent-registry") return json(effectiveBody());
      return json({ error: "not in this test" }, 404);
    };
    const { result } = renderHook(() => useSpawnPathSwitches());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.setRegistryDefault(
        "merge_shepherd",
        false
      );
    });
    expect(outcome).toMatchObject({
      outcome: "refused",
      message: expect.stringContaining(NO_CONNECTION_MESSAGE),
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each fleet read/write in `coordFleet` other than `fetchFleetHealth`
 * (see `coordFleet.test.ts`): the RELATIVE URL written out as a LITERAL (so a
 * change to the shared base cannot move every expectation with it), the
 * `encodeURIComponent` of every path/query parameter, and the
 * `httpClient.fetch` options the route walker cannot see — method and the
 * stated retry policy. `toEqual` on the whole options object keeps them that
 * way unless a change says so. Bodies are compared as strings, so the wire key
 * order is pinned too.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchCiHosting,
  fetchCiRunnerMirror,
  fetchFleet,
  fetchFleetDispatchRoles,
  fetchFleetDrain,
  fetchFleetPolicy,
  fetchFleetResourceSamples,
  fetchFleetTasks,
  fetchFleetWorktreeCap,
  fetchFleetWorktreeSlots,
  fetchRunnerOutput,
  postFleetDrain,
  postFleetUndrain,
  postFleetWorktreeCap,
  postFleetWorktreeCapClear,
  putFleetDispatchRole,
  putFleetPolicy,
} = await import("./coordFleet");

/** An id that only survives the trip as one path/query part if encoded. */
const ODD = "a/b #1&x";
const ODD_ENCODED = "a%2Fb%20%231%26x";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordFleet reads", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it.each([
    ["fetchFleet", () => fetchFleet(), "/api/v1/operations/fleet"],
    [
      "fetchFleetTasks",
      () => fetchFleetTasks(),
      "/api/v1/operations/fleet/tasks",
    ],
    [
      "fetchFleetDrain",
      () => fetchFleetDrain(),
      "/api/v1/operations/fleet/drain",
    ],
    [
      "fetchFleetDispatchRoles",
      () => fetchFleetDispatchRoles(),
      "/api/v1/operations/fleet/dispatch-roles",
    ],
    [
      "fetchFleetWorktreeCap",
      () => fetchFleetWorktreeCap(),
      "/api/v1/operations/fleet/worktree-cap",
    ],
    [
      "fetchFleetWorktreeSlots",
      () => fetchFleetWorktreeSlots(),
      "/api/v1/operations/fleet/worktree-slots",
    ],
    [
      "fetchCiRunnerMirror",
      () => fetchCiRunnerMirror(),
      "/api/v1/operations/fleet/ci-runners",
    ],
    ["fetchCiHosting", () => fetchCiHosting(), "/api/v1/operations/ci-hosting"],
  ])(
    "%s GETs its literal URL, declared idempotent, and parses the body",
    async (_name, call, url) => {
      fetchMock.mockResolvedValueOnce(json({ ok: 1 }));
      await expect(call()).resolves.toEqual({ ok: 1 });
      expect(fetchMock.mock.calls[0]).toEqual([
        url,
        { method: "GET", idempotent: true },
      ]);
    }
  );

  it("a read keeps the caller's retry budget", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await fetchFleetDrain({ maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/drain",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("a read rejects a non-2xx in the <METHOD> <url> failed shape", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 404));
    const err = await fetchFleetDrain().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/fleet/drain failed: 404 - {"error":"nope"}'
    );
    expect(httpStatusOf(err)).toBe(404);
    expect(httpBodyOf(err)).toBe('{"error":"nope"}');
  });

  it("a read of a 2xx whose body is not JSON rejects with a SyntaxError", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    await expect(fetchFleetDrain()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("fetchFleetResourceSamples GETs the window as a query", async () => {
    fetchMock.mockResolvedValueOnce(json({ samples: [] }));
    await fetchFleetResourceSamples(3600, { maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/resource-samples?window_secs=3600",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchRunnerOutput GETs the encoded runner and task run with the tail size", async () => {
    fetchMock.mockResolvedValueOnce(json({ output: "x" }));
    await expect(
      fetchRunnerOutput(ODD, "t/1 2", 8000, { maxRetries: 0 })
    ).resolves.toEqual({ output: "x" });
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/fleet/runners/${ODD_ENCODED}/output?task_run_id=t%2F1%202&tail_chars=8000`,
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchFleetPolicy GETs the encoded domain", async () => {
    fetchMock.mockResolvedValueOnce(json({ domain: ODD }));
    await fetchFleetPolicy(ODD);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/fleet-policy?domain=${ODD_ENCODED}`,
      { method: "GET", idempotent: true },
    ]);
  });
});

describe("coordFleet writes", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("postFleetDrain POSTs the body in wire key order, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(json({ changed: true }));
    await expect(
      postFleetDrain({
        device_id: "d1",
        until: "2026-01-01T00:00:00Z",
        reason: "r",
      })
    ).resolves.toEqual({ changed: true });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/drain",
      {
        method: "POST",
        body: '{"device_id":"d1","until":"2026-01-01T00:00:00Z","reason":"r"}',
        idempotent: false,
      },
    ]);
  });

  it("postFleetUndrain POSTs device and reason, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(json({ changed: false }));
    await postFleetUndrain({ device_id: "d1", reason: "r" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/undrain",
      {
        method: "POST",
        body: '{"device_id":"d1","reason":"r"}',
        idempotent: false,
      },
    ]);
  });

  it("putFleetDispatchRole PUTs with the whole retry chain disabled", async () => {
    fetchMock.mockResolvedValueOnce(json({ changed: true }));
    await putFleetDispatchRole({ dispatch_role: "bench", device_id: "d1" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/dispatch-role",
      {
        method: "PUT",
        body: '{"dispatch_role":"bench","device_id":"d1"}',
        idempotent: false,
        maxRetries: 0,
      },
    ]);
  });

  it("postFleetWorktreeCap and postFleetWorktreeCapClear POST, never re-sent on a 5xx", async () => {
    fetchMock.mockImplementation(async () => json({ changed: true }));
    await postFleetWorktreeCap({
      device_id: "d1",
      max_worktrees: 3,
      reason: "r",
    });
    await postFleetWorktreeCapClear({ device_id: "d1", reason: "r" });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/fleet/worktree-cap",
        {
          method: "POST",
          body: '{"device_id":"d1","max_worktrees":3,"reason":"r"}',
          idempotent: false,
        },
      ],
      [
        "/api/v1/operations/fleet/worktree-cap/clear",
        {
          method: "POST",
          body: '{"device_id":"d1","reason":"r"}',
          idempotent: false,
        },
      ],
    ]);
  });

  it("putFleetPolicy PUTs the dial, retried by method (idempotent)", async () => {
    fetchMock.mockResolvedValueOnce(json({ effective: null }));
    await putFleetPolicy({
      domain: "d",
      scope_band: "tenant",
      scope_key: null,
      level: "on",
      master_enabled: true,
      change_note: "n",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy",
      {
        method: "PUT",
        body: '{"domain":"d","scope_band":"tenant","scope_key":null,"level":"on","master_enabled":true,"change_note":"n"}',
        idempotent: true,
      },
    ]);
  });

  it("a write whose 2xx carries no JSON still resolves null (the change landed)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      postFleetUndrain({ device_id: "d1", reason: "r" })
    ).resolves.toBeNull();
  });

  it("a write rejects a non-2xx carrying the body, in the <METHOD> <url> failed shape", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "admin_required" }, 403));
    const err = await postFleetWorktreeCap({
      device_id: "d1",
      max_worktrees: 1,
      reason: "r",
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'POST /api/v1/operations/fleet/worktree-cap failed: 403 - {"error":"admin_required"}'
    );
    expect(httpStatusOf(err)).toBe(403);
  });
});

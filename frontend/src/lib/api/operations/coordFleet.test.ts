import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { describeCoordPollError } from "@/components/operations/coordPollError";

/**
 * Pins `fetchFleetHealth`'s exact request — the RELATIVE URL (plan D6) on
 * `httpClient.fetch` (the D6 amendment: the helpers would prefix the absolute
 * base) and the init the route walker cannot see — and that the caller's
 * options are kept while the read stays declared `idempotent`. Its rejection
 * must keep `httpClient.get`'s `GET <url> failed: <status> - <body>` shape,
 * because `describeCoordPollError` / `httpStatusOf` / `httpBodyOf` parse it.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchFleetHealth } = await import("./coordFleet");
const { OPERATIONS_BASE } = await import("./base");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordFleet", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("OPERATIONS_BASE is the relative, same-origin form", () => {
    expect(OPERATIONS_BASE).toBe("/api/v1/operations");
  });

  it("fetchFleetHealth GETs /fleet/health, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await fetchFleetHealth();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/health",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchFleetHealth keeps the caller's retry budget", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await fetchFleetHealth({ maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/health",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchFleetHealth resolves to the parsed body", async () => {
    const body = { devices: [{ device_id: "d1" }] };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchFleetHealth()).resolves.toEqual(body);
  });

  it("fetchFleetHealth rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "deadline", budget_ms: 4000 }, 503)
    );
    const err = await fetchFleetHealth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/fleet/health failed: 503 - {"error":"deadline","budget_ms":4000}'
    );
    // The three readers of that shape still read it.
    expect(httpStatusOf(err)).toBe(503);
    expect(httpBodyOf(err)).toBe('{"error":"deadline","budget_ms":4000}');
    expect(describeCoordPollError(err)).toBe(
      "coord read deadline (4000 ms) exceeded — unknown"
    );
  });

  it("fetchFleetHealth passes a network failure through untouched", async () => {
    const err = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValueOnce(err);
    await expect(fetchFleetHealth()).rejects.toBe(err);
  });
});

const {
  fetchComputer,
  fetchComputers,
  fetchDeviceResourceSample,
  fetchDeviceVolumes,
  fetchFleetCiRunners,
  fetchFleetDispatchRoles,
  fetchFleetDrain,
  fetchFleetResourceSamples,
  fetchFleetStatus,
  fetchFleetTasks,
  fetchFleetVolumes,
  fetchFleetWorktreeCap,
  fetchFleetWorktreeSlots,
  fetchRunnerTaskOutput,
  postFleetDrain,
  postFleetUndrain,
  postFleetWorktreeCap,
  postFleetWorktreeCapClear,
  putFleetDispatchRole,
  renameMachine,
} = await import("./coordFleet");

/**
 * The rest of `/fleet/*` and its neighbours. Every read is a relative GET
 * declared `idempotent` that keeps the caller's retry budget; every write is
 * `idempotent: false` (the dispatch-role PUT also `maxRetries: 0`), so the
 * whole init is compared with `toEqual` and the literal URL is spelled out.
 */
describe("coordFleet — fleet reads", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  const POLL = { maxRetries: 0 };
  const reads: Array<{
    name: string;
    call: () => Promise<unknown>;
    url: string;
    init: Record<string, unknown>;
  }> = [
    {
      name: "fetchFleetStatus",
      call: () => fetchFleetStatus(),
      url: "/api/v1/operations/fleet",
      init: { method: "GET", idempotent: true },
    },
    {
      name: "fetchFleetTasks",
      call: () => fetchFleetTasks(),
      url: "/api/v1/operations/fleet/tasks",
      init: { method: "GET", idempotent: true },
    },
    {
      name: "fetchRunnerTaskOutput",
      call: () => fetchRunnerTaskOutput("r 1", "t/2", POLL),
      url: "/api/v1/operations/fleet/runners/r%201/output?task_run_id=t%2F2&tail_chars=8000",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchFleetDrain",
      call: () => fetchFleetDrain(POLL),
      url: "/api/v1/operations/fleet/drain",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchFleetWorktreeCap",
      call: () => fetchFleetWorktreeCap(POLL),
      url: "/api/v1/operations/fleet/worktree-cap",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchFleetDispatchRoles",
      call: () => fetchFleetDispatchRoles(POLL),
      url: "/api/v1/operations/fleet/dispatch-roles",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchFleetResourceSamples",
      call: () => fetchFleetResourceSamples(3600, POLL),
      url: "/api/v1/operations/fleet/resource-samples?window_secs=3600",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchDeviceResourceSample",
      call: () => fetchDeviceResourceSample("d/1", POLL),
      url: "/api/v1/operations/fleet/resource-samples?device_id=d%2F1&history=false",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchFleetWorktreeSlots",
      call: () => fetchFleetWorktreeSlots(POLL),
      url: "/api/v1/operations/fleet/worktree-slots",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchFleetCiRunners",
      call: () => fetchFleetCiRunners(POLL),
      url: "/api/v1/operations/fleet/ci-runners",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchFleetVolumes",
      call: () => fetchFleetVolumes(POLL),
      url: "/api/v1/operations/fleet/volumes",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchDeviceVolumes",
      call: () => fetchDeviceVolumes("d/1"),
      url: "/api/v1/operations/devices/d%2F1/volumes",
      init: { method: "GET", idempotent: true },
    },
    {
      name: "fetchComputers",
      call: () => fetchComputers(POLL),
      url: "/api/v1/operations/computers",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
    {
      name: "fetchComputer",
      call: () => fetchComputer("c/1", POLL),
      url: "/api/v1/operations/computers/c%2F1",
      init: { maxRetries: 0, method: "GET", idempotent: true },
    },
  ];

  for (const r of reads) {
    it(`${r.name} GETs ${r.url} and resolves the parsed body`, async () => {
      fetchMock.mockResolvedValueOnce(json({ ok: 1 }));
      await expect(r.call()).resolves.toEqual({ ok: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]).toEqual([r.url, r.init]);
    });
  }

  it("a fleet read rejects a non-2xx with its status and body readable", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 404));
    const err = await fetchFleetDrain().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/fleet/drain failed: 404 - {"error":"nope"}'
    );
    expect(httpStatusOf(err)).toBe(404);
  });

  it("a fleet read rejects an unparseable 2xx with a SyntaxError", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    await expect(fetchFleetVolumes()).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe("coordFleet — fleet writes", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("renameMachine PATCHes /fleet/machines/{hostname} with a JSON body, idempotent", async () => {
    fetchMock.mockResolvedValueOnce(json({ hostname: "h/1", name: "box" }));
    await expect(renameMachine("h/1", "box")).resolves.toEqual({
      hostname: "h/1",
      name: "box",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/machines/h%2F1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "box" }),
        idempotent: true,
      },
    ]);
  });

  it("renameMachine rejects a non-2xx in the PATCH error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    await expect(renameMachine("h", "")).rejects.toThrow(
      "PATCH /api/v1/operations/fleet/machines/h failed: 403 - denied"
    );
  });

  it("postFleetDrain POSTs the drain body once, never re-issued", async () => {
    fetchMock.mockResolvedValueOnce(json({ changed: true }));
    const body = {
      device_id: "d1",
      until: "2026-10-13T00:00:00Z",
      reason: "r",
    };
    await expect(postFleetDrain(body)).resolves.toEqual({ changed: true });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/drain",
      { method: "POST", body: JSON.stringify(body), idempotent: false },
    ]);
  });

  it("postFleetUndrain POSTs the undrain body once, never re-issued", async () => {
    fetchMock.mockResolvedValueOnce(json({ changed: false }));
    const body = { device_id: "d1", reason: "r" };
    await expect(postFleetUndrain(body)).resolves.toEqual({ changed: false });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/undrain",
      { method: "POST", body: JSON.stringify(body), idempotent: false },
    ]);
  });

  it("postFleetWorktreeCap POSTs the cap body once, never re-issued", async () => {
    fetchMock.mockResolvedValueOnce(json({ changed: true }));
    const body = { device_id: "d1", max_worktrees: 4, reason: "r" };
    await postFleetWorktreeCap(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/worktree-cap",
      { method: "POST", body: JSON.stringify(body), idempotent: false },
    ]);
  });

  it("postFleetWorktreeCapClear POSTs the clear body once, never re-issued", async () => {
    fetchMock.mockResolvedValueOnce(json({ changed: true }));
    const body = { device_id: "d1", reason: "r" };
    await postFleetWorktreeCapClear(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/worktree-cap/clear",
      { method: "POST", body: JSON.stringify(body), idempotent: false },
    ]);
  });

  it("putFleetDispatchRole PUTs the role body with no retries at all", async () => {
    fetchMock.mockResolvedValueOnce(json({ changed: true }));
    const body = {
      dispatch_role: "ci_only",
      reason: "r",
      force: false,
      device_id: "d1",
    };
    await putFleetDispatchRole(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/dispatch-role",
      {
        method: "PUT",
        body: JSON.stringify(body),
        idempotent: false,
        maxRetries: 0,
      },
    ]);
  });

  it("a write resolves null for a 2xx whose body does not parse — it still landed", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(
      postFleetDrain({ device_id: "d1", until: "x", reason: "r" })
    ).resolves.toBeNull();
  });

  it("a write rejects a non-2xx with coord's body intact", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"device_not_in_tenant"}', { status: 422 })
    );
    const err = await postFleetWorktreeCapClear({
      device_id: "d1",
      reason: "r",
    }).catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(422);
    expect(httpBodyOf(err)).toBe('{"error":"device_not_in_tenant"}');
  });
});

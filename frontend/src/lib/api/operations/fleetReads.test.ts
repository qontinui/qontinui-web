import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `fleetReads` function's exact request: the RELATIVE URL as a
 * LITERAL, the method, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const reads = await import("./fleetReads");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("fleetReads", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchFleetResourceSamples GETs window_secs with no client retries and parses the body", async () => {
    const body = { samples: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(reads.fetchFleetResourceSamples(3600)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/resource-samples?window_secs=3600",
      { method: "GET", maxRetries: 0 },
    ]);
  });

  it("fetchFleetResourceSamples rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 502 }));
    const err = await reads
      .fetchFleetResourceSamples(60)
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/fleet/resource-samples?window_secs=60 failed: 502 - nope"
    );
    expect(httpStatusOf(err)).toBe(502);
  });

  it("fetchDeviceResourceSample percent-encodes the device id and asks for no history", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await reads.fetchDeviceResourceSample("a b/c");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/resource-samples?device_id=a%20b%2Fc&history=false",
      { method: "GET", maxRetries: 0 },
    ]);
  });

  it("fetchCiRunnerMirror and fetchFaultToVisibility parse the body, no client retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({ runners: [] }));
    await expect(reads.fetchCiRunnerMirror()).resolves.toEqual({ runners: [] });
    fetchMock.mockResolvedValueOnce(answer({ p50: 1 }));
    await expect(reads.fetchFaultToVisibility()).resolves.toEqual({ p50: 1 });
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/fleet/ci-runners", { method: "GET", maxRetries: 0 }],
      [
        "/api/v1/operations/alerts/fault-to-visibility",
        { method: "GET", maxRetries: 0 },
      ],
    ]);
  });

  it("fetchFleetVolumes GETs with no client retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await reads.fetchFleetVolumes();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/volumes",
      { method: "GET", maxRetries: 0 },
    ]);
  });

  it("fetchDeviceVolumes, fetchFleet and fetchFleetTasks keep the default retry budget", async () => {
    fetchMock.mockResolvedValue(answer({}));
    await reads.fetchDeviceVolumes("d/1");
    await reads.fetchFleet();
    await reads.fetchFleetTasks();
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/devices/d%2F1/volumes"],
      ["/api/v1/operations/fleet"],
      ["/api/v1/operations/fleet/tasks"],
    ]);
  });

  it("fetchRunnerOutput encodes both ids and sends no client retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await reads.fetchRunnerOutput("r/1", "t 2", 8000);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/runners/r%2F1/output?task_run_id=t%202&tail_chars=8000",
      { method: "GET", maxRetries: 0 },
    ]);
  });

  it("renameFleetMachine PATCHes the name, safe to re-issue", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await reads.renameFleetMachine("host a", "Box");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/machines/host%20a",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Box" }),
        idempotent: true,
      },
    ]);
  });

  it("fetchDeviceFleetSessions and postSessionControlRequest hit the session routes", async () => {
    fetchMock.mockResolvedValue(answer({}));
    await reads.fetchDeviceFleetSessions("d1", 500);
    await reads.postSessionControlRequest("s/1", { action: "drain" });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/sessions/fleet?device_id=d1&limit=500",
        { method: "GET", maxRetries: 0 },
      ],
      [
        "/api/v1/operations/sessions/s%2F1/control",
        { method: "POST", body: JSON.stringify({ action: "drain" }) },
      ],
    ]);
  });
});

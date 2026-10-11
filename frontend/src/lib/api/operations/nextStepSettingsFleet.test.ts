import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins the exact request of each nextStepSettingsFleet function: RELATIVE URL literal, method, body. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchFleetNextStepSettings } = await import("./nextStepSettingsFleet");

describe("nextStepSettingsFleet", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("GETs /coord/next-step-settings/fleet and parses the body", async () => {
    const body = { master_enabled: true, tenants: [] };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(
      fetchFleetNextStepSettings({ maxRetries: 0 })
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/next-step-settings/fleet",
      { maxRetries: 0, method: "GET" },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
    const err = await fetchFleetNextStepSettings().catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(500);
  });
});

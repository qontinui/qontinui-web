import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `readFleetVolumes` — how one fleet-volumes read maps onto what the disk
 * section renders when the read fails before any status arrives.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { readFleetVolumes } = await import("./useFleetVolumes");

describe("readFleetVolumes", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("names a network failure as the fleet-volumes request, without a URL", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const read = await readFleetVolumes();
    expect(read).toEqual({
      state: "unavailable",
      reason: "The fleet-volumes request failed: Failed to fetch",
    });
  });

  it("names an unparseable 2xx as invalid JSON, not as a failed request", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    const read = await readFleetVolumes();
    expect(read.state).toBe("unavailable");
    expect(read.state === "unavailable" && read.reason).toMatch(
      /^The fleet-volumes response was not valid JSON: /
    );
  });
});

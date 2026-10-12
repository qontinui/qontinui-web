import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request the `/project-state` client sends. */

const getMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

const { fetchProjectState, PROJECT_STATE_URL } = await import("./projectState");

describe("projectState", () => {
  afterEach(() => {
    getMock.mockReset();
  });

  it("GETs /project-state through httpClient.get, passing the poll options", async () => {
    const body = { schema: 1 };
    getMock.mockResolvedValueOnce(body);
    await expect(fetchProjectState({ maxRetries: 0 })).resolves.toBe(body);
    expect(PROJECT_STATE_URL).toBe("/api/v1/operations/project-state");
    expect(getMock.mock.calls[0]).toEqual([
      "/api/v1/operations/project-state",
      { maxRetries: 0 },
    ]);
  });

  it("rejects with httpClient.get's own error, so poll classification sees its status", async () => {
    const err = Object.assign(new Error("HTTP 404"), { status: 404 });
    getMock.mockRejectedValueOnce(err);
    await expect(fetchProjectState()).rejects.toBe(err);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each unfinished-sessions client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  dismissUnfinishedSession,
  fetchResumeUnfinishedPolicy,
  fetchUnfinishedSessions,
  patchResumeUnfinishedPolicy,
  resumeUnfinishedSession,
} = await import("./unfinished");

const B = "/api/v1/operations";

describe("unfinished", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("reads are idempotent GETs", async () => {
    fetchMock.mockImplementation(async () => new Response("{}"));
    await fetchUnfinishedSessions();
    await fetchResumeUnfinishedPolicy();
    expect(fetchMock.mock.calls).toEqual([
      [`${B}/unfinished-sessions`, { method: "GET", idempotent: true }],
      [
        `${B}/tenant-policy/resume-unfinished`,
        { method: "GET", idempotent: true },
      ],
    ]);
  });

  it("dismiss and resume are never retried", async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 204 })
    );
    await expect(dismissUnfinishedSession("c1")).resolves.toBeNull();
    await resumeUnfinishedSession("s1", {
      target_device_id: "d1",
      account: ".claude-x",
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        `${B}/unfinished-sessions/c1/dismiss`,
        { method: "POST", body: "{}", idempotent: false },
      ],
      [
        `${B}/unfinished-sessions/s1/resume`,
        {
          method: "POST",
          body: '{"target_device_id":"d1","account":".claude-x"}',
          idempotent: false,
        },
      ],
    ]);
  });

  it("patch sends the flag, never retried, and a 504 keeps the shape the hook reads", async () => {
    fetchMock.mockResolvedValueOnce(new Response("lost", { status: 504 }));
    await expect(patchResumeUnfinishedPolicy(true)).rejects.toThrow(
      `PATCH ${B}/tenant-policy/resume-unfinished failed: 504 - lost`
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      `${B}/tenant-policy/resume-unfinished`,
      {
        method: "PATCH",
        body: '{"resume_unfinished_enabled":true}',
        idempotent: false,
      },
    ]);
  });
});

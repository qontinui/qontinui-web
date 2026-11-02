import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins the exact request the `/project-state` client sends: the RELATIVE URL
 * written out as a LITERAL (so a change to the shared base cannot move the
 * expectation with it), through `httpClient.fetch` — the one transport that
 * keeps it same-origin (`./base`, D6) — with the caller's retry options, and
 * a rejection in `httpClient.get`'s own message shape.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchProjectState, PROJECT_STATE_URL } = await import("./projectState");

function answer(text: string, status = 200): Response {
  return new Response(text, { status });
}

describe("projectState", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("GETs the relative /project-state through httpClient.fetch, passing the poll options", async () => {
    const body = { schema: 1 };
    fetchMock.mockResolvedValueOnce(answer(JSON.stringify(body)));
    await expect(fetchProjectState({ maxRetries: 0 })).resolves.toEqual(body);
    expect(PROJECT_STATE_URL).toBe("/api/v1/operations/project-state");
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/project-state",
        { maxRetries: 0, method: "GET", idempotent: true },
      ],
    ]);
  });

  it("sends no options of its own beyond the method when the caller passes none", async () => {
    fetchMock.mockResolvedValueOnce(answer("{}"));
    await fetchProjectState();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/project-state",
      { method: "GET", idempotent: true },
    ]);
  });

  it("rejects a non-2xx in httpClient.get's error shape, so poll classification reads its status and body", async () => {
    const body =
      '{"error":"GATEWAY_TIMEOUT","message":"timeout waiting for coord"}';
    fetchMock.mockResolvedValueOnce(answer(body, 504));
    const err = await fetchProjectState().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `GET /api/v1/operations/project-state failed: 504 - ${body}`
    );
    expect(httpStatusOf(err)).toBe(504);
    expect(httpBodyOf(err)).toBe(body);
  });

  it("passes a transport rejection through unchanged", async () => {
    const err = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValueOnce(err);
    await expect(fetchProjectState()).rejects.toBe(err);
  });
});

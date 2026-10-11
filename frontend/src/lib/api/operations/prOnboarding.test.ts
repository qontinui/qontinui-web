import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `prOnboarding` function's exact request: the RELATIVE URL written out as a
 * LITERAL (so a change to the shared base cannot move every expectation with
 * it), the method, the body, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => fetchMock.mockReset());

const m = await import("./prOnboarding");

describe("prOnboarding", () => {
  it("postConnectState POSTs the payload with no client retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({ connect_state: "abc" }));
    await expect(m.postConnectState({ flow: "merge" })).resolves.toEqual({
      connect_state: "abc",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/connect-state",
      { method: "POST", body: '{"flow":"merge"}', maxRetries: 0 },
    ]);
  });

  it("postConnectState resolves null for a 2xx whose body does not parse, and rejects a non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    await expect(m.postConnectState({})).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(answer("no", 502));
    const err = await m.postConnectState({}).catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(502);
  });

  it("fetchPendingInstallationRow GETs the keyed row", async () => {
    const row = { pending: true };
    fetchMock.mockResolvedValueOnce(answer(row));
    await expect(
      m.fetchPendingInstallationRow(
        new URLSearchParams({ installation_id: "7" })
      )
    ).resolves.toEqual(row);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/operations/pr-merge/onboarding/pending-installation?installation_id=7"
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins `coordQuestions`' exact requests: literal relative URLs, encoding, options. */

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchAgentQuestion, respondToAgentQuestion } =
  await import("./coordQuestions");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordQuestions", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchAgentQuestion GETs the encoded question, declared idempotent", async () => {
    const body = { question_id: "q/1" };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchAgentQuestion("q/1")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/q%2F1",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchAgentQuestion resolves a null body as null, for the caller to refuse", async () => {
    fetchMock.mockResolvedValueOnce(answer(null));
    await expect(fetchAgentQuestion("q-1")).resolves.toBeNull();
  });

  it("fetchAgentQuestion rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "gone" }, 404));
    const err = await fetchAgentQuestion("q-1").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/agent-questions/q-1 failed: 404 - {"detail":"gone"}'
    );
    expect(httpStatusOf(err)).toBe(404);
  });

  it("respondToAgentQuestion POSTs the answer, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await respondToAgentQuestion("q-1", "bump", "op@example.com");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/q-1/respond",
      {
        method: "POST",
        body: JSON.stringify({
          response: "bump",
          responded_by_operator: "op@example.com",
        }),
        idempotent: false,
      },
    ]);
  });

  it("respondToAgentQuestion treats a 2xx with an unreadable body as landed", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(respondToAgentQuestion("q-1", "x", "op")).resolves.toBeNull();
  });

  it("respondToAgentQuestion rejects a non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "no" }, 409));
    const err = await respondToAgentQuestion("q-1", "x", "op").catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(409);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordQuestions` function's exact request: the RELATIVE URL as a
 * LITERAL, the `encodeURIComponent` of the question id, and the
 * `httpClient.fetch` options (method, idempotent, the caller's retry budget).
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchAnsweredGapQuestions,
  fetchAnsweredQuestions,
  fetchPendingGapQuestions,
  fetchPendingQuestions,
  fetchQuestion,
  respondToQuestion,
} = await import("./coordQuestions");

const RAW = "q/1 #2";
const ENCODED = "q%2F1%20%232";
const POLL = { maxRetries: 0 };

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordQuestions", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "x" }, 503));
    const err = await fetchPendingQuestions().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/agent-questions/pending failed: 503 - {"error":"x"}'
    );
    expect(httpStatusOf(err)).toBe(503);
  });

  it("fetchPendingQuestions GETs /agent-questions/pending", async () => {
    fetchMock.mockResolvedValueOnce(answer({ questions: [] }));
    await expect(fetchPendingQuestions(POLL)).resolves.toEqual({
      questions: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/pending",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPendingGapQuestions GETs /agent-questions/pending?gap=true", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await fetchPendingGapQuestions();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/pending?gap=true",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchAnsweredQuestions GETs /agent-questions/answered with the limit", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await fetchAnsweredQuestions(50, POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/answered?limit=50",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchAnsweredGapQuestions GETs the gap form with the limit", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await fetchAnsweredGapQuestions(200);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/answered?gap=true&limit=200",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchQuestion GETs /agent-questions/{id} with the id encoded", async () => {
    fetchMock.mockResolvedValueOnce(answer({ id: RAW }));
    await fetchQuestion(RAW);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/agent-questions/${ENCODED}`,
      { method: "GET", idempotent: true },
    ]);
  });

  it("respondToQuestion POSTs the response in wire key order, not idempotent", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await respondToQuestion(RAW, {
      responded_by_operator: "op@x.io",
      response: "yes",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/agent-questions/${ENCODED}/respond`,
      {
        method: "POST",
        body: '{"responded_by_operator":"op@x.io","response":"yes"}',
        idempotent: false,
      },
    ]);
  });
});

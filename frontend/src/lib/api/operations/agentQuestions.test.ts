import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each agent-questions client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchAgentQuestion,
  fetchAnsweredAgentQuestions,
  fetchAnsweredPolicyGapQuestions,
  fetchPendingAgentQuestions,
  fetchPendingPolicyGapQuestions,
  respondToAgentQuestion,
} = await import("./agentQuestions");

const POLL = { maxRetries: 0 };

function answer(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
}

describe("agentQuestions", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchPendingAgentQuestions GETs /agent-questions/pending with the caller's retry budget", async () => {
    answer({ questions: [] });
    await expect(fetchPendingAgentQuestions(POLL)).resolves.toEqual({
      questions: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/pending",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPendingAgentQuestions keeps the client's default retries with no options", async () => {
    answer({ questions: [] });
    await fetchPendingAgentQuestions();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/pending",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchPendingPolicyGapQuestions GETs the pending inbox with the gap hint", async () => {
    answer({ questions: [] });
    await fetchPendingPolicyGapQuestions(POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/pending?gap=true",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchAnsweredAgentQuestions GETs /agent-questions/answered with the limit", async () => {
    answer([]);
    await expect(fetchAnsweredAgentQuestions(50)).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/answered?limit=50",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchAnsweredPolicyGapQuestions GETs the answered inbox with the gap hint and limit", async () => {
    answer({ questions: [] });
    await fetchAnsweredPolicyGapQuestions(200, POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/answered?gap=true&limit=200",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchAgentQuestion GETs one question with its id encoded", async () => {
    answer({ question_id: "q/1", question: "?" });
    await expect(fetchAgentQuestion("q/1")).resolves.toEqual({
      question_id: "q/1",
      question: "?",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/q%2F1",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchAgentQuestion rejects a 404 in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("gone", { status: 404 }));
    await expect(fetchAgentQuestion("q-1")).rejects.toThrow(
      "GET /api/v1/operations/agent-questions/q-1 failed: 404 - gone"
    );
  });

  it("respondToAgentQuestion POSTs the answer once, never re-sent on a 5xx", async () => {
    answer({ ok: true });
    await respondToAgentQuestion("q/1", {
      response: "pin it",
      responded_by_operator: "op@example.com",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/q%2F1/respond",
      {
        method: "POST",
        body: '{"response":"pin it","responded_by_operator":"op@example.com"}',
        idempotent: false,
      },
    ]);
  });

  it("respondToAgentQuestion resolves null on an unparseable 2xx and rejects a 409 in httpClient.post's shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(
      respondToAgentQuestion("q-1", {
        response: "x",
        responded_by_operator: "op",
      })
    ).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(
      new Response("already answered", { status: 409 })
    );
    await expect(
      respondToAgentQuestion("q-1", {
        response: "x",
        responded_by_operator: "op",
      })
    ).rejects.toThrow(
      "POST /api/v1/operations/agent-questions/q-1/respond failed: 409 - already answered"
    );
  });
});

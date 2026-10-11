import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins the exact request of each agentQuestions function: RELATIVE URL literal, method, body. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchPendingQuestions, fetchAnsweredQuestions } =
  await import("./agentQuestions");

describe("agentQuestions", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchPendingQuestions GETs /agent-questions/pending with and without a query", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ questions: [] }), { status: 200 })
    );
    await fetchPendingQuestions("");
    await fetchPendingQuestions("gap=true", { maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/pending",
      { method: "GET" },
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/v1/operations/agent-questions/pending?gap=true",
      { maxRetries: 0, method: "GET" },
    ]);
  });

  it("fetchAnsweredQuestions GETs /agent-questions/answered?<query>", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ questions: [] }), { status: 200 })
    );
    await fetchAnsweredQuestions("limit=5");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-questions/answered?limit=5",
      { method: "GET" },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
    const err = await fetchPendingQuestions("").catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(500);
  });
});

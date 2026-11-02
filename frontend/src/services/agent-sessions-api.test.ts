import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: fetchMock },
}));

import { AgentSessionsApiError, getSessionCensus } from "./agent-sessions-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("parseError", () => {
  beforeEach(() => fetchMock.mockReset());

  it("reads a refusal_error body's message when it has no detail", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(502, { error: "x", message: "census body not an object" })
    );
    const err = await getSessionCensus({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentSessionsApiError);
    expect((err as Error).message).toBe("census body not an object");
  });

  it("prefers detail over message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, { detail: "the detail", message: "the message" })
    );
    const err = await getSessionCensus({}).catch((e: unknown) => e);
    expect((err as Error).message).toBe("the detail");
  });
});

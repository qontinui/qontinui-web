import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the exact request `fetchKpis` sends — the literal relative URL and the
 * full `httpClient.fetch` init — and how it parses (and refuses) the answer.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchKpis } = await import("./coordKpis");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordKpis", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("sends no `?` when neither window nor repos is set", async () => {
    fetchMock.mockResolvedValueOnce(json({ schema: "kpis/v1" }));
    await expect(fetchKpis()).resolves.toEqual({ schema: "kpis/v1" });
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/kpis", { method: "GET", idempotent: true }],
    ]);
  });

  it("forwards window and the caller's options", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await fetchKpis({ window: "7d" }, { maxRetries: 0 });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/kpis?window=7d",
        { maxRetries: 0, method: "GET", idempotent: true },
      ],
    ]);
  });

  it("forwards repos as one comma list, percent-encoded", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await fetchKpis({ window: "28d", repos: "qontinui/a,qontinui/b" });
    const url = fetchMock.mock.calls[0][0] as string;
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("window")).toBe("28d");
    // One value; the backend decodes it and coord splits on the comma.
    expect(qs.getAll("repos")).toEqual(["qontinui/a,qontinui/b"]);
  });

  it("omits an empty window or repos rather than sending `window=`", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await fetchKpis({ window: "", repos: "" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/operations/kpis");
  });

  it("rejects a non-2xx in httpClient.get's shape, status and body intact", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"no_such_route"}', { status: 404 })
    );
    await expect(fetchKpis({ window: "28d" })).rejects.toThrow(
      'GET /api/v1/operations/kpis?window=28d failed: 404 - {"error":"no_such_route"}'
    );
  });
});

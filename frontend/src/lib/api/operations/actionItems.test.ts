import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each action-items client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchActionItems, resolveActionItem } = await import("./actionItems");

function answer(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
}

describe("actionItems client", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchActionItems sends only the set params, in order", async () => {
    answer({
      items: [],
      next_cursor: null,
      counts: { open: 0, done: 0, dismissed: 0 },
    });
    await fetchActionItems(
      { status: "open", limit: 200, cursor: "c/1", itemId: "abc" },
      { maxRetries: 0 }
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/action-items?status=open&limit=200&cursor=c%2F1&item_id=abc",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchActionItems with no params sends a bare path", async () => {
    answer({ items: [] });
    await fetchActionItems({});
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/operations/action-items");
  });

  it("fetchActionItems keeps coord's 503 in the shared error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"schema_migration_pending"}', { status: 503 })
    );
    await expect(fetchActionItems({ status: "open" })).rejects.toThrow(
      'GET /api/v1/operations/action-items?status=open failed: 503 - {"error":"schema_migration_pending"}'
    );
  });

  it("resolveActionItem POSTs the typed body and omits an absent note", async () => {
    answer({ item: { item_id: "i1", status: "done" } });
    await resolveActionItem("i1", "done", undefined, {
      noRetryStatuses: [429, 503],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/operations/action-items/resolve");
    expect(init).toMatchObject({
      method: "POST",
      idempotent: false,
      noRetryStatuses: [429, 503],
    });
    expect(JSON.parse(init.body)).toEqual({ item_id: "i1", status: "done" });
  });

  it("resolveActionItem carries a note when given", async () => {
    answer({ item: {} });
    await resolveActionItem("i1", "dismissed", "not needed");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      item_id: "i1",
      status: "dismissed",
      note: "not needed",
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each notifications client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchNotifications, markNotificationsRead } =
  await import("./notifications");

function answer(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
}

describe("notifications", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchNotifications GETs one row for the nav badge, with the caller's options", async () => {
    answer({ notifications: [], unread_count: 3 });
    await expect(
      fetchNotifications({ limit: 1 }, { noRetryStatuses: [503] })
    ).resolves.toEqual({ notifications: [], unread_count: 3 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/notifications?limit=1",
      { noRetryStatuses: [503], method: "GET", idempotent: true },
    ]);
  });

  it("fetchNotifications sends every filter, in order, encoded", async () => {
    answer({ notifications: [] });
    await fetchNotifications({
      limit: 50,
      kind: "policy change",
      unreadOnly: true,
      via: "agent_evidence",
      cursor: "c/1",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/notifications?limit=50&kind=policy+change&unread_only=true&via=agent_evidence&cursor=c%2F1",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchNotifications omits absent and false filters", async () => {
    answer({ notifications: [] });
    await fetchNotifications({ limit: 50, unreadOnly: false, cursor: null });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/notifications?limit=50",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchNotifications keeps coord's 503 in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"schema_migration_pending"}', { status: 503 })
    );
    await expect(fetchNotifications({ limit: 1 })).rejects.toThrow(
      'GET /api/v1/operations/notifications?limit=1 failed: 503 - {"error":"schema_migration_pending"}'
    );
  });

  it("markNotificationsRead POSTs the selection as the body, never re-sent on a 5xx", async () => {
    answer({ marked: 1, unread_count: 0 });
    await expect(
      markNotificationsRead(
        { notification_ids: ["n-1"] },
        { noRetryStatuses: [429, 503] }
      )
    ).resolves.toEqual({ marked: 1, unread_count: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/notifications/mark-read",
      {
        noRetryStatuses: [429, 503],
        method: "POST",
        body: '{"notification_ids":["n-1"]}',
        idempotent: false,
      },
    ]);
  });

  it("markNotificationsRead sends the mark-all arm as {all: true}", async () => {
    answer({ marked: 9 });
    await markNotificationsRead({ all: true });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/notifications/mark-read",
      { method: "POST", body: '{"all":true}', idempotent: false },
    ]);
  });
});

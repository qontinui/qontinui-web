import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins the exact request of each notificationsFeed function: RELATIVE URL literal, method, body. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchNotifications, markNotificationsRead } =
  await import("./notificationsFeed");

describe("notificationsFeed", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchNotifications GETs /notifications?<query> with the caller's options", async () => {
    const body = { notifications: [] };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(
      fetchNotifications("limit=50", { maxRetries: 0 })
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/notifications?limit=50",
      { maxRetries: 0, method: "GET" },
    ]);
  });

  it("markNotificationsRead POSTs the selection as the body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ marked: 1 }), { status: 200 })
    );
    await markNotificationsRead({ all: true }, { maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/notifications/mark-read",
      { maxRetries: 0, method: "POST", body: '{"all":true}' },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 503 }));
    const err = await fetchNotifications("").catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(503);
  });
});

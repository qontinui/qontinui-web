/**
 * The relay client reads the backend's diagnostic error body.
 *
 * The backend puts `device_id`, `ws_connected_at`, `last_seen_at` and
 * `request_id` on its 404/503 bodies specifically so a relay failure can be
 * diagnosed. Until this file existed, `runnerProxyGet` threw all of it away
 * and surfaced the bare string "runner returned HTTP 503" — the fields were
 * emitted and never read.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import { runnerProxyGet, RunnerRelayError } from "./runner-relay";

/** Minimal `Response` stand-in — only what `runnerProxyGet` touches. */
function errorResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return {
    ok: false,
    status,
    headers: { get: (k: string) => headers[k] ?? null },
    json: async () => {
      if (body === undefined) throw new SyntaxError("not JSON");
      return body;
    },
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("runnerProxyGet error diagnostics", () => {
  it("exposes the 503 body's device id, both clocks, and request id", async () => {
    fetchMock.mockResolvedValue(
      errorResponse(503, {
        detail: "runner not connected",
        device_id: "dev-1",
        ws_connected_at: "2026-08-27T09:20:00+00:00",
        last_seen_at: "2026-08-27T09:15:00+00:00",
        request_id: "req-9",
      })
    );

    const err = await runnerProxyGet("dev-1", "health").catch((e) => e);

    expect(err).toBeInstanceOf(RunnerRelayError);
    expect(err.status).toBe(503);
    expect(err.detail).toBe("runner not connected");
    expect(err.deviceId).toBe("dev-1");
    expect(err.wsConnectedAt).toBe("2026-08-27T09:20:00+00:00");
    expect(err.lastSeenAt).toBe("2026-08-27T09:15:00+00:00");
    expect(err.requestId).toBe("req-9");
    // The message is what React Query renders and what lands in the console,
    // so the two facts a reader needs must be in it.
    expect(err.message).toContain("runner not connected");
    expect(err.message).toContain("req-9");
  });

  it("keeps a null ws_connected_at as null, not undefined", async () => {
    // `null` means "never registered" — a distinct answer from "the backend
    // did not tell us", so it must survive the parse rather than collapse.
    fetchMock.mockResolvedValue(
      errorResponse(503, {
        detail: "runner not connected",
        device_id: "dev-1",
        ws_connected_at: null,
        last_seen_at: null,
      })
    );

    const err = await runnerProxyGet("dev-1", "health").catch((e) => e);

    expect(err.wsConnectedAt).toBeNull();
    expect(err.lastSeenAt).toBeNull();
  });

  it("keeps an ABSENT ws_connected_at absent, distinct from null", async () => {
    // The wire→object hop is the one place this distinction can be destroyed,
    // and both spellings are falsy, so a `?? null` or a `v == null` tidy-up
    // would silently collapse them. The backend omits these keys when its
    // coord read failed; reading that as `null` would make the UI announce
    // "the runner has never registered" every time coord hiccupped.
    fetchMock.mockResolvedValue(
      errorResponse(503, {
        detail: "runner not connected",
        device_id: "dev-1",
      })
    );

    const err = await runnerProxyGet("dev-1", "health").catch((e) => e);

    expect(err.wsConnectedAt).toBeUndefined();
    expect(err.lastSeenAt).toBeUndefined();
    // Not merely falsy — the two cases must not compare equal.
    expect(err.wsConnectedAt).not.toBeNull();
  });

  it("falls back to the X-Request-ID header when the body has no id", async () => {
    fetchMock.mockResolvedValue(
      errorResponse(
        404,
        { detail: "device not found or not owned by caller" },
        { "X-Request-ID": "req-header" }
      )
    );

    const err = await runnerProxyGet("dev-1", "health").catch((e) => e);

    expect(err.status).toBe(404);
    expect(err.requestId).toBe("req-header");
  });

  it("degrades to no diagnostics when the body is not JSON", async () => {
    // A proxy's HTML error page must not turn into a parse error that hides
    // the real HTTP failure.
    fetchMock.mockResolvedValue(errorResponse(502, undefined));

    const err = await runnerProxyGet("dev-1", "health").catch((e) => e);

    expect(err).toBeInstanceOf(RunnerRelayError);
    expect(err.status).toBe(502);
    expect(err.detail).toBeUndefined();
    expect(err.message).toContain("HTTP 502");
  });

  it("still returns the parsed body on success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true }),
    } as unknown as Response);

    await expect(runnerProxyGet("dev-1", "health")).resolves.toEqual({
      ok: true,
    });
  });
});

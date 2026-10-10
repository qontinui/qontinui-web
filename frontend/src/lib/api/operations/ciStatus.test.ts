import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `ciStatus` function's exact request: the RELATIVE URL written out
 * as a LITERAL (so a change to the shared base cannot move every expectation
 * with it), the method, the body, and the retry policy the route walker cannot
 * see. The push-channel URL is the one ABSOLUTE URL, pinned against a mocked
 * `NEXT_PUBLIC_API_URL`.
 */

const fetchMock = vi.fn();
const apiConfig = vi.hoisted(() => ({ API_BASE_URL: "https://api.example.test" }));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

vi.mock("@/services/api-config", () => ({ ApiConfig: apiConfig }));

const {
  armNotifyWhenGreen,
  ciStatusWsUrl,
  fetchCiHosting,
  fetchCiOverview,
  fetchCiStatus,
} = await import("./ciStatus");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("ciStatus", () => {
  afterEach(() => {
    fetchMock.mockReset();
    window.localStorage.clear();
  });

  it("fetchCiOverview GETs /ci/overview with no client retries and resolves the body unvalidated", async () => {
    const body = { pools: [], repos: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchCiOverview()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/ci/overview",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchCiOverview rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "deadline" }, 503));
    const err = await fetchCiOverview().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/ci/overview failed: 503 - {"error":"deadline"}'
    );
    expect(httpStatusOf(err)).toBe(503);
  });

  it("fetchCiStatus GETs /ci-status with no client retries and parses the body", async () => {
    const body = { as_of: "2026-10-09T00:00:00Z", repos: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchCiStatus()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/ci-status",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("armNotifyWhenGreen POSTs {repo, head_sha} and is never re-sent on a 5xx", async () => {
    const body = { gate_id: "g-1", initial_verdict: "open" };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(
      armNotifyWhenGreen({ repo: "o/r", head_sha: "abc" })
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/ci-status/notify-when-green",
      {
        method: "POST",
        body: '{"repo":"o/r","head_sha":"abc"}',
        idempotent: false,
      },
    ]);
  });

  it("armNotifyWhenGreen rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 409 }));
    const err = await armNotifyWhenGreen({ repo: "o/r", head_sha: "abc" }).catch(
      (e: unknown) => e
    );
    expect((err as Error).message).toBe(
      "POST /api/v1/operations/ci-status/notify-when-green failed: 409 - nope"
    );
    expect(httpStatusOf(err)).toBe(409);
  });

  it("fetchCiHosting GETs /ci-hosting and parses the view", async () => {
    const body = {
      domain: "github_hosted_ci",
      tenant_default: { level: "on", resolved_scope: "tenant", unknown_reason: null },
      repos: [],
      can_edit: true,
    };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchCiHosting()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/ci-hosting",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchCiHosting keeps the 404 message useCiHosting reads as 'not served'", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "Not Found" }, 404));
    const err = await fetchCiHosting().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/ci-hosting failed: 404 - {"detail":"Not Found"}'
    );
  });

  it("ciStatusWsUrl is the absolute wss URL with the token encoded and the active tenant appended", () => {
    window.localStorage.setItem("qontinui.active_tenant_id", "t 1");
    expect(ciStatusWsUrl("a b&c")).toBe(
      "wss://api.example.test/api/v1/operations/ci-status/ws?token=a%20b%26c&active_tenant=t%201"
    );
  });

  it("ciStatusWsUrl carries no active_tenant when none is selected", () => {
    expect(ciStatusWsUrl("tok")).toBe(
      "wss://api.example.test/api/v1/operations/ci-status/ws?token=tok"
    );
  });
});

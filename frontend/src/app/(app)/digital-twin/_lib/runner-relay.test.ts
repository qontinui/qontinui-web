/**
 * The relay client reads the backend's diagnostic error body, the runner's
 * own refusal, and the runner's `ApiResponse` envelope.
 *
 * The backend puts `device_id`, `ws_connected_at`, `last_seen_at` and
 * `request_id` on its 404/503 bodies specifically so a relay failure can be
 * diagnosed. Until this file existed, `runnerProxyGet` threw all of it away
 * and surfaced the bare string "runner returned HTTP 503" — the fields were
 * emitted and never read.
 *
 * The envelope block pins the other half: the runner wraps the live snapshot
 * as `{ success, data }` and both relay hops pass it through verbatim, so
 * `runnerProxyGet` is where it is unwrapped — once, for every read. Before
 * that, the panel read the envelope's top level and a 112-element snapshot
 * rendered as "0 elements".
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

/**
 * A real `Response` (the relay client clones it to read the runner's half of
 * an error body). `body === undefined` is a non-JSON body, like a proxy's HTML
 * error page.
 */
function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  const json = body !== undefined;
  return new Response(
    json ? JSON.stringify(body) : "<html>bad gateway</html>",
    {
      status,
      headers: {
        "Content-Type": json ? "application/json" : "text/html",
        ...headers,
      },
    }
  );
}

/**
 * The error a call rejected with. Fails the test if the call resolved —
 * `.catch((e) => e)` would hand a resolved VALUE to the assertions instead.
 */
async function rejection(call: Promise<unknown>): Promise<RunnerRelayError> {
  return call.then(
    (value) => {
      throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
    },
    (e: unknown) => e as RunnerRelayError
  );
}

/**
 * The runner's live snapshot as `GET /ui-bridge/control/snapshot` returns it
 * (`Json<ApiResponse<…>>` — `{ success, data }`), trimmed to three elements.
 */
const SNAPSHOT_ENVELOPE = {
  success: true,
  data: {
    timestamp: 1760190000000,
    elements: [
      { id: "nav-runs", type: "button", actions: ["click"] },
      { id: "nav-settings", type: "button", actions: ["click"] },
      { id: "runs-filter", type: "input", actions: ["type", "clear"] },
    ],
    components: [{ id: "runs-table", name: "RunsTable" }],
    workflows: [],
    activeRuns: [],
    page: {
      url: "http://tauri.localhost/",
      pathname: "/",
      title: "Qontinui Runner",
    },
    appId: "qontinui-runner",
    route: "/",
  },
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("runnerProxyGet error diagnostics", () => {
  it("exposes the 503 body's device id, both clocks, and request id", async () => {
    fetchMock.mockResolvedValue(
      response(503, {
        detail: "runner not connected",
        device_id: "dev-1",
        ws_connected_at: "2026-08-27T09:20:00+00:00",
        last_seen_at: "2026-08-27T09:15:00+00:00",
        request_id: "req-9",
      })
    );

    const err = await rejection(runnerProxyGet("dev-1", "health"));

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
    // The relay layer spoke, not the runner.
    expect(err.runner).toBeUndefined();
  });

  it("keeps a null ws_connected_at as null, not undefined", async () => {
    // `null` means "never registered" — a distinct answer from "the backend
    // did not tell us", so it must survive the parse rather than collapse.
    fetchMock.mockResolvedValue(
      response(503, {
        detail: "runner not connected",
        device_id: "dev-1",
        ws_connected_at: null,
        last_seen_at: null,
      })
    );

    const err = await rejection(runnerProxyGet("dev-1", "health"));

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
      response(503, {
        detail: "runner not connected",
        device_id: "dev-1",
      })
    );

    const err = await rejection(runnerProxyGet("dev-1", "health"));

    expect(err.wsConnectedAt).toBeUndefined();
    expect(err.lastSeenAt).toBeUndefined();
    // Not merely falsy — the two cases must not compare equal.
    expect(err.wsConnectedAt).not.toBeNull();
  });

  it("falls back to the X-Request-ID header when the body has no id", async () => {
    fetchMock.mockResolvedValue(
      response(
        404,
        { detail: "device not found or not owned by caller" },
        { "X-Request-ID": "req-header" }
      )
    );

    const err = await rejection(runnerProxyGet("dev-1", "health"));

    expect(err.status).toBe(404);
    expect(err.requestId).toBe("req-header");
  });

  it("degrades to no diagnostics when the body is not JSON", async () => {
    // A proxy's HTML error page must not turn into a parse error that hides
    // the real HTTP failure.
    fetchMock.mockResolvedValue(response(502, undefined));

    const err = await rejection(runnerProxyGet("dev-1", "health"));

    expect(err).toBeInstanceOf(RunnerRelayError);
    expect(err.status).toBe(502);
    expect(err.detail).toBeUndefined();
    expect(err.runner).toBeUndefined();
    expect(err.message).toContain("HTTP 502");
  });

  it("carries the runner's own app-not-found refusal, not just a bare 404", async () => {
    // The runner's Spec API body for an unregistered app id (qontinui-runner
    // `spec_api/apps.rs` `app_error_into_response`). Its `detail` is an
    // object, so the relay reader sees no `detail` at all — before this,
    // nothing read `reason` and the page said only "HTTP 404".
    fetchMock.mockResolvedValue(
      response(
        404,
        {
          ok: false,
          reason: "app-not-found",
          detail: { appId: "qontinui-web" },
        },
        { "X-Request-ID": "req-404" }
      )
    );

    const err = await rejection(
      runnerProxyGet("dev-1", "apps/qontinui-web/spec/list")
    );

    expect(err).toBeInstanceOf(RunnerRelayError);
    expect(err.status).toBe(404);
    expect(err.detail).toBeUndefined();
    expect(err.runner).toEqual({
      reason: "app-not-found",
      message: undefined,
      detail: { appId: "qontinui-web" },
    });
    expect(err.message).toContain("app-not-found");
    expect(err.requestId).toBe("req-404");
  });
});

describe("runnerProxyGet unwraps the runner's ApiResponse envelope", () => {
  it("still returns the parsed body on success", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: true }));

    await expect(runnerProxyGet("dev-1", "health")).resolves.toEqual({
      ok: true,
    });
  });

  it("returns `data` from a { success: true, data } body", async () => {
    fetchMock.mockResolvedValue(response(200, SNAPSHOT_ENVELOPE));

    const snap = await runnerProxyGet<{
      elements?: unknown[];
      appId?: string;
    }>("dev-1", "ui-bridge/control/snapshot");

    expect(snap.elements).toHaveLength(3);
    expect(snap.appId).toBe("qontinui-runner");
    expect(snap).not.toHaveProperty("success");
  });

  it("returns a bare body whole", async () => {
    // The Spec API answers without an envelope.
    const bare = {
      ok: true,
      specs: [
        {
          specId: "runs",
          appName: "Qontinui Runner",
          config: { version: "1", description: "Runs", groups: [] },
        },
      ],
    };
    fetchMock.mockResolvedValue(response(200, bare));

    await expect(
      runnerProxyGet("dev-1", "apps/qontinui-runner/spec/list")
    ).resolves.toEqual(bare);
  });

  it("returns an empty-but-ok body as a success, with its reason", async () => {
    // `{ ok: true, specs: [], reason }` is a real empty answer — the runner
    // has no pages for the app — and must not be mistaken for a failure.
    const empty = { ok: true, specs: [], reason: "no-pages-registered" };
    fetchMock.mockResolvedValue(response(200, empty));

    await expect(
      runnerProxyGet("dev-1", "apps/qontinui-runner/spec/list")
    ).resolves.toEqual(empty);
  });

  it("treats a 2xx { success: false } envelope as an error, never an empty success", async () => {
    fetchMock.mockResolvedValue(
      response(200, { success: false, error: "UI Bridge SDK not connected" })
    );

    const err = await rejection(
      runnerProxyGet("dev-1", "ui-bridge/control/snapshot")
    );

    expect(err).toBeInstanceOf(RunnerRelayError);
    expect(err.status).toBe(200);
    expect(err.runner?.message).toBe("UI Bridge SDK not connected");
    expect(err.message).toContain("UI Bridge SDK not connected");
  });

  it("keeps the backend's request id on a 2xx refusal", async () => {
    // The body is the runner's, so only the header can carry the id — and
    // without it the relay-failure box has nothing to grep the log for.
    fetchMock.mockResolvedValue(
      response(
        200,
        { success: false, error: "UI Bridge SDK not connected" },
        { "X-Request-ID": "req-200" }
      )
    );

    const err = await rejection(
      runnerProxyGet("dev-1", "ui-bridge/control/snapshot")
    );

    expect(err.requestId).toBe("req-200");
    expect(err.message).toContain("(request req-200)");
  });

  it("carries the runner's message from a non-2xx { success: false } envelope", async () => {
    // The snapshot route's own failure: neither the SDK nor a native window
    // capture answered (`ui_bridge_get_snapshot_handler` → 500 `api_error`).
    fetchMock.mockResolvedValue(
      response(500, {
        success: false,
        error: "UI Bridge request timed out after 10000ms",
      })
    );

    const err = await rejection(
      runnerProxyGet("dev-1", "ui-bridge/control/snapshot")
    );

    expect(err).toBeInstanceOf(RunnerRelayError);
    expect(err.status).toBe(500);
    expect(err.runner?.message).toBe(
      "UI Bridge request timed out after 10000ms"
    );
  });
});

/**
 * useTenantFleetPolicyDial — the refresh-vs-write race, and the send-time pin.
 *
 * The per-domain hooks' tests pin the read/write/read-back honesty properties.
 * This file pins the properties that exist only in the shared core:
 *
 * 1. **A read that STARTED before a write must not land over that write's
 *    confirmed read-back.** Otherwise a slow Refresh paints the pre-write value
 *    back on screen and clears the read-back warning — the dial reporting a
 *    state the fleet has already left.
 * 2. **With `resolvePin`, the read and the write are sent in the resolved
 *    project on every attempt**, asked as each is sent — through the REAL
 *    `HttpClient`, so a 429's re-issue after another tab's switch is the
 *    client's own. Omitted, each request is today's, byte for byte.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const putMock = vi.fn();
/** Every request the fake transport was handed: the URL and the options. */
const sentInit = vi.fn();
/**
 * `real: true` sends every request through the REAL `HttpClient` over the
 * global `fetch` the pin tests stub, instead of the per-verb mocks.
 */
const transport = vi.hoisted(() => ({ real: false }));

vi.mock("@/services/service-factory", async () => {
  const { HttpClient } = await import("@/services/http-client");
  const tokens = {
    getAccessToken: () => "tok",
    getRefreshToken: () => "refresh",
    getAccessTokenExpiry: () => Date.now() + 3_600_000,
    isAccessTokenExpired: () => false,
    isAccessTokenExpiringSoon: () => false,
    isAuthenticated: () => true,
    clearTokens: () => {},
  };
  const real = new HttpClient(
    tokens as unknown as ConstructorParameters<typeof HttpClient>[0]
  );
  return {
    httpClient: {
      // The hooks call `httpClient.fetch` (the typed /operations client);
      // route each request onto the per-verb mock the assertions below read.
      fetch: async (
        url: string,
        init: { method?: string; body?: string } & Record<string, unknown>
      ) => {
        if (transport.real) return real.fetch(url, init);
        sentInit(url, init);
        const method = init.method ?? "GET";
        const body = JSON.parse(init.body ?? "null");
        let out: unknown;
        if (method === "GET") out = await getMock(url);
        else if (method === "PUT") out = await putMock(url, body);
        else throw new Error(`fetch mock: unexpected ${method} ${url}`);
        // A mock that resolves a `Response` (an error path) is answered
        // as-is, so a non-2xx goes through `readJson` like the real one.
        return out instanceof Response
          ? out
          : new Response(JSON.stringify(out ?? null));
      },
    },
  };
});
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { useTenantFleetPolicyDial } from "./useTenantFleetPolicyDial";

const view = (level: string) => ({
  domain: "some_dial",
  effective_level: level,
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  transport.real = false;
});

describe("useTenantFleetPolicyDial — a read that began before a write", () => {
  it("does not overwrite the write's confirmed read-back", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Refresh starts, and is still in flight when the write lands.
    const slowRead = deferred<ReturnType<typeof view>>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<boolean>;
    act(() => {
      refresh = result.current.reload();
    });

    putMock.mockResolvedValue({
      ok: true,
      domain: "some_dial",
      written_level: "on",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: null,
      effective: view("on"),
      readback_error: null,
    });
    await act(async () => {
      await result.current.setLevel("on");
    });
    expect(result.current.policy?.effective_level).toBe("on");

    // The stale read now answers with the pre-write value.
    await act(async () => {
      slowRead.resolve(view("off"));
      await refresh;
    });

    expect(result.current.policy?.effective_level).toBe("on");
    expect(result.current.loading).toBe(false);
  });

  it("does not clear an unconfirmed write's read-back warning", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const slowRead = deferred<ReturnType<typeof view>>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<boolean>;
    act(() => {
      refresh = result.current.reload();
    });

    putMock.mockResolvedValue({
      ok: true,
      domain: "some_dial",
      written_level: "on",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });
    await act(async () => {
      await result.current.setLevel("on");
    });

    await act(async () => {
      slowRead.resolve(view("off"));
      await refresh;
    });

    // The pre-write read says nothing about what resolves after the write.
    expect(result.current.readbackError).toContain("502");
  });

  it("keeps a Refresh that overlapped a REJECTED write", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const slowRead = deferred<ReturnType<typeof view>>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<boolean>;
    act(() => {
      refresh = result.current.reload();
    });

    putMock.mockImplementation(
      async () => new Response("admin_required", { status: 403 })
    );
    await act(async () => {
      await result.current.setLevel("on");
    });

    // Someone else changed the dial meanwhile; the refused write changed
    // nothing, so this read is the freshest fact and must be shown.
    await act(async () => {
      slowRead.resolve(view("on"));
      await refresh;
    });

    expect(result.current.policy?.effective_level).toBe("on");
  });

  it("applies a read that began after the write", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    putMock.mockResolvedValue({
      ok: true,
      domain: "some_dial",
      written_level: "on",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });
    await act(async () => {
      await result.current.setLevel("on");
    });

    getMock.mockResolvedValueOnce(view("on"));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.policy?.effective_level).toBe("on");
    expect(result.current.readbackError).toBeNull();
  });
});

describe("useTenantFleetPolicyDial — reload says whether its read was applied", () => {
  it("resolves true for a read that landed, false for one that failed", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    getMock.mockResolvedValueOnce(view("on"));
    let applied: boolean | undefined;
    await act(async () => {
      applied = await result.current.reload();
    });
    expect(applied).toBe(true);
    expect(result.current.policy?.effective_level).toBe("on");

    getMock.mockRejectedValueOnce(new Error("HTTP 502"));
    await act(async () => {
      applied = await result.current.reload();
    });
    // Failed: the last confirmed value stays, and the caller is told so.
    expect(applied).toBe(false);
    expect(result.current.policy?.effective_level).toBe("on");
  });

  it("resolves false for a read discarded because a write landed meanwhile", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const slowRead = deferred<ReturnType<typeof view>>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<boolean>;
    act(() => {
      refresh = result.current.reload();
    });

    putMock.mockResolvedValue({
      ok: true,
      domain: "some_dial",
      written_level: "on",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: null,
      effective: view("on"),
      readback_error: null,
    });
    await act(async () => {
      await result.current.setLevel("on");
    });

    let applied: boolean | undefined;
    await act(async () => {
      slowRead.resolve(view("off"));
      applied = await refresh;
    });
    expect(applied).toBe(false);
    expect(result.current.policy?.effective_level).toBe("on");
  });
});

const KEY = "qontinui.active_tenant_id";
const DIAL_URL = "/api/v1/operations/fleet-policy";
const written = (level: string) => ({
  ok: true,
  domain: "some_dial",
  written_level: level,
  written_master_enabled: true,
  versioned: true,
  version: 2,
  updated_by: null,
  effective: view(level),
  readback_error: null,
});

describe("useTenantFleetPolicyDial — without a resolver", () => {
  it("sends today's read and write, byte for byte", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    putMock.mockResolvedValueOnce(written("on"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setLevel("on");
    });

    expect(sentInit.mock.calls).toEqual([
      [`${DIAL_URL}?domain=some_dial`, { method: "GET", idempotent: true }],
      [
        DIAL_URL,
        {
          method: "PUT",
          body: JSON.stringify({
            domain: "some_dial",
            scope_band: "tenant",
            scope_key: null,
            level: "on",
            master_enabled: true,
            change_note: 'Set some dial to "on" from the console',
          }),
          idempotent: false,
        },
      ],
    ]);
  });

  it("sends the same bytes when the resolver names no project", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">(
        "some_dial",
        "some dial",
        "devices",
        { resolvePin: () => undefined }
      )
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(sentInit.mock.calls).toEqual([
      [`${DIAL_URL}?domain=some_dial`, { method: "GET", idempotent: true }],
    ]);
  });
});

describe("useTenantFleetPolicyDial — resolvePin, through the real client", () => {
  type Sent = { method: string; url: string; tenant: string | null };
  let sent: Sent[] = [];
  /** Run inside the answer to the next PUT, which is then answered 429. */
  let insidePut: (() => void) | null = null;

  beforeEach(() => {
    transport.real = true;
    sent = [];
    insidePut = null;
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const tenant =
          ((init?.headers ?? {}) as Record<string, string>)[
            "X-Qontinui-Active-Tenant"
          ] ?? null;
        sent.push({ method, url, tenant });
        if (method === "PUT" && insidePut) {
          const run = insidePut;
          insidePut = null;
          run();
          return new Response(
            JSON.stringify({ error: "TRANSIENT", message: "answered 429" }),
            { status: 429, headers: { "Content-Type": "application/json" } }
          );
        }
        const body = method === "PUT" ? written("on") : view("off");
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
  });
  afterEach(() => {
    transport.real = false;
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("pins a write to the resolved project across a 429 retry", async () => {
    localStorage.setItem(KEY, "t-page");
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">(
        "some_dial",
        "some dial",
        "devices",
        { resolvePin: () => ({ tenant: "t-page" }) }
      )
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Another tab stores a different project inside the PUT's 429, so the
    // client's re-issue is built with THAT project stored.
    insidePut = () => localStorage.setItem(KEY, "t-other");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setLevel("on");
    });

    expect(ok).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("t-other");
    expect(sent.filter((s) => s.method === "PUT").map((s) => s.tenant)).toEqual(
      ["t-page", "t-page"]
    );
    expect(result.current.policy?.effective_level).toBe("on");
  });

  it("pins its read to the project resolved as the read is sent, and re-fires nothing when the resolver changes", async () => {
    // Stored: another project from the start. Each read must carry the
    // resolver's answer at the moment it goes out.
    localStorage.setItem(KEY, "t-other");
    let page = "t-page";
    const { result, rerender } = renderHook(
      ({ resolve }: { resolve: () => { tenant: string } }) =>
        useTenantFleetPolicyDial<"off" | "on">(
          "some_dial",
          "some dial",
          "devices",
          { resolvePin: resolve }
        ),
      { initialProps: { resolve: () => ({ tenant: page }) } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const { reload, setLevel } = result.current;

    // A NEW resolver identity on every render: no read is re-fired by it,
    // and the callbacks keep their identity.
    rerender({ resolve: () => ({ tenant: page }) });
    rerender({ resolve: () => ({ tenant: page }) });
    expect(result.current.reload).toBe(reload);
    expect(result.current.setLevel).toBe(setLevel);

    page = "t-next";
    await act(async () => {
      await result.current.reload();
    });

    expect(sent.map((s) => [s.method, s.tenant])).toEqual([
      ["GET", "t-page"],
      ["GET", "t-next"],
    ]);
  });
});

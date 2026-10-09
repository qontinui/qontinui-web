/**
 * useCiHosting — the stale-retention and out-of-order guards (plan
 * `2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting` Phase 3).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchViaVerbs } from "@/test/httpClientVerbs";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    fetch: async (url: string, init?: RequestInit) =>
      fetchViaVerbs(url, init, {
        get: getMock,
      }),
  },
}));

import { CI_HOSTING_NOT_SERVED, useCiHosting } from "./useCiHosting";

function view(tenantLevel: "on" | "off") {
  return {
    domain: "github_hosted_ci",
    tenant_default: {
      level: tenantLevel,
      resolved_scope: "tenant",
      unknown_reason: null,
    },
    repos: [],
    can_edit: true,
  };
}

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
});

describe("useCiHosting", () => {
  it("a failed later read keeps the value and marks it stale", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() => useCiHosting());
    await waitFor(() => expect(result.current.view).not.toBeNull());
    expect(result.current.stale).toBe(false);

    getMock.mockRejectedValueOnce(new Error("GET x failed: 502 - down"));
    let ok = true;
    await act(async () => {
      ok = await result.current.reload();
    });
    expect(ok).toBe(false);
    expect(result.current.view?.tenant_default.level).toBe("off");
    expect(result.current.stale).toBe(true);
  });

  it("a 404 is 'not served', never a value", async () => {
    getMock.mockRejectedValueOnce(
      new Error(
        'GET /api/v1/operations/ci-hosting failed: 404 - {"detail":"Not Found"}'
      )
    );
    const { result } = renderHook(() => useCiHosting());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.notServed).toBe(true);
    expect(result.current.error).toBe(CI_HOSTING_NOT_SERVED);
    expect(result.current.view).toBeNull();
  });

  it("an OLDER success landing after a NEWER failure neither applies nor clears the error", async () => {
    const first = deferred<unknown>();
    getMock.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useCiHosting());

    getMock.mockRejectedValueOnce(new Error("GET x failed: 502 - down"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toMatch(/502/);

    await act(async () => {
      first.resolve(view("on"));
      await first.promise;
    });
    expect(result.current.view).toBeNull();
    expect(result.current.error).toMatch(/502/);
    expect(result.current.appliedTicket).toBe(0);
  });

  it("an OLDER success landing after a NEWER success does not overwrite it", async () => {
    const first = deferred<unknown>();
    getMock.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useCiHosting());

    getMock.mockResolvedValueOnce(view("off"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.view?.tenant_default.level).toBe("off");

    await act(async () => {
      first.resolve(view("on"));
      await first.promise;
    });
    expect(result.current.view?.tenant_default.level).toBe("off");
    // The displayed answer is read #2's.
    expect(result.current.appliedTicket).toBe(2);
  });

  it("reload resolves false for a success discarded because a newer read settled", async () => {
    getMock.mockResolvedValueOnce(view("on"));
    const { result } = renderHook(() => useCiHosting());
    await waitFor(() => expect(result.current.appliedTicket).toBe(1));

    const older = deferred<unknown>();
    getMock.mockReturnValueOnce(older.promise);
    let olderResult: Promise<boolean> = Promise.resolve(true);
    act(() => {
      olderResult = result.current.reload();
    });
    getMock.mockResolvedValueOnce(view("off"));
    let newer = false;
    await act(async () => {
      newer = await result.current.reload();
    });
    expect(newer).toBe(true);

    await act(async () => {
      older.resolve(view("on"));
    });
    await expect(olderResult).resolves.toBe(false);
    expect(result.current.view?.tenant_default.level).toBe("off");
  });

  it("issuedTicket names the newest read issued, landed or not", async () => {
    const pending = deferred<unknown>();
    getMock.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useCiHosting());
    expect(result.current.issuedTicket()).toBe(1);
    expect(result.current.appliedTicket).toBe(0);
    await act(async () => {
      pending.resolve(view("on"));
    });
    expect(result.current.appliedTicket).toBe(1);
  });
});

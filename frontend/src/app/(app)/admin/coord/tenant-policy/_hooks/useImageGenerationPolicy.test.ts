/**
 * useImageGenerationPolicy — the binding, the UNKNOWN readings, and both write
 * paths (plan `2026-10-13-image-generation-and-visual-judgment` Phase 12).
 *
 * The shared dial's own honesty properties are pinned in
 * `../../_shared/useTenantFleetPolicyDial.test.ts`; this file pins what the
 * binding adds: the domain it reads and writes, the tenant-band and repo-band
 * bodies, the no-row default that only coord can vouch for, the override list,
 * and that a repo's "read-back failed" marker is retired only by a read issued
 * after the write.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const putMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    // The hooks call `httpClient.fetch` (the typed /operations client); route
    // each request onto the per-verb mock the assertions below read.
    fetch: async (url: string, init: { method?: string; body?: string }) => {
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
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

import { useImageGenerationPolicy } from "./useImageGenerationPolicy";

const OVERRIDES = [
  {
    repo: "acme/site",
    level: "local_only",
    master_enabled: true,
    effective_level: "local_only",
  },
];

/** A tenant with no row, as a coord that declares the domain answers. */
const NO_ROW = {
  domain: "image_generation",
  effective_level: "on",
  master_enabled: true,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
  repo_overrides: [] as typeof OVERRIDES,
};

const writeResult = (
  effective: unknown,
  readbackError: string | null,
  writtenLevel = "local_only"
) => ({
  ok: true,
  domain: "image_generation",
  written_level: writtenLevel,
  written_master_enabled: true,
  versioned: true,
  version: 1,
  updated_by: "operator@example.com",
  effective,
  readback_error: readbackError,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function mounted() {
  const hook = renderHook(() => useImageGenerationPolicy());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useImageGenerationPolicy — reading", () => {
  it("reads the image_generation domain, tenant-wide", async () => {
    getMock.mockResolvedValue(NO_ROW);
    await mounted();
    const [url] = getMock.mock.calls[0];
    expect(url).toContain("domain=image_generation");
    expect(url).not.toContain("repo=");
  });

  it("no row + `on` is the default — on, and nobody chose it", async () => {
    getMock.mockResolvedValue(NO_ROW);
    const { result } = await mounted();
    expect(result.current.displayLevel).toBe("on");
    expect(result.current.tenant).toEqual({
      state: "known",
      level: "on",
      defaulted: true,
    });
  });

  it("a coord that predates the domain (no row, `off`) is UNKNOWN, never on", async () => {
    getMock.mockResolvedValue({
      ...NO_ROW,
      effective_level: "off",
      master_enabled: false,
      repo_overrides: undefined,
    });
    const { result } = await mounted();
    expect(result.current.displayLevel).toBeNull();
    expect(result.current.tenant).toEqual({
      state: "no_declared_default",
      raw: "off",
    });
    // And it lists no overrides, which is UNKNOWN — not "none".
    expect(result.current.overrides).toBeNull();
  });

  it("reports each tenant level as itself", async () => {
    for (const level of ["on", "local_only", "off"]) {
      getMock.mockResolvedValue({
        ...NO_ROW,
        effective_level: level,
        resolved_scope: "tenant",
      });
      const { result, unmount } = await mounted();
      expect(result.current.displayLevel).toBe(level);
      unmount();
    }
  });

  it("carries the override list", async () => {
    getMock.mockResolvedValue({ ...NO_ROW, repo_overrides: OVERRIDES });
    const { result } = await mounted();
    expect(result.current.overrides).toEqual([
      { repo: "acme/site", level: "local_only", raw: "local_only" },
    ]);
  });

  it("has no level and no list before a read succeeds", async () => {
    getMock.mockRejectedValue(new Error("HTTP 502"));
    const { result } = await mounted();
    expect(result.current.displayLevel).toBeNull();
    expect(result.current.tenant).toBeNull();
    expect(result.current.overrides).toBeNull();
    expect(result.current.error).toBe("HTTP 502");
  });
});

describe("useImageGenerationPolicy — the tenant write", () => {
  it("writes the tenant band with the master left on, and shows the read-back", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockResolvedValue(
      writeResult(
        { ...NO_ROW, effective_level: "local_only", resolved_scope: "tenant" },
        null
      )
    );
    const { result } = await mounted();

    await act(async () => {
      await result.current.setLevel("local_only");
    });

    const [url, body] = putMock.mock.calls[0];
    expect(url).toBe("/api/v1/operations/fleet-policy");
    expect(body).toEqual({
      domain: "image_generation",
      scope_band: "tenant",
      scope_key: null,
      level: "local_only",
      master_enabled: true,
      change_note: 'Set image generation to "local_only" from the console',
    });
    expect(result.current.displayLevel).toBe("local_only");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("keeps the confirmed level when the read-back failed", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockResolvedValue(
      writeResult(null, "read-back failed: coord returned 502", "off")
    );
    const { result } = await mounted();

    await act(async () => {
      await result.current.setLevel("off");
    });

    // Not painted as the requested `off`.
    expect(result.current.displayLevel).toBe("on");
    expect(result.current.readbackError).toContain("502");
  });
});

describe("useImageGenerationPolicy — the repo write", () => {
  it("writes the repo band and re-reads the list once the read-back confirms", async () => {
    getMock
      .mockResolvedValueOnce(NO_ROW)
      .mockResolvedValueOnce({ ...NO_ROW, repo_overrides: OVERRIDES });
    putMock.mockResolvedValue(
      writeResult(
        { ...NO_ROW, effective_level: "local_only", resolved_scope: "repo" },
        null
      )
    );
    const { result } = await mounted();
    expect(result.current.overrides).toEqual([]);

    await act(async () => {
      await result.current.writeRepo("acme/site", "local_only");
    });

    expect(putMock.mock.calls[0][1]).toEqual({
      domain: "image_generation",
      scope_band: "repo",
      scope_key: "acme/site",
      level: "local_only",
      master_enabled: true,
      change_note:
        'Set image generation for acme/site to "local_only" from the console',
    });
    await waitFor(() =>
      expect(result.current.overrides).toEqual([
        { repo: "acme/site", level: "local_only", raw: "local_only" },
      ])
    );
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("clears an override with `inherit`", async () => {
    getMock
      .mockResolvedValueOnce({ ...NO_ROW, repo_overrides: OVERRIDES })
      .mockResolvedValueOnce(NO_ROW);
    putMock.mockResolvedValue(writeResult(NO_ROW, null, "inherit"));
    const { result } = await mounted();

    await act(async () => {
      await result.current.writeRepo("acme/site", "inherit");
    });

    expect(putMock.mock.calls[0][1].level).toBe("inherit");
    await waitFor(() => expect(result.current.overrides).toEqual([]));
  });

  it("a failed read-back marks the repo UNKNOWN until a LATER read confirms it", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockResolvedValue(
      writeResult(null, "read-back failed: coord returned 502", "off")
    );
    const { result } = await mounted();

    await act(async () => {
      await result.current.writeRepo("acme/app", "off");
    });
    expect(result.current.repoReadbackErrors).toEqual({
      "acme/app": "read-back failed: coord returned 502",
    });
    // Unconfirmed: no re-read was triggered by the write itself.
    expect(getMock).toHaveBeenCalledTimes(1);

    let applied = false;
    await act(async () => {
      applied = await result.current.refresh();
    });
    expect(applied).toBe(true);
    expect(result.current.repoReadbackErrors).toEqual({});
  });

  it("a refresh that began before the write does not retire its marker", async () => {
    getMock.mockResolvedValueOnce(NO_ROW);
    const { result } = await mounted();

    const slowRead = deferred<typeof NO_ROW>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<boolean>;
    act(() => {
      refresh = result.current.refresh();
    });

    putMock.mockResolvedValue(
      writeResult(null, "read-back failed: coord returned 502", "off")
    );
    await act(async () => {
      await result.current.writeRepo("acme/app", "off");
    });

    // The pre-write read answers now; it says nothing about the write.
    await act(async () => {
      slowRead.resolve(NO_ROW);
      await refresh;
    });
    expect(result.current.repoReadbackErrors).toEqual({
      "acme/app": "read-back failed: coord returned 502",
    });
  });

  it("names coord's refusal of a mistyped level in operator words", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ error: "unknown_level", allowed: ["on"] }),
          { status: 400 }
        )
    );
    const { result } = await mounted();

    let ok = true;
    await act(async () => {
      ok = await result.current.writeRepo("acme/app", "off");
    });
    expect(ok).toBe(false);
    expect(result.current.repoWriteErrors["acme/app"]).toMatch(
      /not one this setting accepts/
    );
  });
});

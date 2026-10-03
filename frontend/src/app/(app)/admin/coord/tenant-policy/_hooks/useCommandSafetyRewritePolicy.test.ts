/**
 * useCommandSafetyRewritePolicy — the binding, and the resolved-not-written rule.
 *
 * The shared dial's honesty properties are pinned once in
 * `../../_shared/useTenantFleetPolicyDial.test.ts`; this file pins what the
 * binding adds: the domain it reads and writes, the tenant-band body, and that
 * the displayed level is the one runners RESOLVE (plan
 * `2026-10-03-runner-sessions-stop-on-builtin-command-safety-prompts` Phase 4).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const putMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

import { useCommandSafetyRewritePolicy } from "./useCommandSafetyRewritePolicy";
import { COMMAND_SAFETY_REWRITE_DOMAIN } from "../types";

// A tenant with no row: coord serves the per-domain default, `on` (plan D5).
const ON_NO_ROW = {
  domain: "command_safety_rewrite",
  effective_level: "on",
  master_enabled: true,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

const writeResult = (effective: unknown, readbackError: string | null) => ({
  ok: true,
  domain: "command_safety_rewrite",
  written_level: "off",
  written_master_enabled: true,
  versioned: true,
  version: 1,
  updated_by: "operator@example.com",
  effective,
  readback_error: readbackError,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCommandSafetyRewritePolicy", () => {
  it("reads the command_safety_rewrite domain", async () => {
    getMock.mockResolvedValue(ON_NO_ROW);
    const { result } = renderHook(() => useCommandSafetyRewritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(COMMAND_SAFETY_REWRITE_DOMAIN).toBe("command_safety_rewrite");
    expect(getMock).toHaveBeenCalledWith(
      expect.stringContaining("domain=command_safety_rewrite")
    );
    expect(result.current.policy?.effective_level).toBe("on");
    expect(result.current.policy?.resolved_scope).toBe("none");
  });

  it("writes `off` at the tenant band with the master left on", async () => {
    getMock.mockResolvedValue(ON_NO_ROW);
    putMock.mockResolvedValue(
      writeResult(
        { ...ON_NO_ROW, effective_level: "off", resolved_scope: "tenant" },
        null
      )
    );
    const { result } = renderHook(() => useCommandSafetyRewritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("off");
    });

    const [, body] = putMock.mock.calls[0];
    expect(body.domain).toBe("command_safety_rewrite");
    expect(body.level).toBe("off");
    // Tenant-wide: the carrier is chosen at spawn, before any repo scoping.
    expect(body.scope_band).toBe("tenant");
    expect(body.scope_key).toBeNull();
    // `off` has one spelling — the level — not a flipped master as well.
    expect(body.master_enabled).toBe(true);
    expect(result.current.policy?.effective_level).toBe("off");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("shows the RESOLVED level when a narrower row overrides the write", async () => {
    getMock.mockResolvedValue(ON_NO_ROW);
    putMock.mockResolvedValue(
      writeResult(
        { ...ON_NO_ROW, effective_level: "on", resolved_scope: "repo" },
        null
      )
    );
    const { result } = renderHook(() => useCommandSafetyRewritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("off");
    });

    expect(result.current.policy?.effective_level).toBe("on");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining("runners resolve")
    );
  });

  it("keeps the confirmed level when the read-back failed", async () => {
    getMock.mockResolvedValue(ON_NO_ROW);
    putMock.mockResolvedValue(
      writeResult(null, "read-back failed: coord returned 502")
    );
    const { result } = renderHook(() => useCommandSafetyRewritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("off");
    });

    // Not painted as the requested `off`: what runners resolve is UNKNOWN.
    expect(result.current.policy?.effective_level).toBe("on");
    expect(result.current.readbackError).toContain("502");
  });
});

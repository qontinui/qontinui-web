/**
 * useAccountSelectionPolicy — the binding, the no-row default, and UNKNOWN.
 *
 * The shared dial's honesty properties are pinned once in
 * `../../_shared/useTenantFleetPolicyDial.test.ts`; this file pins what the
 * binding adds: the domain it reads and writes, the tenant-band body, the
 * no-row `off` default, and that an unrecognised served level is UNKNOWN rather
 * than any known level (plan
 * `2026-10-01-fleet-account-selection-effective-mode-visibility-and-pin-safe-saves`
 * Phase 3).
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

import { useAccountSelectionPolicy } from "./useAccountSelectionPolicy";
import { parseAccountSelectionLevel } from "../types";

// A tenant with no row: coord serves its unlisted-domain fallback, `off`.
const NO_ROW = {
  domain: "account_selection_mode",
  effective_level: "off",
  master_enabled: true,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

const writeResult = (
  effective: unknown,
  readbackError: string | null,
  writtenLevel = "least_usage"
) => ({
  ok: true,
  domain: "account_selection_mode",
  written_level: writtenLevel,
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

describe("parseAccountSelectionLevel", () => {
  it("accepts the runner's wire spellings, trimmed and ASCII case-folded", () => {
    expect(parseAccountSelectionLevel("manual")).toBe("manual");
    expect(parseAccountSelectionLevel(" Least_Usage ")).toBe("least_usage");
    expect(parseAccountSelectionLevel("HIGHEST_EXPECTED_USAGE")).toBe(
      "highest_expected_usage"
    );
    expect(parseAccountSelectionLevel("off")).toBe("off");
  });

  it("returns null — UNKNOWN — for anything else", () => {
    expect(parseAccountSelectionLevel("round_robin")).toBeNull();
    expect(parseAccountSelectionLevel("least-usage")).toBeNull();
    expect(parseAccountSelectionLevel("")).toBeNull();
    expect(parseAccountSelectionLevel(null)).toBeNull();
    expect(parseAccountSelectionLevel(undefined)).toBeNull();
  });
});

describe("useAccountSelectionPolicy", () => {
  it("reads the account_selection_mode domain", async () => {
    getMock.mockResolvedValue(NO_ROW);
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getMock).toHaveBeenCalledWith(
      expect.stringContaining("domain=account_selection_mode")
    );
  });

  it("resolves no row to `off` (no fleet opinion) and says it is a default", async () => {
    // Whatever level string rides along with a no-row answer, it is no opinion.
    getMock.mockResolvedValue({ ...NO_ROW, effective_level: "least_usage" });
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.unrecognizedLevel).toBeNull();
  });

  it("trims resolved_scope before reading it as no row, as the runner does", async () => {
    // A padded `none` is still no fleet opinion: the runner trims before it
    // compares, so an untrimmed check would show a row nobody wrote.
    getMock.mockResolvedValue({
      ...NO_ROW,
      effective_level: "round_robin",
      resolved_scope: " none\n",
    });
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.unrecognizedLevel).toBeNull();
  });

  it("shows an unrecognised level as UNKNOWN, never as a known level", async () => {
    getMock.mockResolvedValue({
      ...NO_ROW,
      effective_level: "round_robin",
      resolved_scope: "tenant",
    });
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.displayLevel).toBeNull();
    expect(result.current.isDefaulted).toBe(false);
    expect(result.current.unrecognizedLevel).toBe("round_robin");
  });

  it("reports a recognised tenant row as that level", async () => {
    getMock.mockResolvedValue({
      ...NO_ROW,
      effective_level: "highest_expected_usage",
      resolved_scope: "tenant",
    });
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.displayLevel).toBe("highest_expected_usage");
    expect(result.current.isDefaulted).toBe(false);
  });

  it("has no level at all before a read succeeds", async () => {
    getMock.mockRejectedValue(new Error("HTTP 502"));
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.displayLevel).toBeNull();
    expect(result.current.unrecognizedLevel).toBeNull();
    expect(result.current.error).toBe("HTTP 502");
  });

  it("writes the mode at the tenant band with the master left on", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockResolvedValue(
      writeResult(
        {
          ...NO_ROW,
          effective_level: "least_usage",
          resolved_scope: "tenant",
        },
        null
      )
    );
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("least_usage");
    });

    const [, body] = putMock.mock.calls[0];
    expect(body.domain).toBe("account_selection_mode");
    expect(body.level).toBe("least_usage");
    // Tenant-wide: the mode is machine-global and a machine is not repo-scoped.
    expect(body.scope_band).toBe("tenant");
    expect(body.scope_key).toBeNull();
    expect(body.master_enabled).toBe(true);
    expect(result.current.displayLevel).toBe("least_usage");
    expect(result.current.isDefaulted).toBe(false);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("writes `off` as an explicit no-fleet-opinion row", async () => {
    getMock.mockResolvedValue({
      ...NO_ROW,
      effective_level: "manual",
      resolved_scope: "tenant",
    });
    putMock.mockResolvedValue(
      writeResult({ ...NO_ROW, resolved_scope: "tenant" }, null, "off")
    );
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("off");
    });

    expect(putMock.mock.calls[0][1].level).toBe("off");
    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
  });

  it("shows the RESOLVED level when a narrower row overrides the write", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockResolvedValue(
      writeResult(
        { ...NO_ROW, effective_level: "manual", resolved_scope: "repo" },
        null
      )
    );
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("least_usage");
    });

    expect(result.current.displayLevel).toBe("manual");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining("runners resolve")
    );
  });

  it("keeps the confirmed level when the read-back failed", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockResolvedValue(
      writeResult(null, "read-back failed: coord returned 502")
    );
    const { result } = renderHook(() => useAccountSelectionPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("least_usage");
    });

    // Not painted as the requested `least_usage`.
    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.readbackError).toContain("502");
  });
});

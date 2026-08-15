/**
 * usePlanCapturePolicy — the honesty properties of the capture toggle.
 *
 * A toggle that reports what was WRITTEN rather than what RESOLVES is worse
 * than no toggle: it tells the operator the fleet is in a state it is not in,
 * and nothing else on the page contradicts it. The three branches pinned here
 * are the ones where that failure would happen silently.
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
// Arrow indirection: `vi.mock` factories hoist above these consts, so naming
// them eagerly is a TDZ error.
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

import { usePlanCapturePolicy } from "./usePlanCapturePolicy";

const OFF_NO_ROW = {
  domain: "plan_capture",
  effective_level: "off",
  master_enabled: false,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: ["controls", "drain"],
  keys_not_shown_source: "fleet_resources_row",
};

const RECORD_TENANT = {
  domain: "plan_capture",
  effective_level: "record",
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePlanCapturePolicy — reads the resolved value", () => {
  it("loads the effective level and the scope band it resolved from", async () => {
    getMock.mockResolvedValue(OFF_NO_ROW);

    const { result } = renderHook(() => usePlanCapturePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.policy?.effective_level).toBe("off");
    // "off because no row exists" must stay distinguishable from "off because
    // someone chose off" — the scope band is the only thing that says which.
    expect(result.current.policy?.resolved_scope).toBe("none");
    expect(getMock).toHaveBeenCalledWith(
      expect.stringContaining("domain=plan_capture")
    );
  });

  it("keeps the last known value on a failed read rather than showing off", async () => {
    getMock.mockResolvedValueOnce(RECORD_TENANT);
    const { result } = renderHook(() => usePlanCapturePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    getMock.mockRejectedValueOnce(new Error("coord is not reachable"));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toContain("coord is not reachable");
    // Blanking this would render as "off", which is a claim we cannot make.
    expect(result.current.policy?.effective_level).toBe("record");
  });
});

describe("usePlanCapturePolicy — writes", () => {
  it("sends the closed body coord accepts and no more", async () => {
    getMock.mockResolvedValue(OFF_NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "plan_capture",
      written_level: "record",
      written_master_enabled: true,
      versioned: true,
      version: 1,
      updated_by: "operator@example.com",
      effective: RECORD_TENANT,
      readback_error: null,
    });

    const { result } = renderHook(() => usePlanCapturePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("record");
    });

    const [, body] = putMock.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual([
      "change_note",
      "domain",
      "level",
      "master_enabled",
      "scope_band",
      "scope_key",
    ]);
    // Tenant-wide by design: the clause is baked into a briefing once per
    // session at spawn, and a session is not repo-scoped.
    expect(body.scope_band).toBe("tenant");
    expect(body.scope_key).toBeNull();
    // A two-state toggle must not have two spellings of "off".
    expect(body.master_enabled).toBe(true);
    expect(result.current.policy?.effective_level).toBe("record");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("reports the RESOLVED value when it disagrees with what was written", async () => {
    getMock.mockResolvedValue(OFF_NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "plan_capture",
      written_level: "record",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: "operator@example.com",
      // A REPO-band row wins over the tenant row we just wrote — coord
      // resolves most-specific-first (repo > tenant > system), so this is the
      // band that can actually override a tenant write.
      effective: {
        ...OFF_NO_ROW,
        resolved_scope: "repo",
        keys_not_shown: [],
        keys_not_shown_source: null,
      },
      readback_error: null,
    });

    const { result } = renderHook(() => usePlanCapturePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("record");
    });

    // The load-bearing assertion: the displayed level is the RESOLVED one.
    expect(result.current.policy?.effective_level).toBe("off");
    expect(result.current.policy?.resolved_scope).toBe("repo");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining("devices resolve")
    );
  });

  it("treats a failed read-back as UNKNOWN, not as the written value", async () => {
    getMock.mockResolvedValue(OFF_NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "plan_capture",
      written_level: "record",
      written_master_enabled: true,
      versioned: null,
      version: null,
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });

    const { result } = renderHook(() => usePlanCapturePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("record");
    });

    // The write landed. What devices resolve is NOT known, so the displayed
    // value must stay the last one we could confirm.
    expect(result.current.policy?.effective_level).toBe("off");
    expect(result.current.readbackError).toContain("502");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("retires the read-back warning once a read confirms the value", async () => {
    getMock.mockResolvedValue(OFF_NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "plan_capture",
      written_level: "record",
      written_master_enabled: true,
      versioned: null,
      version: null,
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });

    const { result } = renderHook(() => usePlanCapturePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setLevel("record");
    });
    expect(result.current.readbackError).toBeTruthy();

    getMock.mockResolvedValue(RECORD_TENANT);
    await act(async () => {
      await result.current.reload();
    });

    // The banner says "the value above may be stale". Leaving it beside a
    // value we just confirmed would be the opposite of honest.
    expect(result.current.readbackError).toBeNull();
    expect(result.current.policy?.effective_level).toBe("record");
  });

  it("surfaces a rejected write without touching the displayed value", async () => {
    getMock.mockResolvedValue(RECORD_TENANT);
    putMock.mockRejectedValue(new Error("admin_required"));

    const { result } = renderHook(() => usePlanCapturePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.setLevel("off");
    });

    expect(outcome).toBe(false);
    expect(result.current.policy?.effective_level).toBe("record");
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("admin_required")
    );
  });
});

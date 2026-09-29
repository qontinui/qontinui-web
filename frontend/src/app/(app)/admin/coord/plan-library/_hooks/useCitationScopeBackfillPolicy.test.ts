/**
 * useCitationScopeBackfillPolicy — the `citation_scope_backfill_write` binding
 * of the shared tenant-band dial.
 *
 * The honesty branches are pinned for `plan_capture` in
 * `usePlanCapturePolicy.test.ts`; they are re-pinned here against THIS
 * domain's vocabulary because the dial governs a write that can demote
 * `shipped` work units and spend quota. Reporting a written `live` that does
 * not resolve, or an unreachable coord as `off`, would misstate what agents
 * are about to do.
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
// Arrow indirection: `vi.mock` factories hoist above these consts.
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

import { useCitationScopeBackfillPolicy } from "./useCitationScopeBackfillPolicy";

// What coord produces for a tenant with NO row once the dial is registered:
// the per-domain default `dry_run`, resolved from no scope band at all.
const DRY_RUN_NO_ROW = {
  domain: "citation_scope_backfill_write",
  effective_level: "dry_run",
  master_enabled: true,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: ["controls", "drain"],
  keys_not_shown_source: "fleet_resources_row",
};

const LIVE_TENANT = {
  ...DRY_RUN_NO_ROW,
  effective_level: "live",
  resolved_scope: "tenant",
  keys_not_shown: [],
  keys_not_shown_source: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCitationScopeBackfillPolicy — reads", () => {
  it("resolves the no-row default `dry_run` and asks for this domain", async () => {
    getMock.mockResolvedValue(DRY_RUN_NO_ROW);

    const { result } = renderHook(() => useCitationScopeBackfillPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.policy?.effective_level).toBe("dry_run");
    expect(result.current.policy?.resolved_scope).toBe("none");
    expect(getMock).toHaveBeenCalledWith(
      expect.stringContaining("domain=citation_scope_backfill_write")
    );
  });

  it("does not show a failed read as off", async () => {
    getMock.mockResolvedValueOnce(LIVE_TENANT);
    const { result } = renderHook(() => useCitationScopeBackfillPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    getMock.mockRejectedValueOnce(new Error("coord is not reachable"));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toContain("coord is not reachable");
    expect(result.current.policy?.effective_level).toBe("live");
  });

  it("leaves the policy null (UNKNOWN) when the very first read fails", async () => {
    getMock.mockRejectedValue(new Error("coord is not reachable"));
    const { result } = renderHook(() => useCitationScopeBackfillPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.policy).toBeNull();
    expect(result.current.error).toContain("coord is not reachable");
  });
});

describe("useCitationScopeBackfillPolicy — writes", () => {
  it("writes a tenant-band row for this domain with master_enabled true", async () => {
    getMock.mockResolvedValue(DRY_RUN_NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "citation_scope_backfill_write",
      written_level: "live",
      written_master_enabled: true,
      versioned: true,
      version: 1,
      updated_by: "operator@example.com",
      effective: LIVE_TENANT,
      readback_error: null,
    });

    const { result } = renderHook(() => useCitationScopeBackfillPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setLevel("live");
    });

    const [, body] = putMock.mock.calls[0];
    expect(body).toMatchObject({
      domain: "citation_scope_backfill_write",
      scope_band: "tenant",
      scope_key: null,
      level: "live",
      master_enabled: true,
    });
    expect(result.current.policy?.effective_level).toBe("live");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("warns and shows the RESOLVED level when the read-back disagrees", async () => {
    getMock.mockResolvedValue(DRY_RUN_NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "citation_scope_backfill_write",
      written_level: "live",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: "operator@example.com",
      // A repo-band row outranks the tenant row just written.
      effective: {
        ...DRY_RUN_NO_ROW,
        effective_level: "off",
        resolved_scope: "repo",
        keys_not_shown: [],
        keys_not_shown_source: null,
      },
      readback_error: null,
    });

    const { result } = renderHook(() => useCitationScopeBackfillPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setLevel("live");
    });

    expect(result.current.policy?.effective_level).toBe("off");
    expect(result.current.policy?.resolved_scope).toBe("repo");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining("agents resolve")
    );
  });

  it("treats a failed read-back as UNKNOWN, not as the written level", async () => {
    getMock.mockResolvedValue(DRY_RUN_NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "citation_scope_backfill_write",
      written_level: "live",
      written_master_enabled: true,
      versioned: null,
      version: null,
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });

    const { result } = renderHook(() => useCitationScopeBackfillPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setLevel("live");
    });

    expect(result.current.policy?.effective_level).toBe("dry_run");
    expect(result.current.readbackError).toContain("502");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalled();
  });
});

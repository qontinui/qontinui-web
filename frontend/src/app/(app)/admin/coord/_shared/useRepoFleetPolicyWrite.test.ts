/**
 * useRepoFleetPolicyWrite — the repo-band write's wire body and its read-back
 * honesty (plan `2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting`
 * D4/D7).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchViaVerbs } from "@/test/httpClientVerbs";
import { act, renderHook } from "@testing-library/react";

const putMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: vi.fn(),
    put: (...args: unknown[]) => putMock(...args),
    fetch: async (url: string, init?: RequestInit) =>
      fetchViaVerbs(url, init, {
        put: putMock,
      }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { useRepoFleetPolicyWrite } from "./useRepoFleetPolicyWrite";

const effective = {
  domain: "github_hosted_ci",
  effective_level: "on",
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useRepoFleetPolicyWrite", () => {
  it("writes the repo band, keyed owner/name, master always enabled", async () => {
    putMock.mockResolvedValue({ ok: true, effective, readback_error: null });
    const onConfirmed = vi.fn();
    const { result } = renderHook(() =>
      useRepoFleetPolicyWrite(
        "github_hosted_ci",
        "GitHub-hosted CI",
        onConfirmed
      )
    );

    await act(async () => {
      await result.current.write("qontinui/qontinui-web", "inherit");
    });

    expect(putMock).toHaveBeenCalledWith("/api/v1/operations/fleet-policy", {
      domain: "github_hosted_ci",
      scope_band: "repo",
      scope_key: "qontinui/qontinui-web",
      level: "inherit",
      master_enabled: true,
      change_note:
        'Set GitHub-hosted CI for qontinui/qontinui-web to "inherit" from the console',
    });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(result.current.readbackErrors).toEqual({});
  });

  it("a failed read-back marks the repo UNKNOWN and does not claim a confirmed write", async () => {
    putMock.mockResolvedValue({
      ok: true,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });
    const onConfirmed = vi.fn();
    const { result } = renderHook(() =>
      useRepoFleetPolicyWrite(
        "github_hosted_ci",
        "GitHub-hosted CI",
        onConfirmed
      )
    );

    await act(async () => {
      await result.current.write("o/r", "off");
    });

    expect(onConfirmed).not.toHaveBeenCalled();
    expect(result.current.readbackErrors).toEqual({
      "o/r": "read-back failed: coord returned 502",
    });

    act(() => result.current.clearReadbackErrors());
    expect(result.current.readbackErrors).toEqual({});
  });

  it("a rejected write reports failure and records nothing", async () => {
    putMock.mockRejectedValue(new Error("PUT failed: 403 - admin_required"));
    const { result } = renderHook(() =>
      useRepoFleetPolicyWrite("github_hosted_ci", "GitHub-hosted CI")
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.write("o/r", "on");
    });
    expect(ok).toBe(false);
    expect(result.current.readbackErrors).toEqual({});
    expect(result.current.savingRepo).toBeNull();
  });
});

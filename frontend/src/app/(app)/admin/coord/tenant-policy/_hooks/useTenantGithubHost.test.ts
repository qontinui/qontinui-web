import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/lib/api/operations/tenantPolicy", () => ({
  fetchTenantGithubHost: () => fetchMock(),
  putTenantGithubHost: (w: unknown) => putMock(w),
  deleteTenantGithubHost: () => deleteMock(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useTenantGithubHost } from "./useTenantGithubHost";

const GITHUB_COM = { web_base: "https://github.com", configured: false };
const GHES = { web_base: "https://ghe.example.com", configured: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTenantGithubHost", () => {
  it("takes a landed write's echo as the host", async () => {
    fetchMock.mockResolvedValue(GITHUB_COM);
    putMock.mockResolvedValue(GHES);
    const { result } = renderHook(() => useTenantGithubHost());
    await waitFor(() => expect(result.current.host).toEqual(GITHUB_COM));

    await act(() =>
      result.current.save({
        api_base: "https://ghe.example.com/api/v3",
        web_base: "https://ghe.example.com",
      })
    );
    expect(result.current.host).toEqual(GHES);
    expect(result.current.writeError).toBeNull();
  });

  it("drops a read that began before a write landed", async () => {
    let releaseRead: (v: unknown) => void = () => {};
    fetchMock.mockResolvedValueOnce(GITHUB_COM);
    const { result } = renderHook(() => useTenantGithubHost());
    await waitFor(() => expect(result.current.host).toEqual(GITHUB_COM));

    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseRead = resolve;
      })
    );
    putMock.mockResolvedValue(GHES);
    let reloading: Promise<boolean> = Promise.resolve(false);
    act(() => {
      reloading = result.current.reload();
    });
    await act(() =>
      result.current.save({ api_base: "https://a", web_base: "https://b" })
    );
    await act(async () => {
      releaseRead(GITHUB_COM);
      await reloading;
    });
    expect(result.current.host).toEqual(GHES);
  });

  it("keeps the host and records the refusal when a write fails", async () => {
    fetchMock.mockResolvedValue(GHES);
    deleteMock.mockRejectedValue(
      new Error(
        'DELETE /api/v1/operations/tenant/github-host failed: 409 - {"detail":{"error":"repos_registered_on_another_host","repos":[]}}'
      )
    );
    const { result } = renderHook(() => useTenantGithubHost());
    await waitFor(() => expect(result.current.host).toEqual(GHES));

    await act(() => result.current.reset());
    expect(result.current.host).toEqual(GHES);
    expect(result.current.writeError?.code).toBe(
      "repos_registered_on_another_host"
    );
  });
});

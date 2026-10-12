import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listResource: vi.fn(),
  getResource: vi.fn(),
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import { ResourceError } from "@/components/overview/editing/api";
import { PAGE_LIST_LIMIT } from "../_lib/pages";
import { usePage, useWikiSlugs } from "./usePages";

const page = {
  id: "p1",
  slug: "getting-started",
  kind: "wiki",
  title: "Getting Started",
};

describe("usePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds a wiki page from an address that is not in slug form", async () => {
    api.listResource.mockResolvedValue({ items: [page] });
    api.getResource.mockResolvedValue({ item: { ...page, body_md: "Hi" } });
    const { result } = renderHook(() =>
      usePage(
        { kind: "wiki", slug: "Getting Started" },
        { hold: false, reloadKey: 1 }
      )
    );
    await waitFor(() => expect(result.current.state.state).toBe("ready"));
    expect(api.listResource).toHaveBeenCalledWith("pages", {
      kind: "wiki",
      slug: "getting-started",
    });
  });

  it("reports a page the project does not have as missing, not as an error", async () => {
    api.listResource.mockResolvedValue({ items: [] });
    const { result } = renderHook(() =>
      usePage({ kind: "wiki", slug: "risks" }, { hold: false, reloadKey: 1 })
    );
    await waitFor(() => expect(result.current.state.state).toBe("missing"));
    api.getResource.mockRejectedValue(
      new ResourceError(404, null, "not found")
    );
    const byId = renderHook(() =>
      usePage({ id: "gone" }, { hold: false, reloadKey: 1 })
    );
    await waitFor(() =>
      expect(byId.result.current.state.state).toBe("missing")
    );
  });

  it("reads nothing while held", () => {
    renderHook(() => usePage({ id: "p1" }, { hold: true, reloadKey: 1 }));
    expect(api.getResource).not.toHaveBeenCalled();
  });
});

describe("useWikiSlugs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("knows the slugs of a complete list", async () => {
    api.listResource.mockResolvedValue({ items: [page] });
    const { result } = renderHook(() =>
      useWikiSlugs({ hold: false, reloadKey: 1 })
    );
    await waitFor(() =>
      expect(result.current?.has("getting-started")).toBe(true)
    );
  });

  it("treats a list that may have been cut short as unknown", async () => {
    api.listResource.mockResolvedValue({
      items: Array.from({ length: PAGE_LIST_LIMIT }, (_, i) => ({
        ...page,
        slug: `p${i}`,
      })),
    });
    const { result } = renderHook(() =>
      useWikiSlugs({ hold: false, reloadKey: 1 })
    );
    await waitFor(() => expect(api.listResource).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });
});

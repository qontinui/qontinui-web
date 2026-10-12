import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getResource: vi.fn() }));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import { ResourceError } from "@/components/overview/editing/api";
import { useSourceDocument } from "./source";

const doc = (kind: string, body = "") => ({
  item: { id: "doc-1", kind, title: "Delivery plan", body_md: body },
});

describe("useSourceDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads a document and its gantt chart", async () => {
    api.getResource.mockResolvedValue(
      doc("document", "```mermaid\ngantt\n  section A0 X\n```")
    );
    const { result } = renderHook(() =>
      useSourceDocument("doc-1", false, "p1")
    );
    await waitFor(() => expect(result.current.kind).toBe("ready"));
    const ready = result.current as Extract<
      typeof result.current,
      { kind: "ready" }
    >;
    expect(ready.source.title).toBe("Delivery plan");
    expect(ready.source.gantt).toContain("section A0 X");
  });

  it("treats a wiki page or an unknown id as missing, not an error", async () => {
    api.getResource.mockResolvedValue(doc("wiki"));
    const wiki = renderHook(() => useSourceDocument("doc-1", false, "p1"));
    await waitFor(() => expect(wiki.result.current.kind).toBe("missing"));
    api.getResource.mockRejectedValue(
      new ResourceError(404, null, "not found")
    );
    const gone = renderHook(() => useSourceDocument("nope", false, "p1"));
    await waitFor(() => expect(gone.result.current.kind).toBe("missing"));
  });

  it("reads nothing while held, and nothing at all without an id", () => {
    renderHook(() => useSourceDocument("doc-1", true, "p1"));
    const none = renderHook(() => useSourceDocument(null, false, "p1"));
    expect(api.getResource).not.toHaveBeenCalled();
    expect(none.result.current.kind).toBe("none");
  });

  it("reads again when the project changes", async () => {
    api.getResource.mockResolvedValue(doc("document"));
    const { result, rerender } = renderHook(
      ({ project }) => useSourceDocument("doc-1", false, project),
      { initialProps: { project: "p1" } }
    );
    await waitFor(() => expect(result.current.kind).toBe("ready"));
    // Under the next project the same id is not a document of it.
    api.getResource.mockRejectedValue(
      new ResourceError(404, null, "not found")
    );
    rerender({ project: "p2" });
    await waitFor(() => expect(result.current.kind).toBe("missing"));
    expect(api.getResource).toHaveBeenCalledTimes(2);
  });
});

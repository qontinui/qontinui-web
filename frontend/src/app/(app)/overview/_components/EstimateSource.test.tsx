import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageRecord } from "../_lib/pages";

const mocks = vi.hoisted(() => ({
  canEdit: vi.fn(() => false),
  listResource: vi.fn(),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useCanEdit: mocks.canEdit,
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listResource: mocks.listResource,
}));

import { EstimateSource, editorHref } from "./EstimateSource";

const page = {
  id: "doc-1",
  kind: "document",
  body_md:
    "# Plan\n\n```mermaid\ngantt\n  section A0 X\n  T :a, 2026-01-05, 5d\n```",
} as PageRecord;

function estimates(source: string | null) {
  mocks.listResource.mockResolvedValue({
    items: [
      {
        id: "e1",
        name: "v0.1",
        is_baseline: true,
        source_page_id: source,
        content: null,
      },
    ],
    total: 1,
    can_edit: false,
    degraded: null,
  });
}

function show() {
  return render(
    <EstimateSource page={page} hold={false} reloadKey={1} uiBridgeId="t.est" />
  );
}

describe("EstimateSource", () => {
  it("says so when it could not check, instead of offering the wrong action", async () => {
    mocks.canEdit.mockReturnValue(false);
    mocks.listResource.mockRejectedValue(new Error("HTTP 503"));
    show();
    expect(await screen.findByText(/couldn.t\s+be checked/)).toBeTruthy();
  });

  beforeEach(() => vi.clearAllMocks());

  it("offers an editor to build the estimate from this document", async () => {
    mocks.canEdit.mockReturnValue(true);
    estimates(null);
    show();
    const link = await screen.findByRole("link", {
      name: "Use as the project estimate",
    });
    expect(link.getAttribute("href")).toBe(editorHref("doc-1"));
    expect(editorHref("doc-1")).toBe("/overview/team/edit?from_document=doc-1");
    expect(screen.getByText(/gantt chart can be imported/)).toBeTruthy();
  });

  it("tells anyone when this document is the estimate's source", async () => {
    mocks.canEdit.mockReturnValue(false);
    estimates("doc-1");
    show();
    expect(
      await screen.findByText(/is the source of the project/)
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /Use as|Update the estimate/ })
    ).toBeNull();
  });

  it("shows a reader nothing when it is not the source", async () => {
    mocks.canEdit.mockReturnValue(false);
    estimates("another-doc");
    const { container } = show();
    // Wait for the answer itself, not just the request: while loading the
    // section is empty anyway, so asserting then would prove nothing.
    await act(async () => {
      await mocks.listResource.mock.results[0]?.value;
    });
    expect(container.textContent).toBe("");
  });
});

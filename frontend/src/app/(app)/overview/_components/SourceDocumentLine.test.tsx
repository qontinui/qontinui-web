import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getResource: vi.fn() }));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import { ResourceError } from "@/components/overview/editing/api";
import { SourceDocumentLine } from "./SourceDocumentLine";

describe("SourceDocumentLine", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names and links the document the estimate was built from", async () => {
    api.getResource.mockResolvedValue({
      item: { id: "doc-1", title: "Delivery plan" },
    });
    render(<SourceDocumentLine pageId="doc-1" uiBridgeId="t.src" />);
    const link = await screen.findByRole("link", { name: "Delivery plan" });
    expect(link.getAttribute("href")).toBe("/overview/documents/doc-1");
  });

  it("says so when that document has been deleted", async () => {
    api.getResource.mockRejectedValue(
      new ResourceError(404, null, "not found")
    );
    render(<SourceDocumentLine pageId="gone" uiBridgeId="t.src" />);
    expect(
      await screen.findByText(
        "Built from a document that has since been deleted."
      )
    ).toBeTruthy();
  });
});

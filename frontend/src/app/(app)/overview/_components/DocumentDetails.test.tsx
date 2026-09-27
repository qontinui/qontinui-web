import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentDetailsForm, detailsPatch } from "./DocumentDetails";
import type { PageRecord } from "../_lib/pages";

const page: PageRecord = {
  id: "p1",
  kind: "document",
  slug: "plan",
  title: "Plan",
  body_md: "",
  excerpt: "",
  doc_number: "DP-001",
  doc_status: "Draft",
  owner: null,
  related: ["alpha", "beta"],
  version: 3,
  created_at: "2026-09-26T00:00:00Z",
  updated_at: "2026-09-26T00:00:00Z",
  created_by: null,
  updated_by: null,
};

const draft = {
  title: "Plan",
  doc_number: "DP-001",
  doc_status: "Draft",
  owner: "",
  related: ["alpha", "beta"],
};

describe("detailsPatch", () => {
  it("sends nothing when nothing changed, whatever the related order", () => {
    expect(
      detailsPatch(page, { ...draft, related: ["beta", "alpha"] })
    ).toEqual({});
  });

  it("sends only what changed, and clears an emptied field", () => {
    expect(
      detailsPatch(page, {
        ...draft,
        doc_status: "  Approved ",
        doc_number: " ",
      })
    ).toEqual({ doc_status: "Approved", doc_number: null });
  });

  it("sends the new related list and a trimmed title", () => {
    expect(
      detailsPatch(page, { ...draft, title: " Plan B ", related: ["alpha"] })
    ).toEqual({ title: "Plan B", related: ["alpha"] });
  });
});

describe("DocumentDetailsForm related documents", () => {
  const other = { ...page, id: "p2", slug: "alpha", title: "Alpha" };

  it("lists a related slug no document has any more, so it can be removed", () => {
    const save = vi.fn().mockResolvedValue({ ok: true, item: page });
    render(
      <DocumentDetailsForm
        page={page}
        documents={{ state: "ready", items: [page, other], degraded: null }}
        save={save}
        onDone={vi.fn()}
        uiBridgeId="t.d"
      />
    );
    const orphan = screen.getByLabelText("beta (no longer a document here)");
    expect((orphan as HTMLInputElement).checked).toBe(true);
    fireEvent.click(orphan);
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(save).toHaveBeenCalledWith(page, { related: ["alpha"] });
  });

  it("says the documents are loading, not that they failed", () => {
    render(
      <DocumentDetailsForm
        page={page}
        documents={{ state: "loading" }}
        save={vi.fn()}
        onDone={vi.fn()}
        uiBridgeId="t.d"
      />
    );
    expect(screen.getByText("Loading the other documents…")).toBeTruthy();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { FileRecord } from "../_lib/pages";

const api = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  fetchFileBlob: vi.fn(),
  deleteResource: vi.fn(),
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import { ResourceError } from "@/components/overview/editing/api";
import { FilesPanel } from "./FilesPanel";

const file: FileRecord = {
  id: "f1",
  filename: "Contract.pdf",
  content_type: "application/pdf",
  size_bytes: 2048,
  sha256: "x",
  page_id: "doc-1",
  uploaded_by: "dana@example.com",
  created_at: "2026-09-26T00:00:00Z",
  version: 1,
  download_path: "/api/v1/overview/files/f1/content",
};

function panel(canEdit: boolean, onChanged = vi.fn()) {
  render(
    <FilesPanel
      files={{ state: "ready", items: [file], degraded: null }}
      canEdit={canEdit}
      pageId="doc-1"
      onChanged={onChanged}
      attachedTo={(id) =>
        id === "doc-1" ? { title: "Delivery plan", href: "/d" } : null
      }
      emptyText="None."
      uiBridgeId="t.files"
    />
  );
  return onChanged;
}

function pick(files: File[]) {
  const input = screen.getByLabelText("Files to upload");
  fireEvent.change(input, { target: { files } });
}

describe("FilesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists a file with its kind, size and document; readers get no upload", () => {
    panel(false);
    expect(screen.getByRole("button", { name: "Contract.pdf" })).toBeTruthy();
    expect(screen.getByText(/PDF · 2\.0 KB/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Delivery plan" })).toBeTruthy();
    expect(screen.queryByLabelText("Files to upload")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("refuses a type the server would refuse, without sending it", async () => {
    panel(true);
    pick([new File(["MZ"], "tool.exe")]);
    expect(await screen.findByText(/tool\.exe: only PDF/)).toBeTruthy();
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  it("uploads to the document, one key per file, then re-reads the list", async () => {
    api.uploadFile.mockResolvedValue(file);
    const onChanged = panel(true);
    pick([new File(["%PDF-1"], "a.pdf"), new File(["%PDF-1"], "b.pdf")]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(api.uploadFile).toHaveBeenCalledTimes(2);
    const [first, second] = api.uploadFile.mock.calls;
    expect(first?.[2]).toBe("doc-1");
    expect(first?.[1]).not.toBe(second?.[1]);
    expect(screen.getByText("Uploaded a.pdf.")).toBeTruthy();
  });

  it("shows the server's refusal for the one file it refused", async () => {
    api.uploadFile.mockRejectedValue(
      new ResourceError(
        415,
        "content_mismatch",
        "That file's contents are not a .pdf file."
      )
    );
    const onChanged = panel(true);
    pick([new File(["nope"], "fake.pdf")]);
    expect(
      await screen.findByText("That file's contents are not a .pdf file.")
    ).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    // A refusal made nothing: there is nothing to try again.
    expect(screen.queryByRole("button", { name: /again/ })).toBeNull();
  });

  it("offers a lost upload again under the same key, so a landed first try is not stored twice", async () => {
    api.uploadFile
      .mockRejectedValueOnce(new Error("Request timeout"))
      .mockResolvedValueOnce(file);
    const onChanged = panel(true);
    pick([new File(["%PDF-1"], "big.pdf")]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Try big.pdf again" })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const [first, second] = api.uploadFile.mock.calls;
    expect(second?.[1]).toBe(first?.[1]);
    expect(screen.getByText("Uploaded big.pdf.")).toBeTruthy();
  });

  it("names each file's delete button, and hands focus back when the reader keeps it", async () => {
    panel(true);
    const del = screen.getByRole("button", { name: "Delete Contract.pdf" });
    fireEvent.click(del);
    const keep = screen.getByRole("button", { name: "Keep it" });
    expect(document.activeElement).toBe(keep);
    fireEvent.click(keep);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Delete Contract.pdf" })
      )
    );
  });

  it("downloads through the authenticated route", async () => {
    api.fetchFileBlob.mockResolvedValue(new Blob(["%PDF"]));
    const created = vi.fn(() => "blob:x");
    const original = {
      createObjectURL: URL.createObjectURL,
      revokeObjectURL: URL.revokeObjectURL,
    };
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    onTestFinished(() => Object.assign(URL, original));
    panel(false);
    fireEvent.click(screen.getByRole("button", { name: "Contract.pdf" }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(api.fetchFileBlob).toHaveBeenCalledWith(file.download_path);
  });
});

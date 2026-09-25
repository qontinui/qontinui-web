import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The discard confirm is a DestructiveButton, which refuses the untrusted
// clicks jsdom produces; stand it in with a plain button, as the members
// page tests do. Its gate has its own tests.
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import { EditableSection, type EditableText } from "./EditableSection";
import { draftKey, readDraft, writeDraft } from "./drafts";
import type { SaveResult } from "./useResource";

/**
 * What the editor promises a writer: nothing to click unless the server says
 * they may edit; a draft kept while they type and restored if they come
 * back; an explicit Save; and, on a conflict, both versions and a choice.
 */

const record: EditableText = {
  text: "# Vision\n\nThe old words.",
  version: 3,
  updatedBy: "someone@example.com",
  updatedAt: "2026-09-20T10:00:00Z",
};

const theirs: EditableText = {
  text: "# Vision\n\nTheir words.",
  version: 4,
  updatedBy: "them@example.com",
  updatedAt: "2026-09-23T10:00:00Z",
};

const KEY = draftKey(
  "project-a",
  "intent_documents",
  "product_intent:vision",
  "u1"
);

function renderSection(
  onSave: (text: string, version: number) => Promise<SaveResult<EditableText>>,
  props: Partial<React.ComponentProps<typeof EditableSection>> = {}
) {
  return render(
    <EditableSection
      projectId="project-a"
      resource="intent_documents"
      recordId="product_intent:vision"
      viewerId="u1"
      record={record}
      canEdit
      label="Vision"
      onSave={onSave}
      uiBridgeId="test.vision"
      {...props}
    >
      <p>The old words.</p>
    </EditableSection>
  );
}

const textbox = () =>
  screen.getByLabelText("Text of Vision") as HTMLTextAreaElement;

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("EditableSection", () => {
  it("offers nothing to a reader who may not edit", () => {
    renderSection(vi.fn(), { canEdit: false });
    expect(screen.getByText("The old words.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("saves the edited text against the version it was read at", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, item: record });
    renderSection(onSave);
    fireEvent.click(screen.getByRole("button", { name: "Edit: Vision" }));
    fireEvent.change(textbox(), {
      target: { value: "# Vision\n\nNew words." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("# Vision\n\nNew words.", 3)
    );
    // Saved: the editor closes and the draft is gone.
    await waitFor(() =>
      expect(screen.queryByLabelText("Text of Vision")).toBeNull()
    );
    expect(readDraft(KEY)).toBeNull();
  });

  it("keeps a draft while typing and restores it, with its original version", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, item: record });
    const { unmount } = renderSection(onSave);
    fireEvent.click(screen.getByRole("button", { name: "Edit: Vision" }));
    fireEvent.change(textbox(), { target: { value: "half-written" } });
    expect(readDraft(KEY)?.text).toBe("half-written");
    unmount(); // the tab closed

    renderSection(onSave, { record: { ...record, version: 5 } });
    fireEvent.click(screen.getByRole("button", { name: "Edit: Vision" }));
    expect(textbox().value).toBe("half-written");
    expect(screen.getByText(/Restored your unsaved draft/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // The draft was written against version 3: saving it over version 5 must
    // be a conflict at the server, not a silent overwrite.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("half-written", 3));
  });

  it("asks before discarding changes", () => {
    renderSection(vi.fn());
    fireEvent.click(screen.getByRole("button", { name: "Edit: Vision" }));
    fireEvent.change(textbox(), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard your changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(textbox().value).toBe("changed");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByLabelText("Text of Vision")).toBeNull();
    expect(readDraft(KEY)).toBeNull();
  });

  it("refuses to save what the validator refuses, and says why", () => {
    const onSave = vi.fn();
    renderSection(onSave, {
      validate: (t) => (t.trim() ? null : "Write something before saving."),
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit: Vision" }));
    fireEvent.change(textbox(), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Write something before saving."
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows a failed save's reason and keeps the text", async () => {
    renderSection(
      vi.fn().mockResolvedValue({
        ok: false,
        error: "The service isn't responding.",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit: Vision" }));
    fireEvent.change(textbox(), { target: { value: "precious" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/isn't responding/)
    );
    expect(textbox().value).toBe("precious");
  });

  describe("on a conflict", () => {
    async function conflicted(onSave: ReturnType<typeof vi.fn>) {
      renderSection(onSave);
      fireEvent.click(screen.getByRole("button", { name: "Edit: Vision" }));
      fireEvent.change(textbox(), { target: { value: "My words." } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(
          screen.getByText("Somebody else changed this while you were editing")
        ).toBeTruthy()
      );
    }

    it("shows both versions", async () => {
      await conflicted(
        vi.fn().mockResolvedValue({ ok: false, conflict: theirs })
      );
      expect(screen.getAllByText(/Their words\./).length).toBeGreaterThan(0);
      expect(screen.getAllByText("My words.").length).toBeGreaterThan(0);
    });

    it("keep mine re-saves against THEIR version, knowingly", async () => {
      const onSave = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, conflict: theirs })
        .mockResolvedValueOnce({ ok: true, item: theirs });
      await conflicted(onSave);
      fireEvent.click(
        screen.getByRole("button", { name: "Save mine over theirs" })
      );
      await waitFor(() =>
        expect(onSave).toHaveBeenLastCalledWith("My words.", 4)
      );
    });

    it("take theirs discards mine and the draft", async () => {
      await conflicted(
        vi.fn().mockResolvedValue({ ok: false, conflict: theirs })
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Discard mine, keep theirs" })
      );
      await waitFor(() =>
        expect(screen.queryByLabelText("Text of Vision")).toBeNull()
      );
      expect(readDraft(KEY)).toBeNull();
    });

    it("combine keeps editing mine with theirs alongside, based on theirs", async () => {
      const onSave = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, conflict: theirs })
        .mockResolvedValueOnce({ ok: true, item: theirs });
      await conflicted(onSave);
      fireEvent.click(
        screen.getByRole("button", { name: "Combine them myself" })
      );
      expect(textbox().value).toBe("My words.");
      expect(
        screen.getByLabelText("Their version, for reference")
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(onSave).toHaveBeenLastCalledWith("My words.", 4)
      );
    });
  });

  it("never offers one project's draft in another project", () => {
    // Coord seeds every project with the same document names, so the record
    // id alone cannot tell A's vision from B's.
    const { unmount } = renderSection(vi.fn());
    fireEvent.click(screen.getByRole("button", { name: "Edit: Vision" }));
    fireEvent.change(textbox(), { target: { value: "project A's words" } });
    unmount();

    renderSection(vi.fn(), { projectId: "project-b" });
    fireEvent.click(screen.getByRole("button", { name: "Edit: Vision" }));
    expect(textbox().value).toBe(record.text);
    expect(screen.queryByText(/Restored your unsaved draft/)).toBeNull();
  });

  it("opens with the given start text, not the record's, for a template", () => {
    writeDraft(KEY, "", 1); // an empty draft is no draft
    renderSection(vi.fn(), { startText: "", editLabel: "Write it" });
    fireEvent.click(screen.getByRole("button", { name: "Write it: Vision" }));
    expect(textbox().value).toBe("");
  });
});

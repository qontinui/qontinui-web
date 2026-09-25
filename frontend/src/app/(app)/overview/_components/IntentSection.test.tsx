import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useResourceDescriptor: () => null,
}));

import type { SaveResult } from "@/components/overview/editing/useResource";
import { toIntentEntry, type IntentDocument } from "../_lib/intent";
import {
  IntentSection,
  slugFromTitle,
  type IntentSectionActions,
} from "./IntentSection";

/**
 * Writing into a template — the first thing anyone does on a new project,
 * since every project starts with only templates. The save's own optimistic
 * result makes the section "written"; the editor must survive that, so a
 * failure or a conflict is still shown to the writer.
 */

const template: IntentDocument = {
  id: "audience_profile:example-audience",
  kind: "audience_profile",
  name: "example-audience",
  description: null,
  body: "",
  frontmatter: null,
  overview_order: null,
  state: "skeleton",
  error: null,
  status: null,
  withdrawn: false,
  version: 1,
  updated_at: null,
  updated_by: null,
};

function Harness({
  outcome,
}: {
  outcome: (doc: IntentDocument) => SaveResult<IntentDocument>;
}) {
  const [docs, setDocs] = useState([template]);
  const actions: IntentSectionActions = {
    canEdit: true,
    projectId: "p1",
    viewerId: "u1",
    saveBody: async (_id, text) => {
      // What useSummaryData's optimistic apply does.
      setDocs([{ ...template, body: text, state: "authored" }]);
      await new Promise((r) => setTimeout(r, 0));
      const result = outcome({ ...template, body: text, state: "authored" });
      if (!result.ok && "error" in result) setDocs([template]); // rollback
      if (!result.ok && "conflict" in result) setDocs([result.conflict]);
      return result;
    },
    move: vi.fn(),
    createDocument: vi.fn(),
  };
  return (
    <IntentSection
      kind="audience_profile"
      entries={docs.map(toIntentEntry)}
      actions={actions}
    />
  );
}

function write(text: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Write it/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /^Text of/ }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

beforeEach(() => window.localStorage.clear());

describe("writing into a template", () => {
  it("keeps the editor, and says why, when the first save fails", async () => {
    render(
      <Harness
        outcome={() => ({ ok: false, error: "The service isn't responding." })}
      />
    );
    write("# Leaders\n\nThe people who approve the budget.");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/isn't responding/)
    );
    expect(
      (screen.getByRole("textbox", { name: /^Text of/ }) as HTMLTextAreaElement)
        .value
    ).toMatch(/approve the budget/);
  });

  it("shows the conflict when somebody else wrote it first", async () => {
    const theirs = {
      ...template,
      body: "# Theirs\n\nWritten elsewhere.",
      state: "authored" as const,
      version: 2,
    };
    render(<Harness outcome={() => ({ ok: false, conflict: theirs })} />);
    write("# Mine\n\nMy words.");
    await waitFor(() =>
      expect(
        screen.getByText("Somebody else changed this while you were editing")
      ).toBeTruthy()
    );
  });

  it("closes once saved and shows the written text", async () => {
    render(<Harness outcome={(doc) => ({ ok: true, item: doc })} />);
    write("# Leaders\n\nThe people who approve the budget.");
    await waitFor(() =>
      expect(
        screen.getByText("The people who approve the budget.")
      ).toBeTruthy()
    );
    expect(screen.queryByRole("textbox", { name: /^Text of/ })).toBeNull();
  });
});

describe("slugFromTitle", () => {
  it("makes a coord name from a title", () => {
    expect(slugFromTitle("Café — Q4 Launch!", "unused")).toBe("cafe-q4-launch");
  });

  it("names a title in another script with the form's fixed fallback", () => {
    expect(slugFromTitle("Видение", "document-abc")).toBe("document-abc");
  });
});

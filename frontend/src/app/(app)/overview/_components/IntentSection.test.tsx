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

const written: IntentDocument = {
  ...template,
  id: "audience_profile:human-operator",
  name: "human-operator",
  body: "# The human operator\n\nDirects the fleet.",
  state: "authored",
  version: 2,
};

function Harness({
  outcome,
  initial = [template],
  canEdit = true,
}: {
  outcome: (doc: IntentDocument) => SaveResult<IntentDocument>;
  initial?: IntentDocument[];
  canEdit?: boolean;
}) {
  const [docs, setDocs] = useState(initial);
  const swap = (id: string, next: IntentDocument) =>
    setDocs((all) => all.map((d) => (d.id === id ? next : d)));
  const actions: IntentSectionActions = {
    canEdit,
    projectId: "p1",
    viewerId: "u1",
    saveBody: async (id, text) => {
      const before = docs.find((d) => d.id === id)!;
      // What useSummaryData's optimistic apply does.
      swap(id, { ...before, body: text, state: "authored" });
      await new Promise((r) => setTimeout(r, 0));
      const result = outcome({ ...before, body: text, state: "authored" });
      if (!result.ok && "error" in result) swap(id, before); // rollback
      if (!result.ok && "conflict" in result) swap(id, result.conflict);
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

describe("a section that is already written", () => {
  const both = [written, template];

  it("still offers its unwritten template to an editor", () => {
    render(
      <Harness outcome={() => ({ ok: true, item: written })} initial={both} />
    );
    expect(screen.getByText("Directs the fleet.")).toBeTruthy();
    expect(screen.getByText("Not written yet")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Write: Example audience" })
    ).toBeTruthy();
  });

  it("shows a reader only what is written", () => {
    render(
      <Harness
        outcome={() => ({ ok: true, item: written })}
        initial={both}
        canEdit={false}
      />
    );
    expect(screen.getByText("Directs the fleet.")).toBeTruthy();
    expect(screen.queryByText("Not written yet")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps that template's editor, and its error, through a failed save", async () => {
    render(
      <Harness
        outcome={() => ({ ok: false, error: "The service isn't responding." })}
        initial={both}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Write: Example audience" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Text of/ }), {
      target: { value: "# Leaders\n\nApprove the budget." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/isn't responding/)
    );
    expect(
      (screen.getByRole("textbox", { name: /^Text of/ }) as HTMLTextAreaElement)
        .value
    ).toMatch(/Approve the budget/);
  });

  it("moves a template into the written list once it is saved", async () => {
    render(
      <Harness outcome={(doc) => ({ ok: true, item: doc })} initial={both} />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Write: Example audience" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Text of/ }), {
      target: { value: "# Leaders\n\nApprove the budget." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByText("Approve the budget.")).toBeTruthy()
    );
    expect(screen.queryByText("Not written yet")).toBeNull();
  });
});

describe("several template editors open at once", () => {
  const second: IntentDocument = {
    ...template,
    id: "audience_profile:partners",
    name: "partners",
  };

  it("keeps every open editor, and the failing one's error, through a save", async () => {
    render(
      <Harness
        outcome={() => ({ ok: false, error: "The service isn't responding." })}
        initial={[template, second]}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Write: Example audience" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Write: Partners" }));
    const boxes = () => screen.getAllByRole("textbox", { name: /^Text of/ });
    expect(boxes()).toHaveLength(2);
    fireEvent.change(boxes()[0], { target: { value: "# One\n\nFirst." } });
    fireEvent.change(boxes()[1], { target: { value: "# Two\n\nSecond." } });
    // Save the FIRST-opened one: the empty section must not flip branches and
    // take both editors with it.
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/isn't responding/)
    );
    expect(boxes()).toHaveLength(2);
    expect((boxes()[1] as HTMLTextAreaElement).value).toMatch(/Second/);
  });
});

describe("one template saved while another editor is open", () => {
  const second: IntentDocument = {
    ...template,
    id: "audience_profile:partners",
    name: "partners",
  };

  it("keeps the other editor, and its failing save's error, as the section becomes written", async () => {
    render(
      <Harness
        // The first template saves; the second one's save fails.
        outcome={(doc) =>
          doc.id === template.id
            ? { ok: true, item: doc }
            : { ok: false, error: "The service isn't responding." }
        }
        initial={[template, second]}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Write: Example audience" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Write: Partners" }));
    const boxes = () => screen.getAllByRole("textbox", { name: /^Text of/ });
    fireEvent.change(boxes()[0], { target: { value: "# One\n\nFirst." } });
    fireEvent.change(boxes()[1], { target: { value: "# Two\n\nSecond." } });
    const saves = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saves[1]); // in flight, will fail
    fireEvent.click(saves[0]); // succeeds: the section becomes written
    await waitFor(() => expect(screen.getByText("First.")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/isn't responding/)
    );
    expect(boxes()).toHaveLength(1);
    expect((boxes()[0] as HTMLTextAreaElement).value).toMatch(/Second/);
  });
});

describe("focus after writing a template", () => {
  it("lands on the new document's heading, not the page body", async () => {
    render(
      <Harness
        outcome={(doc) => ({ ok: true, item: doc })}
        initial={[written, template]}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Write: Example audience" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Text of/ }), {
      target: { value: "# Leaders\n\nApprove the budget." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Leaders")
    );
    expect(document.activeElement?.tagName).toBe("H3");
  });
});

describe("focus while another editor is open", () => {
  const second: IntentDocument = {
    ...template,
    id: "audience_profile:partners",
    name: "partners",
  };

  it("is not pulled out of the editor the writer moved on to", async () => {
    render(
      <Harness
        outcome={(doc) => ({ ok: true, item: doc })}
        initial={[written, template, second]}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Write: Example audience" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Write: Partners" }));
    const boxes = () => screen.getAllByRole("textbox", { name: /^Text of/ });
    fireEvent.change(boxes()[0], { target: { value: "# One\n\nFirst." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    // The writer has moved on to the second editor before the save lands.
    // (Once the first editor closes, boxes()[0] is this same second editor.)
    boxes()[1].focus();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "One" })).toBeTruthy()
    );
    expect(document.activeElement).toBe(boxes()[0]);
    expect(boxes()).toHaveLength(1);
  });
});

describe("a document that vanishes while its editor is open", () => {
  it("does not stay under 'Not written yet' when it comes back written", () => {
    const actions: IntentSectionActions = {
      canEdit: true,
      projectId: "p1",
      viewerId: "u1",
      saveBody: vi.fn(),
      move: vi.fn(),
      createDocument: vi.fn(),
    };
    const renderSection = (docs: IntentDocument[]) => (
      <IntentSection
        kind="audience_profile"
        entries={docs.map(toIntentEntry)}
        actions={actions}
      />
    );
    const { rerender } = render(renderSection([written, template]));
    fireEvent.click(
      screen.getByRole("button", { name: "Write: Example audience" })
    );
    rerender(renderSection([written]));
    rerender(
      renderSection([
        written,
        { ...template, body: "# Example audience\n\nBack.", state: "authored" },
      ])
    );
    expect(screen.queryByText("Not written yet")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Example audience" })
    ).toBeTruthy();
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

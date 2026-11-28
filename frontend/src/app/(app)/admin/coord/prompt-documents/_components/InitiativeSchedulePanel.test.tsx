/**
 * InitiativeSchedulePanel — Phase 7 of plan
 * `2026-11-25-overview-timeline-and-milestones-derive-from-coord`.
 *
 * The panel edits the initiative document's schedule frontmatter inside the
 * editor body; the dialog's existing Save (`onUpdate`, i.e. the page's
 * `PATCH /coord/prompt-documents/{kind}/{name}`) writes it. What these pin:
 * the derived-only case (a milestone added here is what the Overview reads and
 * is saved with the document's own address), the unknown case (an unparseable
 * row is listed and nothing is invented; a missing calendar says so), and the
 * tenant case (the panel writes only through the dialog's save for the opened
 * document, and never for any other kind).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api/operations/coordPlans", () => ({
  fetchPlans: vi.fn(),
  planRowsOf: (body: { work_units?: { slug: string }[] } | null) =>
    body?.work_units ?? [],
}));
vi.mock("@/lib/api/operations/coordGates", () => ({
  fetchGatesList: vi.fn(),
}));

import { fetchPlans } from "@/lib/api/operations/coordPlans";
import { fetchGatesList } from "@/lib/api/operations/coordGates";
import { PromptDocumentEditorDialog } from "./PromptDocumentEditorDialog";
import type { PromptDocument, PromptDocumentKind } from "../types";

const BODY =
  "---\nstarts: 2026-10-19\nmilestones:\n" +
  "  - {id: V3, name: V3 pilot, date: 2027-01-22}\n---\n# Current initiative\n";

function doc(kind: PromptDocumentKind, body = BODY): PromptDocument {
  return {
    id: "doc-1",
    tenant_id: "tenant-A",
    kind,
    name: kind === "initiative" ? "current-initiative" : "vision",
    description: "the initiative",
    format: "markdown",
    default_source: null,
    current_version: 4,
    updated_by: "editor@example.com",
    updated_at: "2026-11-25T10:00:00Z",
    body,
    attrs: null,
  };
}

function renderDialog(kind: PromptDocumentKind, body = BODY) {
  const onUpdate = vi.fn().mockResolvedValue(true);
  render(
    <PromptDocumentEditorDialog
      open
      onOpenChange={vi.fn()}
      document={doc(kind, body)}
      loadingBody={false}
      saving={false}
      onUpdate={onUpdate}
      onRestore={vi.fn().mockResolvedValue(true)}
      onShowHistory={vi.fn()}
    />
  );
  return { onUpdate };
}

beforeEach(() => {
  vi.mocked(fetchPlans).mockResolvedValue({
    work_units: [{ slug: "child-a" }, { slug: "child-b" }],
  } as never);
  vi.mocked(fetchGatesList).mockResolvedValue([] as never);
});

describe("InitiativeSchedulePanel", () => {
  it("appears for an initiative document and for no other kind", () => {
    renderDialog("initiative");
    expect(screen.getByTestId("initiative-schedule-panel")).toBeInTheDocument();
  });

  it("is absent for a non-initiative document", () => {
    renderDialog("product_intent");
    expect(
      screen.queryByTestId("initiative-schedule-panel")
    ).not.toBeInTheDocument();
  });

  it("adds milestone V4, previews it, and saves it through the dialog's own update", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDialog("initiative");

    expect(screen.getByTestId("schedule-preview-milestones")).toHaveTextContent(
      "1 milestone: V3 2027-01-22"
    );
    await user.click(screen.getByTestId("schedule-add-milestone"));
    await user.type(screen.getByTestId("schedule-milestone-1-id"), "V4");
    await user.type(
      screen.getByTestId("schedule-milestone-1-name"),
      "V4 handover"
    );
    await user.type(
      screen.getByTestId("schedule-milestone-1-date"),
      "2027-02-01"
    );

    expect(screen.getByTestId("schedule-preview-milestones")).toHaveTextContent(
      "2 milestones: V3 2027-01-22, V4 2027-02-01"
    );
    expect(
      (screen.getByTestId("doc-body") as HTMLTextAreaElement).value
    ).toContain("date: 2027-02-01");

    await user.click(screen.getByTestId("doc-save"));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [kind, name, patch] = onUpdate.mock.calls[0];
    expect(kind).toBe("initiative");
    expect(name).toBe("current-initiative");
    expect(patch.body).toContain("name: V4 handover");
    expect(patch.body).toContain("date: 2027-02-01");
    // Prose and the untouched frontmatter line survive the rewrite.
    expect(patch.body).toContain("starts: 2026-10-19");
    expect(patch.body.endsWith("# Current initiative\n")).toBe(true);
  });

  it("keeps spaces typed in a name (the draft is not re-trimmed from the body)", async () => {
    const user = userEvent.setup();
    renderDialog("initiative");
    await user.click(screen.getByTestId("schedule-add-milestone"));
    const name = screen.getByTestId("schedule-milestone-1-name");
    await user.type(name, "Pilot is live");
    expect(name).toHaveValue("Pilot is live");
  });

  it("lists an unparseable date row as unreadable and invents no date", async () => {
    const user = userEvent.setup();
    renderDialog("initiative");
    await user.click(screen.getByTestId("schedule-add-milestone"));
    await user.type(screen.getByTestId("schedule-milestone-1-id"), "V9");
    await user.type(
      screen.getByTestId("schedule-milestone-1-name"),
      "V9 vague"
    );

    const unreadable = screen.getByTestId("schedule-preview-unreadable");
    expect(unreadable).toHaveTextContent("id: V9, name: V9 vague, date:");
    expect(screen.getByTestId("schedule-preview-milestones")).toHaveTextContent(
      "1 milestone: V3 2027-01-22"
    );
  });

  it("lists a hand-typed unreadable row from the raw body, as the Overview will", () => {
    renderDialog(
      "initiative",
      "---\nmilestones:\n  - {id: V1, name: Fine, date: 2026-12-01}\n  - {id: V2, name: Odd, date: 2026-13-45}\n---\nx\n"
    );
    expect(screen.getByTestId("schedule-preview-unreadable")).toHaveTextContent(
      "id: V2, name: Odd, date: 2026-13-45"
    );
  });

  it("says a missing calendar is no calendar, and declares one on request", async () => {
    const user = userEvent.setup();
    renderDialog("initiative");
    expect(screen.getByTestId("schedule-preview-calendar")).toHaveTextContent(
      /No usable calendar.*Not available \(no calendar\)/
    );
    await user.click(screen.getByTestId("schedule-add-calendar"));
    expect(screen.getByTestId("schedule-preview-calendar")).toHaveTextContent(
      "Calendar: factor 1, 0 breaks"
    );
    await user.click(screen.getByTestId("schedule-add-break"));
    // An empty break is listed as unreadable rather than counted.
    expect(
      screen.getByTestId("schedule-preview-unreadable")
    ).toBeInTheDocument();
  });

  it("re-seeds from the raw editor when the body is edited there", async () => {
    const user = userEvent.setup();
    renderDialog("initiative");
    const raw = screen.getByTestId("doc-body");
    await user.clear(raw);
    await user.click(raw);
    await user.paste(
      "---\nmilestones:\n  - {id: Z1, name: Zed, date: 2027-03-03}\n---\nx\n"
    );
    await waitFor(() =>
      expect(screen.getByTestId("schedule-milestone-0-id")).toHaveValue("Z1")
    );
  });

  it("keeps working when the work-unit and gate pickers cannot load", async () => {
    vi.mocked(fetchPlans).mockRejectedValue(new Error("coord down"));
    renderDialog("initiative");
    await waitFor(() =>
      expect(screen.getByTestId("schedule-pickers-failed")).toBeInTheDocument()
    );
    expect(screen.getByTestId("schedule-milestone-0-work-unit")).toBeEnabled();
  });
});

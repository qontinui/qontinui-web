/**
 * PromptDocumentHistoryDialog — "Restore this version" (plan
 * `2026-07-30-session-compliance-report-enforcement.md` §B1).
 *
 * Rollback is the one genuine gap in the prompt-document stack: history was
 * retained and diffable, but the only restore re-seeded the shipped code
 * default, so rolling back to an arbitrary prior wording was a two-call
 * client-side maneuver that nothing labelled as a revert.
 *
 * What these pin is the part an operator can be hurt by getting wrong — the
 * semantics must be visible BEFORE the click, not discovered after it. A
 * restore is an ordinary versioning edit that creates a NEW snapshot; history
 * is never rewritten. A confirmation that didn't say so would read as "erase
 * everything after v4", which is the opposite of what happens.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PromptDocumentHistoryDialog } from "./PromptDocumentHistoryDialog";
import type {
  ListVersionsResponse,
  PromptDocumentVersion,
} from "../types";

const TARGET = {
  kind: "policy" as const,
  name: "session-protocol",
  label: "Session Protocol",
};

const VERSIONS: ListVersionsResponse = {
  document_id: "doc-1",
  kind: "policy",
  name: "session-protocol",
  current_version: 5,
  total: 2,
  versions: [
    {
      id: "v5",
      version_number: 5,
      description: "tightened Step 3",
      edited_by: "editor@example.com",
      created_at: "2026-07-30T10:00:00Z",
    },
    {
      id: "v4",
      version_number: 4,
      description: "original Step 3",
      edited_by: "editor@example.com",
      created_at: "2026-07-29T10:00:00Z",
    },
  ],
};

const SNAPSHOT_V4: PromptDocumentVersion = {
  id: "v4",
  document_id: "doc-1",
  version_number: 4,
  description: "original Step 3",
  edited_by: "editor@example.com",
  created_at: "2026-07-29T10:00:00Z",
  body: "Step 3 — close the session.",
};

function renderDialog(onRestoreVersion = vi.fn().mockResolvedValue(true)) {
  const fetchVersions = vi.fn().mockResolvedValue(VERSIONS);
  const fetchVersion = vi.fn().mockResolvedValue(SNAPSHOT_V4);
  render(
    <PromptDocumentHistoryDialog
      open
      onOpenChange={vi.fn()}
      target={TARGET}
      currentBody="Step 3 — close the session, and emit the report."
      currentVersion={5}
      fetchVersions={fetchVersions}
      fetchVersion={fetchVersion}
      onRestoreVersion={onRestoreVersion}
    />
  );
  return { onRestoreVersion, fetchVersions, fetchVersion };
}

describe("PromptDocumentHistoryDialog restore", () => {
  /**
   * The confirmation must be ANSWERABLE, not merely present.
   *
   * Shipped, this dialog capped itself at 90vh with `overflow-hidden` while
   * stacking a header, a 65vh diff region, the confirmation and the action row
   * inside it. The confirmation rendered — and its Cancel/Restore buttons fell
   * off the bottom of a dialog that could not be scrolled. The operator could
   * read a question they had no way to answer, which is worse than the control
   * being absent, because absence is legible and this looked like a hang.
   *
   * **This test cannot see that.** jsdom has no layout engine: every element
   * here reports zero height, so the four behavioural tests around it all
   * passed against the broken build and always would. What it pins is the
   * structural invariant the fix rests on — the scrollable region is the one
   * that flexes, and the controls are the ones that do not — so a future edit
   * reintroducing a fixed-height clip has to delete an assertion that says why.
   * Verifying it is actually on screen needs a real viewport.
   */
  it("keeps the confirmation's controls out of the region that scrolls", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByTestId("restore-version"));

    // The dialog is a column whose overflow is delegated to a child...
    const dialog = screen.getByTestId("prompt-document-history");
    expect(dialog.className).toContain("flex-col");

    // ...that child being the diff, which absorbs the height pressure.
    const diff = screen.getByTestId("version-diff");
    expect(diff.className).toContain("flex-1");
    expect(diff.className).toContain("overflow-auto");
    // A fixed viewport-height cap here is what pushed the buttons off-screen.
    expect(diff.className).not.toMatch(/max-h-\[\d+vh\]/);

    // The confirmation never shrinks and never scrolls away.
    const confirm = screen.getByTestId("restore-version-confirm");
    expect(confirm.className).toContain("shrink-0");
    expect(
      screen.getByTestId("restore-version-confirm-button")
    ).toBeInTheDocument();
  });

  it("offers restore for a prior version once its diff is on screen", async () => {
    renderDialog();

    // The default selection is the newest NON-current version, so the diff the
    // operator is looking at is the one the restore would apply.
    await screen.findByTestId("version-diff");
    expect(await screen.findByTestId("restore-version")).toBeEnabled();
  });

  it("states that history is not rewritten, and defaults the change note", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByTestId("restore-version"));

    const confirm = await screen.findByTestId("restore-version-confirm");
    expect(confirm).toHaveTextContent(/ordinary edit, not a rewind/i);
    expect(confirm).toHaveTextContent(/new version/i);
    expect(confirm).toHaveTextContent(/Nothing is deleted/i);
    // The version being replaced is named as surviving — the specific fear.
    expect(confirm).toHaveTextContent(/version 5 stays in this history/i);

    expect(screen.getByTestId("restore-change-note")).toHaveValue(
      "Restored from version 4"
    );
  });

  it("restores the selected version with the note, and never asserts an editor", async () => {
    const user = userEvent.setup();
    const onRestoreVersion = vi.fn().mockResolvedValue(true);
    renderDialog(onRestoreVersion);

    await user.click(await screen.findByTestId("restore-version"));
    await user.click(screen.getByTestId("restore-version-confirm-button"));

    await waitFor(() =>
      expect(onRestoreVersion).toHaveBeenCalledWith(
        "policy",
        "session-protocol",
        4,
        "Restored from version 4"
      )
    );
    // Four positional args and no identity among them: coord stamps the editor
    // from its own authenticated context.
    expect(onRestoreVersion.mock.calls[0]).toHaveLength(4);
  });

  it("hides restore entirely when the caller wires no restore handler", async () => {
    render(
      <PromptDocumentHistoryDialog
        open
        onOpenChange={vi.fn()}
        target={TARGET}
        currentBody="body"
        currentVersion={5}
        fetchVersions={vi.fn().mockResolvedValue(VERSIONS)}
        fetchVersion={vi.fn().mockResolvedValue(SNAPSHOT_V4)}
      />
    );

    await screen.findByTestId("version-diff");
    expect(screen.queryByTestId("restore-version")).not.toBeInTheDocument();
  });
});

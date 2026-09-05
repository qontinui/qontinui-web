/**
 * `ResetToDefaultDialog` previews the body a reset RESTORES — Phase 6 of
 * `2026-08-31-runner-publishes-embedded-command-defaults` — and keeps the
 * honest "cannot be previewed" arm when the console holds no copy of it.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResetToDefaultDialog } from "./ResetToDefaultDialog";

function open(
  restores: Parameters<typeof ResetToDefaultDialog>[0]["restores"]
) {
  render(
    <ResetToDefaultDialog
      unitName="vet-plan"
      layer="account"
      fallsBackTo="the copy embedded in the runner binary (published by runner v0.4.12)"
      restores={restores}
      currentFiles={{ "vet-plan.md": "# mine\n" }}
      versionCount={2}
      busy={false}
      onConfirm={vi.fn()}
    />
  );
  fireEvent.click(screen.getByTestId("unit-delete-btn"));
}

describe("<ResetToDefaultDialog> preview", () => {
  it("shows the text sessions receive after the reset, labelled by the publishing runner", () => {
    open({
      label: "published by runner v0.4.12",
      files: { "vet-plan.md": "# vet-plan\nshipped line\n", "notes.md": "n" },
      entrypoint: "vet-plan.md",
    });
    const preview = screen.getByTestId("unit-delete-preview");
    expect(preview.textContent).toContain("published by runner v0.4.12");
    expect(preview.textContent).toContain("2 files");
    expect(screen.getByTestId("unit-delete-preview-body").textContent).toBe(
      "# vet-plan\nshipped line\n"
    );
    expect(screen.queryByTestId("unit-delete-preview-unavailable")).toBeNull();
  });

  it("keeps the honest arm when there is nothing to preview", () => {
    open(null);
    const arm = screen.getByTestId("unit-delete-preview-unavailable");
    expect(arm.textContent).toMatch(/cannot be previewed here/);
    expect(arm.textContent).toMatch(/no runner has published/);
    expect(screen.queryByTestId("unit-delete-preview")).toBeNull();
  });
});

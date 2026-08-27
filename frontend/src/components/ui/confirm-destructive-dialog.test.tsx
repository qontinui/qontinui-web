/**
 * Tests for <ConfirmDestructiveDialog>.
 *
 * What this pins, and why each matters:
 *
 * 1. **Type-to-confirm actually gates.** The confirm button must stay
 *    disabled until the exact phrase is typed — a near-miss (`acme-dev` for
 *    `acme-devs`) must NOT enable it. The whole reason the gate exists is
 *    that the operator has to have read the name.
 * 2. **The typed phrase resets between openings.** Otherwise the second
 *    delete of a session is a one-click delete, which is the failure the
 *    dialog was added to prevent.
 * 3. **No phrase → no gate.** Type-to-confirm is a real cost; a dialog that
 *    does not need it must not pay it.
 * 4. **Blast radius renders inside the dialog**, because "show it before the
 *    click" is the requirement, not "show it somewhere on the page".
 *
 * The confirm control is a `DestructiveButton`, whose synthetic-click gate is
 * covered by `destructive-button.test.tsx`. jsdom cannot produce a TRUSTED
 * click (`isTrusted` is non-configurable on real events), so the assertions
 * here are on the button's `disabled` state rather than on a click getting
 * through — the two layers are tested where each can be.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { ConfirmDestructiveDialog } from "./confirm-destructive-dialog";

const TEST_ID = "confirm-destructive-dialog";

function renderDialog(props: Record<string, unknown> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <ConfirmDestructiveDialog
      open
      onOpenChange={onOpenChange}
      title="Delete the group acme-devs?"
      description="This cannot be undone."
      onConfirm={onConfirm}
      {...props}
    />
  );
  return { ...utils, onConfirm, onOpenChange };
}

function confirmButton(): HTMLButtonElement {
  return screen.getByTestId(`${TEST_ID}-confirm`) as HTMLButtonElement;
}

describe("ConfirmDestructiveDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the title, description and blast radius", () => {
    renderDialog({
      children: <p>3 members lose this group.</p>,
    });

    expect(screen.getByText("Delete the group acme-devs?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    // The blast radius is INSIDE the dialog — visible at the moment of the
    // decision, not on some other panel the operator would have to go find.
    const blast = screen.getByTestId(`${TEST_ID}-blast-radius`);
    expect(blast).toHaveTextContent("3 members lose this group.");
  });

  it("keeps confirm disabled until the exact phrase is typed", async () => {
    const user = userEvent.setup();
    renderDialog({ confirmPhrase: "acme-devs" });

    expect(confirmButton()).toBeDisabled();

    const input = screen.getByTestId(`${TEST_ID}-phrase-input`);
    // A near-miss must NOT unlock it.
    await user.type(input, "acme-dev");
    expect(confirmButton()).toBeDisabled();

    await user.type(input, "s");
    expect(confirmButton()).toBeEnabled();
  });

  it("does not accept a case-folded or padded phrase", async () => {
    const user = userEvent.setup();
    renderDialog({ confirmPhrase: "acme-devs" });

    const input = screen.getByTestId(`${TEST_ID}-phrase-input`);
    await user.type(input, "ACME-DEVS");
    expect(confirmButton()).toBeDisabled();

    await user.clear(input);
    await user.type(input, " acme-devs");
    expect(confirmButton()).toBeDisabled();
  });

  it("clears the typed phrase when the dialog is reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog({ confirmPhrase: "acme-devs" });

    await user.type(screen.getByTestId(`${TEST_ID}-phrase-input`), "acme-devs");
    expect(confirmButton()).toBeEnabled();

    rerender(
      <ConfirmDestructiveDialog
        open={false}
        onOpenChange={vi.fn()}
        title="Delete the group acme-devs?"
        description="This cannot be undone."
        confirmPhrase="acme-devs"
        onConfirm={vi.fn()}
      />
    );
    rerender(
      <ConfirmDestructiveDialog
        open
        onOpenChange={vi.fn()}
        title="Delete the group acme-devs?"
        description="This cannot be undone."
        confirmPhrase="acme-devs"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByTestId(`${TEST_ID}-phrase-input`)).toHaveValue("");
    expect(confirmButton()).toBeDisabled();
  });

  it("needs no phrase when none is configured", () => {
    renderDialog();
    expect(screen.queryByTestId(`${TEST_ID}-phrase-input`)).toBeNull();
    expect(confirmButton()).toBeEnabled();
  });

  it("stays disabled while busy, and while the caller says so", async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog({
      confirmPhrase: "acme-devs",
      confirmDisabled: true,
    });

    await user.type(screen.getByTestId(`${TEST_ID}-phrase-input`), "acme-devs");
    // The phrase is satisfied — `confirmDisabled` must still win, because it
    // is what carries "you have not ticked the override yet".
    expect(confirmButton()).toBeDisabled();

    rerender(
      <ConfirmDestructiveDialog
        open
        onOpenChange={vi.fn()}
        title="t"
        description="d"
        busy
        onConfirm={vi.fn()}
      />
    );
    expect(confirmButton()).toBeDisabled();
  });

  it("renders the scoped override slot above the phrase field", () => {
    renderDialog({
      extra: <span data-testid="override-slot">I understand</span>,
    });
    expect(screen.getByTestId("override-slot")).toBeInTheDocument();
  });
});

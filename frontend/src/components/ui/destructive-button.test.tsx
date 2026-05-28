/**
 * Tests for <DestructiveButton> and its gate helper.
 *
 * Locks the property that a synthetic / UI-Bridge-issued click is blocked
 * while a real user click passes through. jsdom makes `event.isTrusted`
 * non-configurable on real Event instances, so the "trusted click is
 * forwarded" property is verified at the gate-function layer
 * (`isSyntheticClick`) rather than via dispatched events.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.4.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DestructiveButton, isSyntheticClick } from "./destructive-button";

vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
  },
}));

import { toast } from "sonner";

describe("isSyntheticClick", () => {
  it("returns true for an untrusted (synthetic / bridge-issued) event", () => {
    expect(isSyntheticClick({ isTrusted: false })).toBe(true);
  });

  it("returns false for a trusted (real-user) event", () => {
    expect(isSyntheticClick({ isTrusted: true })).toBe(false);
  });
});

describe("DestructiveButton", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("renders a destructive-styled button with the children", () => {
    render(<DestructiveButton>Delete</DestructiveButton>);
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toBeInTheDocument();
  });

  it("blocks a synthetic (jsdom / fireEvent) click and surfaces a toast", () => {
    // jsdom synthesizes click events with isTrusted=false — the same
    // shape UI Bridge produces via element.click() or a synthesized
    // MouseEvent. This is the security-critical path.
    const handleClick = vi.fn();
    render(
      <DestructiveButton onClick={handleClick}>Delete</DestructiveButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(handleClick).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      "Destructive actions require a real keystroke",
      expect.objectContaining({
        description: expect.stringContaining("programmatically"),
      }),
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("DestructiveButton");
  });

  it("does not throw when onClick is undefined and the gate fires", () => {
    // Defensive: a no-op DestructiveButton must not crash on the
    // blocked-synthetic path.
    expect(() =>
      render(<DestructiveButton>Delete</DestructiveButton>),
    ).not.toThrow();
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Delete" })),
    ).not.toThrow();
  });

  it("forwards Button props (disabled, data-*) to the underlying button", () => {
    render(
      <DestructiveButton disabled data-ui-bridge-id="test.delete">
        Delete
      </DestructiveButton>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-ui-bridge-id", "test.delete");
  });
});

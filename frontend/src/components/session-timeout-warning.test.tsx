/**
 * The session-expiry dialog in the presentation lens (plan
 * `2026-10-23-console-presentation-spaces` D3.2). It stays in presentation
 * mode — a session expiring mid-presentation must still be extendable, or
 * ended — so the decision's two buttons are the presenter's own safety
 * controls (`components/console/presenterSafety.ts`), and they are the only
 * controls the dialog shows.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(async () => true),
  logout: vi.fn(async () => undefined),
}));
vi.mock("@/services/service-factory", () => ({ authService: auth }));

import { PRESENTER_SAFETY_ATTRIBUTE } from "@/components/console/presenterSafety";
import { FixedPresentationMode } from "@/components/presentation/PresentationModeProvider";
import { findPresentationViolations } from "@/test/presentation";
import { SessionTimeoutWarning } from "./session-timeout-warning";

function warn() {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("session-expiring", { detail: { minutesRemaining: 3 } })
    );
  });
}

describe("<SessionTimeoutWarning> in the presentation lens", () => {
  it("shows only the decision's two buttons, each a listed safety control", async () => {
    render(
      <FixedPresentationMode presenting>
        <SessionTimeoutWarning />
      </FixedPresentationMode>
    );
    warn();
    expect(await screen.findByText("Session Expiring Soon")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Logout" })
        .getAttribute(PRESENTER_SAFETY_ATTRIBUTE)
    ).toBe("session-sign-out");
    expect(
      screen
        .getByRole("button", { name: "Continue Working" })
        .getAttribute(PRESENTER_SAFETY_ATTRIBUTE)
    ).toBe("session-continue");
    // No corner close: dismissing without a decision let the session lapse.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(
      findPresentationViolations({
        baseElement: document.body,
        uiBridge: {
          unobservable:
            "the dialog registers nothing with the UI Bridge; its controls are checked as DOM",
        },
      })
    ).toEqual([]);
  });

  it("is a decision: neither Escape nor an outside click dismisses it", async () => {
    render(
      <FixedPresentationMode presenting>
        <SessionTimeoutWarning />
      </FixedPresentationMode>
    );
    warn();
    const dialog = await screen.findByRole("dialog");
    // A reflex Escape mid-demo must not hide the prompt and let the session
    // lapse unannounced; only its two buttons decide.
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    fireEvent.pointerDown(document.body);
    await act(async () => {});
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Session Expiring Soon")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue Working" })
    ).toBeTruthy();
  });

  it("keeps the presenter signed in from Continue Working", async () => {
    render(<SessionTimeoutWarning />);
    warn();
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue Working" })
    );
    await act(async () => {});
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Session Expiring Soon")).toBeNull();
  });
});

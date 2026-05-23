import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StealModal } from "./StealModal";
import type { SessionRow } from "./types";
import * as api from "./api";

/**
 * StealModal — Phase 6 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Covers:
 *   - Submit is disabled below 10 chars and enabled at >= 10
 *   - The counter copy shows chars remaining
 *   - On submit it calls api.stealSession with the typed reason +
 *     the dashboard's per-tab machine_id
 *   - Success closes the modal and fires onSucceeded
 *   - Errors surface inline
 */

function mockSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    tenant_id: "tenant-1",
    device_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    session_kind: "agentic",
    intent: { purpose: "holder session" },
    state: "active",
    started_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
    closed_at: null,
    parent_session_id: null,
    repo: null,
    branch: null,
    ...overrides,
  };
}

describe("StealModal", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disables Steal until the reason hits 10 chars", async () => {
    const user = userEvent.setup();
    render(<StealModal open onOpenChange={() => {}} session={mockSession()} />);

    const submit = screen.getByRole("button", { name: /steal claim/i });
    expect(submit).toBeDisabled();

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "too short");
    expect(submit).toBeDisabled();

    // 1 more char to reach 10 ("too short!").
    await user.type(textarea, "!");
    expect(submit).not.toBeDisabled();
  });

  it("shows the chars-remaining counter copy and switches to ready", async () => {
    const user = userEvent.setup();
    render(<StealModal open onOpenChange={() => {}} session={mockSession()} />);

    const counter = document.querySelector(
      "[data-ui-bridge-id='steal-modal.reason-counter']"
    )!;
    expect(counter.textContent).toMatch(/0 chars/);
    expect(counter.textContent).toMatch(/10 more needed/);
    expect(counter.getAttribute("data-chars-ok")).toBe("false");

    await user.type(screen.getByRole("textbox"), "1234567890");
    await waitFor(() => {
      expect(counter.getAttribute("data-chars-ok")).toBe("true");
    });
    expect(counter.textContent).toMatch(/ready to steal/);
  });

  it("calls api.stealSession with reason + dashboard machine_id", async () => {
    const user = userEvent.setup();
    const stealSpy = vi
      .spyOn(api, "stealSession")
      .mockResolvedValue({ ok: true });
    const onSucceeded = vi.fn();
    const onOpenChange = vi.fn();
    const session = mockSession();
    render(
      <StealModal
        open
        onOpenChange={onOpenChange}
        session={session}
        onSucceeded={onSucceeded}
      />
    );

    await user.type(
      screen.getByRole("textbox"),
      "needs the branch for the deploy hotfix"
    );
    fireEvent.click(screen.getByRole("button", { name: /steal claim/i }));

    await waitFor(() => {
      expect(stealSpy).toHaveBeenCalledTimes(1);
    });
    const [calledId, body] = stealSpy.mock.calls[0]!;
    expect(calledId).toBe(session.id);
    expect(body.reason).toBe("needs the branch for the deploy hotfix");
    expect(body.machine_id).toMatch(/^[0-9a-f-]{36}$/i);

    await waitFor(() => {
      expect(onSucceeded).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("surfaces a server error inline without closing", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "stealSession").mockRejectedValue(
      new Error("HTTP 422: reason too short")
    );
    const onOpenChange = vi.fn();
    render(
      <StealModal open onOpenChange={onOpenChange} session={mockSession()} />
    );

    await user.type(
      screen.getByRole("textbox"),
      "abcdefghij" // 10 chars — passes client gate
    );
    fireEvent.click(screen.getByRole("button", { name: /steal claim/i }));

    let errorBanner: Element | null = null;
    await waitFor(() => {
      errorBanner = document.querySelector(
        "[data-ui-bridge-id='steal-modal.error']"
      );
      expect(errorBanner).not.toBeNull();
    });
    expect(errorBanner!.textContent).toContain("reason too short");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

/**
 * Component test for CanonicalHistoryPanel.
 *
 * `canonical-history.test.ts` covers the pure label ladder; this covers the
 * states the panel itself owns, which is where the audit trail can lie:
 *
 *   1. empty history  → the explicit "nothing recorded yet" note, NOT an error
 *      and NOT a spinner (an empty audit is the correct state until the next
 *      designation)
 *   2. rows           → newest-first summary, from → to, actor, and the note
 *      (the "why", which had no writer until this follow-up)
 *   3. error          → inline message + a Retry that actually refetches
 *   4. full page      → offers "Load older changes" and appends the next page,
 *      rather than presenting a truncated audit as the whole history
 *   5. refreshKey     → a bump refetches, so a designation you just made shows
 *      up without a reload — without flashing the list back to a spinner
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CanonicalChange } from "@/services/devenv-api";

const getCanonicalHistory = vi.fn();

// The error class is defined INSIDE the factory: `vi.mock` is hoisted above
// this file's declarations, so a class referenced by identifier would be in
// its TDZ when the factory runs. Tests re-import it from the mocked module.
vi.mock("@/services/devenv-api", () => {
  class DevenvApiError extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message);
    }
  }
  return {
    getCanonicalHistory: (...args: unknown[]) => getCanonicalHistory(...args),
    CANONICAL_HISTORY_PAGE_SIZE: 50,
    DevenvApiError,
  };
});

import {
  CANONICAL_HISTORY_PAGE_SIZE,
  DevenvApiError,
} from "@/services/devenv-api";
import { CanonicalHistoryPanel } from "./CanonicalHistoryPanel";

function change(over: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    environment_id: "env-1",
    from_machine_id: null,
    to_machine_id: "22222222-2222-2222-2222-222222222222",
    changed_by_user_id: "33333333-3333-3333-3333-333333333333",
    tenant_id: null,
    note: null,
    changed_at: "2026-07-19T12:00:00Z",
    changed_by_email: "josh@qontinui.io",
    from_machine_name: null,
    to_machine_name: "monster",
    ...over,
  };
}

describe("CanonicalHistoryPanel", () => {
  beforeEach(() => {
    getCanonicalHistory.mockReset();
  });

  it("renders an explicit empty state, not an error", async () => {
    getCanonicalHistory.mockResolvedValue([]);
    render(<CanonicalHistoryPanel environmentId="env-1" />);

    expect(
      await screen.findByText(/No canonical changes recorded yet/i)
    ).toBeInTheDocument();
    expect(getCanonicalHistory).toHaveBeenCalledWith("env-1");
  });

  it("renders the latest change, the transition, the actor and the note", async () => {
    getCanonicalHistory.mockResolvedValue([
      change({
        from_machine_id: "44444444-4444-4444-4444-444444444444",
        from_machine_name: "laptop",
        note: "rebuilt from current lockfiles",
      }),
    ]);
    render(<CanonicalHistoryPanel environmentId="env-1" />);

    expect(
      await screen.findByText(/Canonical set to monster by josh@qontinui\.io/i)
    ).toBeInTheDocument();
    expect(screen.getByText("laptop")).toBeInTheDocument();
    expect(screen.getByText("monster")).toBeInTheDocument();
    // The "why" — rendered since #810, writable only as of this follow-up.
    expect(
      screen.getByText("rebuilt from current lockfiles")
    ).toBeInTheDocument();
  });

  it("marks a first designation as initial rather than a deletion", async () => {
    getCanonicalHistory.mockResolvedValue([change()]);
    render(<CanonicalHistoryPanel environmentId="env-1" />);

    expect(await screen.findByText("initial")).toBeInTheDocument();
    // No "deleted machine (…)" hint: the from side was genuinely absent.
    expect(screen.queryByText(/deleted machine/i)).not.toBeInTheDocument();
  });

  it("shows an inline error with a Retry that refetches", async () => {
    getCanonicalHistory
      .mockRejectedValueOnce(new DevenvApiError(500, "boom"))
      .mockResolvedValueOnce([change()]);
    render(<CanonicalHistoryPanel environmentId="env-1" />);

    expect(await screen.findByText("boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(
      await screen.findByText(/Canonical set to monster/i)
    ).toBeInTheDocument();
    expect(getCanonicalHistory).toHaveBeenCalledTimes(2);
  });

  it("offers and appends an older page when the first comes back full", async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => change({ id: `id-${from + i}` }));
    getCanonicalHistory
      .mockResolvedValueOnce(page(0, CANONICAL_HISTORY_PAGE_SIZE))
      .mockResolvedValueOnce(page(CANONICAL_HISTORY_PAGE_SIZE, 2));
    render(<CanonicalHistoryPanel environmentId="env-1" />);

    // The affordance lives in the expanded list — the collapsed view shows
    // only the newest few and its own "show older" toggle.
    await userEvent.click(
      await screen.findByRole("button", { name: /show \d+ older changes/i })
    );
    await userEvent.click(
      screen.getByRole("button", { name: /load older changes/i })
    );

    // Second page requested by offset, then appended.
    await waitFor(() =>
      expect(getCanonicalHistory).toHaveBeenLastCalledWith(
        "env-1",
        CANONICAL_HISTORY_PAGE_SIZE,
        CANONICAL_HISTORY_PAGE_SIZE
      )
    );
    await waitFor(() =>
      expect(screen.getAllByText("monster")).toHaveLength(
        CANONICAL_HISTORY_PAGE_SIZE + 2
      )
    );
    // A short second page means we reached the end — the offer is withdrawn.
    expect(
      screen.queryByRole("button", { name: /load older changes/i })
    ).not.toBeInTheDocument();
  });

  it("offers no older page when the first is partial", async () => {
    getCanonicalHistory.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => change({ id: `id-${i}` }))
    );
    render(<CanonicalHistoryPanel environmentId="env-1" />);

    await userEvent.click(
      await screen.findByRole("button", { name: /show \d+ older changes/i })
    );
    expect(
      screen.queryByRole("button", { name: /load older changes/i })
    ).not.toBeInTheDocument();
  });

  it("refetches when refreshKey changes", async () => {
    getCanonicalHistory.mockResolvedValue([change()]);
    const { rerender } = render(
      <CanonicalHistoryPanel environmentId="env-1" refreshKey={0} />
    );
    await screen.findByText(/Canonical set to monster/i);

    rerender(<CanonicalHistoryPanel environmentId="env-1" refreshKey={1} />);
    await waitFor(() => expect(getCanonicalHistory).toHaveBeenCalledTimes(2));
  });
});

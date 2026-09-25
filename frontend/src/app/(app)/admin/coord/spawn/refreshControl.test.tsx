/**
 * The `/spawn` refresh control names itself and acknowledges a click — and
 * ONLY a click.
 *
 * `/spawn`'s own refresh button was explicitly left unchanged by PR #1349
 * ("its own refresh button is not changed") even though the page shares
 * `derivePlansHealth`, `fetchData`'s question/lock machinery, and
 * `filterWindowReset.test.tsx` coverage with `/plans` — it had the exact same
 * F1 defect (plan
 * `2026-09-09-coord-plans-page-controls-do-not-acknowledge-or-name-themselves`):
 * an icon with no accessible name, no title, no pending state, and a click
 * that bypassed `pollInFlight` entirely.
 *
 * Mirrors `../plans/refreshControl.test.tsx` — same fix, same shape, applied
 * to the sibling page that was left out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordSpawnPage from "./page";

const POLL_INTERVAL_MS = 15_000;

/** A read the test settles by hand. */
function deferred() {
  let resolve!: (body: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function refreshButton() {
  return screen.getByTestId("coord-spawn-refresh");
}

beforeEach(() => {
  get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/admin/coord/spawn refresh control", () => {
  it("has an accessible name, and a title that names its effect", async () => {
    get.mockResolvedValue({ work_units: [] });
    render(<CoordSpawnPage />);

    const button = await screen.findByRole("button", { name: "Refresh plans" });
    expect(button).toBe(refreshButton());
    expect(button).toHaveAttribute(
      "title",
      "Re-reads the plan list now; it also refreshes itself every 15 s"
    );
    const icon = button.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("acknowledges a click for exactly as long as the read it issued is out", async () => {
    const clickRead = deferred();
    let call = 0;
    get.mockImplementation(() => {
      call += 1;
      return call === 1 ? Promise.resolve({ work_units: [] }) : clickRead.promise;
    });
    const user = userEvent.setup();
    render(<CoordSpawnPage />);
    await screen.findByTestId("coord-spawn-plans-empty");

    expect(refreshButton()).not.toHaveAttribute("aria-busy", "true");
    await user.click(refreshButton());

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(refreshButton()).toHaveAttribute("aria-busy", "true");
    expect(refreshButton()).toHaveAttribute("aria-disabled", "true");

    // A second press while the first is out issues nothing.
    await user.click(refreshButton());
    expect(get).toHaveBeenCalledTimes(2);

    await act(async () => {
      clickRead.resolve({ work_units: [] });
    });
    await waitFor(() =>
      expect(refreshButton()).not.toHaveAttribute("aria-busy", "true")
    );
    expect(refreshButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("does not acknowledge a background poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pollRead = deferred();
    let call = 0;
    get.mockImplementation(() => {
      call += 1;
      return call === 1 ? Promise.resolve({ work_units: [] }) : pollRead.promise;
    });
    render(<CoordSpawnPage />);
    await screen.findByTestId("coord-spawn-plans-empty");

    // One tick: the poll issues a read through the same `fetchData`.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(get).toHaveBeenCalledTimes(2);

    // That read is out, and the control says nothing about it.
    expect(refreshButton()).not.toHaveAttribute("aria-busy", "true");
    expect(refreshButton()).not.toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      pollRead.resolve({ work_units: [] });
    });
  });

  it("holds the poll lock while its read is out, so a tick cannot stack on it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const clickRead = deferred();
    let call = 0;
    get.mockImplementation(() => {
      call += 1;
      return call === 1 ? Promise.resolve({ work_units: [] }) : clickRead.promise;
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CoordSpawnPage />);
    await screen.findByTestId("coord-spawn-plans-empty");

    await user.click(refreshButton());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    // Two ticks pass while the manual read is still out: neither may issue a
    // concurrent read of the same question.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 2);
    });
    expect(get).toHaveBeenCalledTimes(2);

    // Once it lands the lock is released and polling resumes.
    await act(async () => {
      clickRead.resolve({ work_units: [] });
    });
    get.mockResolvedValue({ work_units: [] });
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(get).toHaveBeenCalledTimes(3);
  });
});

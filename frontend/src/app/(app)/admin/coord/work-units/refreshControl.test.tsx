/**
 * The `/plans` refresh control names itself and acknowledges a click — and
 * ONLY a click.
 *
 * F1 of plan `2026-09-09-coord-plans-page-controls-do-not-acknowledge-or-name-themselves`:
 * the control was an icon with no accessible name, no title and no pending
 * state, so to a screen reader it was an unnamed button and to a sighted
 * operator a click "didn't seem to do anything".
 *
 * The trap the plan names, pinned here: the 10s poll calls the same
 * `fetchData`, so an acknowledgement driven off a shared in-flight flag would
 * pulse on its own every ten seconds. The pending state must belong to the
 * click, and a background poll must never reach it.
 *
 * The refresh-during-a-read overlap itself (a click while a poll or the first
 * read is still out) stays reachable and is pinned as GUARDED by
 * `filterWindowReset.test.tsx`; this file pins only that a tick cannot stack on
 * top of a manual read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/work-units",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// The page's SECOND read — the plan library's difficulty ratings — goes
// through its own hook and would otherwise count against the `get` spy this
// file asserts on. What is under test here is the work-unit read, so the
// ratings stay pending; `usePlanDifficulty` has its own coverage.
vi.mock("./usePlanDifficulty", () => ({
  usePlanDifficulty: () => ({
    index: { state: "pending" },
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordWorkUnitsListPage from "./page";

const POLL_INTERVAL_MS = 10_000;

/** A read the test settles by hand. */
function deferred() {
  let resolve!: (body: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function refreshButton() {
  return screen.getByTestId("coord-work-units-refresh");
}

beforeEach(() => {
  get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/admin/coord/work-units refresh control", () => {
  it("has an accessible name, and a title that names its effect", async () => {
    get.mockResolvedValue({ work_units: [] });
    render(<CoordWorkUnitsListPage />);

    const button = await screen.findByRole("button", {
      name: "Refresh work units",
    });
    expect(button).toBe(refreshButton());
    expect(button).toHaveAttribute(
      "title",
      "Re-reads the work-unit list now; it also refreshes itself every 10 s"
    );
    // The icon is decoration; the name is the label, not an SVG. (lucide-react
    // currently stamps aria-hidden on a bare icon by itself, so this is a guard
    // against that default changing rather than a pin on RefreshButton's own
    // prop — the name assertion above is the load-bearing one.)
    const icon = button.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon?.querySelector("title")).toBeNull();
  });

  it("acknowledges a click for exactly as long as the read it issued is out", async () => {
    const clickRead = deferred();
    let call = 0;
    get.mockImplementation(() => {
      call += 1;
      return call === 1
        ? Promise.resolve({ work_units: [] })
        : clickRead.promise;
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);
    await screen.findByTestId("coord-work-units-empty");

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
      return call === 1
        ? Promise.resolve({ work_units: [] })
        : pollRead.promise;
    });
    render(<CoordWorkUnitsListPage />);
    await screen.findByTestId("coord-work-units-empty");

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
      return call === 1
        ? Promise.resolve({ work_units: [] })
        : clickRead.promise;
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CoordWorkUnitsListPage />);
    await screen.findByTestId("coord-work-units-empty");

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

  it("does not free a lock it did not take: a click during the first read", async () => {
    // The click finds the first read holding the lock, so it issues its own
    // read WITHOUT taking the lock. When that click read lands first, it must
    // leave the lock with the first read — or the next tick stacks a third
    // concurrent read of the same question.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const firstRead = deferred();
    const clickRead = deferred();
    let call = 0;
    get.mockImplementation(() => {
      call += 1;
      if (call === 1) return firstRead.promise;
      if (call === 2) return clickRead.promise;
      return Promise.resolve({ work_units: [] });
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CoordWorkUnitsListPage />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    await user.click(refreshButton());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await act(async () => {
      clickRead.resolve({ work_units: [] });
    });

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    // The first read is still out and still holds the lock.
    expect(get).toHaveBeenCalledTimes(2);

    await act(async () => {
      firstRead.resolve({ work_units: [] });
    });
  });

  it("does not free the NEW question's lock when its read outlives a filter change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const clickRead = deferred();
    const switchedRead = deferred();
    let call = 0;
    get.mockImplementation((url: string) => {
      call += 1;
      if (url.includes("status=blocked")) return switchedRead.promise;
      if (call === 1) return Promise.resolve({ work_units: [] });
      return clickRead.promise;
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CoordWorkUnitsListPage />);
    await screen.findByTestId("coord-work-units-empty");

    // The click takes the free lock; its read stays out.
    await user.click(refreshButton());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    // The operator changes the filter: the new question's first read takes
    // the lock and stays out too.
    await user.click(screen.getByTestId("coord-work-units-status-select"));
    await user.click(await screen.findByRole("option", { name: "Blocked" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));

    // The superseded click read lands. It belongs to the old question, so it
    // must not release the lock the new question's read holds.
    await act(async () => {
      clickRead.resolve({ work_units: [] });
    });
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(get).toHaveBeenCalledTimes(3);

    await act(async () => {
      switchedRead.resolve({ work_units: [] });
    });
  });

  it("does not stay busy on the new question over a press the filter change superseded", async () => {
    const clickRead = deferred();
    const switchedRead = deferred();
    let call = 0;
    get.mockImplementation((url: string) => {
      call += 1;
      if (url.includes("status=blocked")) return switchedRead.promise;
      if (call === 1) return Promise.resolve({ work_units: [] });
      return clickRead.promise;
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);
    await screen.findByTestId("coord-work-units-empty");

    await user.click(refreshButton());
    await waitFor(() =>
      expect(refreshButton()).toHaveAttribute("aria-busy", "true")
    );

    // The question changes while that press's read is still out. Its answer
    // will be discarded, so the control must not keep acknowledging it.
    await user.click(screen.getByTestId("coord-work-units-status-select"));
    await user.click(await screen.findByRole("option", { name: "Blocked" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));

    expect(refreshButton()).not.toHaveAttribute("aria-busy", "true");
    expect(refreshButton()).not.toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      clickRead.resolve({ work_units: [] });
      switchedRead.resolve({ work_units: [] });
    });
  });
});

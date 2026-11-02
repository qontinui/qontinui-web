/**
 * `FleetWorktreeSlotsSection` in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` Phase 7): an occupant reads as a
 * descriptor whose age keeps advancing.
 *
 * The occupant's age is coord's `age_secs` AS OF the read's answer. While the
 * read keeps failing, the page keeps showing that answer's rows (marked
 * last-known) and re-renders every 15 s on its clock; each re-render must age
 * the descriptor from the ANSWER, or the occupant reads "2m ago" for as long
 * as the outage lasts — the frozen age `presentationClock.ts` exists to rule
 * out.
 */

import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInPresentationMode } from "@/test/presentation";
import { FleetWorktreeSlotsSection } from "./FleetWorktreeSlotsSection";
import type {
  UseFleetWorktreeSlotsResult,
  WorktreeSlotsResponse,
} from "./useFleetWorktreeSlots";

const T0 = Date.parse("2026-10-27T12:00:00Z");
const DEVICE = "a1a1a1a1-0000-4000-8000-00000000000a";

const DATA: WorktreeSlotsResponse = {
  tenant_id: "t-1",
  device_count: 1,
  truncated: false,
  device_cap: 100,
  census_window_secs: 900,
  devices: [
    {
      device_id: DEVICE,
      hostname: "hostname-alpha-7731",
      active_worktrees: 1,
      max_worktrees: 16,
      census_recent_rows: 1,
      occupants: {
        shown: 1,
        total: 1,
        truncated: false,
        rows: [
          {
            // Two minutes old when the read answered.
            repo: "other-owner/private-repo",
            worktree_path: "agent-worktrees/aaaa/private-repo",
            age_secs: 120,
            building: false,
          },
        ],
      },
    },
  ],
};

function slots(
  over: Partial<UseFleetWorktreeSlotsResult> = {}
): UseFleetWorktreeSlotsResult {
  return {
    data: DATA,
    loading: false,
    error: null,
    // The read answered at T0; nothing newer arrives in these tests.
    fetchedAtMs: T0,
    refresh: vi.fn(async () => {}),
    ...over,
  };
}

/** The presented occupant's descriptor text. */
function occupantDescriptor(): string {
  const descriptor = document.querySelector(
    '[data-testid="worktree-slots-occupants-disclosure"] [data-redacted="true"]'
  );
  if (!descriptor) throw new Error("no presented occupant descriptor");
  return descriptor.textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FleetWorktreeSlotsSection?present=1 — an occupant's age", () => {
  it("keeps advancing from the read's answer while no new answer arrives", () => {
    const devices = [{ device_id: DEVICE }];
    const view = renderInPresentationMode(
      <FleetWorktreeSlotsSection devices={devices} slots={slots()} />
    );
    fireEvent.click(
      screen
        .getByTestId("worktree-slots-occupants-disclosure")
        .querySelector("button[aria-expanded]") as HTMLElement
    );
    expect(occupantDescriptor()).toMatch(/\b2m ago\b/);

    // Ten minutes on, the read failing all along: the section shows the same
    // answer, re-rendered by the page's clock.
    vi.advanceTimersByTime(10 * 60_000);
    view.rerender(
      <FleetWorktreeSlotsSection
        devices={devices}
        slots={slots({ error: "coord read deadline exceeded — unknown" })}
      />
    );
    expect(screen.getByTestId("fleet-worktree-slots-error")).toBeTruthy();
    expect(occupantDescriptor()).toMatch(/\b12m ago\b/);
  });

  it("states no age at all when no answer is dated", () => {
    renderInPresentationMode(
      <FleetWorktreeSlotsSection
        devices={[{ device_id: DEVICE }]}
        slots={slots({ fetchedAtMs: null })}
      />
    );
    fireEvent.click(
      screen
        .getByTestId("worktree-slots-occupants-disclosure")
        .querySelector("button[aria-expanded]") as HTMLElement
    );
    expect(occupantDescriptor()).toMatch(/age unknown/);
  });
});

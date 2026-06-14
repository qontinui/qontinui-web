import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveRow, stateVariant } from "./MigrationQueueTile";
import type { MigrationReservation } from "./types";

/**
 * MigrationQueueTile — the live-row queue position.
 *
 * The tile exists to surface coord's 1-based `position` (the field the live
 * smoke found serializing as null before PR #533 populated it). The row leads
 * with the position; it prefers the server value and falls back to the list
 * index for older coord deploys that predate the field.
 */

function reservation(
  overrides: Partial<MigrationReservation> = {}
): MigrationReservation {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    repo: "qontinui/qontinui-web",
    revision: "abc123def4567890",
    down_revision: "root0000",
    state: "queued",
    pr_number: null,
    pr_url: null,
    requested_by_session: "agent-7",
    authoring_deadline: "2026-06-11T10:45:00Z",
    created_at: "2026-06-11T10:00:00Z",
    bound_at: null,
    merged_at: null,
    terminated_at: null,
    terminal_reason: null,
    position: 1,
    ...overrides,
  };
}

function renderRow(res: MigrationReservation, fallbackPosition: number) {
  return render(
    <TooltipProvider>
      <ul>
        <LiveRow res={res} fallbackPosition={fallbackPosition} />
      </ul>
    </TooltipProvider>
  );
}

describe("MigrationQueueTile LiveRow", () => {
  it("renders the server-supplied position", () => {
    const { container, getByText } = renderRow(
      reservation({ position: 3 }),
      99
    );
    const row = container.querySelector(
      "[data-ui-bridge-id='operations.migration-queue-live-row']"
    );
    expect(row?.getAttribute("data-position")).toBe("3");
    // The position chip is visible (prefers the server value, not the fallback).
    expect(getByText("#3")).toBeTruthy();
  });

  it("falls back to the list index when position is absent (older coord)", () => {
    const { getByText } = renderRow(reservation({ position: undefined }), 2);
    expect(getByText("#2")).toBeTruthy();
  });

  it("renders a PR link when the reservation is bound to a PR", () => {
    const { container } = renderRow(
      reservation({
        state: "pr_bound",
        pr_number: 533,
        pr_url: "https://github.com/qontinui/qontinui-web/pull/533",
      }),
      1
    );
    const link = container.querySelector(
      "[data-ui-bridge-id='operations.migration-queue-pr-link']"
    );
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(
      "https://github.com/qontinui/qontinui-web/pull/533"
    );
  });

  it("renders the state chip with the reservation state", () => {
    const { container } = renderRow(reservation({ state: "queued" }), 1);
    const stateChip = container.querySelector(
      "[data-ui-bridge-id='operations.migration-queue-state']"
    );
    expect(stateChip?.textContent).toContain("queued");
  });
});

describe("stateVariant", () => {
  it("maps known lifecycle states to distinct variants", () => {
    expect(stateVariant("merged")).toBe("success");
    expect(stateVariant("pr_bound")).toBe("info");
    expect(stateVariant("expired")).toBe("warning");
    expect(stateVariant("queued")).toBe("secondary");
    expect(stateVariant("withdrawn")).toBe("outline");
  });

  it("falls back to a neutral outline for an unknown/future state", () => {
    expect(stateVariant("some_future_state")).toBe("outline");
  });
});

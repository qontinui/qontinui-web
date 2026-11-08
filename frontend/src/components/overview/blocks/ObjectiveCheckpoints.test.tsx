/**
 * `objective-checkpoints` in a document (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3,
 * D9): "not available yet" ONLY for a 404 — a backend that predates the
 * objectives read — and "can't be read right now" for every other failure;
 * when the read serves, the measure's checkpoints with their tallies.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchObjectives: vi.fn(),
  fetchPageBacklinks: vi.fn(async () => []),
}));
vi.mock("@/app/(app)/overview/_hooks/useOverviewProject", () => ({
  useOverviewProject: () => ({
    projectId: "p1",
    hold: false,
    tenantsError: null,
    viewerId: "u1",
  }),
}));
vi.mock("@/components/overview/editing/api", async (original) => ({
  ...(await original<object>()),
  ...mocks,
}));

import { ResourceError } from "@/components/overview/editing/api";
import { InPageBody, fence } from "./__fixtures__/render";

const BLOCK = fence("objective-checkpoints", "metric: review-scorecard");

const NOT_AVAILABLE = "Checkpoint results are not available yet";
const CANT_READ = "Checkpoint results can't be read right now.";

function objectives(over: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-11-08T09:00:00Z",
    document_list_complete: true,
    metrics: [
      {
        name: "review-scorecard",
        title: "Review scorecard",
        checkpoint_results: [
          {
            id: "cp1",
            label: "Checkpoint 1",
            due: "2026-10-29",
            status_reason: null,
            tally: { met: 2, missed: 1, unknown: 1 },
          },
          {
            id: "cp2",
            label: null,
            due: null,
            status_reason: "Not measured yet: it is due later.",
            tally: { met: 0, missed: 0, unknown: 4 },
          },
        ],
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  mocks.fetchObjectives.mockReset();
});

describe("objective-checkpoints when the read fails", () => {
  it("says 'not available yet' for a 404, from a backend that predates the read", async () => {
    mocks.fetchObjectives.mockRejectedValue(
      new ResourceError(404, null, "Not Found")
    );
    render(<InPageBody body={BLOCK} />);
    expect(await screen.findByText(NOT_AVAILABLE)).toBeTruthy();
    expect(screen.queryByText(CANT_READ)).toBeNull();
  });

  it.each([
    ["a server error", () => new ResourceError(500, null, "boom")],
    ["a refusal", () => new ResourceError(403, null, "no")],
    ["a dropped connection", () => new Error("Failed to fetch")],
  ])(
    "says 'can't be read right now' for %s — never 'not available yet'",
    async (_what, error) => {
      mocks.fetchObjectives.mockRejectedValue(error());
      render(<InPageBody body={BLOCK} />);
      expect(await screen.findByText(CANT_READ)).toBeTruthy();
      expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
    }
  );

  it("says 'can't be read right now' for an answer it cannot read", async () => {
    mocks.fetchObjectives.mockResolvedValue({ metrics: "not a list" });
    render(<InPageBody body={BLOCK} />);
    expect(await screen.findByText(CANT_READ)).toBeTruthy();
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
  });
});

describe("objective-checkpoints when the read serves", () => {
  it("shows each checkpoint with its due date and tally, and the read's source and as-of", async () => {
    mocks.fetchObjectives.mockResolvedValue(objectives());
    render(<InPageBody body={BLOCK} />);
    expect(
      await screen.findByText("Review scorecard: checkpoints")
    ).toBeTruthy();
    const one = document.querySelector(
      '[data-ui-bridge-id="overview.block.objective-checkpoints.review-scorecard.checkpoint.cp1"]'
    )!;
    expect(one.textContent).toBe(
      "Checkpoint 1due 29 Oct 20262 met, 1 missed, 1 not measured"
    );
    const two = document.querySelector(
      '[data-ui-bridge-id="overview.block.objective-checkpoints.review-scorecard.checkpoint.cp2"]'
    )!;
    expect(two.textContent).toMatch(
      /^cp2no due date given0 met, 0 missed, 4 not measured/
    );
    expect(two.textContent).toMatch(/Not measured yet: it is due later\./);
    const block = document.querySelector(
      '[data-overview-block="objective-checkpoints"]'
    )!;
    expect(block.querySelector("[data-provenance]")?.textContent).toMatch(
      /^source: the project's success measures · as of /
    );
  });

  it("says there is no such measure only when the read's list is complete", async () => {
    mocks.fetchObjectives.mockResolvedValue(objectives({ metrics: [] }));
    render(<InPageBody body={BLOCK} />);
    expect(await screen.findByText(/No measure named/)).toBeTruthy();
    expect(screen.getByText(/in this project/)).toBeTruthy();
  });

  it("says a measure the read did not return may still exist when its list is incomplete", async () => {
    mocks.fetchObjectives.mockResolvedValue(
      objectives({ metrics: [], document_list_complete: false })
    );
    render(<InPageBody body={BLOCK} />);
    expect(await screen.findByText(/may be incomplete right now/)).toBeTruthy();
    expect(screen.queryByText(/in this project/)).toBeNull();
  });
});

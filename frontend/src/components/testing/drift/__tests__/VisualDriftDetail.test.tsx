/**
 * VisualDriftDetail tests.
 *
 * The component delegates the actual side-by-side / overlay rendering to
 * the existing `VisualDiffViewer`. We mock the viewer to a sentinel that
 * captures props, so the test asserts the adapter mapping
 * `VisualDriftEntryView -> VisualDiffViewer props` and `DriftEntry.diffRegion ->
 * DiffRegion[]` is correct.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  VisualDriftDetail,
  adaptVisualDriftToRegions,
} from "../VisualDriftDetail";
import type { VisualDriftEntryView } from "../drift-api";

const visualDiffViewerProps = vi.fn();

vi.mock("@/components/testing/visual-regression", () => ({
  VisualDiffViewer: (props: Record<string, unknown>) => {
    visualDiffViewerProps(props);
    return (
      <div
        data-testid="visual-diff-viewer"
        data-baseline-url={String(props.baselineUrl ?? "")}
        data-screenshot-url={String(props.screenshotUrl ?? "")}
        data-diff-url={String(props.diffUrl ?? "")}
      />
    );
  },
}));

const SAMPLE: VisualDriftEntryView = {
  id: "header-logo",
  kind: "visual-drift",
  detail: "visual drift on header-logo: 8.3% pixels (831px) differ from baseline",
  diffPercentage: 8.3,
  diffPixelCount: 831,
  totalPixels: 10_012,
  diffRegion: { x: 10, y: 20, width: 100, height: 50 },
  baselineKey: "baseline/header-logo",
  baselineUrl: "https://cdn.example.com/baseline.png",
  screenshotUrl: "https://cdn.example.com/screenshot.png",
  diffUrl: "https://cdn.example.com/diff.png",
  threshold: 0.95,
};

describe("VisualDriftDetail", () => {
  it("mounts the VisualDiffViewer with mapped props", () => {
    render(<VisualDriftDetail runId="run-1" entry={SAMPLE} />);

    expect(screen.getByTestId("visual-diff-viewer")).toBeInTheDocument();

    const last = visualDiffViewerProps.mock.calls.at(-1)![0];
    expect(last).toMatchObject({
      baselineUrl: "https://cdn.example.com/baseline.png",
      screenshotUrl: "https://cdn.example.com/screenshot.png",
      diffUrl: "https://cdn.example.com/diff.png",
      threshold: 0.95,
    });
    // similarityScore is 1 - (diffPercentage / 100), clamped to [0, 1]
    expect(last.similarityScore).toBeCloseTo(1 - 8.3 / 100, 5);
  });

  it("renders summary stats from the drift entry", () => {
    render(<VisualDriftDetail runId="run-1" entry={SAMPLE} />);

    // 8.3% rounded to one decimal
    expect(screen.getByText("8.3%")).toBeInTheDocument();
    // pixel counts formatted with the test environment's locale separators
    expect(screen.getByText((831).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText((10_012).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText("baseline/header-logo")).toBeInTheDocument();
  });

  it("passes nullable image URLs through as null", () => {
    render(
      <VisualDriftDetail
        runId="run-1"
        entry={{
          ...SAMPLE,
          baselineUrl: undefined,
          screenshotUrl: null,
          diffUrl: undefined,
        }}
      />,
    );
    const last = visualDiffViewerProps.mock.calls.at(-1)![0];
    expect(last.baselineUrl).toBeNull();
    expect(last.screenshotUrl).toBeNull();
    expect(last.diffUrl).toBeNull();
  });

  describe("adaptVisualDriftToRegions", () => {
    it("returns an empty array when no diffRegion is set", () => {
      const entry: VisualDriftEntryView = { ...SAMPLE, diffRegion: undefined };
      expect(adaptVisualDriftToRegions(entry)).toEqual([]);
    });

    it("maps a single bounding diffRegion into one DiffRegion", () => {
      const out = adaptVisualDriftToRegions(SAMPLE);
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        change_percentage: 0.083,
        pixel_count: 831,
      });
    });

    it("clamps change_percentage to [0, 1]", () => {
      const high = adaptVisualDriftToRegions({
        ...SAMPLE,
        diffPercentage: 250,
      });
      expect(high[0].change_percentage).toBe(1);

      const low = adaptVisualDriftToRegions({
        ...SAMPLE,
        diffPercentage: -10,
      });
      expect(low[0].change_percentage).toBe(0);
    });
  });
});

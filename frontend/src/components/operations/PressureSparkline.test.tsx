/**
 * PressureSparkline — the second (swap) line.
 *
 * Plan `2026-11-09-devops-swap-axis-did-not-surface-tmpfs-exhaustion-on-nilan`
 * Phase 2 follow-up. A host's lead line is commit on every OS, so a Linux
 * host's swap device filling up (nilan, 2026-11-09: swap 0.9999 while commit
 * read 0.815) was not visible as a trajectory. Coord now serves `swap_ratio`
 * on every history point, and the chart draws it as a dashed second line.
 *
 * The rule these tests pin: a swap value that is `null` or absent draws NO
 * swap point, never a 0. A series with fewer than two swap readings draws no
 * swap line at all.
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PressureSparkline, type PressurePoint } from "./PressureSparkline";

afterEach(cleanup);

const T0 = "2026-11-09T18:00:00Z";
const T1 = "2026-11-09T18:15:00Z";
const T2 = "2026-11-09T18:30:00Z";

/** Every drawn `<Line>`'s curve path, in render order. */
function curves(container: HTMLElement): SVGPathElement[] {
  return Array.from(
    container.querySelectorAll<SVGPathElement>("path.recharts-line-curve")
  );
}

function dashed(container: HTMLElement): SVGPathElement[] {
  return curves(container).filter(
    (p) => (p.getAttribute("stroke-dasharray") ?? "").trim().length > 0
  );
}

describe("PressureSparkline — the swap line", () => {
  it("draws a Linux host's swap climb as a second, dashed line", () => {
    const points: PressurePoint[] = [
      { sampled_at: T0, pressure: 0.8, swap: 0.62 },
      { sampled_at: T1, pressure: 0.81, swap: 0.91 },
      { sampled_at: T2, pressure: 0.815, swap: 0.9999 },
    ];
    const { container } = render(
      <PressureSparkline points={points} tone="critical" />
    );
    const chart = screen.getByTestId("fleet-resource-sparkline");
    expect(chart.getAttribute("data-swap-line")).toBe("drawn");
    expect(curves(container)).toHaveLength(2);
    // The swap line is the dashed one, so the lead (commit) line keeps its
    // look and the swap line adds no new colour.
    expect(dashed(container)).toHaveLength(1);
    const [lead, swap] = curves(container);
    expect(swap.getAttribute("stroke")).toBe(lead.getAttribute("stroke"));
    // The pinned [0, 1] domain puts the swap line ABOVE the commit line at the
    // end of the window: higher ratio, smaller SVG y.
    const lastY = (p: SVGPathElement) => {
      const nums = (p.getAttribute("d") ?? "").match(/-?\d+(\.\d+)?/g) ?? [];
      return Number(nums[nums.length - 1]);
    };
    expect(lastY(swap)).toBeLessThan(lastY(lead));
  });

  it("draws no swap line when every swap value is null (a Windows host)", () => {
    const { container } = render(
      <PressureSparkline
        points={[
          { sampled_at: T0, pressure: 0.4, swap: null },
          { sampled_at: T1, pressure: 0.5, swap: null },
        ]}
        tone="ok"
      />
    );
    expect(
      screen
        .getByTestId("fleet-resource-sparkline")
        .getAttribute("data-swap-line")
    ).toBe("absent");
    expect(curves(container)).toHaveLength(1);
    expect(dashed(container)).toHaveLength(0);
  });

  it("draws no swap line when the key is absent (a coord older than the field)", () => {
    const { container } = render(
      <PressureSparkline
        points={[
          { sampled_at: T0, pressure: 0.4 },
          { sampled_at: T1, pressure: 0.5 },
        ]}
        tone="ok"
      />
    );
    expect(
      screen
        .getByTestId("fleet-resource-sparkline")
        .getAttribute("data-swap-line")
    ).toBe("absent");
    expect(dashed(container)).toHaveLength(0);
  });

  it("draws no swap line from a single swap reading: a trend needs two", () => {
    const { container } = render(
      <PressureSparkline
        points={[
          { sampled_at: T0, pressure: 0.4, swap: null },
          { sampled_at: T1, pressure: 0.5, swap: 0.7 },
        ]}
        tone="ok"
      />
    );
    expect(
      screen
        .getByTestId("fleet-resource-sparkline")
        .getAttribute("data-swap-line")
    ).toBe("absent");
    expect(dashed(container)).toHaveLength(0);
  });

  it("never draws a non-finite swap value as a point", () => {
    render(
      <PressureSparkline
        points={[
          { sampled_at: T0, pressure: 0.4, swap: Number.NaN },
          { sampled_at: T1, pressure: 0.5, swap: Number.POSITIVE_INFINITY },
        ]}
        tone="ok"
      />
    );
    expect(
      screen
        .getByTestId("fleet-resource-sparkline")
        .getAttribute("data-swap-line")
    ).toBe("absent");
  });

  it("still draws the swap trend when the lead line has no two readings", () => {
    // A host whose commit reading dropped out while swap kept reporting still
    // has a trajectory, so the chart does not say "no history".
    const { container } = render(
      <PressureSparkline
        points={[
          { sampled_at: T0, pressure: null, swap: 0.9 },
          { sampled_at: T1, pressure: null, swap: 0.95 },
        ]}
        tone="warn"
      />
    );
    expect(screen.queryByTestId("fleet-resource-sparkline-empty")).toBeNull();
    expect(
      screen
        .getByTestId("fleet-resource-sparkline")
        .getAttribute("data-swap-line")
    ).toBe("drawn");
    expect(dashed(container)).toHaveLength(1);
  });

  it("says 'no history' when neither line has two readings", () => {
    render(
      <PressureSparkline
        points={[
          { sampled_at: T0, pressure: 0.4, swap: null },
          { sampled_at: T1, pressure: null, swap: 0.5 },
        ]}
        tone="ok"
      />
    );
    expect(screen.getByTestId("fleet-resource-sparkline-empty")).toBeTruthy();
    expect(screen.queryByTestId("fleet-resource-sparkline")).toBeNull();
  });
});

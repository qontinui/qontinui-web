/**
 * `report-figures` in a document (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3,
 * D5): each figure's value, baseline, target, direction and verdict — a
 * shape and a word — with its own source and as-of, its change since the
 * compared stop, and a trend over every stop in which an unmeasured stop is
 * a gap, never a zero.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listResource: vi.fn(),
  fetchReportView: vi.fn(),
  fetchPageBacklinks: vi.fn(async () => []),
}));
vi.mock("@/components/overview/editing/api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));

import {
  InPageBody,
  atAddress,
  fence,
  serveReports,
} from "./__fixtures__/render";
import { SLUG, reportView } from "./__fixtures__/reportView";

const FIGURES = fence("report-figures", `report: ${SLUG}`, "set: all");

function figure(id: string) {
  return document.querySelector(
    `[data-ui-bridge-id="overview.report.${SLUG}.figures.all.figure.${id}"]`
  ) as HTMLElement | null;
}

beforeEach(() => {
  vi.clearAllMocks();
  atAddress();
  serveReports(api, [reportView()]);
});

describe("report-figures", () => {
  it("shows each figure's value, baseline, target, direction and verdict, with its own source and as-of", async () => {
    render(<InPageBody body={FIGURES} />);
    await waitFor(() => expect(figure("uptime")).not.toBeNull());
    const uptime = figure("uptime")!;
    expect(uptime.textContent).toMatch(/Uptime/);
    expect(uptime.textContent).toMatch(/99\.4 %/);
    expect(uptime.textContent).toMatch(/Starting point98\.5/);
    expect(uptime.textContent).toMatch(/Target99/);
    expect(uptime.textContent).toMatch(/DirectionHigher is better/);
    const verdict = uptime.querySelector("[data-verdict]")!;
    expect(verdict.getAttribute("data-verdict")).toBe("met");
    expect(verdict.textContent).toBe("✓ Met");
    expect(uptime.querySelector("[data-provenance]")?.textContent).toMatch(
      /^source: the status page's monthly export · as of /
    );
    expect(figure("lead-time")!.textContent).toMatch(
      /DirectionLower is better/
    );
  });

  it("says 'not measured' and why for a figure the stop did not measure — never 0 or a blank", async () => {
    atAddress(`?at.${SLUG}=2`);
    render(<InPageBody body={FIGURES} />);
    await waitFor(() => expect(figure("lead-time")).not.toBeNull());
    const lead = figure("lead-time")!;
    expect(lead.querySelector("[data-not-measured]")?.textContent).toBe(
      "not measured — the dashboard export did not include it"
    );
    expect(lead.querySelector("[data-verdict]")?.textContent).toBe("? Unknown");
    // The value line holds no number at all.
    const valueLine = lead.querySelector("[data-not-measured]")!.parentElement!;
    expect(valueLine.textContent).not.toMatch(/\b0\b/);
  });

  it("gives a figure's change as a shape and a word, said against which way is better", async () => {
    render(<InPageBody body={FIGURES} />);
    await waitFor(() => expect(figure("lead-time")).not.toBeNull());
    const up = figure("uptime")!.querySelector("[data-delta]")!;
    expect(up.textContent).toBe(
      "↑up: up from 99.2 to 99.4 since Checkpoint 1 (better)"
    );
    const lead = figure("lead-time")!.querySelector("[data-delta]")!;
    // Measured again after a stop that did not measure it.
    expect(lead.getAttribute("data-delta")).toBe("unknown");
  });

  it("draws a trend over every stop, with the unmeasured stop as a gap and said in words", async () => {
    render(<InPageBody body={FIGURES} />);
    await waitFor(() => expect(figure("lead-time")).not.toBeNull());
    const trend = figure("lead-time")!.querySelector("[data-trend-points]")!;
    expect(trend.getAttribute("data-trend-points")).toBe("3");
    expect(trend.textContent).toMatch(
      /Over every stop: Baseline review: 12; Checkpoint 1: not measured; Re-review: 7\./
    );
    expect(trend.querySelector("svg")).not.toBeNull();
  });

  it("shows one figure when the block names it, and says so when the stop has no such figure", async () => {
    render(
      <InPageBody
        body={[
          fence("report-figures", `report: ${SLUG}`, "set: uptime"),
          "",
          fence("report-figures", `report: ${SLUG}`, "set: no-such-figure"),
        ].join("\n")}
      />
    );
    await waitFor(() =>
      expect(
        document.querySelector(
          `[data-ui-bridge-id="overview.report.${SLUG}.figures.uptime.figure.uptime"]`
        )
      ).not.toBeNull()
    );
    expect(
      document.querySelector(
        `[data-ui-bridge-id="overview.report.${SLUG}.figures.uptime.figure.lead-time"]`
      )
    ).toBeNull();
    expect(screen.getByText(/This stop has no figure/)).toBeTruthy();
  });
});

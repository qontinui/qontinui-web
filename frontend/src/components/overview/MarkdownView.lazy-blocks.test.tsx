/**
 * A block's component loads only when a document shows that block (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2).
 * `MarkdownView` renders the text of every document and wiki page and of the
 * Summary, so a document with no block in it must load no block — and not
 * recharts, which `report-figures` draws its trends with.
 *
 * Each module below records the moment it is first evaluated: a mock factory
 * runs only when something imports its module.
 */

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => new Set<string>());

vi.mock("recharts", async (original) => {
  loaded.add("recharts");
  return await original<object>();
});
vi.mock("./blocks/ObjectiveCheckpoints", async (original) => {
  loaded.add("ObjectiveCheckpoints");
  return await original<object>();
});
vi.mock("./blocks/OverviewKpi", async (original) => {
  loaded.add("OverviewKpi");
  return await original<object>();
});
vi.mock("./blocks/OverviewPlanVsActual", async () => {
  loaded.add("OverviewPlanVsActual");
  // A block whose component cannot be fetched (a failed chunk).
  throw new Error("Loading chunk overview-plan-vs-actual failed");
});
vi.mock("./blocks/OverviewRisks", async (original) => {
  loaded.add("OverviewRisks");
  return await original<object>();
});
vi.mock("./blocks/OverviewTimeline", async (original) => {
  loaded.add("OverviewTimeline");
  return await original<object>();
});
vi.mock("./blocks/ReportChanges", async (original) => {
  loaded.add("ReportChanges");
  return await original<object>();
});
vi.mock("./blocks/ReportFigures", async (original) => {
  loaded.add("ReportFigures");
  return await original<object>();
});
vi.mock("./blocks/ReportItems", async (original) => {
  loaded.add("ReportItems");
  return await original<object>();
});
vi.mock("./blocks/ReportScorecard", async (original) => {
  loaded.add("ReportScorecard");
  return await original<object>();
});
vi.mock("./blocks/ReportTimeline", async (original) => {
  loaded.add("ReportTimeline");
  return await original<object>();
});
vi.mock("@/components/overview/editing/api", async (original) => ({
  ...(await original<object>()),
  fetchPageBacklinks: vi.fn(async () => []),
}));

import { InPageBody, fence, pageSettled } from "./blocks/__fixtures__/render";

/** What importing the page surfaces — `PageBody`, `IntentSection` and their
 *  `MarkdownView` — evaluated, before any test renders anything. */
const loadedByImports = [...loaded].sort();

/** The modules evaluated since `before` was taken. */
function loadedSince(before: ReadonlySet<string>): string[] {
  return [...loaded].filter((name) => !before.has(name)).sort();
}

describe("MarkdownView and the blocks' components", () => {
  it("loads no block, and not recharts, for a document with no block in it", async () => {
    expect(loadedByImports).toEqual([]);
    const beforeQuiet = new Set(loaded);
    const first = render(
      <InPageBody
        body={[
          "# Notes",
          "",
          "Where the work stands.",
          "",
          "```ts",
          "const answer = 42;",
          "```",
          "",
          "```objective-c",
          "@interface Greeter : NSObject",
          "```",
        ].join("\n")}
      />
    );
    await pageSettled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(loadedSince(beforeQuiet)).toEqual([]);
    expect(screen.getByText("Where the work stands.")).toBeTruthy();
    first.unmount();

    // The control: a document that shows a block loads that block's module —
    // only that one — and shows that it is loading until it has.
    const beforeShown = new Set(loaded);
    render(<InPageBody body={fence("overview-risks")} />);
    expect(
      document.querySelector('[data-overview-block-loading="overview-risks"]')
    ).not.toBeNull();
    await screen.findByText("Risks aren't available yet");
    await pageSettled();
    expect(loadedSince(beforeShown)).toEqual(["OverviewRisks"]);
    expect(
      document.querySelector('[data-overview-block-loading="overview-risks"]')
    ).toBeNull();
  });

  it("says a block can't be shown when its component can't be loaded — and keeps the rest of the document", async () => {
    // React and the error boundary both report the failure on the console.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      render(
        <InPageBody
          body={[
            "Before the block.",
            "",
            fence("overview-plan-vs-actual"),
          ].join("\n")}
        />
      );
      const notice = await screen.findByText(
        "This block can't be shown right now."
      );
      expect(
        notice.closest('[data-overview-block="overview-plan-vs-actual"]')
      ).not.toBeNull();
      expect(
        notice.closest('[data-overview-block-error="failed"]')
      ).not.toBeNull();
      expect(screen.getByText("Before the block.")).toBeTruthy();
      expect(
        document.querySelector("[data-overview-block-loading]")
      ).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      await pageSettled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

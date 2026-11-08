/**
 * How a fence becomes a block, and what it says when it cannot (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2,
 * D3 "Binding"): a fence that names a block renders it in place of the code;
 * one that looks like a block but is not says "This block isn't available";
 * settings that do not parse or validate say "This block's settings aren't
 * valid", naming the setting; a report block outside a report names its
 * report, and inside one needs no such line. Never a silent nothing.
 * Entered through `PageBody` and `IntentSection`.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listResource: vi.fn(),
  fetchReportView: vi.fn(),
  fetchPageBacklinks: vi.fn(async () => []),
  fetchChangeLog: vi.fn(async () => ({ entries: [], truncated: false })),
}));
vi.mock("@/components/overview/editing/api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useResourceDescriptor: () => null,
}));

import { ReportProvider } from "./ReportContext";
import {
  InIntentSection,
  InPageBody,
  atAddress,
  fence,
  pageSettled,
  serveReports,
} from "./__fixtures__/render";
import { SLUG, reportView } from "./__fixtures__/reportView";

function settingsError() {
  return document.querySelector('[data-overview-block-error="settings"]');
}

beforeEach(() => {
  vi.clearAllMocks();
  atAddress();
  serveReports(api, [reportView()]);
});

describe("a fence that names a block", () => {
  it("renders the block in place of the code", async () => {
    render(<InPageBody body={fence("report-timeline", `report: ${SLUG}`)} />);
    expect(await screen.findAllByRole("tab")).toHaveLength(3);
    expect(document.querySelector("pre")).toBeNull();
    expect(document.body.textContent).not.toContain("report: platform-review");
  });

  it("leaves every other fence as the code it was", () => {
    render(<InIntentSection body={fence("ts", "const x = 1;")} />);
    expect(document.querySelector("pre > code.language-ts")?.textContent).toBe(
      "const x = 1;\n"
    );
    expect(document.querySelector("[data-overview-block]")).toBeNull();
  });
});

describe("a fence that looks like a block but is not one", () => {
  it.each(["report-gantt", "overview-burndown", "objective-trend"])(
    "says %s isn't available — never a silent nothing",
    async (name) => {
      render(<InPageBody body={fence(name, "anything: here")} />);
      await pageSettled();
      const notice = document.querySelector(
        '[data-overview-block-error="unknown"]'
      )!;
      expect(notice.textContent).toMatch(/^This block isn.t available: /);
      expect(notice.querySelector("code")?.textContent).toBe(name);
    }
  );
});

describe("settings that are not valid", () => {
  it("names a setting the block does not have", async () => {
    render(
      <InPageBody
        body={fence(
          "report-scorecard",
          `report: ${SLUG}`,
          "table: scorecard",
          "colour: red"
        )}
      />
    );
    await pageSettled();
    expect(settingsError()?.textContent).toMatch(
      /^This block's settings aren't valid/
    );
    expect(settingsError()?.querySelector("[data-setting]")?.textContent).toBe(
      "colour"
    );
  });

  it("names a value the block does not accept", () => {
    render(<InIntentSection body={fence("overview-kpi revenue")} />);
    expect(settingsError()?.textContent).toMatch(
      /This block's settings aren't valid/
    );
    expect(settingsError()?.querySelector("[data-setting]")?.textContent).toBe(
      "figure"
    );
    expect(settingsError()?.textContent).toMatch(/forecast-finish, slip/);
  });

  it("names a setting the block needs", async () => {
    render(<InPageBody body={fence("report-scorecard", `report: ${SLUG}`)} />);
    await pageSettled();
    expect(settingsError()?.querySelector("[data-setting]")?.textContent).toBe(
      "table"
    );
    expect(settingsError()?.textContent).toMatch(/This block needs `table`/);
  });

  it("refuses a line that is not a setting", () => {
    render(
      <InIntentSection
        body={fence("report-changes", "<script>alert(1)</script>")}
      />
    );
    expect(settingsError()?.textContent).toMatch(/is not a setting/);
    expect(document.querySelector("script")).toBeNull();
  });

  it("refuses a URL as a value", async () => {
    render(
      <InPageBody
        body={fence("report-timeline", "report: https://example.org/x")}
      />
    );
    await pageSettled();
    expect(settingsError()?.querySelector("[data-setting]")?.textContent).toBe(
      "report"
    );
  });
});

describe("which report a report block shows", () => {
  it("outside a report's page, needs a report line, and says so", async () => {
    render(<InPageBody body={fence("report-changes")} />);
    await pageSettled();
    expect(settingsError()?.querySelector("[data-setting]")?.textContent).toBe(
      "report"
    );
    expect(settingsError()?.textContent).toMatch(
      /add a line report: <the report's name>/
    );
    expect(api.listResource).not.toHaveBeenCalled();
  });

  it("inside a report's page, shows that report with no report line", async () => {
    render(
      <ReportProvider views={[reportView()]}>
        <InPageBody body={fence("report-timeline")} />
      </ReportProvider>
    );
    expect(await screen.findAllByRole("tab")).toHaveLength(3);
    // The page already held the view: nothing was fetched.
    expect(api.listResource).not.toHaveBeenCalled();
    expect(api.fetchReportView).not.toHaveBeenCalled();
  });

  it("reads each named report once per document, however many blocks name it", async () => {
    render(
      <InPageBody
        body={[
          fence("report-timeline", `report: ${SLUG}`),
          fence("report-changes", `report: ${SLUG}`),
          fence("report-items", `report: ${SLUG}`),
        ].join("\n\n")}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    expect(api.listResource).toHaveBeenCalledTimes(1);
    expect(api.listResource).toHaveBeenCalledWith("reports", { slug: SLUG });
    expect(api.fetchReportView).toHaveBeenCalledTimes(1);
    expect(api.fetchReportView).toHaveBeenCalledWith("report-platform-review");
  });
});

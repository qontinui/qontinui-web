/**
 * A document's text with live blocks in it (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` Phase
 * 2, Arming): a fenced `report-*` or `overview-*` block in a document renders
 * its component instead of a code block, and a fence that is not a block
 * renders as the code it always was. Documents and wiki pages both render
 * their text through `PageBody`.
 */

import { render, screen } from "@testing-library/react";
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
  pageSettled,
  serveReports,
} from "@/components/overview/blocks/__fixtures__/render";
import {
  SLUG,
  reportView,
} from "@/components/overview/blocks/__fixtures__/reportView";

beforeEach(() => {
  vi.clearAllMocks();
  atAddress();
  serveReports(api, [reportView()]);
});

describe("PageBody with live blocks", () => {
  it("renders a report block in place of its fence", async () => {
    render(
      <InPageBody
        body={[
          "Where the review stands.",
          "",
          fence("report-timeline", `report: ${SLUG}`),
        ].join("\n")}
      />
    );
    expect(await screen.findAllByRole("tab")).toHaveLength(3);
    expect(screen.getByText("Where the review stands.")).toBeTruthy();
    expect(document.querySelector("pre")).toBeNull();
    await pageSettled();
  });

  it("renders an overview block in place of its fence", async () => {
    render(<InPageBody body={fence("overview-risks top=3")} />);
    expect(await screen.findByText("Risks aren't available yet")).toBeTruthy();
    expect(document.querySelector("pre")).toBeNull();
    await pageSettled();
  });

  it("renders a fence that is not a block as the code it always was", async () => {
    render(<InPageBody body={fence("ts", "const x = 1;")} />);
    expect(document.querySelector("pre > code.language-ts")?.textContent).toBe(
      "const x = 1;\n"
    );
    expect(document.querySelector("[data-overview-block]")).toBeNull();
    await pageSettled();
  });
});

/**
 * The withheld marker (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D4,
 * "Amended 2026-11-08"): a string the server withheld — it names a
 * confidential term added after it was written — is served as exactly
 * `[withheld]`, with a `withheld` entry naming its slot. Blocks render that
 * slot as a plain-language notice: the word "Withheld", never a blank, and
 * never the marker itself. Confidentiality is the server's; this guard only
 * says, in words, that the server withheld something.
 *
 * Checked on a report field (its title), on a snapshot cell (a score's
 * reason) and on a stop's label, each entered through a page.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
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

import {
  InIntentSection,
  InPageBody,
  atAddress,
  fence,
  serveReports,
} from "./__fixtures__/render";
import {
  SLUG,
  WITHHELD,
  docAt,
  reportRead,
  reportView,
  scorecard,
  stopAt,
} from "./__fixtures__/reportView";

/** A slot holds the notice: the word, the reason, and never the marker. */
function expectNotice(slot: Element) {
  const notice = slot.querySelector("[data-withheld]");
  expect(notice, "the slot renders the withheld notice").not.toBeNull();
  expect(notice!.textContent).toMatch(
    /^Withheld: This text was withheld because it names something this project keeps confidential\.$/
  );
  expect(slot.textContent).not.toContain(WITHHELD);
  expect(slot.textContent?.trim()).not.toBe("");
}

beforeEach(() => {
  vi.clearAllMocks();
  atAddress();
});

describe("a report field the server withheld", () => {
  it("reads as the notice, never the marker or a blank", async () => {
    serveReports(api, [
      reportView({
        report: reportRead({
          title: WITHHELD,
          withheld: [{ slot: "title", reason: "confidential_term" }],
        }),
      }),
    ]);
    render(<InPageBody body={fence("report-timeline", `report: ${SLUG}`)} />);
    await screen.findAllByRole("tab");
    const line = document.querySelector(
      '[data-overview-block="report-timeline"] p'
    )!;
    expectNotice(line);
    expect(document.body.innerHTML).not.toContain(WITHHELD);
  });
});

describe("a snapshot cell the server withheld", () => {
  it("reads as the notice, in the cell and its tooltip — never the marker or a blank", async () => {
    const withheldReason = docAt(2, {
      tables: [
        scorecard({
          intake: {
            clarity: { value: 3, unknown_reason: null },
            leanness: { value: 3, unknown_reason: null },
          },
          billing: {
            clarity: { value: 3, unknown_reason: null },
            leanness: { value: null, unknown_reason: WITHHELD },
          },
          overall: {
            clarity: { value: 3, unknown_reason: null },
            leanness: { value: 3, unknown_reason: null },
          },
        }),
      ],
    });
    serveReports(api, [
      reportView({
        snapshots: [stopAt(1), stopAt(2, { data: withheldReason })],
        withheld: [
          {
            seq: 2,
            slot: "tables[0].rows[1].cells[columns[1]].unknown_reason",
            reason: "confidential_term",
          },
        ],
      }),
    ]);
    render(
      <InIntentSection
        body={fence("report-scorecard", `report: ${SLUG}`, "table: scorecard")}
      />
    );
    const cell = await waitFor(() => {
      const found = document.querySelector(
        `[data-ui-bridge-id="overview.report.${SLUG}.scorecard.scorecard.cell.billing.leanness"]`
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expectNotice(cell);
    expect(
      cell.querySelector("[data-not-measured]")?.getAttribute("title")
    ).toBe("Withheld");
    expect(document.body.innerHTML).not.toContain(WITHHELD);
  });
});

describe("a stop label the server withheld", () => {
  it("reads as the notice in its tab — never the marker or a blank", async () => {
    const two = stopAt(2, { data: docAt(2, { label: WITHHELD }) });
    serveReports(api, [
      reportView({
        snapshots: [stopAt(1), two, stopAt(3)],
        withheld: [{ seq: 2, slot: "label", reason: "confidential_term" }],
      }),
    ]);
    render(<InPageBody body={fence("report-timeline", `report: ${SLUG}`)} />);
    const tabs = await screen.findAllByRole("tab");
    expectNotice(tabs[1]!);
    expect(within(tabs[1]!).getByText("Light check")).toBeTruthy();
  });
});

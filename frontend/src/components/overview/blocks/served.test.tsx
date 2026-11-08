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
 * reason) and on a stop's label, each entered through a page — and then on
 * every free-text slot the contract has, at once, across all five report
 * blocks, at every stop, with every disclosure open.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  pageSettled,
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
  type ReportView,
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

// ---------------------------------------------------------------------------
// Every free-text slot, across all five report blocks
// ---------------------------------------------------------------------------

/**
 * The contract's free-text keys, copied verbatim from `FREE_TEXT_KEYS` in
 * `backend/app/overview/report_snapshot_contract.py` (Phase 1, ec4afcdd8).
 * The server may serve any string under one of these keys as the marker: in
 * the report (its title, summary and body), in each stop's row and in each
 * stop's document.
 */
const FREE_TEXT_KEYS = new Set([
  "label",
  "note",
  "summary",
  "help",
  "title",
  "caption",
  "row_header",
  "unit",
  "source",
  "unknown_reason",
  "status_note",
  "body_md",
  "url",
]);

/** A stop row's copy of its document's method label, which the server
 *  withholds as it withholds the label it copies (`treat_label`). */
const ROW_COPIES = new Set(["method_label"]);

/** `view` with every free-text string replaced by `serve(path)`. */
function everyFreeText(
  view: ReportView,
  serve: (path: string) => string
): ReportView {
  const walk = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((item, i) => walk(item, `${path}[${i}]`));
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          typeof item === "string" &&
          (FREE_TEXT_KEYS.has(key) || ROW_COPIES.has(key))
            ? serve(`${path}.${key}`)
            : walk(item, `${path}.${key}`),
        ])
      );
    }
    return value;
  };
  return walk(view, "view") as ReportView;
}

/** The fixture's report with every slot it can carry filled: each stop also
 *  carries a note (no block shows notes; the marker must not leak there). */
function fullView(): ReportView {
  const withNote = (seq: 1 | 2 | 3) =>
    stopAt(seq, {
      data: docAt(seq, {
        notes: [{ title: "How this stop was read", body_md: "From the log." }],
      }),
    });
  return reportView({ snapshots: [withNote(1), withNote(2), withNote(3)] });
}

const REPORT_BLOCKS = [
  "report-timeline",
  "report-scorecard",
  "report-figures",
  "report-items",
  "report-changes",
] as const;

const ALL_FIVE = [
  fence("report-timeline", `report: ${SLUG}`),
  fence("report-scorecard", `report: ${SLUG}`, "table: scorecard"),
  fence("report-figures", `report: ${SLUG}`),
  fence("report-items", `report: ${SLUG}`),
  fence("report-changes", `report: ${SLUG}`),
].join("\n\n");

const SENTINEL = /ZQ\d+ZQ/g;
const WORD = /\bWithheld\b/g;

const count = (text: string, pattern: RegExp) =>
  (text.match(pattern) ?? []).length;

/** What one block shows: its free text (the sentinels), the notices standing
 *  in for withheld text, and the notice's word where the text is part of a
 *  string (an attribute, a sentence, a provenance chip). */
function measure(block: Element) {
  let sentinelText = 0;
  let wordText = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    sentinelText += count(text, SENTINEL);
    if (!node.parentElement?.closest("[data-withheld]")) {
      wordText += count(text, WORD);
    }
  }
  let sentinelAttrs = 0;
  let wordAttrs = 0;
  for (const el of [block, ...block.querySelectorAll("*")]) {
    for (const attr of el.attributes) {
      sentinelAttrs += count(attr.value, SENTINEL);
      wordAttrs += count(attr.value, WORD);
    }
  }
  return {
    sentinelText,
    sentinelAttrs,
    notices: block.querySelectorAll("[data-withheld]").length,
    wordText,
    wordAttrs,
  };
}

/** Every place the literal marker shows: in the page's text, or in any
 *  attribute of any element. */
function markerShown(): string[] {
  const found: string[] = [];
  if (document.body.textContent?.includes(WITHHELD)) found.push("page text");
  for (const el of document.body.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      if (attr.value.includes(WITHHELD)) {
        found.push(`<${el.tagName.toLowerCase()} ${attr.name}>`);
      }
    }
  }
  return found;
}

/** Render all five report blocks on one page over `view`, then at each stop
 *  — chosen on the timeline — open every "Technical details" and read each
 *  block. */
async function readEveryStop(view: ReportView) {
  atAddress();
  serveReports(api, [view]);
  const page = render(<InPageBody body={ALL_FIVE} />);
  await waitFor(() => {
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    for (const name of REPORT_BLOCKS) {
      expect(
        document.querySelector(`[data-overview-block="${name}"]`)
      ).not.toBeNull();
    }
    expect(document.querySelector("[data-overview-block-loading]")).toBeNull();
    expect(
      document.querySelector('[aria-label="Loading the report"]')
    ).toBeNull();
  });
  await pageSettled();
  const stops = [];
  for (let stop = 0; stop < 3; stop++) {
    fireEvent.click(screen.getAllByRole("tab")[stop]!);
    expect(
      screen.getAllByRole("tab")[stop]!.getAttribute("aria-selected")
    ).toBe("true");
    for (const toggle of screen.queryAllByRole("button", {
      name: "Technical details",
    })) {
      fireEvent.click(toggle);
    }
    expect(
      screen.queryAllByRole("button", { name: "Technical details" })
    ).toHaveLength(0);
    stops.push({
      marker: markerShown(),
      blocks: Object.fromEntries(
        REPORT_BLOCKS.map((name) => [
          name,
          measure(document.querySelector(`[data-overview-block="${name}"]`)!),
        ])
      ),
    });
  }
  page.unmount();
  return stops;
}

describe("every free-text slot the server withheld, across the five report blocks", () => {
  it("reads as the notice in every slot, at every stop, with every disclosure open — never the marker, never a blank", async () => {
    // First every slot gets text of its own, to see where each one shows;
    // then every slot is served as the marker, as the server withholds it.
    let n = 0;
    const plain = await readEveryStop(
      everyFreeText(fullView(), () => `ZQ${++n}ZQ`)
    );
    const withheld = await readEveryStop(
      everyFreeText(fullView(), () => WITHHELD)
    );

    plain.forEach((shown, i) => {
      const at = `stop ${i + 1}`;
      expect(withheld[i]!.marker, `${at}: the marker shown`).toEqual([]);
      for (const name of REPORT_BLOCKS) {
        const before = shown.blocks[name]!;
        const after = withheld[i]!.blocks[name]!;
        // The block showed free text of its own here, so the check below
        // is about something.
        expect(before.sentinelText, `${at}, ${name}`).toBeGreaterThan(0);
        expect(after.sentinelText + after.sentinelAttrs).toBe(0);
        // Each slot that showed its text now shows the notice instead: one
        // notice (or, inside a string, the notice's word) per slot.
        expect(
          after.notices + after.wordText - before.wordText,
          `${at}, ${name}: text slots`
        ).toBe(before.sentinelText);
        expect(
          after.wordAttrs - before.wordAttrs,
          `${at}, ${name}: attribute slots`
        ).toBe(before.sentinelAttrs);
      }
    });
  });
});

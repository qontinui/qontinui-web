/**
 * `report-items` in a document (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3,
 * D5): a status list in plain words, what changed since the compared stop,
 * and every technical reference kept inside its item's "Technical details"
 * disclosure — ABSENT from the page until a reader opens it.
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
import {
  PLANTED_UUID,
  SLUG,
  docAt,
  reportView,
  stopAt,
} from "./__fixtures__/reportView";

const ITEMS = fence("report-items", `report: ${SLUG}`);

function item(id: string) {
  return document.querySelector(
    `[data-ui-bridge-id="overview.report.${SLUG}.items.all.item.${id}"]`
  ) as HTMLElement | null;
}

beforeEach(() => {
  vi.clearAllMocks();
  atAddress(`?at.${SLUG}=2`);
  serveReports(api, [reportView()]);
});

describe("report-items", () => {
  it("says each status in the Summary's words, plus Dropped — each a shape and a word", async () => {
    render(<InPageBody body={ITEMS} />);
    await waitFor(() => expect(item("r01")).not.toBeNull());
    const status = (id: string) =>
      item(id)!.querySelector("[data-status]")!.textContent;
    expect(status("r01")).toBe("◐In progress");
    expect(status("r02")).toBe("–Dropped");
    expect(status("r03")).toBe("?Status unknown");
    expect(item("r01")!.textContent).toMatch(/Half of the routes have moved\./);
    // The items' source and as-of: the stop they were measured at.
    const block = document.querySelector(
      '[data-overview-block="report-items"]'
    )!;
    expect(block.querySelector("[data-provenance]")?.textContent).toMatch(
      /^source: Light check: Scripted light check · as of /
    );
  });

  it("groups items under their group, with its plain-language help and due date", async () => {
    render(<InPageBody body={ITEMS} />);
    await waitFor(() => expect(item("r01")).not.toBeNull());
    const group = document.querySelector(
      `[data-ui-bridge-id="overview.report.${SLUG}.items.all.group.recommendations"]`
    )!;
    expect(group.textContent).toMatch(/Recommendationsdue 31 Dec 2026/);
    expect(group.textContent).toMatch(
      /What the review advised the team to change\./
    );
    expect(
      within(group as HTMLElement).queryByText("Write the on-call guide")
    ).toBeNull();
    expect(screen.getByText("Other items")).toBeTruthy();
  });

  it("says what changed since the compared stop", async () => {
    render(<InPageBody body={ITEMS} />);
    await waitFor(() => expect(item("r01")).not.toBeNull());
    expect(item("r01")!.textContent).toMatch(
      /Was Planned at Baseline review\./
    );
    expect(item("r03")!.textContent).toMatch(/New since Baseline review\./);
  });

  it("keeps technical references absent from the page until Technical details is opened", async () => {
    render(<InPageBody body={ITEMS} />);
    await waitFor(() => expect(item("r01")).not.toBeNull());
    const r01 = item("r01")!;
    // Closed: neither the links nor the identifier planted among them is in
    // the DOM at all — not hidden, absent.
    expect(document.body.innerHTML).not.toContain(PLANTED_UUID);
    expect(document.body.innerHTML).not.toContain("github.com/example-org");
    expect(within(r01).queryByRole("link")).toBeNull();

    const toggle = within(r01).getByRole("button", {
      name: "Technical details",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const links = within(r01).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "https://github.com/example-org/platform/pull/101",
      `/overview/documents/${PLANTED_UUID}`,
    ]);
    // Only inside the disclosure: every link on the page is in an opened body.
    for (const link of screen.getAllByRole("link")) {
      if (link.closest("[data-overview-block]")) {
        expect(
          link.closest(`[data-ui-bridge-id$=".technical"]`)
        ).not.toBeNull();
      }
    }
  });

  it("offers no disclosure for an item without links, and reads well without any", async () => {
    // A device with no first-party owners configured publishes link-free.
    const linkFree = docAt(2);
    linkFree.items = linkFree.items.map((i) => ({ ...i, links: [] }));
    serveReports(api, [
      reportView({ snapshots: [stopAt(1), stopAt(2, { data: linkFree })] }),
    ]);
    render(<InPageBody body={ITEMS} />);
    await waitFor(() => expect(item("r01")).not.toBeNull());
    expect(
      screen.queryByRole("button", { name: /Technical details/ })
    ).toBeNull();
    expect(item("r01")!.textContent).toMatch(/Split the intake service/);
    expect(item("r01")!.textContent).toMatch(/First routes moved/);
  });

  it("never follows a link in a form the server's link rule does not allow", async () => {
    const odd = docAt(2);
    odd.items = odd.items.map((i) =>
      i.id === "r01"
        ? {
            ...i,
            links: [
              { label: "Somewhere else", url: "https://tracker.example/x" },
            ],
          }
        : i
    );
    serveReports(api, [
      reportView({ snapshots: [stopAt(1), stopAt(2, { data: odd })] }),
    ]);
    render(<InPageBody body={ITEMS} />);
    await waitFor(() => expect(item("r01")).not.toBeNull());
    fireEvent.click(
      within(item("r01")!).getByRole("button", { name: "Technical details" })
    );
    expect(
      within(item("r01")!).getByText("Somewhere else").closest("a")
    ).toBeNull();
  });

  it("shows one group when the block names it, and says so when the stop has no such group", async () => {
    render(
      <InPageBody
        body={[
          fence("report-items", `report: ${SLUG}`, "group: recommendations"),
          "",
          fence("report-items", `report: ${SLUG}`, "group: no-such-group"),
        ].join("\n")}
      />
    );
    expect(await screen.findByText(/This stop has no group/)).toBeTruthy();
    await waitFor(() =>
      expect(
        document.querySelector(
          `[data-ui-bridge-id="overview.report.${SLUG}.items.recommendations.item.r01"]`
        )
      ).not.toBeNull()
    );
    expect(
      document.querySelector(
        `[data-ui-bridge-id="overview.report.${SLUG}.items.recommendations.item.r03"]`
      )
    ).toBeNull();
  });
});

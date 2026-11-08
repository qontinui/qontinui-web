/**
 * `report-timeline` in a document (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3):
 * one tab per stop, the arrow keys move between them, the choice is kept in
 * the URL per report, every block of that report follows it, and what the
 * view could not show is said. Entered through `PageBody`, the way a reader
 * meets a block in a document.
 */

import type { ReactNode } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UIBridgeProvider,
  useUIBridgeOptional,
} from "@qontinui/ui-bridge/react";

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
  OTHER_SLUG,
  SLUG,
  otherView,
  reportView,
  stopAt,
} from "./__fixtures__/reportView";

const TIMELINE = fence("report-timeline", `report: ${SLUG}`);

function tablist(name = "Stops in this report", index = 0) {
  return screen.getAllByRole("tablist", { name })[index]!;
}

function selectedTab(list: HTMLElement) {
  return within(list)
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true");
}

beforeEach(() => {
  vi.clearAllMocks();
  atAddress();
  serveReports(api, [reportView(), otherView()]);
});

describe("report-timeline with many stops", () => {
  it("shows one tab per stop — date, label and method in words — with the newest chosen", async () => {
    render(<InPageBody body={TIMELINE} />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "13 Oct 2026 Baseline review Full review",
      "29 Oct 2026 Checkpoint 1 Light check",
      "20 Nov 2026 Re-review Full review",
    ]);
    expect(selectedTab(tablist())?.textContent).toMatch(/Re-review/);
    // The chosen stop is described, with its source and as-of.
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toMatch(/Both parts are leaner/);
    expect(panel.querySelector("[data-provenance]")?.textContent).toMatch(
      /^source: Full review: Independent architecture review · as of /
    );
  });

  it("moves with the arrow keys, Home and End, and keeps the stop in ?at.<slug>=", async () => {
    render(<InPageBody body={TIMELINE} />);
    await screen.findAllByRole("tab");
    const list = tablist();
    selectedTab(list)!.focus();

    fireEvent.keyDown(list, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(selectedTab(list)?.textContent).toMatch(/Checkpoint 1/)
    );
    expect(new URLSearchParams(window.location.search).get(`at.${SLUG}`)).toBe(
      "2"
    );
    expect(document.activeElement).toBe(selectedTab(list));

    fireEvent.keyDown(list, { key: "Home" });
    await waitFor(() =>
      expect(selectedTab(list)?.textContent).toMatch(/Baseline/)
    );
    expect(new URLSearchParams(window.location.search).get(`at.${SLUG}`)).toBe(
      "1"
    );

    fireEvent.keyDown(list, { key: "ArrowLeft" }); // already first: stays
    expect(selectedTab(list)?.textContent).toMatch(/Baseline/);

    fireEvent.keyDown(list, { key: "End" });
    await waitFor(() =>
      expect(selectedTab(list)?.textContent).toMatch(/Re-review/)
    );
    expect(new URLSearchParams(window.location.search).get(`at.${SLUG}`)).toBe(
      "3"
    );

    fireEvent.keyDown(list, { key: "ArrowRight" }); // already last: stays
    expect(selectedTab(list)?.textContent).toMatch(/Re-review/);
  });

  it("keeps only the chosen stop in the tab order", async () => {
    render(<InPageBody body={TIMELINE} />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("starts on the stop the URL names", async () => {
    atAddress(`?at.${SLUG}=1`);
    render(<InPageBody body={TIMELINE} />);
    await screen.findAllByRole("tab");
    expect(selectedTab(tablist())?.textContent).toMatch(/Baseline review/);
  });

  it("chooses the newest when the URL names a stop it does not show, and says so", async () => {
    atAddress(`?at.${SLUG}=9`);
    render(<InPageBody body={TIMELINE} />);
    await screen.findAllByRole("tab");
    expect(selectedTab(tablist())?.textContent).toMatch(/Re-review/);
    expect(
      screen.getByText(/The stop this link named isn.t shown here/)
    ).toBeTruthy();
  });

  it("lists what happened between the stop before and the chosen one", async () => {
    atAddress(`?at.${SLUG}=2`);
    render(<InPageBody body={TIMELINE} />);
    const panel = await screen.findByRole("tabpanel");
    expect(panel.textContent).toMatch(
      /20 Oct 2026 First routes moved \(Split the intake service\)/
    );
  });

  it("says when a page of stops was capped", async () => {
    serveReports(api, [reportView({ truncated: true, total: 60 })]);
    render(<InPageBody body={TIMELINE} />);
    expect(
      await screen.findByText("Showing the newest 3 of 60 stops.")
    ).toBeTruthy();
  });
});

describe("report-timeline with one stop, or none", () => {
  it("with one stop, has one tab and nothing earlier to compare", async () => {
    serveReports(api, [reportView({ snapshots: [stopAt(1)] })]);
    render(<InPageBody body={TIMELINE} />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toMatch(
      /first stop, so there is nothing earlier to compare it with/
    );
  });

  it("with no stops, says none have been published — no empty stepper", async () => {
    serveReports(api, [reportView({ snapshots: [] })]);
    render(<InPageBody body={TIMELINE} />);
    expect(
      await screen.findByText(
        "No stops have been published for this report yet."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("with every stop withheld whole, says they can't be shown — never that there are none", async () => {
    serveReports(api, [
      reportView({
        snapshots: [],
        total: 2,
        withheld: [
          { seq: 1, slot: "items[0].id", reason: "confidential_term" },
          { seq: 2, slot: "groups[0].id", reason: "confidential_term" },
        ],
      }),
    ]);
    render(<InPageBody body={TIMELINE} />);
    expect(
      await screen.findByText("None of this report's stops can be shown.")
    ).toBeTruthy();
    expect(screen.queryByText(/No stops have been published/)).toBeNull();
    expect(
      screen.getByText(
        /2 stops aren.t shown: the server withheld them because they name something this project keeps confidential/
      )
    ).toBeTruthy();
  });
});

describe("two reports on one page", () => {
  it("keeps a separate stop for each, under its own key", async () => {
    render(
      <InPageBody
        body={[
          TIMELINE,
          "",
          fence("report-timeline", `report: ${OTHER_SLUG}`),
        ].join("\n")}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("tablist")).toHaveLength(2));
    const [first, second] = screen.getAllByRole("tablist");
    selectedTab(first!)!.focus();
    fireEvent.keyDown(first!, { key: "Home" });
    await waitFor(() =>
      expect(selectedTab(first!)?.textContent).toMatch(/Baseline review/)
    );
    // The other report's stepper did not move, and its key is not set.
    expect(selectedTab(second!)?.textContent).toMatch(/Support check/);
    const params = new URLSearchParams(window.location.search);
    expect(params.get(`at.${SLUG}`)).toBe("1");
    expect(params.has(`at.${OTHER_SLUG}`)).toBe(false);
  });
});

describe("the stepper drives the report's other blocks", () => {
  it("changes the scorecard to the chosen stop", async () => {
    render(
      <InPageBody
        body={[
          TIMELINE,
          "",
          fence("report-scorecard", `report: ${SLUG}`, "table: scorecard"),
        ].join("\n")}
      />
    );
    const cell = () =>
      document.querySelector(
        `[data-ui-bridge-id="overview.report.${SLUG}.scorecard.scorecard.cell.intake.clarity"]`
      );
    await waitFor(() => expect(cell()?.textContent).toMatch(/^4/));
    const list = tablist();
    selectedTab(list)!.focus();
    fireEvent.keyDown(list, { key: "Home" });
    await waitFor(() => expect(cell()?.textContent).toMatch(/^2/));
  });
});

describe("the stepper's UI Bridge registration", () => {
  it("declares every action read — choosing a stop changes only what this reader sees", async () => {
    const seen: { registry: unknown } = { registry: null };
    function Probe() {
      seen.registry = useUIBridgeOptional()?.registry ?? null;
      return null;
    }
    function WithBridge({ children }: { children: ReactNode }) {
      return (
        <UIBridgeProvider>
          <Probe />
          {children}
        </UIBridgeProvider>
      );
    }
    render(<InPageBody body={TIMELINE} />, { wrapper: WithBridge });
    await screen.findAllByRole("tab");
    const registry = seen.registry as {
      getAllComponents(): {
        id: string;
        actions?: { id: string; effect?: string }[];
      }[];
    };
    const stepper = registry
      .getAllComponents()
      .find((c) => c.id === `overview.report.${SLUG}.timeline`);
    expect(stepper?.actions?.map((a) => [a.id, a.effect])).toEqual([
      ["select-stop", "read"],
      ["next-stop", "read"],
      ["previous-stop", "read"],
    ]);
  });
});

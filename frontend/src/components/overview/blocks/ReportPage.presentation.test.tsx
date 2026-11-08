/**
 * A full report page, checked by the presentation oracle as an outsider would
 * meet it (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` Phase
 * 2): every report block, bound to its report the way the Reports section's
 * page binds it, in a page a non-editor reads — no enabled control that is
 * not navigation, every UI Bridge registration declaring `effect` (the
 * stepper's are all `read`), and no identity in text or attributes: no UUID,
 * no email, and not the fixture's confidential term `Northwind Mutual`, which
 * it plants only in fields no block renders.
 *
 * The presenting-mode guarantee itself is proven in Phase 6, the one surface
 * that renders presenting; this is the outsider-safety oracle over the
 * blocks (checks (a), (b), (e)).
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  expectPresentationSafe,
  findPresentationViolations,
  renderInPresentationMode,
} from "@/test/presentation";
import { ReportProvider } from "./ReportContext";
import { InPageBody, atAddress, fence } from "./__fixtures__/render";
import {
  CONFIDENTIAL,
  PLANTED_UUID,
  SLUG,
  reportView,
} from "./__fixtures__/reportView";

/** A report page's narrative: every report block, bound, none naming it. */
const REPORT_BODY = [
  "## Where things stand",
  "",
  fence("report-timeline"),
  "",
  fence("report-figures"),
  "",
  fence("report-scorecard table=scorecard"),
  "",
  fence("report-items"),
  "",
  fence("report-changes"),
].join("\n");

const SCOPE = {
  status: "ready" as const,
  scope: {
    firstPartyOwners: ["example-org"],
    confidentialTerms: [CONFIDENTIAL],
  },
};

function renderReportPage() {
  return renderInPresentationMode(
    <ReportProvider views={[reportView()]}>
      <InPageBody body={REPORT_BODY} />
    </ReportProvider>,
    { scope: SCOPE }
  );
}

async function settled(view: ReturnType<typeof renderReportPage>) {
  await screen.findAllByRole("tab");
  await waitFor(() =>
    expect(document.querySelectorAll("[data-overview-block]")).toHaveLength(5)
  );
  // The blocks load on demand, so the stepper's UI Bridge registration can
  // land a moment after its tabs do; check (b) must see it, not miss it.
  await waitFor(() => {
    expect("registry" in view.uiBridge).toBe(true);
    if (!("registry" in view.uiBridge)) return;
    expect(
      view.uiBridge.registry
        .getAllComponents()
        .some((c) => c.id === `overview.report.${SLUG}.timeline`)
    ).toBe(true);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The stop where the planted identifier sits among an item's links.
  atAddress(`?at.${SLUG}=2`);
});

describe("a report page, to an outsider", () => {
  it("passes the presentation oracle: no live control, read-only registrations, no identity", async () => {
    const view = renderReportPage();
    await settled(view);
    expect(screen.getByRole("tab", { selected: true }).textContent).toMatch(
      /Checkpoint 1/
    );
    expectPresentationSafe(view, { forbidden: [CONFIDENTIAL] });
  });

  it("keeps it so only while Technical details is closed: open, the oracle sees the planted identifier", async () => {
    // The positive control: the oracle is not blind to what the disclosure
    // holds — its being closed is what keeps the page safe to show.
    const view = renderReportPage();
    await settled(view);
    const r01 = document.querySelector(
      `[data-ui-bridge-id="overview.report.${SLUG}.items.all.item.r01"]`
    ) as HTMLElement;
    fireEvent.click(
      within(r01).getByRole("button", { name: "Technical details" })
    );
    const kinds = findPresentationViolations(view, {
      forbidden: [CONFIDENTIAL],
    }).map((v) => v.kind);
    expect(kinds).toContain("identifier");
    expect(document.body.innerHTML).toContain(PLANTED_UUID);
  });
});

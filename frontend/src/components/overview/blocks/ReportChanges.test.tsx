/**
 * `report-changes` on the Summary (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3,
 * D10): what changed since the compared stop, in sentences, and "Different
 * method — compare with care" when the two stops were measured differently.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listResource: vi.fn(),
  fetchReportView: vi.fn(),
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
  atAddress,
  fence,
  serveReports,
} from "./__fixtures__/render";
import { SLUG, docAt, reportView, stopAt } from "./__fixtures__/reportView";

const CHANGES = fence("report-changes", `report: ${SLUG}`);

function block() {
  return document.querySelector(
    `[data-ui-bridge-id="overview.report.${SLUG}.changes"]`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  atAddress(`?at.${SLUG}=2`);
  serveReports(api, [reportView()]);
});

describe("report-changes", () => {
  it("names the stop it compares with, and warns when the method differs", async () => {
    render(<InIntentSection body={CHANGES} />);
    expect(
      await screen.findByRole("heading", {
        name: "What changed since Baseline review",
      })
    ).toBeTruthy();
    const warning = screen.getByRole("note");
    expect(warning.textContent).toMatch(/Different method — compare with care/);
    expect(warning.textContent).toMatch(
      /Baseline review was a full review; this stop is a light check\./
    );
    // The changes' source and as-of: the stop they lead to.
    expect(block()?.querySelector("[data-provenance]")?.textContent).toMatch(
      /^source: Light check: Scripted light check · as of /
    );
  });

  it("does not warn when both stops were measured the same way", async () => {
    const same = docAt(2, {
      method: {
        kind: "full_review",
        label: "Independent architecture review",
        note: null,
      },
    });
    const two = stopAt(2, { data: same });
    serveReports(api, [
      reportView({
        snapshots: [
          stopAt(1),
          {
            ...two,
            changes_since_previous: {
              ...two.changes_since_previous!,
              method_changed: false,
            },
          },
        ],
      }),
    ]);
    render(<InIntentSection body={CHANGES} />);
    await screen.findByRole("heading", { name: /What changed since/ });
    expect(screen.queryByText(/Different method/)).toBeNull();
  });

  it("says the scores, figures, statuses and events that changed, in sentences", async () => {
    render(<InIntentSection body={CHANGES} />);
    await waitFor(() => expect(block()?.querySelector("ul")).not.toBeNull());
    const lines = [...block()!.querySelectorAll("ul > li")].map(
      (li) => li.textContent
    );
    expect(lines).toEqual([
      "Architecture scorecard: Intake, Clarity went from 2 to 3.",
      "Architecture scorecard: Billing, Leanness went from 4 to not measured — not re-scored by a light check.",
      "Architecture scorecard: Overall, Clarity went from 2.5 to 3.",
      "Architecture scorecard: Overall, Leanness went from 3.5 to 3.",
      "Uptime went from 98.5 to 99.2; its verdict went from missed to met.",
      "Lead time went from 12 to not measured — the dashboard export did not include it; its verdict went from missed to unknown.",
      "Split the intake service went from Planned to In progress.",
      "Retire the old billing export went from Planned to Dropped.",
      "Write the on-call guide is new: Status unknown.",
      "20 Oct 2026: First routes moved (Split the intake service).",
    ]);
  });

  it("gives a value the compared stop did not measure that stop's own reason", async () => {
    atAddress(`?at.${SLUG}=3`);
    render(<InIntentSection body={CHANGES} />);
    await waitFor(() => expect(block()?.querySelector("ul")).not.toBeNull());
    expect(block()!.textContent).toContain(
      "Billing, Leanness went from not measured — not re-scored by a light check to 4."
    );
  });

  it("on the first stop, says there is nothing earlier to compare", async () => {
    atAddress(`?at.${SLUG}=1`);
    render(<InIntentSection body={CHANGES} />);
    expect(
      await screen.findByText(
        "This is the report's first stop, so there is nothing earlier to compare it with."
      )
    ).toBeTruthy();
  });

  it("says when nothing changed", async () => {
    const two = stopAt(2);
    serveReports(api, [
      reportView({
        snapshots: [
          stopAt(1),
          {
            ...two,
            changes_since_previous: {
              previous_seq: 1,
              method_changed: false,
              cells: [],
              figures: [],
              items: [],
              events: [],
            },
          },
        ],
      }),
    ]);
    render(<InIntentSection body={CHANGES} />);
    expect(
      await screen.findByText("Nothing changed since Baseline review.")
    ).toBeTruthy();
  });
});

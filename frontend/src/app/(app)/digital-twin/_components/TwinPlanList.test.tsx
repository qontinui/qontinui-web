/**
 * The Twin map's plan list (plan `2026-10-23-console-presentation-spaces`
 * Phase 5, D3.3). The operator sees every plan with its title, its live
 * status and a link to its work unit. In presentation mode a title shows —
 * and is linked, since the link's URL carries the slug — only when the
 * tenant's presentation scope (Phase 1's `PresentationScopeProvider`, which
 * the lens feeds from `GET /api/v1/presentation/scope`) clears it; a scope
 * still loading, failed or unknown clears nothing; and coord's opaque status
 * text never reaches the screen.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import type { PresentationScopeState } from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import type { GroupPlan } from "../_lib/twin-plans";
import { PRESENTATION_PLAN_LIMIT, TwinPlanList } from "./TwinPlanList";

/** A unit whose every repository names the tenant's own owner. */
const OWN = { area: "ui-bridge", repos: ["qontinui/qontinui-web"] };
/** A unit as coord serves one today: bare repository names, no owner. */
const BARE = {
  area: "ui-bridge",
  repos: ["qontinui-web"],
  source_path: "qontinui-dev-notes/plans/a-plan.md",
};

const READY: PresentationScopeState = {
  status: "ready",
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme Corp"] },
};

function unit(
  slug: string,
  status: string,
  metadata: Record<string, unknown> | null,
  over: Partial<CoordPlanRow> = {}
): CoordPlanRow {
  return {
    slug,
    title: `Title of ${slug}`,
    status,
    authored_at: "2026-10-01T00:00:00Z",
    metadata,
    ...over,
  };
}

function plan(of: CoordPlanRow | null, slug = of?.slug ?? ""): GroupPlan {
  return {
    slug,
    unit: of,
    via: [{ kind: "area", area: "ui-bridge" }],
    subspaces: ["dom"],
  };
}

function onlyPlan(): HTMLElement {
  const items = screen.getAllByTestId("digital-twin-plan");
  expect(items).toHaveLength(1);
  return items[0]!;
}

describe("TwinPlanList — operator mode", () => {
  it("lists a plan with its title and live status, linked to its work unit", () => {
    const live = unit("2026-10-01-live-plan", "in_progress", BARE);
    render(<TwinPlanList plans={[plan(live)]} complete />);
    const item = onlyPlan();
    expect(within(item).getByText("In progress")).toBeInTheDocument();
    const link = within(item).getByTestId("digital-twin-plan-link");
    expect(link).toHaveAttribute(
      "href",
      "/admin/coord/work-units/2026-10-01-live-plan"
    );
    expect(link).toHaveTextContent("Title of 2026-10-01-live-plan");
  });

  it("shows coord's unrecognised status and its phase verbatim, as the console does", () => {
    const odd = unit("2026-10-02-odd", "waiting-on-partner-a", BARE, {
      current_phase: "2",
    });
    render(<TwinPlanList plans={[plan(odd)]} complete />);
    const badge = within(onlyPlan()).getByText("waiting-on-partner-a");
    expect(badge).toHaveAttribute("title", "waiting-on-partner-a — phase 2");
  });

  it("keeps finished plans in a collapsed panel, counted", () => {
    const live = unit("2026-10-01-live", "in_progress", BARE);
    const done = unit("2026-09-01-done", "shipped", BARE);
    render(<TwinPlanList plans={[plan(live), plan(done)]} complete />);
    expect(screen.getByTestId("digital-twin-plans-finished")).toHaveTextContent(
      "Shipped or closed1"
    );
  });

  it("says a slug missing from a complete read is not a work unit, and UNKNOWN from a partial one", () => {
    const slug = "2026-10-11-process-twin-event-log-and-flow-metrics";
    const { rerender } = render(
      <TwinPlanList plans={[plan(null, slug)]} complete />
    );
    expect(within(onlyPlan()).getByText("Not a work unit")).toBeInTheDocument();
    // The work-unit page answers for itself, so the link stays.
    expect(
      within(onlyPlan()).getByTestId("digital-twin-plan-link")
    ).toHaveAttribute("href", `/admin/coord/work-units/${slug}`);
    rerender(<TwinPlanList plans={[plan(null, slug)]} complete={false} />);
    expect(within(onlyPlan()).getByText("UNKNOWN")).toBeInTheDocument();
    expect(onlyPlan()).toHaveAttribute("data-plan-progress", "unknown");
  });

  it("says why there are no plans — and that a partial read may have missed some", () => {
    const { rerender } = render(<TwinPlanList plans={[]} complete />);
    expect(screen.getByTestId("digital-twin-plans-empty")).toHaveTextContent(
      /No plan is tied to these parts/
    );
    rerender(<TwinPlanList plans={[]} complete={false} />);
    expect(screen.getByTestId("digital-twin-plans-empty")).toHaveTextContent(
      /the read was incomplete, so plans may be missing/
    );
  });
});

describe("TwinPlanList — presentation mode, as the tenant's scope decides", () => {
  it("shows and links a title whose every repository is first-party", () => {
    const own = unit("2026-10-01-own-plan", "in_progress", OWN);
    const view = renderInPresentationMode(
      <TwinPlanList plans={[plan(own)]} complete />,
      { scope: READY }
    );
    const item = onlyPlan();
    expect(item.querySelector('[data-redacted="false"]')).toHaveTextContent(
      "Title of 2026-10-01-own-plan"
    );
    expect(within(item).getByTestId("digital-twin-plan-link")).toHaveAttribute(
      "href",
      "/admin/coord/work-units/2026-10-01-own-plan"
    );
    expectPresentationSafe(view);
  });

  it("withholds and unlinks a first-party title that names a confidential term", () => {
    const named = unit("2026-10-02-acme-corp-portal", "in_progress", OWN, {
      title: "Roll out the portal for Acme Corp",
    });
    const view = renderInPresentationMode(
      <TwinPlanList plans={[plan(named)]} complete />,
      { scope: READY }
    );
    const item = onlyPlan();
    expect(item.querySelector('[data-redacted="true"]')).toHaveTextContent(
      /^Plan · ui-bridge · In progress · /
    );
    expect(item.querySelector("a")).toBeNull();
    // Neither the title nor the slug (which the link's URL would carry).
    expect(document.body.innerHTML).not.toMatch(/acme/i);
    expectPresentationSafe(view);
  });

  it("withholds and unlinks a title coord names only bare repositories for", () => {
    const bare = unit("2026-10-03-bare-plan", "in_progress", BARE);
    renderInPresentationMode(<TwinPlanList plans={[plan(bare)]} complete />, {
      scope: READY,
    });
    const item = onlyPlan();
    expect(item.querySelector('[data-redacted="true"]')).not.toBeNull();
    expect(item.querySelector("a")).toBeNull();
    expect(item).not.toHaveTextContent("Title of 2026-10-03-bare-plan");
  });

  it("withholds and unlinks every title while the scope is unknown, loading or failed", () => {
    const own = unit("2026-10-01-own-plan", "in_progress", OWN);
    const states: PresentationScopeState[] = [
      { status: "unknown" },
      { status: "loading" },
      { status: "error", reason: "first-party owners unknown" },
    ];
    for (const scope of states) {
      const view = renderInPresentationMode(
        <TwinPlanList plans={[plan(own)]} complete />,
        { scope }
      );
      const item = onlyPlan();
      // The area is tenant-authored, so it is withheld too until the scope
      // can clear it.
      expect(
        item.querySelector('[data-redacted="true"]'),
        scope.status
      ).toHaveTextContent(/^Plan · area withheld · In progress · /);
      expect(item.querySelector("a"), scope.status).toBeNull();
      expect(item, scope.status).not.toHaveTextContent(
        "Title of 2026-10-01-own-plan"
      );
      view.unmount();
    }
  });

  it("never shows coord's opaque status text or its free-text phase", () => {
    const odd = unit("2026-10-04-odd-status", "waiting-on-partner-a", OWN, {
      current_phase: "2 — cut over for Partner A",
    });
    const view = renderInPresentationMode(
      <TwinPlanList plans={[plan(odd)]} complete />,
      { scope: READY }
    );
    const item = onlyPlan();
    const badge = within(item).getByText("Status unknown");
    expect(badge).toHaveAttribute("title", "Status unknown");
    expect(document.body.innerHTML).not.toMatch(/waiting-on|partner a/i);
    expectPresentationSafe(view);
  });

  it("puts the fixed status word, not coord's text, into a withheld plan's descriptor", () => {
    const odd = unit("2026-10-05-odd-bare", "waiting-on-partner-a", BARE);
    renderInPresentationMode(<TwinPlanList plans={[plan(odd)]} complete />, {
      scope: READY,
    });
    expect(
      onlyPlan().querySelector('[data-redacted="true"]')
    ).toHaveTextContent(/^Plan · ui-bridge · Status unknown · /);
    expect(document.body.innerHTML).not.toMatch(/waiting-on/);
  });

  it("is a descriptor, unlinked, for a slug that is not among the units read", () => {
    const slug = "2026-10-11-process-twin-event-log-and-flow-metrics";
    renderInPresentationMode(
      <TwinPlanList plans={[plan(null, slug)]} complete={false} />,
      { scope: READY }
    );
    const item = onlyPlan();
    expect(item.querySelector('[data-redacted="true"]')).toHaveTextContent(
      "Plan · area unknown · status unknown · age unknown"
    );
    expect(item.querySelector("a")).toBeNull();
    expect(within(item).getByText("UNKNOWN")).toBeInTheDocument();
  });

  it("turns density down: a few unfinished plans, the rest and the finished ones counted", () => {
    const unfinished = Array.from(
      { length: PRESENTATION_PLAN_LIMIT + 2 },
      (_, i) =>
        plan(
          unit(
            `2026-09-${String(i + 1).padStart(2, "0")}-p`,
            "in_progress",
            BARE
          )
        )
    );
    const finished = [1, 2, 3].map((i) =>
      plan(unit(`2026-08-0${i}-done`, "shipped", BARE))
    );
    const view = renderInPresentationMode(
      <TwinPlanList plans={[...unfinished, ...finished]} complete />,
      { scope: READY }
    );
    expect(screen.getAllByTestId("digital-twin-plan")).toHaveLength(
      PRESENTATION_PLAN_LIMIT
    );
    expect(screen.getByText("and 2 more unfinished plans")).toBeInTheDocument();
    expect(screen.getByText("3 shipped or closed")).toBeInTheDocument();
    expect(screen.queryByTestId("digital-twin-plans-finished")).toBeNull();
    expectPresentationSafe(view);
  });
});

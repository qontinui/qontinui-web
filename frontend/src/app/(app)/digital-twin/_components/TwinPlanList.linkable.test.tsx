/**
 * What the Twin map's plan list decides about a plan's link once the
 * work-unit page CAN be presented (plan `2026-10-23-console-presentation-spaces`
 * D3.3).
 *
 * Today `/admin/coord/work-units/[slug]` is not presentation-ready, so
 * `LensLink` makes every plan title plain text while presenting, and the
 * list's own rule is never reached. That rule must still hold the day a later
 * phase registers the page: a title the lens withholds is never linked,
 * because the link's URL carries the slug the descriptor hides. So this file
 * registers the page — the one thing it changes — and pins the rule.
 */

import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import type { PresentationScopeState } from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import type { GroupPlan } from "../_lib/twin-plans";

vi.mock(
  "@/components/presentation/presentationReadiness",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/presentation/presentationReadiness")
      >();
    return {
      ...actual,
      PRESENTATION_READY_ROUTES: [
        ...actual.PRESENTATION_READY_ROUTES,
        {
          route: "/admin/coord/work-units/[slug]",
          provenBy: "a later phase (hypothetical, this file only)",
        },
      ],
    };
  }
);

import { TwinPlanList } from "./TwinPlanList";

/** A unit whose every repository names the tenant's own owner. */
const OWN = { area: "ui-bridge", repos: ["qontinui/qontinui-web"] };
/** A unit as coord serves one today: bare repository names, no owner. */
const BARE = { area: "ui-bridge", repos: ["qontinui-web"] };

const READY: PresentationScopeState = {
  status: "ready",
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme Corp"] },
};

function plan(
  slug: string,
  metadata: Record<string, unknown> | null,
  over: Partial<CoordPlanRow> = {}
): GroupPlan {
  return {
    slug,
    unit: {
      slug,
      title: `Title of ${slug}`,
      status: "in_progress",
      authored_at: "2026-10-01T00:00:00Z",
      metadata,
      ...over,
    },
    via: [{ kind: "area", area: "ui-bridge" }],
    subspaces: ["dom"],
  };
}

function onlyPlan(): HTMLElement {
  const items = screen.getAllByTestId("digital-twin-plan");
  expect(items).toHaveLength(1);
  return items[0]!;
}

describe("TwinPlanList — the link, once the work-unit page can be presented", () => {
  it("links a first-party title to its work unit, keeping the presentation", () => {
    const view = renderInPresentationMode(
      <TwinPlanList plans={[plan("2026-10-01-own-plan", OWN)]} complete />,
      { scope: READY }
    );
    expect(
      within(onlyPlan()).getByTestId("digital-twin-plan-link")
    ).toHaveAttribute(
      "href",
      "/admin/coord/work-units/2026-10-01-own-plan?present=1"
    );
    expectPresentationSafe(view);
  });

  it("never links a title it withholds — the URL would carry its slug", () => {
    const cases: Array<[string, GroupPlan, PresentationScopeState]> = [
      [
        "a confidential term",
        plan("2026-10-02-acme-corp-portal", OWN, {
          title: "Roll out the portal for Acme Corp",
        }),
        READY,
      ],
      ["bare repositories", plan("2026-10-03-bare-plan", BARE), READY],
      [
        "an unknown scope",
        plan("2026-10-04-own-plan", OWN),
        { status: "unknown" },
      ],
    ];
    for (const [why, withheld, scope] of cases) {
      const view = renderInPresentationMode(
        <TwinPlanList plans={[withheld]} complete />,
        { scope }
      );
      const item = onlyPlan();
      expect(item.querySelector('[data-redacted="true"]'), why).not.toBeNull();
      expect(item.querySelector("a"), why).toBeNull();
      expect(document.body.innerHTML, why).not.toContain(withheld.slug);
      view.unmount();
    }
  });
});

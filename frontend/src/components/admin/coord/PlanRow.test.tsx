/**
 * PlanRow render tests — the status tag as it actually reaches the DOM, plus
 * the two contracts the Wave 1 migration had to hold.
 *
 * Ported from `PlanCard.test.tsx`, which was DELETED in Wave 2 along with the
 * card itself once `/history` — its last renderer — moved onto `<PlanRow>`.
 * Every case it held is reproduced below. The pure-function coverage lives in
 * `planStatus.test.ts`; this asserts the ROW wires it through, because the
 * original defect was a rendering one: `shipped` and `in_progress` both
 * resolved to `variant="default"` and so painted identically on screen.
 *
 * The two new contracts:
 *   - **D4a** — every `data-testid` `PlanCard` authored is still emitted, on
 *     the equivalent new element. `coord-plan-card-dates`,
 *     `coord-plan-card-link` and `coord-plan-card-spawn-btn` moved INTO the
 *     expanded detail, so they are asserted with the row expanded.
 *   - **R5** — a collapsed row shows the status and nothing else; the fields
 *     appear on expansion. A row that renders its detail while collapsed has
 *     not actually been migrated.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanRow } from "./PlanRow";

// One shared spy, so the Phase 3 cases can assert that Spawn DID or DID NOT
// navigate. `vi.hoisted` is required: `vi.mock` is hoisted above every plain
// `const`, so a bare module-scope `vi.fn()` would still be undefined when the
// factory runs.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockClear();
});

function renderRow(
  plan: Parameters<typeof PlanRow>[0]["plan"],
  expanded = false
) {
  return render(
    <PlanRow plan={plan} expanded={expanded} onToggle={() => {}} />
  );
}

describe("PlanRow status tag", () => {
  it("renders SHIPPED in green, and not as the raw enum", () => {
    renderRow({ slug: "p-1", status: "shipped" });
    const tag = screen.getByTestId("coord-plan-status-tag");
    expect(tag).toHaveTextContent("Shipped");
    expect(tag.firstElementChild?.className).toContain("green");
    expect(tag).toHaveAttribute("data-tone", "shipped");
  });

  it("renders in-progress visually DISTINCT from shipped", () => {
    const { unmount } = renderRow({ slug: "p-1", status: "shipped" });
    const shippedClass =
      screen.getByTestId("coord-plan-status-tag").firstElementChild?.className;
    unmount();

    renderRow({ slug: "p-2", status: "in_progress" });
    const activeClass =
      screen.getByTestId("coord-plan-status-tag").firstElementChild?.className;

    expect(activeClass).not.toBe(shippedClass);
    expect(screen.getByTestId("coord-plan-status-tag")).toHaveTextContent(
      "In progress"
    );
  });

  it("shows an unknown status verbatim and marks it unrecognised", () => {
    renderRow({ slug: "p-3", status: "weird_new_state" });
    const tag = screen.getByTestId("coord-plan-status-tag");
    expect(tag).toHaveTextContent("weird_new_state");
    expect(tag).toHaveAttribute("data-recognised", "false");
    expect(tag).toHaveAttribute("data-tone", "unknown");
  });

  it("renders a tag even when coord sent no status at all", () => {
    // Previously the badge was omitted entirely, so "no status" and "not
    // loaded yet" looked the same.
    renderRow({ slug: "p-4" });
    const tag = screen.getByTestId("coord-plan-status-tag");
    expect(tag).toHaveTextContent("No status");
    expect(tag).toHaveAttribute("data-recognised", "false");
  });
});

describe("PlanRow detail (R5) and the frozen testids (D4a)", () => {
  const plan = {
    slug: "2026-08-16-p-5",
    status: "draft",
    title: "A plan with a title",
    created_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
    updated_at: new Date(Date.now() - 3600_000).toISOString(),
  };

  it("keeps the detail OUT of the DOM while collapsed", () => {
    renderRow(plan, false);
    expect(screen.getByTestId("coord-plan-card")).toBeInTheDocument();
    expect(screen.queryByTestId("coord-plan-card-dates")).toBeNull();
    expect(screen.queryByTestId("coord-plan-card-link")).toBeNull();
    expect(screen.queryByTestId("coord-plan-card-spawn-btn")).toBeNull();
  });

  it("surfaces the creation date once expanded", () => {
    renderRow(plan, true);
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/created 3d ago/);
    expect(dates).toHaveTextContent(/updated 1h ago/);
  });

  it("prefers shipped-at over updated-at when present", () => {
    renderRow(
      {
        slug: "2026-08-16-p-6",
        status: "shipped",
        created_at: new Date(Date.now() - 10 * 86400_000).toISOString(),
        updated_at: new Date(Date.now() - 3600_000).toISOString(),
        shipped_at: new Date(Date.now() - 7200_000).toISOString(),
      },
      true
    );
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/shipped 2h ago/);
    expect(dates).not.toHaveTextContent(/updated/);
  });

  it("says so when coord recorded no creation date, rather than blanking", () => {
    renderRow({ slug: "p-7", status: "draft" }, true);
    expect(screen.getByTestId("coord-plan-card-dates")).toHaveTextContent(
      /created not recorded/
    );
  });

  it("carries the detail route as an explicit action, not a whole-row link (D1)", () => {
    renderRow(plan, true);
    const link = screen.getByTestId("coord-plan-card-link");
    expect(link).toHaveAttribute(
      "href",
      "/admin/coord/plans/2026-08-16-p-5"
    );
    expect(screen.getByTestId("coord-plan-card-spawn-btn")).toBeInTheDocument();
    // The row itself must NOT be an anchor any more — that is the whole point
    // of D1, and it is the one thing a testid check cannot see.
    expect(
      screen.getByTestId("coord-plan-card").querySelector("a")
    ).toBe(link);
  });
});

describe("PlanRow body signals", () => {
  /**
   * Plan `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`,
   * Phases 1, 2 and 5a. The copy and the derivation are covered by
   * `planBodySignal.test.ts` and by the backend; what is asserted here is
   * that the ROW wires them through — the original defect on this surface was
   * a rendering one, and the failure mode this plan is about is a signal that
   * reads as more (or less) certain than it is.
   */

  it("renders unknown as its own visible chip — never blank, never a tick", () => {
    renderRow({
      slug: "2026-09-01-x",
      status: "in_progress",
      body_provenance: "never_scanned",
      has_body: "unknown",
      body_unknown_reason: "empty_corpus_for_org",
    });
    const chip = screen.getByTestId("coord-plan-has-body-unknown");
    expect(chip).toHaveTextContent("document unknown");
    // Not the settled answers — in either direction.
    expect(screen.queryByTestId("coord-plan-has-body-true")).toBeNull();
    expect(screen.queryByTestId("coord-plan-has-body-false")).toBeNull();
    // ...and the reason is reachable, not swallowed.
    expect(chip.getAttribute("title")).toContain("not the principal");
  });

  it("labels never_scanned as a SCREEN and states its precision", () => {
    renderRow({
      slug: "2026-09-01-x",
      status: "draft",
      body_provenance: "never_scanned",
      has_body: false,
    });
    const chip = screen.getByTestId("coord-plan-provenance-never-scanned");
    expect(chip).toHaveTextContent("no document seen");
    expect(chip.getAttribute("title")).toContain("SCREEN, not a verdict");
    expect(chip.getAttribute("title")).toContain("27.6% precision");
  });

  it("distinguishes scanned_locally from scanned (Phase 5a)", () => {
    renderRow({
      slug: "2026-09-01-x",
      status: "draft",
      body_provenance: "scanned_locally",
      has_body: "unknown",
      body_unknown_reason: "capture_off",
    });
    expect(
      screen.getByTestId("coord-plan-provenance-scanned-locally")
    ).toHaveTextContent("one machine only");
  });

  it("renders NO provenance chip for scanned — it is not proof of a body", () => {
    renderRow({
      slug: "2026-09-01-x",
      status: "draft",
      body_provenance: "scanned",
      has_body: true,
    });
    expect(screen.queryByTestId("coord-plan-provenance-never-scanned")).toBeNull();
    expect(
      screen.queryByTestId("coord-plan-provenance-scanned-locally")
    ).toBeNull();
    expect(screen.getByTestId("coord-plan-has-body-true")).toBeInTheDocument();
  });

  it("suppresses the whole marker group on a TERMINAL unit", () => {
    // A shipped work unit that never had a document is not a defect — badging
    // it would spend the signal's credibility on correctly-closed work.
    renderRow({
      slug: "2026-08-16-shipped",
      status: "shipped",
      body_provenance: "never_scanned",
      has_body: false,
    });
    expect(screen.queryByTestId("coord-plan-body-signal")).toBeNull();
    expect(screen.queryByTestId("coord-plan-provenance-never-scanned")).toBeNull();
    expect(screen.queryByTestId("coord-plan-has-body-false")).toBeNull();
    // ...and the row is otherwise unchanged.
    expect(screen.getByTestId("coord-plan-status-tag")).toHaveTextContent(
      "Shipped"
    );
  });

  it("renders nothing at all when the backend served no signals", () => {
    // A build that predates the fields must not render "no document" over
    // rows it was simply never told about.
    renderRow({ slug: "2026-09-01-x", status: "draft" });
    expect(screen.queryByTestId("coord-plan-body-signal")).toBeNull();
  });

  it("repeats the markers in the detail, where the caveat can be READ", () => {
    // The row's chips are dropped below `sm` and their caveat lives in a
    // `title`, which a touch device cannot hover.
    renderRow(
      {
        slug: "2026-09-01-x",
        status: "in_progress",
        body_provenance: "never_scanned",
        has_body: "unknown",
        body_unknown_reason: "capture_never_configured",
      },
      true
    );
    const detail = screen.getByTestId("coord-plan-has-body-unknown-detail");
    expect(detail).toHaveTextContent("document unknown");
    expect(detail).toHaveTextContent(/ever been written/);
    expect(
      screen.getByTestId("coord-plan-provenance-never-scanned-detail")
    ).toHaveTextContent(/SCREEN, not a verdict/);
  });

  it("keeps every frozen testid alive alongside the new chips (D4a)", () => {
    renderRow(
      {
        slug: "2026-09-01-x",
        status: "in_progress",
        body_provenance: "never_scanned",
        has_body: false,
      },
      true
    );
    for (const id of [
      "coord-plan-card",
      "coord-plan-status-tag",
      "coord-plan-card-dates",
      "coord-plan-card-link",
      "coord-plan-card-spawn-btn",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});

describe("PlanRow spawn guard (Phase 3)", () => {
  /**
   * The incident this plan was written for: an operator picked a bodyless row
   * off this console and sent a session at a plan that does not exist. The
   * chips above make that visible; these cases pin that the SPAWN action
   * itself now costs a deliberate second click on exactly the rows that earn
   * one — and costs nothing at all everywhere else.
   */

  /** Expand, click Spawn once, and report what happened. */
  async function clickSpawn(plan: Parameters<typeof PlanRow>[0]["plan"]) {
    const user = userEvent.setup();
    renderRow(plan, true);
    await user.click(screen.getByTestId("coord-plan-card-spawn-btn"));
    return user;
  }

  it("confirms before spawning when the document is proven absent", async () => {
    await clickSpawn({
      slug: "2026-09-01-x",
      status: "in_progress",
      has_body: false,
      body_provenance: "never_scanned",
    });

    // The first click states the cost instead of navigating.
    expect(push).not.toHaveBeenCalled();
    const notice = screen.getByTestId("coord-plan-spawn-body-confirm");
    expect(notice).toHaveAttribute("data-risk", "absent");
    expect(notice).toHaveTextContent("This work unit has no plan document.");
    expect(notice).toHaveTextContent(/have to author the plan/);
    // ...and the button says what the next click will do.
    expect(screen.getByTestId("coord-plan-card-spawn-btn")).toHaveTextContent(
      "Spawn anyway"
    );
  });

  it("is a confirm, not a block — the second click spawns", async () => {
    // Spawning a session to AUTHOR the plan from good metadata is a
    // legitimate and common move (§9). The guard must never remove it.
    const user = await clickSpawn({
      slug: "2026-09-01-x",
      status: "draft",
      has_body: false,
    });
    await user.click(screen.getByTestId("coord-plan-card-spawn-btn"));
    expect(push).toHaveBeenCalledWith("/admin/coord/spawn");
  });

  it("is reversible — Cancel puts the row back", async () => {
    const user = await clickSpawn({
      slug: "2026-09-01-x",
      status: "draft",
      has_body: false,
    });
    await user.click(screen.getByTestId("coord-plan-card-spawn-cancel"));
    expect(screen.queryByTestId("coord-plan-spawn-body-confirm")).toBeNull();
    expect(screen.getByTestId("coord-plan-card-spawn-btn")).toHaveTextContent(
      "Spawn"
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("confirms on unknown + never_scanned, worded as UNPROVEN", async () => {
    await clickSpawn({
      slug: "2026-09-01-x",
      status: "in_progress",
      has_body: "unknown",
      body_provenance: "never_scanned",
      body_unknown_reason: "capture_off",
    });

    expect(push).not.toHaveBeenCalled();
    const notice = screen.getByTestId("coord-plan-spawn-body-confirm");
    expect(notice).toHaveAttribute("data-risk", "unproven");
    // An unknown confirm that reads like a false confirm fails the honesty
    // gate, so the assertion is on the words, not only on the appearance.
    expect(notice).toHaveTextContent(/UNPROVEN, not proof of absence/);
    expect(notice).not.toHaveTextContent(
      "This work unit has no plan document."
    );
    expect(notice).toHaveTextContent(/switched off/);
  });

  it.each([
    [
      "unknown + scanned (the two weak signals disagree)",
      { has_body: "unknown" as const, body_provenance: "scanned" as const },
    ],
    [
      "unknown + scanned_locally",
      {
        has_body: "unknown" as const,
        body_provenance: "scanned_locally" as const,
      },
    ],
    ["a document that exists", { has_body: true }],
    ["a row the backend never annotated", {}],
  ])("spawns straight through on %s", async (_label, signal) => {
    await clickSpawn({ slug: "2026-09-01-x", status: "in_progress", ...signal });

    expect(screen.queryByTestId("coord-plan-spawn-body-confirm")).toBeNull();
    expect(push).toHaveBeenCalledWith("/admin/coord/spawn");
  });

  it("spawns straight through on a TERMINAL unit, however bodyless", async () => {
    // A shipped work unit that never had a document is not a defect, so it
    // is not a spawn worth interrupting either.
    await clickSpawn({
      slug: "2026-08-16-shipped",
      status: "shipped",
      has_body: false,
      body_provenance: "never_scanned",
    });

    expect(screen.queryByTestId("coord-plan-spawn-body-confirm")).toBeNull();
    expect(push).toHaveBeenCalledWith("/admin/coord/spawn");
  });

  it("keeps every frozen testid alive while confirming (D4a)", async () => {
    await clickSpawn({
      slug: "2026-09-01-x",
      status: "draft",
      has_body: false,
    });
    for (const id of [
      "coord-plan-card",
      "coord-plan-status-tag",
      "coord-plan-card-dates",
      "coord-plan-card-link",
      "coord-plan-card-spawn-btn",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});

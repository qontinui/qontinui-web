/**
 * CiRepoStrip — "Notify when green" arm-outcome reporting.
 *
 * Was `CiStatusPanel`, mounted on `/admin/coord/pipeline` under the hero; the
 * 2026-09-19 redesign moved it onto the Train tab's repo axis. The arm-outcome
 * contract below is unchanged by that move and these tests are carried over
 * verbatim — the component's rename is the only edit. Two NEW properties the
 * move is responsible for are asserted at the end of this file.
 *
 * Follow-up to plan `2026-08-03-gate-class-producers-and-clearance-rules-inert`
 * Phase 3. P3 stopped the backend from swallowing `gate_class` and declared
 * `warnings` on the response so coord's signal stayed reachable — but nothing
 * downstream read it, and the panel reported every 200 as a successfully armed
 * gate.
 *
 * The load-bearing contract here is that a 200 is NOT success on its own.
 * coord evaluates the CiGreen predicate once at registration and reports
 * `initial_verdict`; only `open` means "armed, waiting". `cleared` means the
 * repo was already green (no notification is coming) and `failed` /
 * `misconfigured` mean the gate will never fire. An unrecognized or absent
 * verdict must read as unknown, never as success.
 *
 * `useCiStatusStream` and `httpClient` are stubbed so the render is isolated
 * to the panel itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
const useCiStatusStreamMock = vi.fn();
vi.mock("./useCiStatusStream", () => ({
  useCiStatusStream: (...args: unknown[]) => useCiStatusStreamMock(...args),
}));

import { CiRepoStrip } from "./CiRepoStrip";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RepoCiRow } from "./types";

const GATE_ID = "77777777-7777-7777-7777-777777777777";

function ciRow(overrides: Partial<RepoCiRow> = {}): RepoCiRow {
  return {
    repo: "qontinui/qontinui-web",
    // Not green, so the "Notify when green" action is enabled.
    main_verdict: "red",
    open_pr_checks: { success: 0, failure: 0, pending: 0 },
    latest_details_url: null,
    main_head_sha: "abc123",
    ...overrides,
  };
}

/** Render the strip with one repo row and coord's register response stubbed. */
function renderWithCoordResponse(body: Record<string, unknown>) {
  useCiStatusStreamMock.mockReturnValue({
    byRepo: new Map([["qontinui/qontinui-web", ciRow()]]),
    connected: true,
    seeded: true,
    error: null,
  });
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  // The app mounts a TooltipProvider higher up; supply one here so the
  // panel's tooltips (including the arm-outcome detail) can render.
  return render(
    <TooltipProvider>
      <CiRepoStrip />
    </TooltipProvider>
  );
}

async function clickNotify(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(
    "[data-action='notify-when-green']"
  );
  expect(button).not.toBeNull();
  await userEvent.click(button!);
  await waitFor(() =>
    expect(container.querySelector("[data-arm-tone]")).not.toBeNull()
  );
  return container.querySelector("[data-arm-tone]")!;
}

describe("CiRepoStrip notify-when-green arm outcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports an `open` verdict as armed", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: [],
      initial_verdict: "open",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("armed");
    expect(chip.textContent).toContain("gate armed");
    // Namespaced away from `data-gate-id`, which the console uses for gate
    // ROWS (`GatesTable` / `GateActions`).
    expect(chip.getAttribute("data-arm-gate-id")).toBe(GATE_ID);
    expect(chip.getAttribute("data-gate-id")).toBeNull();
  });

  it("does NOT report `cleared` as armed — the repo was already green", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: [],
      initial_verdict: "cleared",
      initial_verdict_reason: "main is green at abc123",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("cleared");
    expect(chip.textContent).toContain("already green");
    expect(chip.textContent).not.toContain("gate armed");
  });

  it("does NOT report `misconfigured` as armed — the gate will never fire", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: ["initial evaluation could not be completed"],
      initial_verdict: "misconfigured",
      initial_verdict_reason: "repo qontinui/qontinui-web not found",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("dead");
    expect(chip.textContent).toContain("will not fire");
  });

  it("treats `failed` as a gate that will never fire", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: [],
      initial_verdict: "failed",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("dead");
  });

  it("treats an ABSENT verdict as unknown, never as armed", async () => {
    // A coord that reports no verdict. Claiming "armed" on absent evidence is
    // the false-success this reporting exists to close.
    const { container } = renderWithCoordResponse({ gate_id: GATE_ID });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("unknown");
    expect(chip.textContent).not.toContain("gate armed");
  });

  it("treats an UNRECOGNIZED verdict as unknown, never as armed", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      initial_verdict: "some-future-coord-verdict",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("unknown");
    expect(chip.textContent).not.toContain("gate armed");
  });

  it("surfaces coord's warnings on an otherwise-armed gate", async () => {
    // `warnings` already carries coord's `steer` string when one applies, so
    // this is also the steer path.
    const steer = "this repo's PRs are orchestrated; prefer the merge train";
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: [steer],
      initial_verdict: "open",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("armed");
    // The warning rides the tooltip, which mounts on hover.
    await userEvent.hover(chip);
    await waitFor(() => expect(screen.getAllByText(steer).length).toBeGreaterThan(0));
  });
});

// ---------------------------------------------------------------------------
// What the 2026-09-19 move is responsible for.
//
// Both of these are properties of the COMPONENT's shape rather than of any
// render, which is why they are asserted at the source. A render test cannot
// see "the fetch is owned above the disclosure" — that was exactly how the R7
// violation survived in `CiStatusPanel` unnoticed.
// ---------------------------------------------------------------------------

describe("CiRepoStrip structure", () => {
  const SRC = readFileSync(join(__dirname, "CiRepoStrip.tsx"), "utf8");
  /**
   * The source with its comments removed.
   *
   * Scanning the raw text does not work here and the reason is worth stating:
   * this module's header, and its component docblock, both name
   * `<CollapsiblePanel>` — because recording what a file stopped doing is how
   * the next author learns not to redo it. A substring check over the raw
   * source would make that documentation illegal, which is the wrong
   * incentive to build into a test.
   */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    // Line comments only — anchored on start-or-whitespace so it does not
    // also truncate every line containing a `https://` URL, which the naive
    // `\/\/.*$` did (it ate `repoPrQueueHref`'s template literal, leaving
    // `CODE` quietly not being what this comment says it is).
    /(^|\s)\/\/.*$/gm,
    "$1"
  );

  it("owns its transport, and is not wrapped in a panel that outlives it", () => {
    // The R7 violation this component used to BE: `useCiStatusStream()` sat
    // above a `<CollapsiblePanel>`, so the REST seed, the WebSocket and the
    // poll ran for every visitor to /admin/coord/pipeline whether or not they
    // ever opened it. Laziness now comes from the Train tab not being mounted,
    // which only holds while this file has no panel of its own to hide behind.
    expect(CODE).toContain("useCiStatusStream()");
    expect(CODE).not.toContain("CollapsiblePanel");
  });

  it("renders one repo as ONE row (R2), not a stacked two-line card", () => {
    // ASSERTED ON DESCENDANTS, and that is the whole point of this test.
    //
    // The first version checked `flex`, `items-center` and `not flex-wrap` on
    // the `[data-ci-repo]` element itself — and review showed all three of
    // those passed against the PRE-redesign markup this test claims to forbid
    // (`flex items-center gap-3 px-3 py-2 border rounded-md …`). The stacking
    // was never on the row element; it was in a child that wrapped the repo
    // name in a `<p>` over a second `flex-wrap` line of badges. A test that
    // cannot fail against the thing it forbids is worse than no test, because
    // it reads as coverage.
    useCiStatusStreamMock.mockReturnValue({
      byRepo: new Map([
        ["qontinui/qontinui-web", ciRow()],
        ["qontinui/qontinui-coord", ciRow({ repo: "qontinui/qontinui-coord" })],
      ]),
      connected: true,
      seeded: true,
      error: null,
    });
    const { container } = render(
      <TooltipProvider>
        <CiRepoStrip />
      </TooltipProvider>
    );
    const rows = container.querySelectorAll("[data-ci-repo]");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // R2's mechanism: a single horizontal flexbox. What it forbids is a row
      // whose height changes, because vertical rhythm is what a list is
      // skimmed by — so no descendant may wrap, anywhere in the subtree.
      expect(row.className).toContain("flex");
      expect(row.className).toContain("items-center");
      expect(row.querySelectorAll(".flex-wrap")).toHaveLength(0);
      // And no block-level stacking container: the old shape's tell was a
      // `<p>` holding the repo name above a sibling div of badges.
      expect(row.querySelectorAll("p")).toHaveLength(0);
      // The repo name and the verdict badge are SIBLINGS on one line, not
      // parent-and-child on two.
      const repoName = within(row as HTMLElement).getByText(/qontinui-(web|coord)$/);
      const verdict = within(row as HTMLElement).getByText(/^main:/);
      expect(repoName.parentElement).toBe(verdict.parentElement);
    }
  });

  it("says what a red main actually means, once, on the strip", () => {
    // The mis-reading this strip is most exposed to now that it sits among
    // per-repo TRAIN rows: `main: red` is not "this repo's PRs are failing",
    // it is "coord will not land any of them".
    useCiStatusStreamMock.mockReturnValue({
      byRepo: new Map([["qontinui/qontinui-web", ciRow()]]),
      connected: true,
      seeded: true,
      error: null,
    });
    render(
      <TooltipProvider>
        <CiRepoStrip />
      </TooltipProvider>
    );
    expect(
      screen.getByText(/coord lands nothing onto a red main/i)
    ).toBeInTheDocument();
  });
});

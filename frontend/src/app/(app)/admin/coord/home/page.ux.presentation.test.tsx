/**
 * /admin/coord/home in presentation mode — what the 2026-10-31 UX pass
 * changed (plan `2026-10-23-console-presentation-spaces` Phase 2 follow-up).
 * The operator half is `page.ux.test.tsx`; the page's readiness proof is
 * still `page.presentation.test.tsx`.
 *
 * Renders the real page through `renderInPresentationMode`, mocking only its
 * data sources: the project-state read (`httpFetch`) and the reads beside it
 * (`__fixtures__/supplementReads`). Every test also scans EVERY attribute of
 * the page — `href` included, which `expectPresentationSafe` does not read —
 * for the fixture's identifiers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  sessionMachineAliases,
  type CaptionKey,
} from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
  type PresentationRenderResult,
} from "@/test/presentation";
import {
  BARE_REPO,
  FIRST_PARTY_REPO,
  FOREIGN_REPO,
  MUST_NOT_APPEAR,
  SCOPE,
  fullBody,
  initiativeBody,
} from "./__fixtures__/presentationFixture";
import { expandRow } from "./__fixtures__/homePageDriver";
import {
  fleetHealth,
  gatesOverview,
  pendingQuestions,
  resetSupplements,
  roster,
} from "./__fixtures__/supplementReads";
import {
  GATES_SOURCE,
  MACHINES_SOURCE,
  QUESTIONS_SOURCE,
} from "./_lib/homeSupplements";

const httpFetch = vi.fn();
vi.mock("@/services/service-factory", async () => {
  const s = await import("./__fixtures__/supplementReads");
  return {
    httpClient: s.homeTransport(
      (...args: unknown[]) => httpFetch(...args) as Promise<Response>
    ),
  };
});

vi.mock("@/contexts/tenant-context", async () => {
  const f = await import("./__fixtures__/presentationFixture");
  return {
    useTenant: () => ({
      tenants: [{ id: f.TENANT_ID, name: f.TENANT_NAME }],
      activeTenantId: f.TENANT_ID,
      loading: false,
      error: null,
    }),
  };
});

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/admin/coord/home",
}));

import CoordHomePage from "./page";

/** The roster's own identifiers, which must never reach the presented page. */
const ROSTER_IDS = [
  "example-host-0",
  "example-host-1",
  "example-host-2",
  "00000000-0000-4000-8000-000000000000",
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];
const FORBIDDEN = [...MUST_NOT_APPEAR, ...ROSTER_IDS];

/** Every attribute value on the page, `href` included. */
function attributeValues(): string[] {
  const out: string[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    for (const attr of el.attributes) out.push(attr.value);
  }
  return out;
}

function expectNothingLeaked() {
  const attrs = attributeValues().join("\n").toLowerCase();
  const text = (document.body.textContent ?? "").toLowerCase();
  for (const needle of FORBIDDEN) {
    expect(attrs, `attribute carries ${needle}`).not.toContain(
      needle.toLowerCase()
    );
    expect(text, `text carries ${needle}`).not.toContain(needle.toLowerCase());
  }
}

/** A region's provenance chips, by the source they name. */
function chips(region: string): HTMLElement[] {
  const caption = document.querySelector<HTMLElement>(
    `[data-presentation-section="coordination-overview.${region}"]`
  );
  return caption
    ? [...caption.querySelectorAll<HTMLElement>("[data-provenance]")]
    : [];
}

async function renderPresenting(
  body: unknown
): Promise<PresentationRenderResult> {
  httpFetch.mockImplementation(
    async () => new Response(JSON.stringify(body), { status: 200 })
  );
  const view = renderInPresentationMode(<CoordHomePage />, { scope: SCOPE });
  await waitFor(() =>
    expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
  );
  return view;
}

const CAPTIONS: CaptionKey[] = [
  "coordination-overview.page",
  "coordination-overview.degrading",
];

describe("/admin/coord/home?present=1 — the 2026-10-31 UX pass", () => {
  beforeEach(() => {
    httpFetch.mockReset();
    resetSupplements();
    sessionMachineAliases.reset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  describe("Degrading's machine line", () => {
    it("shows the counts with their own source, and no machine's name or id anywhere", async () => {
      const asOf = new Date(Date.now() - 5 * 60_000).toISOString();
      fleetHealth.mockImplementation(async () => ({
        ...roster("degraded", null, "healthy"),
        as_of: asOf,
      }));
      const view = await renderPresenting(fullBody());
      const line = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(line).toHaveTextContent(
          "1 of 3 machines is in a state other than healthy; 1 reports no health state"
        )
      );
      // Dev Ops is presentation-ready, so the link opens there.
      expect(
        within(line).getByRole("link", { name: "See them on Dev Ops" })
      ).toBeInTheDocument();
      const machines = chips("degrading").find((c) =>
        c.textContent?.includes(MACHINES_SOURCE)
      );
      expect(machines).toBeDefined();
      expect(machines).toHaveAttribute("data-provenance-known", "true");
      expect(machines).toHaveTextContent(/as of 5m ago/);
      expectPresentationSafe(view, {
        captions: CAPTIONS,
        forbidden: FORBIDDEN,
      });
      expectNothingLeaked();
    });

    it("dates an unread roster UNKNOWN, never by the project state's read", async () => {
      fleetHealth.mockRejectedValue(new TypeError("unreachable"));
      await renderPresenting(fullBody());
      const line = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(line).toHaveAttribute("data-machines-state", "could_not_read")
      );
      const machines = chips("degrading").find((c) =>
        c.textContent?.includes(MACHINES_SOURCE)
      );
      expect(machines).toHaveAttribute("data-provenance-known", "false");
      expect(machines).toHaveTextContent("as of UNKNOWN");
      expect(
        within(line).queryByRole("link", { name: /Dev Ops/ })
      ).not.toBeInTheDocument();
    });
  });

  describe("withheld repositories", () => {
    /** The repository groups' identity chips, in render order. */
    const identities = () =>
      within(screen.getByTestId("coord-home.on-track"))
        .getAllByTestId("coord-home.on-track.group")
        .map(
          (g) => g.querySelector("[data-console-row] > span")?.textContent ?? ""
        );

    it("read as stable, distinct aliases, and their names reach no text or attribute", async () => {
      const view = await renderPresenting(fullBody());
      // Coord's order: the foreign repository, the first-party one, the bare one.
      expect(identities()).toEqual([
        "Repository A",
        FIRST_PARTY_REPO,
        "Repository B",
        "no repo named",
      ]);
      const detail = expandRow(
        screen.getByTestId("coord-home.on-track"),
        /^Repository B/
      );
      expect(detail).toHaveTextContent("Work units that name Repository B.");
      expectPresentationSafe(view, { forbidden: FORBIDDEN });
      expectNothingLeaked();
      const html = document.body.innerHTML;
      for (const repo of [FOREIGN_REPO, BARE_REPO]) {
        expect(html).not.toContain(repo);
      }
    });

    it("keep their letters across a poll that reorders them", async () => {
      const first = fullBody();
      await renderPresenting(first);
      expect(identities()[0]).toBe("Repository A");
      const groups = (first.on_track as { groups: unknown[] }).groups;
      const reordered = {
        ...first,
        on_track: { ...first.on_track, groups: [...groups].reverse() },
      };
      httpFetch.mockImplementation(
        async () => new Response(JSON.stringify(reordered), { status: 200 })
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId("coord-home.refresh"));
      });
      await waitFor(() =>
        expect(identities()).toEqual([
          "no repo named",
          "Repository B",
          FIRST_PARTY_REPO,
          "Repository A",
        ])
      );
    });
  });

  describe("the initiative, when coord could not parse its document", () => {
    it("says so in a fixed sentence, never coord's parser message or a descriptor", async () => {
      const view = await renderPresenting(
        initiativeBody({
          state: "unparseable",
          error: "frontmatter line 8: indented line is not a `- item`",
        })
      );
      const initiative = screen.getByTestId("coord-home.on-track.initiative");
      expect(
        within(initiative).getByTestId(
          "coord-home.on-track.initiative.unparseable"
        )
      ).toHaveTextContent(
        "The current initiative's document could not be read as written, so its status and scope are not shown."
      );
      expect(initiative).not.toHaveTextContent(
        /frontmatter|could not be parsed|Reason ·/
      );
      expectPresentationSafe(view, { forbidden: ["frontmatter line 8"] });
      expectNothingLeaked();
    });
  });

  describe("sections not built yet", () => {
    it.each([
      [
        "no source exists",
        { state: "unknown", reason: "verification_metrics_door_absent" },
      ],
      ["coord has not built the block", { state: "not_implemented" }],
    ])(
      "leave Correct? out of the presented page when %s",
      async (_name, correctness) => {
        await renderPresenting(fullBody({ correctness }));
        expect(
          screen.queryByTestId("coord-home.correct")
        ).not.toBeInTheDocument();
        expect(
          document.querySelector(
            '[data-presentation-section="coordination-overview.correct"]'
          )
        ).toBeNull();
      }
    );

    it("keep Correct? when coord could not read it: an unknown is shown as unknown", async () => {
      await renderPresenting(
        fullBody({ correctness: { state: "could_not_read" } })
      );
      expect(screen.getByTestId("coord-home.correct")).toHaveTextContent(
        "Not known — coord could not read trust calibration this time"
      );
    });

    it("count the sources not built yet on one line rather than list them", async () => {
      await renderPresenting(
        fullBody({
          does_not_know: [
            { source: "work_units", state: "read" },
            { source: "verification_metrics", state: "not_implemented" },
            {
              source: "infra_health_observations (cloud, latest per resource)",
              state: "not_implemented",
            },
            { source: "fleet_drain", state: "could_not_read" },
          ],
        })
      );
      const region = screen.getByTestId("coord-home.does-not-know");
      expect(
        within(region).getByTestId("coord-home.does-not-know.count")
      ).toHaveTextContent("3 of 4 sources not read");
      const rows = within(region).getAllByTestId(
        "coord-home.does-not-know.row"
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("Machine drains");
      for (const row of rows)
        expect(row).not.toHaveTextContent("not built yet");
      expect(
        within(region).getByTestId("coord-home.does-not-know.not-built")
      ).toHaveTextContent(
        "2 further sources are not built yet, so this view does not show them."
      );
      expect(region).not.toHaveTextContent(
        /Verification measurements|Cloud service health/
      );
    });
  });

  describe("captions and provenance", () => {
    it("give each section one sentence, and the project state one provenance line for the page", async () => {
      await renderPresenting(fullBody());
      const sections = document.querySelectorAll(
        '[data-presentation-section^="coordination-overview."]'
      );
      expect(sections.length).toBeGreaterThanOrEqual(5);
      for (const section of sections) {
        expect(
          section.querySelectorAll('[data-caption-part="one-liner"]')
        ).toHaveLength(1);
        expect(
          section.querySelector('[data-caption-part="why-it-matters"]')
        ).toBeNull();
        for (const chip of section.querySelectorAll("[data-provenance]")) {
          expect(chip.textContent).not.toContain("coord's project state");
        }
      }
      const line = screen.getByTestId("coord-home.provenance");
      expect(line.querySelectorAll("[data-provenance]")).toHaveLength(1);
      expect(line).toHaveTextContent("source: coord's project state");
      // The page caption keeps why it matters.
      expect(
        document.querySelector(
          '[data-presentation-caption="coordination-overview.page"] [data-caption-part="why-it-matters"]'
        )
      ).not.toBeNull();
    });
  });

  describe("Needs you's counts, while coord serves no needs block", () => {
    it("counts with their own sources, links to no page it cannot show, and quotes no gate or question", async () => {
      pendingQuestions.mockImplementation(async () => ({
        questions: [{ id: "q", question: "Should Acme Corp get a discount?" }],
        total: 4,
      }));
      gatesOverview.mockImplementation(async () => ({
        generated_at: new Date().toISOString(),
        gates: [
          {
            gate_id: "7c6b5a49-3d2e-4f10-9e8d-7c6b5a493d2e",
            verdict: "open",
            clearance_audience: "operator",
            predicate: { kind: "operator_approval" },
            title: "Approve the Acme Corp contract renewal",
          },
        ],
        counts: { open: 1 },
      }));
      const view = await renderPresenting(
        fullBody({ needs_me: { state: "not_implemented" } })
      );
      const counts = screen.getByTestId("coord-home.needs-you.counts");
      await waitFor(() =>
        expect(counts).toHaveTextContent("Approvals waiting on the operator: 1")
      );
      expect(counts).toHaveTextContent(
        "Agent questions waiting on the operator: 4"
      );
      expect(within(counts).queryByRole("link")).toBeNull();
      expect(counts.querySelector("[data-lens-link]")).toBeNull();
      expect(counts.textContent).not.toMatch(/Gates|Questions/);
      const sources = chips("needs-you").map((c) => c.textContent ?? "");
      expect(sources.some((t) => t.includes(GATES_SOURCE))).toBe(true);
      expect(sources.some((t) => t.includes(QUESTIONS_SOURCE))).toBe(true);
      expectPresentationSafe(view, {
        captions: ["coordination-overview.needs-you"],
        forbidden: [...FORBIDDEN, "Acme Corp", "discount"],
      });
      expectNothingLeaked();
    });
  });
});

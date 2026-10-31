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
import { screen, waitFor, within } from "@testing-library/react";
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
  MUST_NOT_APPEAR,
  SCOPE,
  fullBody,
} from "./__fixtures__/presentationFixture";
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

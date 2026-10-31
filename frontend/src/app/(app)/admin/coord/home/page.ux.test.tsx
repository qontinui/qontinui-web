/**
 * /admin/coord/home — what the 2026-10-31 UX pass changed on the rendered
 * page (plan `2026-10-23-console-presentation-spaces` Phase 2 follow-up), in
 * operator mode. The presentation half is `page.ux.presentation.test.tsx`;
 * the pure derivations are `coordHomeStatus.ux.test.ts`.
 *
 * Every read the page makes is answered by URL (`answer`), so a test states
 * which source answered what, and an unanswered read rejects.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { expandRow } from "./__fixtures__/homePageDriver";

const httpFetch = vi.fn();
const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => httpFetch(...args),
    get: (...args: unknown[]) => httpGet(...args),
  },
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [{ id: TENANT_ID, name: "Example project" }],
    activeTenantId: TENANT_ID,
    loading: false,
    error: null,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import CoordHomePage from "./page";

const CLASSES = {
  shipped: 0,
  in_flight: 0,
  stalled: 0,
  blocked_on_dependency: 0,
  waiting_on_gate: 0,
  not_started: 1,
  closed_other: 0,
  off_vocabulary: 0,
  unset: 0,
};

/** A project state with one repository counting one not-started unit. */
export function oneUnitBody(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    generated_at: new Date().toISOString(),
    tenant_id: TENANT_ID,
    on_track: {
      state: "read",
      totals: { row_count: 1, classes: CLASSES },
      groups: [
        {
          key: "example-repo",
          kind: "repo",
          row_count: 1,
          classes: CLASSES,
          named: {
            stalled: { units: [], omitted: 0 },
            waiting_on_gate: { units: [], omitted: 0 },
          },
        },
      ],
      stall_window_secs: 14 * 86_400,
    },
    correctness: { state: "read" },
    needs_me: { state: "read", items: [], total: 0, omitted: 0 },
    degradations: {
      state: "read",
      headline: "none",
      open: [],
      declared: [],
      recently_cleared: [],
      planes: [],
    },
    does_not_know: [
      { source: "work_units", state: "read", as_of: new Date().toISOString() },
    ],
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Answer each read by URL prefix; anything else rejects. */
function answer(
  routes: Record<string, () => Response | Promise<Response>>,
  gets: Record<string, () => unknown> = {}
) {
  httpFetch.mockImplementation(async (url: string) => {
    const path = url.split("?")[0]!;
    const route = routes[path];
    if (!route) throw new TypeError(`no answer for ${url}`);
    return route();
  });
  httpGet.mockImplementation(async (url: string) => {
    const path = url.split("?")[0]!;
    const route = gets[path];
    if (!route) throw new Error(`GET ${url} failed: 503 - unavailable`);
    return route();
  });
}

const PROJECT_STATE = "/api/v1/operations/project-state";

async function renderPage() {
  render(<CoordHomePage />);
  await waitFor(() =>
    expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
  );
}

describe("/admin/coord/home — the 2026-10-31 UX pass", () => {
  beforeEach(() => {
    httpFetch.mockReset();
    httpGet.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Work by state", () => {
    it("is headed by what it counts, not by a judgement", async () => {
      answer({ [PROJECT_STATE]: () => json(oneUnitBody()) });
      await renderPage();
      const region = screen.getByTestId("coord-home.on-track");
      expect(
        within(region).getByRole("heading", { level: 2 })
      ).toHaveTextContent(/^Work by state$/);
      expect(region).not.toHaveTextContent(/on track/i);
    });

    it("counts one unit in the singular, in the header and on the group", async () => {
      answer({ [PROJECT_STATE]: () => json(oneUnitBody()) });
      await renderPage();
      const region = screen.getByTestId("coord-home.on-track");
      expect(
        within(region).getByTestId("coord-home.on-track.count")
      ).toHaveTextContent(/^1 work unit$/);
      const group = within(region).getByTestId("coord-home.on-track.group");
      expect(within(group).getByText(/^1 units?$/)).toHaveTextContent(
        /^1 unit$/
      );
    });
  });

  describe("a repository group, expanded", () => {
    it("accounts for every unit its badge counts, and points to the page that lists the rest", async () => {
      answer({ [PROJECT_STATE]: () => json(oneUnitBody()) });
      await renderPage();
      const row = expandRow(
        screen.getByTestId("coord-home.on-track"),
        "example-repo"
      );
      expect(
        within(row).getByTestId("coord-home.on-track.group.classes")
      ).toHaveTextContent("By state: not started 1.");
      const unnamed = within(row).getByTestId(
        "coord-home.on-track.group.unnamed"
      );
      expect(unnamed).toHaveTextContent(
        "the 1 other unit is not listed here; it is on Work units."
      );
      expect(
        within(unnamed).getByRole("link", { name: "Work units" })
      ).toHaveAttribute("href", "/admin/coord/work-units");
    });

    it("says nothing about other units when coord named all of them", async () => {
      const classes = { ...CLASSES, not_started: 0, stalled: 1 };
      const body = oneUnitBody();
      const onTrack = body.on_track as {
        groups: Array<Record<string, unknown>>;
      };
      onTrack.groups[0] = {
        ...onTrack.groups[0],
        classes,
        named: {
          stalled: {
            units: [
              {
                slug: "2026-10-01-example-unit",
                title: "Example unit",
                age_secs: 20 * 86_400,
                age_basis: "last_recorded_change",
              },
            ],
            omitted: 0,
          },
          waiting_on_gate: { units: [], omitted: 0 },
        },
      };
      answer({ [PROJECT_STATE]: () => json(body) });
      await renderPage();
      const row = expandRow(
        screen.getByTestId("coord-home.on-track"),
        "example-repo"
      );
      expect(
        within(row).getByTestId("coord-home.on-track.group.classes")
      ).toHaveTextContent("By state: no recorded change in 14 days 1.");
      expect(
        within(row).queryByTestId("coord-home.on-track.group.unnamed")
      ).not.toBeInTheDocument();
      expect(row).toHaveTextContent("Example unit");
    });
  });

  describe("the no-recorded-change wording", () => {
    it("is plain words with the unit, on the strip and on a repository row", async () => {
      answer({ [PROJECT_STATE]: () => json(oneUnitBody()) });
      await renderPage();
      expect(
        screen.getByTestId("coord-home.strip.no-change")
      ).toHaveTextContent(/^0 units with no recorded change in 14 days$/);
      const group = screen.getByTestId("coord-home.on-track.group");
      expect(group).toHaveTextContent("no recorded change in 14 days 0");
      for (const el of [screen.getByTestId("coord-home.strip"), group]) {
        expect(el).not.toHaveTextContent(/\b14 d\b/);
      }
    });
  });
});

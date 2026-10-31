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
import { expandRow, openSourcesRead } from "./__fixtures__/homePageDriver";
import { NONE_WITHHELD } from "./__fixtures__/supplementReads";

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

  describe("What this view does not know", () => {
    const now = () => new Date().toISOString();
    const SOURCES = [
      { source: "work_units", state: "read", as_of: now() },
      { source: "fleet_drain", state: "read", as_of: now() },
      {
        source: "train_health (per authority repo)",
        state: "read",
        as_of: now(),
        freshness_bound_secs: 20,
      },
      { source: "verification_metrics", state: "not_implemented" },
      { source: "worker_heartbeats", state: "could_not_read", error: "x" },
    ];

    it("lists the sources not read, and puts the read ones behind one disclosure with their count", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody({ does_not_know: SOURCES })),
      });
      await renderPage();
      const region = screen.getByTestId("coord-home.does-not-know");
      expect(
        within(region).getByTestId("coord-home.does-not-know.count")
      ).toHaveTextContent("2 of 5 sources not read");
      const listed = within(region).getAllByTestId(
        "coord-home.does-not-know.row"
      );
      expect(listed).toHaveLength(2);
      expect(listed[0]).toHaveTextContent("Verification measurements");
      expect(listed[0]).toHaveTextContent("not built yet");
      expect(listed[1]).toHaveTextContent("Watcher heartbeats");
      expect(listed[1]).toHaveTextContent("could not be read");
      expect(region).not.toHaveTextContent("Machine drains");
      expect(
        within(region).getByTestId("coord-home.does-not-know.read-count")
      ).toHaveTextContent("read 3");
      const panel = openSourcesRead();
      expect(
        within(panel).getAllByTestId("coord-home.does-not-know.row")
      ).toHaveLength(3);
      expect(panel).toHaveTextContent("Machine drains");
    });

    it("says each unstated clause once per list, never on every row", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody({ does_not_know: SOURCES })),
      });
      await renderPage();
      const region = screen.getByTestId("coord-home.does-not-know");
      openSourcesRead();
      for (const row of within(region).getAllByTestId(
        "coord-home.does-not-know.row"
      )) {
        expect(row).not.toHaveTextContent(/not stated/);
      }
      expect(
        within(region).getByTestId("coord-home.does-not-know.not-read.unstated")
      ).toHaveTextContent(
        "Coord stated no age bound for all 2, and no count of excluded rows for all 2."
      );
      expect(
        within(region).getByTestId("coord-home.does-not-know.read.unstated")
      ).toHaveTextContent(
        "Coord stated no age bound for 2 of 3, and no count of excluded rows for all 3."
      );
      expect(region).toHaveTextContent("may be up to 20s old");
    });

    it("says every source was read when none is unread, and still counts the read ones", async () => {
      answer({
        [PROJECT_STATE]: () =>
          json(oneUnitBody({ does_not_know: SOURCES.slice(0, 3) })),
      });
      await renderPage();
      const region = screen.getByTestId("coord-home.does-not-know");
      expect(
        within(region).getByTestId("coord-home.does-not-know.all-read")
      ).toHaveTextContent("Coord read every source it lists.");
      expect(
        within(region).queryAllByTestId("coord-home.does-not-know.row")
      ).toHaveLength(0);
      expect(
        within(region).getByTestId("coord-home.does-not-know.read-count")
      ).toHaveTextContent("read 3");
    });

    it("never says every source was read when coord listed none", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody({ does_not_know: [] })),
      });
      await renderPage();
      const region = screen.getByTestId("coord-home.does-not-know");
      expect(region).toHaveTextContent("Coord listed no sources — unknown.");
      expect(
        within(region).queryByTestId("coord-home.does-not-know.all-read")
      ).not.toBeInTheDocument();
    });
  });

  describe("Degrading, beside the machine roster the nav counts", () => {
    const FLEET = "/api/v1/operations/fleet/health";
    const QUESTIONS = "/api/v1/operations/agent-questions/pending";
    const roster = (...states: Array<string | null>) => ({
      as_of: new Date().toISOString(),
      devices: states.map((state, i) => ({
        device_id: `d-${i}`,
        hostname: `example-host-${i}`,
        ...(state === null ? {} : { state }),
      })),
      ...NONE_WITHHELD,
    });
    const quiet = { [QUESTIONS]: () => json({ questions: [] }) };

    it("does not read calm while a machine is degrading or has no verdict", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () =>
          json(roster("healthy", "degraded", "partitioned", null, "healthy")),
        ...quiet,
      });
      await renderPage();
      const deg = screen.getByTestId("coord-home.degrading");
      const line = await within(deg).findByText(/2 of 5 machines/);
      expect(line.closest("p")).toHaveTextContent(
        "Machines: 2 of 5 machines are in a degrading state — not in coord's list above; 1 has no health verdict, so its health is unknown. See them on Dev Ops."
      );
      expect(
        within(deg).getByRole("link", { name: "See them on Dev Ops" })
      ).toHaveAttribute("href", "/admin/coord/devops");
      expect(deg).not.toHaveTextContent("Nothing is degrading");
      expect(
        within(deg).getByTestId("coord-home.degrading.machines-not-calm")
      ).toHaveTextContent("a machine is in a degrading state");
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "amber");
      expect(strip).toHaveTextContent("Something is degrading");
      expect(strip).toHaveTextContent(
        "2 machines are in a degrading state. 1 machine has no health verdict — unknown."
      );
      expect(screen.getByTestId("coord-home.strip.machines")).toHaveTextContent(
        /^machines not healthy 2$/
      );
    });

    it("never calls an abandoned or verdict-less machine degrading, and reconciles with the nav by state", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () => json(roster("healthy", "abandoned", "unknown")),
        ...quiet,
      });
      await renderPage();
      const reconcile = await screen.findByTestId(
        "coord-home.degrading.machines-reconcile"
      );
      expect(reconcile).toHaveTextContent(
        "2 machines not reporting healthy are not degradations: 1 abandoned, the 1 with no verdict named above — see Dev Ops."
      );
      expect(
        within(reconcile).getByRole("link", { name: "Dev Ops" })
      ).toHaveAttribute("href", "/admin/coord/devops");
      expect(
        screen.getByTestId("coord-home.degrading.machines")
      ).toHaveTextContent(
        "Machines: 1 of 3 machines has no health verdict, so its health is unknown."
      );
      const deg = screen.getByTestId("coord-home.degrading");
      expect(deg).not.toHaveTextContent("Nothing is degrading");
      expect(
        within(deg).getByTestId("coord-home.degrading.machines-not-calm")
      ).toHaveTextContent("machine health is not fully known");
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "amber");
      expect(strip).not.toHaveTextContent("Something is degrading");
      expect(strip).not.toHaveTextContent(/nothing is degrading/i);
      // The nav's number, so the two read the same.
      expect(screen.getByTestId("coord-home.strip.machines")).toHaveTextContent(
        /^machines not healthy 2$/
      );
    });

    it("says nothing is degrading beside an abandoned machine, and still says why the nav counts it", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () => json(roster("healthy", "abandoned")),
        ...quiet,
      });
      await renderPage();
      await screen.findByTestId("coord-home.degrading.machines-reconcile");
      expect(
        screen.getByTestId("coord-home.degrading.empty")
      ).toHaveTextContent("Nothing is degrading");
      expect(screen.getByTestId("coord-home.strip.health")).toHaveTextContent(
        "1 machine not reporting healthy is not a degradation: 1 abandoned — see Dev Ops."
      );
    });

    it("does not count a machine coord already lists as a degradation twice", async () => {
      answer({
        [PROJECT_STATE]: () =>
          json(
            oneUnitBody({
              degradations: {
                state: "read",
                headline: "degrading",
                open: [
                  {
                    id: "fleet_health:state:d-1",
                    plane: "runner",
                    source: "fleet_health",
                    subject: {
                      kind: "device",
                      name: "example-host-1",
                      id: "d-1",
                    },
                    headline: "A machine has stopped heartbeating to coord",
                    declared: false,
                  },
                ],
                declared: [],
                recently_cleared: [],
                planes: [],
              },
            })
          ),
        [FLEET]: () => json(roster("healthy", "partitioned")),
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveTextContent(
          "1 of 2 machines is in a degrading state — listed above."
        )
      );
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveTextContent("Something is degrading");
      // Named once, as listed — the strip's lines add up to its badge.
      expect(strip).toHaveTextContent(
        "1 machine in a degrading state is among the open degradations."
      );
      expect(strip).not.toHaveTextContent("1 machine is in a degrading state.");
      expect(screen.getByTestId("coord-home.strip.degraded")).toHaveTextContent(
        /^degraded 1$/
      );
    });

    it("does not count placeholder rows as machines: healthy machines beside them read calm", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () => {
          const r = roster(...Array.from({ length: 8 }, () => "healthy"));
          return json({
            ...r,
            devices: [
              ...r.devices,
              { device_id: "p-0", dispatch_liveness: "unknown" },
              {
                device_id: "p-1",
                state: "partitioned",
                dispatch_liveness: "unknown",
              },
            ],
          });
        },
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveTextContent("All 8 machines report healthy.")
      );
      expect(machines).not.toHaveTextContent("of 10");
      expect(machines).not.toHaveTextContent("no health verdict");
      expect(
        screen.getByTestId("coord-home.degrading.machines-placeholders")
      ).toHaveTextContent(
        "2 placeholder rows coord does not grade are not counted as machines."
      );
      // The nav counts the partitioned placeholder; the reconcile line says so.
      expect(
        screen.getByTestId("coord-home.degrading.machines-reconcile")
      ).toHaveTextContent(
        "1 row not reporting healthy is not a degradation: 1 of the 2 placeholder rows named above — see Dev Ops."
      );
      expect(
        screen.getByTestId("coord-home.degrading.empty")
      ).toHaveTextContent("Nothing is degrading");
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "green");
      expect(strip).not.toHaveTextContent(/cannot tell/i);
    });

    it.each([
      [
        "withheld devices",
        {
          excluded: { unbound: 2, bound_to_other_tenant: 0 },
          excluded_error: null,
        },
        "Coord also withheld 2 machines from its roster (2 with no binding), so the roster is incomplete and their health is unknown.",
      ],
      [
        "could not count what it withheld",
        { excluded: null, excluded_error: "pool timed out" },
        "Coord could not count the machines it withheld from its roster (pool timed out), so the roster may be incomplete",
      ],
    ])(
      "never reads a non-empty roster calm when coord %s",
      async (_label, exclusions, sentence) => {
        answer({
          [PROJECT_STATE]: () => json(oneUnitBody()),
          [FLEET]: () => json({ ...roster("healthy"), ...exclusions }),
          ...quiet,
        });
        await renderPage();
        const machines = screen.getByTestId("coord-home.degrading.machines");
        await waitFor(() => expect(machines).toHaveTextContent(sentence));
        expect(machines).toHaveAttribute("data-roster-fault", "true");
        const deg = screen.getByTestId("coord-home.degrading");
        expect(deg).not.toHaveTextContent("Nothing is degrading");
        expect(
          within(deg).getByTestId("coord-home.degrading.machines-not-calm")
        ).toHaveTextContent("coord's roster may be missing machines");
        const strip = screen.getByTestId("coord-home.strip.health");
        expect(strip).toHaveAttribute("data-health-level", "amber");
        expect(strip).not.toHaveTextContent(/nothing is degrading/i);
        // The strip shows in every mode: never coord's own error text.
        expect(strip).not.toHaveTextContent("pool timed out");
      }
    );

    it.each([
      [
        "is at an older coord's row limit",
        () => roster(...Array<string>(1000).fill("healthy")),
        "Coord's roster lists 1000 rows, at coord's limit of 1000, so it may be cut off — machine health beyond it is unknown.",
      ],
      [
        "says it cut the roster off",
        () => ({ ...roster("healthy"), truncated: true }),
        "Coord reports its roster was cut after 1 row — machine health beyond it is unknown.",
      ],
      [
        "serves a total larger than the rows it lists",
        () => ({ ...roster("healthy", "healthy"), total: 5 }),
        "Coord reports its roster was cut: it lists 2 rows of 5 — the health of the other 3 is unknown.",
      ],
      [
        "withheld machines that could be degrading",
        () => ({
          ...roster("healthy", "healthy"),
          total: 9,
          truncated: true,
          degradable_dropped: 4,
          row_cap: { soft: 1, hard: 2 },
        }),
        "Coord's roster lists 2 rows of 9, and coord withheld 4 machines that could be degrading past its row limit of 2 — their health is unknown, so this view is partial.",
      ],
    ])(
      "never reads a roster calm when coord %s, even with nothing withheld",
      async (_label, body, sentence) => {
        answer({
          [PROJECT_STATE]: () => json(oneUnitBody()),
          [FLEET]: () => json(body()),
          ...quiet,
        });
        await renderPage();
        const machines = screen.getByTestId("coord-home.degrading.machines");
        await waitFor(() => expect(machines).toHaveTextContent(sentence));
        // A cut is not a binding fault.
        expect(machines).not.toHaveAttribute("data-roster-fault");
        const deg = screen.getByTestId("coord-home.degrading");
        expect(deg).not.toHaveTextContent("Nothing is degrading");
        expect(
          within(deg).getByTestId("coord-home.degrading.machines-not-calm")
        ).toHaveTextContent("coord's roster may be missing machines");
        const strip = screen.getByTestId("coord-home.strip.health");
        expect(strip).toHaveAttribute("data-health-level", "amber");
        expect(strip).not.toHaveTextContent(/nothing is degrading/i);
        expect(strip).toHaveTextContent(sentence);
      }
    );

    it.each([
      [
        "cut only rows that cannot degrade",
        () => ({
          ...roster("healthy", "healthy"),
          total: 7,
          truncated: true,
          degradable_dropped: 0,
          row_cap: { soft: 2, hard: 20 },
        }),
        "Coord's roster lists 2 rows of 7: the other 5 are abandoned or placeholder rows past coord's limit of 2, not listed here — coord says none of them could be degrading.",
      ],
      [
        "says nothing was cut past the old limit",
        () => ({
          ...roster(...Array<string>(1001).fill("healthy")),
          total: 1001,
          truncated: false,
          degradable_dropped: 0,
          row_cap: { soft: 1000, hard: 10000 },
        }),
        "All 1001 machines report healthy.",
      ],
    ])("reads a roster calm when coord %s", async (_label, body, sentence) => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () => json(body()),
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() => expect(machines).toHaveTextContent(sentence));
      expect(
        screen.getByTestId("coord-home.degrading.empty")
      ).toHaveTextContent("Nothing is degrading");
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "green");
      expect(strip).not.toHaveTextContent(/cannot tell|may be cut/i);
    });

    it("reads an older coord's unstated exclusions as maybe incomplete, with no binding-fault attribute", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () =>
          json({
            as_of: new Date().toISOString(),
            devices: [
              {
                device_id: "d-0",
                hostname: "example-host-0",
                state: "healthy",
              },
            ],
          }),
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveTextContent(
          "Coord does not say whether it withheld any machines from its roster, so the roster may be incomplete"
        )
      );
      expect(machines).not.toHaveAttribute("data-roster-fault");
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "amber");
      expect(strip).not.toHaveTextContent(/nothing is degrading/i);
    });

    it("never reads calm when every machine coord grades is abandoned: no live machine reports", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () => {
          const r = roster("abandoned", "abandoned");
          return json({
            ...r,
            devices: [
              ...r.devices,
              {
                device_id: "d-ph",
                hostname: "example-host-ph",
                state: "healthy",
                dispatch_liveness: "unknown",
              },
            ],
          });
        },
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveTextContent(
          "All 2 machines coord grades are abandoned, so no live machine reports — there is no machine this view can call healthy."
        )
      );
      const deg = screen.getByTestId("coord-home.degrading");
      expect(deg).not.toHaveTextContent("Nothing is degrading");
      expect(
        within(deg).getByTestId("coord-home.degrading.machines-not-calm")
      ).toHaveTextContent("no live machine reports");
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "amber");
      expect(strip).not.toHaveTextContent(/nothing is degrading/i);
      expect(strip).toHaveTextContent("so no live machine reports");
      // The roster was read: the headline says so, never "not read".
      expect(strip).not.toHaveTextContent(/part of this view is not read/);
      // Named once, then pointed back at.
      expect(
        screen.getByTestId("coord-home.degrading.machines-reconcile")
      ).toHaveTextContent(
        "2 machines not reporting healthy are not degradations: the 2 abandoned named above"
      );
    });

    it("says machine health is unknown, never calm, when the roster cannot be read", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () => json({ error: "unavailable" }, 503),
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveAttribute(
          "data-machines-state",
          "could_not_read"
        )
      );
      expect(machines).toHaveTextContent(
        "Machine health could not be read — unknown, so this view cannot say no machine is degrading."
      );
      expect(machines).not.toHaveTextContent(/\b0\b/);
      const deg = screen.getByTestId("coord-home.degrading");
      expect(deg).not.toHaveTextContent("Nothing is degrading");
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "amber");
      expect(strip).not.toHaveTextContent(/nothing is degrading/i);
      expect(strip).toHaveTextContent("Machine health was not read.");
      expect(screen.getByTestId("coord-home.strip.machines")).toHaveTextContent(
        /^machines not healthy –$/
      );
    });

    it("reads a roster answer with no device list as unknown, not as no machines", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () => json({ as_of: new Date().toISOString() }),
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveAttribute(
          "data-machines-state",
          "could_not_read"
        )
      );
      expect(machines).not.toHaveTextContent("Coord lists no machines.");
    });

    it("reads an empty roster coord withheld devices from as a binding fault, never calm", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () =>
          json({
            as_of: new Date().toISOString(),
            devices: [],
            excluded: { unbound: 1, bound_to_other_tenant: 1 },
            excluded_error: null,
          }),
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveAttribute("data-roster-fault", "true")
      );
      expect(machines).toHaveTextContent(
        "Coord lists no machines but withheld 2 from its roster (1 with no binding, 1 bound to another tenant) — a binding fault, not an empty fleet, so machine health is unknown."
      );
      const deg = screen.getByTestId("coord-home.degrading");
      expect(deg).not.toHaveTextContent("Nothing is degrading");
      expect(
        within(deg).getByTestId("coord-home.degrading.machines-not-calm")
      ).toHaveTextContent("coord lists no machines");
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "amber");
      expect(strip).not.toHaveTextContent(/nothing is degrading/i);
    });

    it("says exactly that an empty roster withheld nothing, and does not rest calm on zero machines", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () =>
          json({
            as_of: new Date().toISOString(),
            devices: [],
            excluded: { unbound: 0, bound_to_other_tenant: 0 },
            excluded_error: null,
          }),
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveTextContent(
          "Coord lists no machines and withheld none from its roster, so there is no machine this view can call healthy."
        )
      );
      expect(machines).not.toHaveAttribute("data-roster-fault");
      expect(screen.getByTestId("coord-home.degrading")).not.toHaveTextContent(
        "Nothing is degrading"
      );
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "amber");
      expect(strip).not.toHaveTextContent(/nothing is degrading/i);
    });

    it("says nothing is degrading only when every machine reports healthy", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () => json(roster("healthy", "healthy")),
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveTextContent("All 2 machines report healthy.")
      );
      expect(
        screen.getByTestId("coord-home.degrading.empty")
      ).toHaveTextContent("Nothing is degrading");
      expect(screen.getByTestId("coord-home.strip.health")).toHaveAttribute(
        "data-health-level",
        "green"
      );
    });

    it("keeps the last good machine counts through a failed refresh, and says so", async () => {
      let fail = false;
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        [FLEET]: () =>
          fail ? json({}, 503) : json(roster("healthy", "degraded")),
        ...quiet,
      });
      await renderPage();
      const machines = screen.getByTestId("coord-home.degrading.machines");
      await waitFor(() =>
        expect(machines).toHaveTextContent("1 of 2 machines")
      );
      fail = true;
      screen.getByTestId("coord-home.refresh").click();
      await waitFor(() =>
        expect(machines).toHaveTextContent(
          "At the last good read, 1 of 2 machines is in a degrading state — not in coord's list above."
        )
      );
      expect(screen.getByTestId("coord-home.strip.health")).toHaveTextContent(
        "Machine health is from its last good read."
      );
    });
  });

  describe("Needs you, until coord serves its needs block", () => {
    const FLEET = "/api/v1/operations/fleet/health";
    const QUESTIONS = "/api/v1/operations/agent-questions/pending";
    const GATES = "/api/v1/admin-dev/overview";
    const calmFleet = {
      [FLEET]: () =>
        json({
          devices: [{ device_id: "d", state: "healthy" }],
          ...NONE_WITHHELD,
        }),
    };
    const unbuilt = () =>
      json(oneUnitBody({ needs_me: { state: "not_implemented" } }));
    const gate = (
      kind: string,
      audience: string,
      verdict = "open"
    ): Record<string, unknown> => ({
      gate_id: `g-${kind}-${audience}-${verdict}`,
      verdict,
      clearance_audience: audience,
      predicate: { kind },
    });
    const overview = (
      gates: Record<string, unknown>[],
      extra: Record<string, unknown> = {}
    ) => ({
      generated_at: new Date().toISOString(),
      gates,
      counts: { open: gates.length },
      ...extra,
    });

    it("counts open operator approvals and operator questions from the Gates and Questions lists, each linking there", async () => {
      answer(
        {
          [PROJECT_STATE]: unbuilt,
          ...calmFleet,
          [QUESTIONS]: () =>
            json({ questions: [{ id: "q1" }, { id: "q2" }], total: 7 }),
        },
        {
          [GATES]: () =>
            overview([
              gate("operator_approval", "operator"),
              gate("operator_approval", "operator"),
              gate("operator_approval", "agent"),
              gate("pr_merged", "operator"),
            ]),
        }
      );
      await renderPage();
      const gates = screen.getByTestId("coord-home.needs-you.count.gates");
      const questions = screen.getByTestId(
        "coord-home.needs-you.count.questions"
      );
      await waitFor(() =>
        expect(gates).toHaveTextContent("Approvals waiting on you: 2 · Gates")
      );
      expect(questions).toHaveTextContent(
        "Questions waiting on you: 7 · Questions"
      );
      expect(within(gates).getByRole("link")).toHaveAttribute(
        "href",
        "/admin/coord/gates"
      );
      expect(within(questions).getByRole("link")).toHaveAttribute(
        "href",
        "/admin/coord/questions"
      );
      // The questions read asks for the operator's queue, as the page does.
      const asked = httpFetch.mock.calls
        .map((c) => String(c[0]))
        .find((u) => u.startsWith(QUESTIONS));
      expect(asked).toContain("audience=operator");
      expect(String(httpGet.mock.calls[0]?.[0])).toContain("verdict=open");
    });

    it("says UNKNOWN, and why, never 0, for a list that cannot be read", async () => {
      answer(
        {
          [PROJECT_STATE]: unbuilt,
          ...calmFleet,
          [QUESTIONS]: () => json({ not: "a list" }),
        },
        {}
      );
      await renderPage();
      const gates = screen.getByTestId("coord-home.needs-you.count.gates");
      const questions = screen.getByTestId(
        "coord-home.needs-you.count.questions"
      );
      await waitFor(() =>
        expect(gates).toHaveAttribute("data-count-state", "could_not_read")
      );
      await waitFor(() =>
        expect(questions).toHaveAttribute("data-count-state", "could_not_read")
      );
      expect(gates).toHaveTextContent(
        "Approvals waiting on you: UNKNOWN — the gates list could not be read"
      );
      expect(questions).toHaveTextContent(
        "Questions waiting on you: UNKNOWN — the questions list could not be read"
      );
      for (const el of [gates, questions]) {
        expect(el).not.toHaveTextContent(/: 0\b/);
      }
    });

    it("reads the web proxy's cold-start envelope as unknown, not as no gates", async () => {
      answer(
        {
          [PROJECT_STATE]: unbuilt,
          ...calmFleet,
          [QUESTIONS]: () => json({ questions: [] }),
        },
        { [GATES]: () => overview([], { coord_error: "coord unreachable" }) }
      );
      await renderPage();
      const gates = screen.getByTestId("coord-home.needs-you.count.gates");
      await waitFor(() =>
        expect(gates).toHaveAttribute("data-count-state", "could_not_read")
      );
      // An empty questions page at offset 0 IS an empty queue.
      expect(
        screen.getByTestId("coord-home.needs-you.count.questions")
      ).toHaveTextContent("Questions waiting on you: 0");
    });

    it("marks a kept (reconnecting) gates list as its last good read", async () => {
      answer(
        {
          [PROJECT_STATE]: unbuilt,
          ...calmFleet,
          [QUESTIONS]: () => json({ questions: [] }),
        },
        {
          [GATES]: () =>
            overview([gate("operator_approval", "operator")], {
              coord_error: "reconnecting",
              coord_reconnecting: true,
            }),
        }
      );
      await renderPage();
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-home.needs-you.count.gates")
        ).toHaveTextContent(
          "Approvals waiting on you: 1 (at its last good read)"
        )
      );
    });

    it("shows the strip a known lower bound when one list was read and the other failed, never 'nothing needs you'", async () => {
      answer(
        {
          [PROJECT_STATE]: unbuilt,
          ...calmFleet,
          [QUESTIONS]: () => json({ error: "unavailable" }, 503),
        },
        {
          [GATES]: () =>
            overview([
              gate("operator_approval", "operator"),
              gate("operator_approval", "operator"),
            ]),
        }
      );
      await renderPage();
      const badge = screen.getByTestId("coord-home.strip.needs-you");
      await waitFor(() =>
        expect(badge).toHaveTextContent(/^needs you ≥2 \(from queues\)$/)
      );
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveTextContent(
        "At least 2 decisions need you — counted from the Gates and Questions queues"
      );
      expect(strip).toHaveTextContent(
        "The Questions queue was not read, so its share is unknown and the figure is a lower bound."
      );
      expect(strip).not.toHaveTextContent(/nothing needs you/i);
    });

    it("says none is counted yet, never ≥0, when the one list read is empty and the other failed", async () => {
      answer(
        {
          [PROJECT_STATE]: unbuilt,
          ...calmFleet,
          [QUESTIONS]: () => json({ questions: [] }),
        },
        {}
      );
      await renderPage();
      const badge = screen.getByTestId("coord-home.strip.needs-you");
      await waitFor(() =>
        expect(badge).toHaveTextContent(
          /^needs you none counted yet \(from queues\)$/
        )
      );
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).not.toHaveTextContent("≥0");
      expect(strip).not.toHaveTextContent(/nothing needs you/i);
      expect(strip).toHaveAttribute("data-health-level", "amber");
      expect(strip).toHaveTextContent(
        "The Gates queue was not read, so its share is unknown and none is counted yet."
      );
    });

    it("carries a kept queue count to the strip as its last good read", async () => {
      answer(
        {
          [PROJECT_STATE]: unbuilt,
          ...calmFleet,
          [QUESTIONS]: () => json({ questions: [] }),
        },
        {
          [GATES]: () =>
            overview([gate("operator_approval", "operator")], {
              coord_error: "reconnecting",
              coord_reconnecting: true,
            }),
        }
      );
      await renderPage();
      const strip = screen.getByTestId("coord-home.strip.health");
      await waitFor(() =>
        expect(strip).toHaveTextContent(
          "Needs you is counted from the Gates and Questions queues, since coord's needs block is not read — at their last good read."
        )
      );
    });

    it("says 'at least' when a list may hold more than it returned", async () => {
      const page = Array.from({ length: 500 }, () =>
        gate("operator_approval", "operator")
      );
      answer(
        {
          [PROJECT_STATE]: unbuilt,
          ...calmFleet,
          [QUESTIONS]: () =>
            json({ questions: [{ id: "a" }, { id: "b" }], truncated: true }),
        },
        { [GATES]: () => ({ ...overview(page), counts: { open: 640 } }) }
      );
      await renderPage();
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-home.needs-you.count.gates")
        ).toHaveTextContent("Approvals waiting on you: at least 500")
      );
      expect(
        screen.getByTestId("coord-home.needs-you.count.questions")
      ).toHaveTextContent("Questions waiting on you: at least 2");
    });

    it("asks the gates read to bypass the proxy cache on an explicit refresh, and only then", async () => {
      answer(
        {
          [PROJECT_STATE]: unbuilt,
          ...calmFleet,
          [QUESTIONS]: () => json({ questions: [] }),
        },
        { [GATES]: () => overview([]) }
      );
      await renderPage();
      await waitFor(() => expect(httpGet).toHaveBeenCalled());
      expect(String(httpGet.mock.calls[0]?.[0])).not.toContain("refresh=1");
      httpGet.mockClear();
      screen.getByTestId("coord-home.refresh").click();
      await waitFor(() => expect(httpGet).toHaveBeenCalled());
      expect(String(httpGet.mock.calls[0]?.[0])).toContain("refresh=1");
    });

    it("reads the two lists at once when coord stops serving its needs block, not a poll later", async () => {
      // The first read of the two lists (made before the project state
      // landed) failed, and coord then served its needs block, so the page
      // stopped asking. When coord stops serving it, the page must read the
      // lists now — the refresh's own supplement read went out before the
      // page learned it needs them, and the next poll is a minute away.
      let needsServed = true;
      let listsUp = false;
      answer(
        {
          [PROJECT_STATE]: () =>
            needsServed ? json(oneUnitBody()) : unbuilt(),
          ...calmFleet,
          [QUESTIONS]: () =>
            listsUp
              ? json({ questions: [{ id: "q" }], total: 4 })
              : json({ error: "unavailable" }, 503),
        },
        {
          [GATES]: () => {
            if (!listsUp) throw new Error("GET gates failed: 503 - down");
            return overview([
              gate("operator_approval", "operator"),
              gate("operator_approval", "operator"),
            ]);
          },
        }
      );
      await renderPage();
      expect(
        screen.queryByTestId("coord-home.needs-you.counts")
      ).not.toBeInTheDocument();
      needsServed = false;
      listsUp = true;
      screen.getByTestId("coord-home.refresh").click();
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-home.needs-you.count.gates")
        ).toHaveTextContent("Approvals waiting on you: 2")
      );
      expect(
        screen.getByTestId("coord-home.needs-you.count.questions")
      ).toHaveTextContent("Questions waiting on you: 4");
    });

    it("stops asking the two lists once coord serves its needs block", async () => {
      answer({
        [PROJECT_STATE]: () => json(oneUnitBody()),
        ...calmFleet,
        [QUESTIONS]: () => json({ questions: [] }),
      });
      await renderPage();
      expect(
        screen.queryByTestId("coord-home.needs-you.counts")
      ).not.toBeInTheDocument();
      httpFetch.mockClear();
      httpGet.mockClear();
      screen.getByTestId("coord-home.refresh").click();
      await waitFor(() =>
        expect(
          httpFetch.mock.calls.some((c) => String(c[0]).startsWith(FLEET))
        ).toBe(true)
      );
      expect(
        httpFetch.mock.calls.some((c) => String(c[0]).startsWith(QUESTIONS))
      ).toBe(false);
      expect(httpGet).not.toHaveBeenCalled();
    });
  });

  describe("what the operator view keeps that a presentation leaves out", () => {
    it("shows Correct? while nothing measures it, and lists sources not built yet, with no presentation chrome", async () => {
      answer({
        [PROJECT_STATE]: () =>
          json(
            oneUnitBody({
              correctness: {
                state: "unknown",
                reason: "verification_metrics_door_absent",
              },
              does_not_know: [
                { source: "verification_metrics", state: "not_implemented" },
              ],
            })
          ),
      });
      await renderPage();
      expect(screen.getByTestId("coord-home.correct")).toHaveTextContent(
        "Not measured — no trust-calibration source"
      );
      const dnk = screen.getByTestId("coord-home.does-not-know");
      expect(dnk).toHaveTextContent("Verification measurements");
      expect(
        within(dnk).queryByTestId("coord-home.does-not-know.not-built")
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("coord-home.provenance")).toBeNull();
      expect(document.querySelector("[data-presentation-section]")).toBeNull();
    });

    it("names a repository and quotes coord's parse error as before", async () => {
      const body = oneUnitBody();
      (body.on_track as Record<string, unknown>).initiative = {
        state: "unparseable",
        error: "frontmatter line 8: indented line is not a `- item`",
      };
      answer({ [PROJECT_STATE]: () => json(body) });
      await renderPage();
      expect(screen.getByTestId("coord-home.on-track")).toHaveTextContent(
        "example-repo"
      );
      expect(
        screen.getByTestId("coord-home.on-track.initiative")
      ).toHaveTextContent(
        "The current initiative document could not be parsed: frontmatter line 8"
      );
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

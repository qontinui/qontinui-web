/**
 * The Twin map tab (plan `2026-10-23-console-presentation-spaces` Phase 5):
 * every aspect of the twin with its fidelity and the plans moving it; an
 * aspect opens its parts and plans, each plan linking to its work unit; and a
 * source that failed renders as a labelled UNKNOWN, never as zero.
 *
 * The probe and catalog bodies are the page's own Spec CI stubs, so this file
 * renders what CI renders; the work units are this file's fixtures.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import type { WalkOutcome } from "@/app/(app)/admin/coord/work-units/planWalk";
import type { PresentationScopeState } from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import { isDeclaredProbe, manifest } from "../_lib/resolve";
import { RunnerRelayError } from "../_lib/runner-relay";
import { MANIFEST_SNAPSHOT_IDS, catalogDeclaring } from "../_lib/test-catalog";
import type {
  SubspacesProbeResponse,
  TwinCatalogResponse,
} from "../_lib/types";

const state = vi.hoisted(() => ({
  probe: {} as Record<string, unknown>,
  catalog: undefined as unknown,
  report: {} as Record<string, unknown>,
  workUnits: {} as Record<string, unknown>,
  appTwin: {} as Record<string, unknown>,
}));

vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));
vi.mock("../_hooks/useDigitalTwinSubspaces", () => ({
  useDigitalTwinSubspaces: () => state.probe,
}));
vi.mock("../_hooks/useTwinCatalog", () => ({
  useTwinCatalog: () => ({ data: state.catalog }),
}));
vi.mock("../_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: () => state.report,
}));
vi.mock("../_hooks/useTwinWorkUnits", () => ({
  useTwinWorkUnits: () => state.workUnits,
}));
vi.mock("../_hooks/useAppTwin", () => ({
  useAppTwin: () => state.appTwin,
}));

import { TwinMap } from "./TwinMap";

const SPEC = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../specs/pages/digital-twin/state-machine.derived.json"
    ),
    "utf-8"
  )
) as { metadata: { routeStubs: { urlPattern: string; body: unknown }[] } };

function stubBody(urlPattern: string): unknown {
  const stub = SPEC.metadata.routeStubs.find(
    (s) => s.urlPattern === urlPattern
  );
  if (!stub) throw new Error(`the spec stubs no route ${urlPattern}`);
  return stub.body;
}

const READ_AT = Date.parse("2026-10-23T12:00:00Z");

function unit(slug: string, status: string, area: string | null): CoordPlanRow {
  return {
    slug,
    title: `Title for ${slug}`,
    status,
    authored_at: "2026-10-01T00:00:00Z",
    metadata: area
      ? { area, source_path: `qontinui-dev-notes/plans/${slug}.md` }
      : null,
  };
}

/** An explicit manifest plan slug, and units reached only through an area. */
const EVENT_LOG = manifest.subspaces.find((s) => s.id === "process_log")!.plan!;
const UNITS: CoordPlanRow[] = [
  unit(EVENT_LOG, "in_progress", "digital-twin"),
  unit("2026-09-20-migration-head-drift", "in_progress", "database-migrations"),
  unit("2026-09-12-merge-train-threshold", "shipped", "coord-merge-train"),
  unit("2026-10-01-gates-blocked", "blocked", "gate-continuations"),
];

function walk(rows: CoordPlanRow[]): WalkOutcome {
  return { kind: "complete", rows, bodySignal: null, pages: 1 };
}

const idle = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  dataUpdatedAt: 0,
  errorUpdatedAt: 0,
};

beforeEach(() => {
  state.probe = {
    ...idle,
    data: stubBody(
      "**/api/v1/digital-twin/subspaces"
    ) as SubspacesProbeResponse,
    dataUpdatedAt: READ_AT,
  };
  state.catalog = stubBody(
    "**/api/v1/digital-twin/catalog"
  ) as TwinCatalogResponse;
  state.report = {
    ...idle,
    isError: true,
    error: new Error(
      "GET /api/v1/digital-twin/subspace/twin_fidelity/raw failed: 404 - none"
    ),
  };
  state.workUnits = { ...idle, data: walk(UNITS), dataUpdatedAt: READ_AT };
  state.appTwin = { deviceId: null, online: true, apps: idle, graph: idle };
});

function card(aspect: string): HTMLElement {
  return screen.getByTestId(`digital-twin-aspect-card-${aspect}`);
}

function figure(aspect: string, key: string): HTMLElement {
  return screen.getByTestId(`digital-twin-aspect-${aspect}-fidelity-${key}`);
}

async function openAspect(aspect: string) {
  const user = userEvent.setup();
  await user.click(
    within(card(aspect)).getByRole("button", {
      name: /show its parts and plans/i,
    })
  );
  return {
    user,
    detail: screen.getByTestId(`digital-twin-aspect-detail-${aspect}`),
  };
}

describe("TwinMap — each aspect with its fidelity and the plans moving it", () => {
  it("renders the four aspects, each with its four fidelity figures and plan counts", () => {
    render(<TwinMap />);
    for (const aspect of ["environment", "process", "intent", "ui-bridge"]) {
      expect(card(aspect)).toBeInTheDocument();
      for (const key of ["observed", "coverage", "staleness", "honesty"]) {
        expect(figure(aspect, key), `${aspect}.${key}`).toBeInTheDocument();
      }
      expect(
        screen.getByTestId(`digital-twin-aspect-${aspect}-plans`),
        aspect
      ).toHaveAttribute("data-plans-state", "known");
    }
    // The environment twin's probes answer: a live count, not an UNKNOWN.
    expect(figure("environment", "observed")).toHaveAttribute(
      "data-fidelity-state",
      "known"
    );
    expect(figure("environment", "observed")).toHaveTextContent(/\d+ of \d+/);
    // The process twin: the event-log plan in progress, the blocked gate plan,
    // and the shipped merge-train plan, counted by live status.
    const plans = screen.getByTestId("digital-twin-aspect-process-plans");
    expect(
      within(plans).getByTestId("digital-twin-aspect-process-plans-in-flight")
    ).toHaveTextContent("1");
    expect(
      within(plans).getByTestId("digital-twin-aspect-process-plans-blocked")
    ).toHaveTextContent("1");
    expect(
      within(plans).getByTestId("digital-twin-aspect-process-plans-done")
    ).toHaveTextContent("1");
    expect(screen.getByTestId("digital-twin-plans-read")).toHaveTextContent(
      "4 work units"
    );
  });

  it("opens an aspect: its parts, and its plans with live status, each linking to its work unit", async () => {
    render(<TwinMap />);
    const { detail } = await openAspect("process");

    const parts = within(detail).getByTestId("digital-twin-parts");
    const processRows = manifest.subspaces.filter((s) => s.twin === "process");
    expect(within(parts).getAllByRole("button")).toHaveLength(
      processRows.length
    );

    const links = within(detail).getAllByTestId("digital-twin-plan-link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(
      `/admin/coord/work-units/${encodeURIComponent(EVENT_LOG)}`
    );
    expect(hrefs).toContain("/admin/coord/work-units/2026-10-01-gates-blocked");
    // Each plan shows its live status beside it.
    const eventLog = links
      .find((a) =>
        a.getAttribute("href")!.endsWith(encodeURIComponent(EVENT_LOG))
      )!
      .closest("li")!;
    expect(within(eventLog).getByText("In progress")).toBeInTheDocument();
    // The shipped plan is kept, collapsed, under "Shipped or closed".
    expect(
      within(detail).getByTestId("digital-twin-plans-finished")
    ).toHaveTextContent("1");
  });

  it("resolves a part with no plan slug through the area mapping", async () => {
    render(<TwinMap />);
    const schema = manifest.subspaces.find((s) => s.id === "schema")!;
    expect(schema.plan).toBeFalsy();
    const { user, detail } = await openAspect("environment");

    await user.click(within(detail).getByTestId("digital-twin-part-schema"));
    expect(within(detail).getByText("Plans moving schema")).toBeInTheDocument();
    const links = within(detail).getAllByTestId("digital-twin-plan-link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/admin/coord/work-units/2026-09-20-migration-head-drift",
    ]);
  });

  it("opens a different aspect unfiltered", async () => {
    render(<TwinMap />);
    const { user, detail } = await openAspect("environment");
    await user.click(within(detail).getByTestId("digital-twin-part-schema"));
    expect(within(detail).getByText("Plans moving schema")).toBeInTheDocument();

    await user.click(
      within(card("process")).getByRole("button", {
        name: /show its parts and plans/i,
      })
    );
    const process = screen.getByTestId("digital-twin-aspect-detail-process");
    expect(
      within(process).getByText("Plans moving the process twin")
    ).toBeInTheDocument();
    expect(within(process).queryByRole("button", { pressed: true })).toBeNull();
    expect(
      within(process).getAllByTestId("digital-twin-plan").length
    ).toBeGreaterThan(0);
  });

  it("heads each drill-down with the aspect's own name — a proper noun keeps its case", async () => {
    render(<TwinMap />);
    const { detail } = await openAspect("ui-bridge");
    expect(
      within(detail).getByText("Plans moving the UI Bridge app twin")
    ).toBeInTheDocument();
    expect(within(detail).queryByText(/ui bridge app twin/)).toBeNull();
  });

  it("counts a part's plans exactly over a complete read, and says none is unfinished", async () => {
    render(<TwinMap />);
    const { user, detail } = await openAspect("process");
    expect(
      within(detail).getByTestId("digital-twin-part-merge_train")
    ).toHaveTextContent(/· 1 plan$/);
    expect(
      within(detail).getByTestId("digital-twin-part-coord")
    ).toHaveTextContent(/· 0 plans$/);
    await user.click(
      within(detail).getByTestId("digital-twin-part-merge_train")
    );
    expect(
      within(detail).getByTestId("digital-twin-plans-none-unfinished")
    ).toHaveTextContent(
      "No unfinished plan — every plan tied to these parts is shipped or closed."
    );
  });

  it("names, for the operator, mapped areas that no work unit carries", async () => {
    render(<TwinMap />);
    const { detail } = await openAspect("process");
    // `coord-claims` maps the coordination part; no fixture unit carries it.
    expect(
      within(detail).getByTestId("digital-twin-area-drift")
    ).toHaveTextContent("coord-claims");
  });
});

describe("TwinMap — a failed source is a labelled UNKNOWN, never zero", () => {
  it("renders a failed probe as UNKNOWN with the reason on every probe figure", () => {
    state.probe = {
      ...idle,
      isError: true,
      error: new Error(
        "GET /api/v1/digital-twin/subspaces failed: 502 - upstream"
      ),
    };
    render(<TwinMap />);
    for (const key of ["observed", "coverage", "staleness"]) {
      const f = figure("environment", key);
      expect(f, key).toHaveAttribute("data-fidelity-state", "unknown");
      expect(f, key).toHaveTextContent("UNKNOWN");
      expect(f, key).toHaveTextContent(
        "coord's live probe could not be read (HTTP 502)"
      );
      expect(f, key).not.toHaveTextContent(/\b0 of\b/);
    }
  });

  it("renders a degraded probe answer (HTTP 200, no probe made) as UNKNOWN, never 0 observed", () => {
    const body = stubBody(
      "**/api/v1/digital-twin/subspaces"
    ) as SubspacesProbeResponse;
    state.probe = {
      ...idle,
      data: {
        ...body,
        degraded: true,
        subspaces: body.subspaces.map((s) => ({
          id: s.id,
          status: "error",
          error: "coord_unavailable",
        })),
      } satisfies SubspacesProbeResponse,
      dataUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    for (const aspect of ["environment", "process"]) {
      for (const key of ["observed", "coverage", "staleness"]) {
        const f = figure(aspect, key);
        expect(f, `${aspect}.${key}`).toHaveAttribute(
          "data-fidelity-state",
          "unknown"
        );
        expect(f, `${aspect}.${key}`).toHaveTextContent(
          "coord's live probe could not be made: coord could not be reached"
        );
        expect(f, `${aspect}.${key}`).not.toHaveTextContent(/\b\d+ of \d+\b/);
      }
    }
  });

  /** Every live part of the open drill-down: UNKNOWN with why, never "Error". */
  function expectLivePartsUnknown(detail: HTMLElement, reason: string) {
    const liveParts = manifest.subspaces.filter(
      (s) =>
        s.twin === "process" &&
        (state.catalog as TwinCatalogResponse).entries.some(
          (e) => e.subspace === s.id && isDeclaredProbe(e)
        )
    );
    expect(liveParts.length).toBeGreaterThan(0);
    for (const part of liveParts) {
      const row = within(detail).getByTestId(`digital-twin-part-${part.id}`);
      expect(row, part.id).toHaveTextContent("UNKNOWN");
      expect(row, part.id).not.toHaveTextContent("Error");
      expect(row.getAttribute("title"), part.id).toContain(reason);
      expect(row.getAttribute("title"), part.id).not.toContain("was probed");
    }
    expect(within(detail).queryAllByText(/^Error$/)).toHaveLength(0);
  }

  it("opens an aspect over a degraded probe answer: its live parts are UNKNOWN with why, never Error", async () => {
    const body = stubBody(
      "**/api/v1/digital-twin/subspaces"
    ) as SubspacesProbeResponse;
    state.probe = {
      ...idle,
      data: {
        ...body,
        degraded: true,
        subspaces: body.subspaces.map((s) => ({
          id: s.id,
          status: "error",
          error: "coord_unavailable",
        })),
      } satisfies SubspacesProbeResponse,
      dataUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    const { detail } = await openAspect("process");
    expectLivePartsUnknown(
      detail,
      "Coord's live probe could not be made: coord could not be reached"
    );
  });

  it("opens an aspect over a failed probe read: its live parts are UNKNOWN with the HTTP status, never Error", async () => {
    state.probe = {
      ...idle,
      isError: true,
      error: new Error(
        "GET /api/v1/digital-twin/subspaces failed: 502 - upstream"
      ),
      errorUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    const { detail } = await openAspect("process");
    expectLivePartsUnknown(
      detail,
      "Coord's live probe could not be read (HTTP 502)"
    );
  });

  it("renders a failed work-unit read as UNKNOWN with the reason, not as no plans", () => {
    state.workUnits = {
      ...idle,
      isError: true,
      error: new Error("GET /api/v1/operations/plans failed: 503 - coord down"),
      errorUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    expect(screen.getByTestId("digital-twin-plans-unknown")).toHaveTextContent(
      "The plans could not be read"
    );
    for (const aspect of ["environment", "process", "intent", "ui-bridge"]) {
      const plans = screen.getByTestId(`digital-twin-aspect-${aspect}-plans`);
      expect(plans, aspect).toHaveAttribute("data-plans-state", "unknown");
      expect(plans, aspect).toHaveTextContent("UNKNOWN");
    }
  });

  it("renders a failed work-unit read in the drill-down as UNKNOWN, with no plan count", async () => {
    state.workUnits = {
      ...idle,
      isError: true,
      error: new Error("GET /api/v1/operations/plans failed: 503 - coord down"),
      errorUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    const { detail } = await openAspect("process");
    expect(
      within(detail).getByTestId("digital-twin-aspect-detail-plans-unknown")
    ).toHaveTextContent("UNKNOWN — the plans could not be read:");
    expect(within(detail).queryAllByTestId("digital-twin-plan")).toHaveLength(
      0
    );
    expect(within(detail).queryByTestId("digital-twin-plans-empty")).toBeNull();
    // No part claims a count of plans the read never returned.
    expect(
      within(detail).getByTestId("digital-twin-parts")
    ).not.toHaveTextContent(/\bplans?\b/);
  });

  it("marks plan counts from an incomplete read as INCOMPLETE, with why", () => {
    state.workUnits = {
      ...idle,
      data: {
        kind: "partial",
        rows: UNITS,
        bodySignal: null,
        pages: 2,
        reason: "error",
        error: "coord answered 502",
      } satisfies WalkOutcome,
      dataUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    expect(
      screen.getByTestId("digital-twin-plans-incomplete")
    ).toHaveTextContent(
      /INCOMPLETE — coord's work-unit list stopped answering after 2 pages/
    );
  });

  it("over an incomplete read, counts a part's plans as a floor, unknown when none was found — never 0", async () => {
    state.workUnits = {
      ...idle,
      data: {
        kind: "partial",
        rows: UNITS,
        bodySignal: null,
        pages: 20,
        reason: "page_cap",
      } satisfies WalkOutcome,
      dataUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    const { user, detail } = await openAspect("process");
    const part = (id: string) =>
      within(detail).getByTestId(`digital-twin-part-${id}`);
    // Maps areas; one shipped unit found on the pages read.
    expect(part("merge_train")).toHaveTextContent(/· at least 1 plan$/);
    // Maps an area no unit read carries: unknown, not zero.
    expect(part("coord")).toHaveTextContent(/· plans unknown$/);
    expect(part("coord")).not.toHaveTextContent(/0 plans/);
    // Maps no area, only its explicit plan: exact whatever was read.
    expect(part("process_log")).toHaveTextContent(/· 1 plan$/);
    expect(part("cascade")).toHaveTextContent(/· 0 plans$/);

    await user.click(part("merge_train"));
    expect(
      within(detail).getByTestId("digital-twin-plans-none-unfinished")
    ).toHaveTextContent(
      "No unfinished plan was found among the work units read — the read was incomplete, so some may be missing."
    );
  });

  it("carries an incomplete read into the drill-down: an unread plan is UNKNOWN, an empty part may be missing plans", async () => {
    // The walk stopped before the event-log plan's page: its explicit slug
    // was not read, and neither were the units of the coordination part.
    state.workUnits = {
      ...idle,
      data: {
        kind: "partial",
        rows: UNITS.filter((u) => u.slug !== EVENT_LOG),
        bodySignal: null,
        pages: 20,
        reason: "page_cap",
      } satisfies WalkOutcome,
      dataUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    // The cards say their counts cover only what was read.
    expect(
      screen.getByTestId("digital-twin-aspect-process-plans")
    ).toHaveTextContent(/\d+ plans? moving it among the work units read/);

    const { user, detail } = await openAspect("process");
    const eventLog = within(detail)
      .getAllByTestId("digital-twin-plan")
      .find((li) => li.textContent?.includes(EVENT_LOG))!;
    expect(eventLog).toHaveAttribute("data-plan-progress", "unknown");
    expect(within(eventLog).getByText("UNKNOWN")).toBeInTheDocument();
    expect(within(eventLog).queryByText("Not a work unit")).toBeNull();

    await user.click(within(detail).getByTestId("digital-twin-part-coord"));
    expect(
      within(detail).getByTestId("digital-twin-plans-empty")
    ).toHaveTextContent(
      "No plan was found among the work units read — the read was incomplete, so plans may be missing."
    );
  });

  it("over a complete read, says a plan missing from coord's list is not a work unit", async () => {
    state.workUnits = {
      ...idle,
      data: walk(UNITS.filter((u) => u.slug !== EVENT_LOG)),
      dataUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    expect(
      screen.getByTestId("digital-twin-aspect-process-plans")
    ).not.toHaveTextContent(/among the work units read/);
    const { detail } = await openAspect("process");
    const eventLog = within(detail)
      .getAllByTestId("digital-twin-plan")
      .find((li) => li.textContent?.includes(EVENT_LOG))!;
    expect(within(eventLog).getByText("Not a work unit")).toBeInTheDocument();
  });

  it("tells the operator a refresh failed, over the last good plans", () => {
    state.workUnits = {
      ...idle,
      data: walk(UNITS),
      dataUpdatedAt: READ_AT,
      isError: true,
      error: new Error("GET /api/v1/operations/plans failed: 503 - {}"),
      errorUpdatedAt: READ_AT + 120_000,
    };
    render(<TwinMap />);
    expect(screen.getByTestId("digital-twin-plans-stale")).toHaveTextContent(
      /^The last refresh failed \(.+\); these are the plans from the read before it\.$/
    );
    // The plans shown are still the last good read's.
    expect(screen.getByTestId("digital-twin-plans-read")).toHaveTextContent(
      "4 work units"
    );
  });

  it("renders the app twin as UNKNOWN with no runner connected", () => {
    render(<TwinMap />);
    const f = figure("ui-bridge", "observed");
    expect(f).toHaveAttribute("data-fidelity-state", "unknown");
    expect(f).toHaveTextContent("no runner is connected");
  });
});

/** A host and a client named only in upstream error text. */
const HOST = "coord.internal.acme-corp.example";
const LEAKY_BODY = JSON.stringify({
  detail: `upstream https://${HOST}:8443 refused the connection for Acme Corp`,
});
const leakyError = (status: number) =>
  new Error(`GET /api/v1/operations/plans failed: ${status} - ${LEAKY_BODY}`);
/** What the fixture's upstream text names; an evaluator sees none of it. */
const FORBIDDEN = [HOST, "acme"];
const ASPECTS = ["environment", "process", "intent", "ui-bridge"];
const SCOPE: PresentationScopeState = {
  status: "ready",
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme Corp"] },
};

function presentTwinMap() {
  return renderInPresentationMode(<TwinMap />, {
    scope: SCOPE,
    // This file mocks the UI Bridge SDK; the page proof
    // (`page.presentation-proof.test.tsx`) reads the real registry.
    uiBridge: {
      unobservable: "TwinMap.test.tsx mocks @qontinui/ui-bridge/react",
    },
  });
}

describe("TwinMap in presentation mode — a failed read says its HTTP status, never its text", () => {
  it("words a failed work-unit read by its status on the read line, every card and the drill-down", async () => {
    state.workUnits = {
      ...idle,
      isError: true,
      error: leakyError(502),
      errorUpdatedAt: READ_AT,
    };
    const view = presentTwinMap();
    const said = "coord's work-unit list answered HTTP 502";
    expect(screen.getByTestId("digital-twin-plans-unknown")).toHaveTextContent(
      `The plans could not be read: ${said}`
    );
    for (const aspect of ASPECTS) {
      expect(
        screen.getByTestId(`digital-twin-aspect-${aspect}-plans`),
        aspect
      ).toHaveTextContent(`The plans could not be read: ${said}`);
    }
    const { detail } = await openAspect("process");
    expect(
      within(detail).getByTestId("digital-twin-aspect-detail-plans-unknown")
    ).toHaveTextContent(`UNKNOWN — the plans could not be read: ${said}`);
    expectPresentationSafe(view, { forbidden: FORBIDDEN });
  });

  it("names an incomplete read without the failing page's text, in the badge and its title", () => {
    state.workUnits = {
      ...idle,
      data: {
        kind: "partial",
        rows: UNITS,
        bodySignal: null,
        pages: 2,
        reason: "error",
        error: `${HOST} refused the connection for Acme Corp`,
      } satisfies WalkOutcome,
      dataUpdatedAt: READ_AT,
    };
    const view = presentTwinMap();
    const badge = screen.getByTestId("digital-twin-plans-incomplete");
    expect(badge).toHaveTextContent(
      /^INCOMPLETE — coord's work-unit list stopped answering after 2 pages$/
    );
    expect(badge).toHaveAttribute(
      "title",
      "The plan counts cover only the work units read: coord's work-unit list stopped answering after 2 pages."
    );
    expectPresentationSafe(view, { forbidden: FORBIDDEN });
  });

  it("words a failed refresh by its status, over the last good plans", () => {
    state.workUnits = {
      ...idle,
      data: walk(UNITS),
      dataUpdatedAt: READ_AT,
      isError: true,
      error: leakyError(503),
      errorUpdatedAt: READ_AT + 120_000,
    };
    const view = presentTwinMap();
    expect(screen.getByTestId("digital-twin-plans-stale")).toHaveTextContent(
      "The last refresh failed (coord's work-unit list answered HTTP 503); these are the plans from the read before it."
    );
    expectPresentationSafe(view, { forbidden: FORBIDDEN });
  });

  it("gives the operator the failing read's own text, which is what the lens withholds", () => {
    state.workUnits = {
      ...idle,
      isError: true,
      error: leakyError(502),
      errorUpdatedAt: READ_AT,
    };
    render(<TwinMap />);
    expect(screen.getByTestId("digital-twin-plans-unknown")).toHaveTextContent(
      HOST
    );
  });
});

/**
 * The probe's answer kept after its latest read failed (react-query keeps a
 * query's data when a refetch fails). The figures and the live-probed part
 * rows still show that answer, so the map's own notice leads above them,
 * names them as the last answer and dates it, in both modes (style guide R6
 * and 6.5).
 */
describe("TwinMap — a probe answer kept after its latest read failed", () => {
  const PROBE_ERROR = new Error(
    `GET /api/v1/digital-twin/subspaces failed: 502 - ${LEAKY_BODY}`
  );
  /**
   * Under the page's own catalog stub, which declares no intent row (nor did
   * coord on 2026-10-27): the notice names the two twins the probe feeds.
   */
  const HELD_NOTICE =
    "Coord's live probe's latest read failed (HTTP 502), so the Observed, Coverage and Staleness figures of the environment twin and the process twin, and the statuses of the live-probed parts below, are its last answer, not a current reading.";

  /** The probe holds `data`, read at READ_AT; its refetch a minute later failed. */
  function holdProbe(data?: SubspacesProbeResponse) {
    state.probe = {
      ...idle,
      data:
        data ??
        (stubBody(
          "**/api/v1/digital-twin/subspaces"
        ) as SubspacesProbeResponse),
      dataUpdatedAt: READ_AT,
      isError: true,
      error: PROBE_ERROR,
      errorUpdatedAt: READ_AT + 60_000,
    };
  }

  const following = (a: Node, b: Node) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  for (const mode of ["operator", "presenting"] as const) {
    it(`names the figures and part statuses below as the probe's last answer, dated, above them · ${mode}`, async () => {
      holdProbe();
      const view = mode === "presenting" ? presentTwinMap() : null;
      if (mode === "operator") render(<TwinMap />);
      const notice = screen.getByTestId("digital-twin-map-probe-held");
      expect(notice).toHaveTextContent(`UNKNOWN${HELD_NOTICE}`);
      // Dated by when the kept answer was read, in both modes.
      const chip = within(notice).getByTestId(
        "digital-twin-map-probe-held-provenance"
      );
      expect(chip).toHaveTextContent(
        /^source: coord's live twin probe · as of /
      );
      expect(chip).toHaveAttribute("data-provenance-known", "true");
      // It says the HTTP status only, in both modes.
      for (const forbidden of FORBIDDEN) {
        expect(notice.textContent?.toLowerCase()).not.toContain(
          forbidden.toLowerCase()
        );
      }
      // It leads: above every card and the drill-down an aspect opens.
      for (const aspect of ASPECTS) {
        expect(following(notice, card(aspect)), aspect).toBe(true);
      }
      const { detail } = await openAspect("process");
      expect(following(notice, detail)).toBe(true);
      // Under it the figures keep the last answer: R6's row arm.
      expect(figure("process", "observed")).toHaveAttribute(
        "data-fidelity-state",
        "known"
      );
      if (view) expectPresentationSafe(view, { forbidden: FORBIDDEN });
    });
  }

  /**
   * Which twins the notice names is which twins' figures the kept answer
   * decides. Under coord's catalog those are the twins with a part it
   * declares: a twin with none says nothing in it is probed live, which the
   * catalog says and no answer does, whatever coord answered or refused, so
   * the notice never calls its figures that answer. With the catalog unread,
   * the manifest's snapshot rows and the answer's own cells say which parts
   * are live-probed, so the answer decides every twin's figures and the
   * notice names them all. Each row is also read as an answer the latest
   * read returned, over which there is no notice at all.
   *
   * Every row is read in both modes, and every aspect's drill-down with it:
   * a live part says what the answer says of it. Where coord refused every
   * reading, that is UNKNOWN naming the refusal, as the figures say it —
   * never "Restricted" with a refused part's own reason ("Qontinui-internal
   * ... your other sub-spaces are unaffected"), which is false of an answer
   * that refused them all, and in presentation mode the restricted-access
   * message shown as data.
   */
  const FED: readonly {
    catalog: string;
    declares: () => TwinCatalogResponse | undefined;
    /** Coord refused every reading in the answer (its coarse twin gate). */
    refused: boolean;
    names: string | null;
    /** The twins whose figures say nothing in them is probed live. */
    unprobed: readonly string[];
  }[] = [
    {
      catalog: "the page's own stub, which declares no intent row",
      declares: () =>
        stubBody("**/api/v1/digital-twin/catalog") as TwinCatalogResponse,
      refused: false,
      names: "the environment twin and the process twin",
      unprobed: ["intent"],
    },
    {
      catalog: "one that declares an intent row as well",
      declares: () => catalogDeclaring([...MANIFEST_SNAPSHOT_IDS, "metrics"]),
      refused: false,
      names: "the environment twin, the process twin and the intent twin",
      unprobed: [],
    },
    {
      catalog: "one that declares only process rows",
      declares: () =>
        catalogDeclaring(
          MANIFEST_SNAPSHOT_IDS.filter(
            (id) =>
              manifest.subspaces.find((s) => s.id === id)?.twin === "process"
          )
        ),
      refused: false,
      names: "the process twin",
      unprobed: ["environment", "intent"],
    },
    {
      catalog: "one that declares nothing probeable",
      declares: () => ({
        entries: catalogDeclaring(["schema"]).entries.map((entry) => ({
          ...entry,
          snapshot: false,
        })),
        total: 1,
      }),
      refused: false,
      names: null,
      unprobed: ["environment", "process", "intent"],
    },
    {
      catalog: "none read, so the manifest and the answer's cells stand in",
      declares: () => undefined,
      refused: false,
      names: "the environment twin, the process twin and the intent twin",
      unprobed: ["intent"],
    },
    {
      catalog: "the page's own stub, with every reading refused",
      declares: () =>
        stubBody("**/api/v1/digital-twin/catalog") as TwinCatalogResponse,
      refused: true,
      names: "the environment twin and the process twin",
      unprobed: ["intent"],
    },
    {
      catalog: "none read, with every reading refused",
      declares: () => undefined,
      refused: true,
      names: "the environment twin, the process twin and the intent twin",
      unprobed: ["intent"],
    },
  ];

  /** The page's own probe stub, or the same answer with every reading refused. */
  function answer(refused: boolean): SubspacesProbeResponse {
    const body = stubBody(
      "**/api/v1/digital-twin/subspaces"
    ) as SubspacesProbeResponse;
    if (!refused) return body;
    return {
      ...body,
      restricted: true,
      subspaces: body.subspaces.map((cell) => ({
        id: cell.id,
        status: "restricted" as const,
        door_shape: cell.door_shape,
      })),
    };
  }

  const PLANTS = ["environment", "process", "intent"] as const;

  /**
   * The parts a row of {@link FED} probes live: those its catalog declares,
   * or, with the catalog unread, the manifest's `snapshot` rows and the
   * rows the answer has a cell for.
   */
  function livePartIds(
    catalog: TwinCatalogResponse | undefined,
    body: SubspacesProbeResponse
  ): ReadonlySet<string> {
    if (catalog) {
      return new Set(
        catalog.entries.filter(isDeclaredProbe).map((entry) => entry.subspace)
      );
    }
    const cells = new Set(body.subspaces.map((cell) => cell.id));
    return new Set(
      manifest.subspaces
        .filter((s) => s.query_kind === "snapshot" || cells.has(s.id))
        .map((s) => s.id)
    );
  }

  /** A live part's title where coord refused every reading. */
  const REFUSED_PART =
    "Coord does not share the twin's live readings with this workspace, so there is no current reading of this observer — its status is unknown, not a failure of the observer.";

  for (const c of FED) {
    for (const kept of [true, false]) {
      for (const mode of ["operator", "presenting"] as const) {
        const read = kept
          ? "kept after its refresh failed"
          : "the latest read's";
        it(`shows the answer as the answer it is, under ${c.catalog} · ${read} · ${mode}`, async () => {
          const catalog = c.declares();
          const body = answer(c.refused);
          state.catalog = catalog;
          if (kept) {
            holdProbe(body);
          } else {
            state.probe = { ...idle, data: body, dataUpdatedAt: READ_AT };
          }
          const view = mode === "presenting" ? presentTwinMap() : null;
          if (mode === "operator") render(<TwinMap />);
          const notice = screen.queryByTestId("digital-twin-map-probe-held");
          if (!kept || c.names === null) {
            // A current answer, or nothing on the map that is the answer.
            expect(notice).toBeNull();
          } else {
            expect(notice).toHaveTextContent(
              `Coord's live probe's latest read failed (HTTP 502), so the Observed, Coverage and Staleness figures of ${c.names}, and the statuses of the live-probed parts below, are its last answer, not a current reading.`
            );
          }
          for (const aspect of PLANTS) {
            const unprobed = c.unprobed.includes(aspect);
            // A twin the notice leaves out says nothing in it is probed live.
            if (
              notice &&
              !notice.textContent?.includes(`the ${aspect} twin`)
            ) {
              expect(unprobed, aspect).toBe(true);
            }
            for (const key of ["observed", "coverage", "staleness"]) {
              const f = figure(aspect, key);
              if (unprobed) {
                // Whatever coord answered or refused, and whatever is kept.
                expect(f, `${aspect}.${key}`).toHaveTextContent(
                  "UNKNOWNnothing in this twin is probed live yet"
                );
              } else if (c.refused) {
                expect(f, `${aspect}.${key}`).toHaveTextContent(
                  "UNKNOWNcoord does not share the twin's live readings with this workspace"
                );
              } else {
                expect(f, `${aspect}.${key}`).not.toHaveTextContent(
                  "nothing in this twin is probed live"
                );
              }
            }
          }

          // Every part of every aspect's drill-down.
          const live = livePartIds(catalog, body);
          const refusedParts = new Set<string>();
          for (const aspect of ASPECTS) {
            const { detail } = await openAspect(aspect);
            for (const row of within(detail).getAllByTestId(
              /^digital-twin-part-/
            )) {
              const id = row
                .getAttribute("data-testid")!
                .slice("digital-twin-part-".length);
              const title = row.getAttribute("title") ?? "";
              // No part claims a refusal of itself alone.
              expect(row, id).not.toHaveTextContent(/\bRestricted\b/);
              expect(title, id).not.toMatch(/Qontinui-internal|unaffected/);
              if (c.refused && live.has(id)) {
                refusedParts.add(id);
                expect(row, id).toHaveTextContent("UNKNOWN");
                expect(title, id).toBe(REFUSED_PART);
              } else {
                expect(title, id).not.toContain(
                  "does not share the twin's live readings"
                );
              }
            }
            if (view) expectPresentationSafe(view, { forbidden: FORBIDDEN });
          }
          // Not vacuous: a refusal reaches every live part, and only then.
          expect(refusedParts.size).toBe(c.refused ? live.size : 0);
          if (c.refused) expect(live.size).toBeGreaterThan(0);
        });
      }
    }
  }

  it("has no notice over an answer the latest read returned", () => {
    render(<TwinMap />);
    expect(screen.queryByTestId("digital-twin-map-probe-held")).toBeNull();
  });

  it("has no notice where the probe holds no reading: every probe figure says UNKNOWN and why", () => {
    // A failed refresh over a degraded answer: no probe was made, so there
    // is no last answer to name.
    const body = stubBody(
      "**/api/v1/digital-twin/subspaces"
    ) as SubspacesProbeResponse;
    holdProbe({
      ...body,
      degraded: true,
      subspaces: body.subspaces.map((cell) => ({
        id: cell.id,
        status: "error" as const,
        error: "coord_unavailable",
      })),
    });
    render(<TwinMap />);
    expect(screen.queryByTestId("digital-twin-map-probe-held")).toBeNull();
    expect(figure("process", "observed")).toHaveAttribute(
      "data-fidelity-state",
      "unknown"
    );
  });
});

/**
 * The UI Bridge app twin over the runner's two reads, in both modes. A figure
 * is the runner's answer only while its read's LATEST attempt answered:
 * react-query keeps an earlier answer beside a failed refetch, and nothing on
 * the card would say it is not current, so the card shows the failure — dated
 * by that attempt — and never the kept value. The map has no notice for these
 * reads, so a failed one adds none.
 */
describe("TwinMap — the UI Bridge app twin's figures are the runner's latest answer", () => {
  const DEVICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  /** The failed refetch, nine minutes after the answer it would replace. */
  const FAILED_AT = READ_AT + 9 * 60_000;
  const DOWN = new RunnerRelayError("runner unreachable", 503);
  const APPS = { ok: true, apps: [{ app_id: "a" }, { app_id: "b" }] };
  const GRAPH = {
    ok: true,
    pages: [
      { id: "p1", stateIds: ["s"], transitionIds: [] },
      { id: "p2", stateIds: [], transitionIds: [] },
    ],
  };
  const answered = (data: unknown) => ({
    ...idle,
    data,
    dataUpdatedAt: READ_AT,
  });
  /** A failed read, over `held` when react-query keeps an earlier answer. */
  const failed = (held?: unknown) => ({
    ...idle,
    data: held,
    dataUpdatedAt: held === undefined ? 0 : READ_AT,
    isError: true,
    error: DOWN,
    errorUpdatedAt: FAILED_AT,
  });

  /** What a figure says: its value, or the reason it has none. */
  const REGISTRY_FAILED =
    "the runner's app registry could not be read (HTTP 503)";
  const MODEL_FAILED =
    "the runner's model of its own interface could not be read (HTTP 503)";

  const CASES: readonly {
    name: string;
    apps: Record<string, unknown>;
    graph: Record<string, unknown>;
    observed: { value: string } | { reason: string };
    coverage: { value: string } | { reason: string };
  }[] = [
    {
      name: "both answered",
      apps: answered(APPS),
      graph: answered(GRAPH),
      observed: { value: "2 apps" },
      coverage: { value: "2 of 2" },
    },
    {
      name: "the registry's refetch failed over its last answer",
      apps: failed(APPS),
      graph: answered(GRAPH),
      observed: { reason: REGISTRY_FAILED },
      coverage: { value: "2 of 2" },
    },
    {
      name: "the model's refetch failed over its last answer",
      apps: answered(APPS),
      graph: failed(GRAPH),
      observed: { value: "2 apps" },
      coverage: { reason: MODEL_FAILED },
    },
    {
      name: "both refetches failed over their last answers",
      apps: failed(APPS),
      graph: failed(GRAPH),
      observed: { reason: REGISTRY_FAILED },
      coverage: { reason: MODEL_FAILED },
    },
    {
      name: "both reads failed with nothing held",
      apps: failed(),
      graph: failed(),
      observed: { reason: REGISTRY_FAILED },
      coverage: { reason: MODEL_FAILED },
    },
  ];

  /** The kept values a failed read must never show. */
  const KEPT = { observed: "2 apps", coverage: "2 of 2" } as const;

  for (const c of CASES) {
    for (const mode of ["operator", "presenting"] as const) {
      it(`${c.name} · ${mode}`, () => {
        state.appTwin = {
          deviceId: DEVICE,
          online: true,
          apps: c.apps,
          graph: c.graph,
        };
        const view = mode === "presenting" ? presentTwinMap() : null;
        if (mode === "operator") render(<TwinMap />);

        for (const key of ["observed", "coverage"] as const) {
          const f = figure("ui-bridge", key);
          const want = c[key];
          const chip = f.querySelector("[data-provenance]");
          if ("value" in want) {
            expect(f, key).toHaveAttribute("data-fidelity-state", "known");
            expect(f, key).toHaveTextContent(want.value);
          } else {
            expect(f, key).toHaveAttribute("data-fidelity-state", "unknown");
            expect(f, key).toHaveTextContent(`UNKNOWN${want.reason}`);
            expect(f, key).not.toHaveTextContent(KEPT[key]);
          }
          if (mode === "presenting") {
            // Dated in both arms: by the answer, or by the failed attempt.
            expect(chip, key).toHaveAttribute("data-provenance-known", "true");
          } else {
            expect(chip, key).toBeNull();
          }
        }
        // The map's one notice is the probe's, and the probe answered.
        expect(screen.queryByTestId("digital-twin-map-probe-held")).toBeNull();
        if (view) expectPresentationSafe(view, { forbidden: FORBIDDEN });
      });
    }
  }
});

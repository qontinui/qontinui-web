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
  state.appTwin = { deviceId: null, apps: idle, graph: idle };
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

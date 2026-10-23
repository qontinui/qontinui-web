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
import { manifest } from "../_lib/resolve";
import type { SubspacesProbeResponse, TwinCatalogResponse } from "../_lib/types";

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
  const stub = SPEC.metadata.routeStubs.find((s) => s.urlPattern === urlPattern);
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
    metadata: area ? { area, source_path: `qontinui-dev-notes/plans/${slug}.md` } : null,
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
    data: stubBody("**/api/v1/digital-twin/subspaces") as SubspacesProbeResponse,
    dataUpdatedAt: READ_AT,
  };
  state.catalog = stubBody("**/api/v1/digital-twin/catalog") as TwinCatalogResponse;
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
    within(card(aspect)).getByRole("button", { name: /show its parts and plans/i })
  );
  return { user, detail: screen.getByTestId(`digital-twin-aspect-detail-${aspect}`) };
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
    expect(within(plans).getByTestId("digital-twin-aspect-process-plans-in-flight")).toHaveTextContent("1");
    expect(within(plans).getByTestId("digital-twin-aspect-process-plans-blocked")).toHaveTextContent("1");
    expect(within(plans).getByTestId("digital-twin-aspect-process-plans-done")).toHaveTextContent("1");
    expect(screen.getByTestId("digital-twin-plans-read")).toHaveTextContent(
      "4 work units"
    );
  });

  it("opens an aspect: its parts, and its plans with live status, each linking to its work unit", async () => {
    render(<TwinMap />);
    const { detail } = await openAspect("process");

    const parts = within(detail).getByTestId("digital-twin-parts");
    const processRows = manifest.subspaces.filter((s) => s.twin === "process");
    expect(within(parts).getAllByRole("button")).toHaveLength(processRows.length);

    const links = within(detail).getAllByTestId("digital-twin-plan-link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(
      `/admin/coord/work-units/${encodeURIComponent(EVENT_LOG)}`
    );
    expect(hrefs).toContain("/admin/coord/work-units/2026-10-01-gates-blocked");
    // Each plan shows its live status beside it.
    const eventLog = links
      .find((a) => a.getAttribute("href")!.endsWith(encodeURIComponent(EVENT_LOG)))!
      .closest("li")!;
    expect(within(eventLog).getByText("In progress")).toBeInTheDocument();
    // The shipped plan is kept, collapsed, under "Shipped or closed".
    expect(within(detail).getByTestId("digital-twin-plans-finished")).toHaveTextContent("1");
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

  it("names, for the operator, mapped areas that no work unit carries", async () => {
    render(<TwinMap />);
    const { detail } = await openAspect("process");
    // `coord-claims` maps the coordination part; no fixture unit carries it.
    expect(within(detail).getByTestId("digital-twin-area-drift")).toHaveTextContent(
      "coord-claims"
    );
  });
});

describe("TwinMap — a failed source is a labelled UNKNOWN, never zero", () => {
  it("renders a failed probe as UNKNOWN with the reason on every probe figure", () => {
    state.probe = {
      ...idle,
      isError: true,
      error: new Error("GET /api/v1/digital-twin/subspaces failed: 502 - upstream"),
    };
    render(<TwinMap />);
    for (const key of ["observed", "coverage", "staleness"]) {
      const f = figure("environment", key);
      expect(f, key).toHaveAttribute("data-fidelity-state", "unknown");
      expect(f, key).toHaveTextContent("UNKNOWN");
      expect(f, key).toHaveTextContent("coord's live probe could not be read (HTTP 502)");
      expect(f, key).not.toHaveTextContent(/\b0 of\b/);
    }
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
    expect(screen.getByTestId("digital-twin-plans-incomplete")).toHaveTextContent(
      /INCOMPLETE — coord's work-unit list stopped answering after 2 pages/
    );
  });

  it("renders the app twin as UNKNOWN with no runner connected", () => {
    render(<TwinMap />);
    const f = figure("ui-bridge", "observed");
    expect(f).toHaveAttribute("data-fidelity-state", "unknown");
    expect(f).toHaveTextContent("no runner is connected");
  });
});

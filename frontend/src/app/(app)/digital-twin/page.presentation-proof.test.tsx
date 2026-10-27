/**
 * /digital-twin in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D3, Phase 5), through Phase 1's
 * helper and the REAL UI Bridge provider: every tab, the Twin map's
 * drill-down and the sub-space drawer must hold no enabled control that is
 * not navigation-only, no link to a console page that drops the presentation,
 * no write registration, no cost, and the captions they promise.
 *
 * This file is the proof `presentationReadiness.ts` names for `/digital-twin`:
 * without the registration `PresentationPage` withholds the whole page in
 * presentation mode. What makes it a proof is read from the RUN
 * (`src/test/readinessEvidence.ts`) — the page's own component mounted under
 * a presenting lens, its last check over each render clean, the real
 * provider's registry read — so only data sources are mocked here (the data
 * hooks, the runner context, the chat socket). Mocking a component the page
 * renders, or a lens primitive, would put a render in front of the check that
 * is not production's.
 *
 * The data hooks answer with the page's own Spec CI stubs. A runner is
 * connected (dispatch target, chat socket, relay target), so every control
 * the lens unmounts — Ask the Twin's input and Ask button, the UI Bridge
 * inspector's App field and Capture snapshot — WOULD render if its
 * `OperatorOnly` boundary were removed: a boundary that holds back nothing
 * would make this test vacuous.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import type { WalkOutcome } from "@/app/(app)/admin/coord/work-units/planWalk";
import {
  isPresentationReady,
  type CaptionKey,
  type PresentationScopeState,
} from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import { RESTRICTED_REASON } from "./_lib/twin-aspects";
import type { SubspacesProbeResponse } from "./_lib/types";

/**
 * What each data hook answers. `probe` is set before every test; the others
 * answer the page's own Spec CI stubs unless a test sets them (a failure arm).
 */
const state = vi.hoisted(() => ({
  probe: {} as Record<string, unknown>,
  catalog: null as Record<string, unknown> | null,
  /** Every raw read fails with this error (the drawer, the fidelity report). */
  rawError: null as unknown,
  workUnits: null as Record<string, unknown> | null,
  /** A Delivery lookup answers this instead of the stub. */
  delivery: null as Record<string, unknown> | null,
  /** The runner relay's reads fail with this error. */
  runnerError: null as unknown,
}));

const SPEC = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../specs/pages/digital-twin/state-machine.derived.json"
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
const answered = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  dataUpdatedAt: READ_AT,
  errorUpdatedAt: 0,
});

vi.mock("./_hooks/useDigitalTwinSubspaces", () => ({
  useDigitalTwinSubspaces: () => state.probe,
}));
const failed = (error: unknown) => ({
  ...answered(undefined),
  isError: true,
  error,
  dataUpdatedAt: 0,
  errorUpdatedAt: READ_AT,
});

vi.mock("./_hooks/useTwinCatalog", () => ({
  useTwinCatalog: () =>
    state.catalog ?? answered(stubBody("**/api/v1/digital-twin/catalog")),
}));
vi.mock("./_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: (id: string | null, enabled: boolean) => {
    if (!enabled) return answered(undefined);
    if (state.rawError !== null) return failed(state.rawError);
    return id === "schema"
      ? answered(stubBody("**/api/v1/digital-twin/subspace/schema/raw"))
      : failed(
          new Error(
            `GET /api/v1/digital-twin/subspace/${id}/raw failed: 404 - none`
          )
        );
  },
}));
vi.mock("./_hooks/useTwinWorkUnits", () => ({
  useTwinWorkUnits: () => {
    if (state.workUnits !== null) return state.workUnits;
    const body = stubBody("**/api/v1/operations/plans**") as {
      work_units: CoordPlanRow[];
    };
    const outcome: WalkOutcome = {
      kind: "complete",
      rows: body.work_units,
      bodySignal: null,
      pages: 1,
    };
    return answered(outcome);
  },
}));
vi.mock("./_hooks/useDeliveryVerdict", () => ({
  useDeliveryVerdict: (slug: string) =>
    !slug.trim()
      ? answered(undefined)
      : (state.delivery ??
        answered(stubBody("**/api/v1/digital-twin/delivery/verdict**"))),
}));
const RUNNER = "device-presentation-test";
vi.mock("./_hooks/useUiBridge", () => {
  const read = () =>
    state.runnerError === null
      ? {
          data: undefined,
          isLoading: false,
          isError: false,
          error: null,
          isFetching: false,
          dataUpdatedAt: 0,
          errorUpdatedAt: 0,
          refetch: () => {},
        }
      : { ...failed(state.runnerError), refetch: () => {} };
  return {
    useRunnerApps: read,
    useRunnerSpecList: read,
    useRunnerSpecGraph: read,
    useRunnerSnapshot: read,
  };
});
vi.mock("@/contexts/active-runner-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/contexts/active-runner-context")>();
  return {
    ...actual,
    useDispatchTarget: () => ({
      runnerId: RUNNER,
      reason: "explicit",
      message: null,
    }),
    useRunnerTarget: () => ({
      kind: "runner",
      runner: { id: RUNNER, name: "A runner" },
    }),
  };
});
vi.mock("@/hooks/useChatWebSocket", () => ({
  useChatWebSocket: () => ({
    isConnected: true,
    sessionState: "disconnected",
    sessionError: null,
    messages: [],
    streamingContent: "",
    createSession: () => {},
    sendMessage: () => {},
  }),
}));

import DigitalTwinPage from "./page";

/** The tenant's scope: its own owner first-party, no confidential terms. */
const SCOPE: PresentationScopeState = {
  status: "ready",
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: [] },
};

/**
 * What the fixture's work units are called, read from the stub itself so it
 * cannot drift: the lens cannot prove their repositories first-party, so the
 * Twin map must show none of these titles or slugs (D3.3).
 */
const PLAN_NAMES: string[] = (
  stubBody("**/api/v1/operations/plans**") as { work_units: CoordPlanRow[] }
).work_units.flatMap((unit) =>
  unit.title ? [unit.title, unit.slug] : [unit.slug]
);

const FIGURE_KEYS = ["observed", "coverage", "staleness", "honesty"] as const;

/** Each aspect's four figures' sources, in FIGURE_KEYS order — as the reader sees them. */
const FIGURE_SOURCES: Record<string, readonly string[]> = {
  environment: [
    "coord's live twin probe",
    "coord's live twin probe",
    "coord's live twin probe",
    "coord's twin self-check",
  ],
  process: [
    "coord's live twin probe",
    "coord's live twin probe",
    "coord's live twin probe",
    "coord's twin self-check",
  ],
  intent: [
    "coord's live twin probe",
    "coord's live twin probe",
    "coord's live twin probe",
    "coord's twin self-check",
  ],
  "ui-bridge": [
    "the runner's app registry",
    "the runner's interface models",
    "the runner's interface models",
    "coord's twin self-check",
  ],
};

const TWIN_MAP_CAPTIONS: CaptionKey[] = [
  "digital-twin.page",
  "digital-twin.twin-map",
  "digital-twin.aspect-environment",
  "digital-twin.aspect-process",
  "digital-twin.aspect-intent",
  "digital-twin.aspect-ui-bridge",
];

beforeEach(() => {
  state.probe = answered(stubBody("**/api/v1/digital-twin/subspaces"));
  state.catalog = null;
  state.rawError = null;
  state.workUnits = null;
  state.delivery = null;
  state.runnerError = null;
});

function renderPresenting() {
  return renderInPresentationMode(<DigitalTwinPage />, { scope: SCOPE });
}

/**
 * Every link on the screen that stays on this origin leads to a page that
 * can be presented, and keeps the presentation. A link to any other console
 * page — out of the lens trees (one click drops the lens), or a lens page not
 * presentation-ready ("shown in the operator view only") — must be plain
 * text while presenting (`LensLink`). An outbound link (a first-party PR on
 * GitHub) is the redaction's to clear, not this check's.
 */
function expectOnlyPresentableLinks(where: string): void {
  const origin = new URL(document.baseURI).origin;
  for (const link of document.querySelectorAll("a[href]")) {
    const url = new URL(link.getAttribute("href")!, document.baseURI);
    if (url.origin !== origin) continue;
    expect(isPresentationReady(url.pathname), `${where}: ${url.href}`).toBe(
      true
    );
    expect(url.searchParams.get("present"), `${where}: ${url.href}`).toBe("1");
  }
}

/**
 * While the probe holds no reading, no view of it shows a count: the
 * Completeness live gauge and the Lifecycle intro (its twin counts) are a
 * labelled UNKNOWN naming `reason`, with no "N/M" anywhere in them; and the
 * notice that qualifies "the live statuses below" sits above both.
 */
async function expectProbeViewsUnknown(
  user: ReturnType<typeof userEvent.setup>,
  reason: string
): Promise<void> {
  await user.click(screen.getByRole("tab", { name: "Completeness" }));
  const gauge = await screen.findByTestId("digital-twin-gauge-live");
  expect(gauge).toHaveTextContent("UNKNOWN");
  expect(gauge).toHaveTextContent(reason);
  expect(gauge.textContent).not.toMatch(/\d+\/\d+/);
  expect(
    screen
      .getByTestId("digital-twin-coord-unreachable")
      .compareDocumentPosition(screen.getByTestId("digital-twin-gauges")) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();

  await user.click(screen.getByRole("tab", { name: "Lifecycle" }));
  await screen.findByTestId("digital-twin-stage-verify");
  const intro = document.querySelector<HTMLElement>(
    '[aria-labelledby="digital-twin-lifecycle-intro"]'
  )!;
  expect(intro).toHaveTextContent("UNKNOWN");
  expect(intro).toHaveTextContent(reason);
  expect(intro.textContent).not.toMatch(/\d+\/\d+/);
  expect(
    screen
      .getByTestId("digital-twin-coord-unreachable")
      .compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
}

/** The open drill-down's live parts: UNKNOWN with `reason`, none reading "Error". */
function expectDrillDownPartsUnknown(detail: HTMLElement, reason: string) {
  const parts = within(detail).getAllByTestId(/^digital-twin-part-/);
  const unknown = parts.filter((p) => p.textContent?.includes("UNKNOWN"));
  // The process twin's eight live parts, by the page's own stub catalog.
  expect(unknown).toHaveLength(8);
  for (const part of unknown) {
    expect(part.getAttribute("title")).toContain(reason);
  }
  expect(within(detail).queryByText(/(^|\s)Error(\s|$)/)).toBeNull();
}

describe("/digital-twin in presentation mode", () => {
  it("opens on the Twin map, captioned, with nothing to press but navigation and no cost", () => {
    const view = renderPresenting();
    expect(screen.getByRole("tab", { name: "Twin map" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expectPresentationSafe(view, {
      captions: TWIN_MAP_CAPTIONS,
      forbidden: PLAN_NAMES,
    });
    expectOnlyPresentableLinks("Twin map");
    // Every fidelity figure carries its own source and age — each one named,
    // so dropping the chip from any single figure is caught, not hidden in a
    // count.
    for (const [aspect, sources] of Object.entries(FIGURE_SOURCES)) {
      FIGURE_KEYS.forEach((key, i) => {
        const chip = screen
          .getByTestId(`digital-twin-aspect-${aspect}-fidelity-${key}`)
          .querySelector("[data-provenance]");
        expect(chip, `${aspect}.${key}`).toHaveTextContent(
          `source: ${sources[i]}`
        );
      });
      // And so does each card's plan count.
      expect(
        screen
          .getByTestId(`digital-twin-aspect-${aspect}-plans`)
          .querySelector("[data-provenance]"),
        `${aspect} plans`
      ).toHaveTextContent("source: coord's work-unit list");
    }
    // The line saying where the plans come from carries its own.
    expect(
      screen
        .getByTestId("digital-twin-plans-read")
        .querySelector("[data-provenance]")
    ).toHaveTextContent("source: coord's work-unit list");
  });

  it("opens an aspect's parts and plans, with plan titles withheld and unlinked", async () => {
    const view = renderPresenting();
    const user = userEvent.setup();
    await user.click(
      within(screen.getByTestId("digital-twin-aspect-card-process")).getByRole(
        "button",
        { name: /show its parts and plans/i }
      )
    );
    const detail = screen.getByTestId("digital-twin-aspect-detail-process");
    expectPresentationSafe(view, {
      captions: [...TWIN_MAP_CAPTIONS, "digital-twin.aspect-detail"],
      forbidden: PLAN_NAMES,
    });

    // coord names a plan's repositories without an owner, so no title can be
    // proven first-party: each plan is its descriptor, and its link — whose
    // URL carries the slug — is gone.
    const plans = within(detail).getAllByTestId("digital-twin-plan");
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.querySelector('[data-redacted="true"]')).not.toBeNull();
      expect(plan.querySelector("a")).toBeNull();
      expect(plan.textContent).not.toMatch(/Fixture:|Process twin:/);
    }
    expect(within(detail).queryByTestId("digital-twin-area-drift")).toBeNull();
    // The plans' counts and statuses carry their source and age.
    expect(detail.querySelector("[data-provenance]")).toHaveTextContent(
      "source: coord's work-unit list"
    );

    expectOnlyPresentableLinks("the process twin's parts and plans");

    // Filtering by a part is navigation, and stays safe.
    await user.click(within(detail).getByTestId("digital-twin-part-gates"));
    expectPresentationSafe(view, { forbidden: PLAN_NAMES });
  });

  it("keeps every other tab — and the sub-space drawer — safe to show", async () => {
    const view = renderPresenting();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Completeness" }));
    await screen.findByTestId("digital-twin-cell-gates");
    // Ask the Twin is replaced, not hidden: no input, no Ask button, no socket.
    expect(screen.getByTestId("ask-the-twin-presented")).toBeInTheDocument();
    expectPresentationSafe(view, { captions: ["digital-twin.page"] });
    expectOnlyPresentableLinks("Completeness");
    // The live gauge carries its source and age.
    expect(
      screen
        .getByTestId("digital-twin-gauges")
        .querySelector("[data-provenance]")
    ).toHaveTextContent("source: coord's live twin probe");

    // A row Ask the Twin can answer: the drawer's ask is held back too.
    await user.click(screen.getByTestId("digital-twin-cell-gates"));
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: /ask the twin about this/i })
    ).toBeNull();
    expectPresentationSafe(view);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // A row the Delivery tab answers: the drawer's jump there is navigation,
    // and stays live.
    await user.click(screen.getByTestId("digital-twin-cell-delivery"));
    await screen.findByRole("dialog");
    expect(
      screen.getByRole("button", { name: /open the delivery tab/i })
    ).toBeEnabled();
    expectPresentationSafe(view);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // A live-probed row with a raw verdict: its summary shows, its raw JSON
    // toggle does not.
    await user.click(screen.getByTestId("digital-twin-cell-schema"));
    await screen.findByTestId("digital-twin-drawer-summary");
    expect(screen.queryByRole("button", { name: /raw data/i })).toBeNull();
    expectPresentationSafe(view);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("tab", { name: "Lifecycle" }));
    await screen.findByTestId("digital-twin-stage-verify");
    // The stages name the console pages that cover them. None of those pages
    // can be presented — /sessions is out of the lens, and no listed console
    // page is presentation-ready — so each is plain text, never a link out.
    const sessions = within(
      screen.getByTestId("digital-twin-stage-implement")
    ).getByText("Sessions");
    expect(sessions).toHaveAttribute("data-lens-link", "unlinked");
    expect(sessions.closest("a")).toBeNull();
    expect(
      within(screen.getByTestId("digital-twin-stage-verify")).getByText("Gates")
    ).toHaveAttribute("data-lens-link", "unlinked");
    expectOnlyPresentableLinks("Lifecycle");
    expectPresentationSafe(view);
    // The live counts carry their source and age.
    expect(
      document.querySelector(
        '[aria-labelledby="digital-twin-lifecycle-intro"] [data-provenance]'
      )
    ).toHaveTextContent("source: coord's live twin probe");

    await user.click(screen.getByRole("tab", { name: "Delivery" }));
    const slug = screen.getByPlaceholderText(/approach-d-conductor-engine/);
    await user.type(slug, "2026-06-15-twin-delivery-verdict-completion-view");
    await user.click(screen.getByRole("button", { name: /look up/i }));
    await screen.findByText("Cited PRs");
    // No raw JSON, and no PR repository an outsider could follow.
    expect(screen.queryByRole("button", { name: /raw data/i })).toBeNull();
    expect(document.querySelector('a[href*="github.com"]')).toBeNull();
    expectPresentationSafe(view);
    expectOnlyPresentableLinks("Delivery");
    // The verdict's envelope carries its source and age.
    expect(
      screen
        .getByTestId("delivery-verdict-envelope")
        .querySelector("[data-provenance]")
    ).toHaveTextContent("source: coord's delivery verdict");

    await user.click(screen.getByRole("tab", { name: "UI Bridge" }));
    expect(
      await screen.findByTestId("ui-bridge-presented")
    ).toBeInTheDocument();
    expectPresentationSafe(view);
    expectOnlyPresentableLinks("UI Bridge");
  });

  it("names the plan building a sub-space in the drawer, as plain text while its work-unit page cannot be presented", async () => {
    const view = renderPresenting();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Completeness" }));
    await user.click(
      await screen.findByTestId("digital-twin-cell-process_log")
    );
    await screen.findByRole("dialog");
    // The slug is the manifest's own — the product's, not a tenant's — so it
    // shows; its work-unit page is not presentation-ready, so it is not a link
    // into "shown in the operator view only".
    const planned = screen.getByTestId("digital-twin-drawer-plan-link");
    expect(planned).toHaveTextContent(
      "2026-10-11-process-twin-event-log-and-flow-metrics"
    );
    expect(planned).toHaveAttribute("data-lens-link", "unlinked");
    expect(planned.closest("a")).toBeNull();
    expectOnlyPresentableLinks("the drawer");
    expectPresentationSafe(view);
  });
});

/**
 * A host and a client that only upstream error text names — what a failed
 * read's message would carry onto the screen if the lens printed it.
 */
const HOST = "coord.internal.acme-corp.example";
const UPSTREAM = `upstream https://${HOST}:8443 refused the connection for Acme Corp`;
const FAILURE_FORBIDDEN = [HOST, "acme"];
const leaky = (request: string, status: number) =>
  new Error(`GET ${request} failed: ${status} - ${UPSTREAM}`);

describe("/digital-twin in presentation mode, when its sources fail", () => {
  it("says what failed and its HTTP status on every tab — never what the failure's text says", async () => {
    state.probe = failed(leaky("/api/v1/digital-twin/subspaces", 502));
    state.catalog = failed(leaky("/api/v1/digital-twin/catalog", 502));
    state.rawError = leaky("/api/v1/digital-twin/subspace/schema/raw", 502);
    state.workUnits = failed(leaky("/api/v1/operations/plans", 503));
    state.delivery = failed(
      leaky("/api/v1/digital-twin/delivery/verdict", 502)
    );
    state.runnerError = leaky("/api/v1/runners/device/proxy/apps", 502);
    const view = renderPresenting();
    const user = userEvent.setup();

    // The Twin map: the probe, the work-unit read and the runner, each by
    // its status.
    expect(
      screen.getByTestId("digital-twin-aspect-environment-fidelity-observed")
    ).toHaveTextContent("coord's live probe could not be read (HTTP 502)");
    expect(screen.getByTestId("digital-twin-plans-unknown")).toHaveTextContent(
      "The plans could not be read: coord's work-unit list answered HTTP 503"
    );
    expect(
      screen.getByTestId("digital-twin-aspect-ui-bridge-fidelity-observed")
    ).toHaveTextContent(
      "the runner's app registry could not be read (HTTP 502)"
    );
    expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });

    await user.click(
      within(screen.getByTestId("digital-twin-aspect-card-process")).getByRole(
        "button",
        { name: /show its parts and plans/i }
      )
    );
    expect(
      screen.getByTestId("digital-twin-aspect-detail-plans-unknown")
    ).toHaveTextContent("coord's work-unit list answered HTTP 503");
    expectDrillDownPartsUnknown(
      screen.getByTestId("digital-twin-aspect-detail-process"),
      "Coord's live probe could not be read (HTTP 502)"
    );
    expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });

    // Neither the live gauge nor a twin's count is a "0/N" during it.
    await expectProbeViewsUnknown(
      user,
      "Coord's live probe could not be read (HTTP 502)."
    );
    expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });

    await user.click(screen.getByRole("tab", { name: "Completeness" }));
    await screen.findByTestId("digital-twin-cell-schema");
    expect(screen.getByTestId("twin-catalog-error")).toHaveTextContent(
      "Couldn't load the catalog (HTTP 502)."
    );
    expect(
      screen.getByTestId("digital-twin-coord-unreachable")
    ).toHaveTextContent("UNKNOWN");
    expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });

    await user.click(screen.getByTestId("digital-twin-cell-schema"));
    await screen.findByRole("dialog");
    expect(
      screen.getByTestId("digital-twin-drawer-read-error")
    ).toHaveTextContent("Could not read the live verdict (HTTP 502).");
    expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("tab", { name: "Lifecycle" }));
    await screen.findByTestId("digital-twin-stage-verify");
    expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });

    await user.click(screen.getByRole("tab", { name: "Delivery" }));
    await user.type(
      screen.getByPlaceholderText(/approach-d-conductor-engine/),
      "2026-06-15-twin-delivery-verdict-completion-view"
    );
    await user.click(screen.getByRole("button", { name: /look up/i }));
    expect(
      await screen.findByTestId("delivery-verdict-error")
    ).toHaveTextContent("Could not read the delivery verdict (HTTP 502).");
    expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });

    await user.click(screen.getByRole("tab", { name: "UI Bridge" }));
    await screen.findByTestId("ui-bridge-presented");
    expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });
  });

  it("reads a degraded probe as UNKNOWN, an incomplete or stale plan read without its text, and coord's unit status in fixed words", async () => {
    const body = stubBody(
      "**/api/v1/digital-twin/subspaces"
    ) as SubspacesProbeResponse;
    state.probe = answered({
      ...body,
      degraded: true,
      subspaces: body.subspaces.map((s) => ({
        id: s.id,
        status: "error",
        error: "coord_unavailable",
      })),
    } satisfies SubspacesProbeResponse);
    const plans = stubBody("**/api/v1/operations/plans**") as {
      work_units: CoordPlanRow[];
    };
    state.workUnits = {
      ...answered({
        kind: "partial",
        rows: plans.work_units,
        bodySignal: null,
        pages: 2,
        reason: "error",
        error: UPSTREAM,
      } satisfies WalkOutcome),
      isError: true,
      error: leaky("/api/v1/operations/plans", 503),
      errorUpdatedAt: READ_AT + 120_000,
    };
    const verdict = structuredClone(
      stubBody("**/api/v1/digital-twin/delivery/verdict**")
    ) as { verdict: { components: Record<string, unknown> } };
    verdict.verdict.components.status = "waiting-on-acme-corp-legal";
    state.delivery = answered(verdict);
    const view = renderPresenting();
    const user = userEvent.setup();

    for (const key of ["observed", "coverage", "staleness"]) {
      const figure = screen.getByTestId(
        `digital-twin-aspect-environment-fidelity-${key}`
      );
      expect(figure, key).toHaveAttribute("data-fidelity-state", "unknown");
      expect(figure, key).toHaveTextContent(
        "coord's live probe could not be made: coord could not be reached"
      );
    }
    expect(
      screen.getByTestId("digital-twin-plans-incomplete")
    ).toHaveTextContent(
      "INCOMPLETE — coord's work-unit list stopped answering after 2 pages"
    );
    expect(screen.getByTestId("digital-twin-plans-stale")).toHaveTextContent(
      "The last refresh failed (coord's work-unit list answered HTTP 503)"
    );
    expectPresentationSafe(view, {
      forbidden: [...FAILURE_FORBIDDEN, ...PLAN_NAMES],
    });

    // The drill-down: no probe was made, so no live part is an "Error".
    await user.click(
      within(screen.getByTestId("digital-twin-aspect-card-process")).getByRole(
        "button",
        { name: /show its parts and plans/i }
      )
    );
    expectDrillDownPartsUnknown(
      screen.getByTestId("digital-twin-aspect-detail-process"),
      "Coord's live probe could not be made: coord could not be reached"
    );
    expectPresentationSafe(view, {
      forbidden: [...FAILURE_FORBIDDEN, ...PLAN_NAMES],
    });

    // Neither the live gauge nor a twin's count is a "0/N" during it.
    await expectProbeViewsUnknown(
      user,
      "Coord's live probe could not be made: coord could not be reached."
    );
    expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });

    // Every view of the probe names the outage the same way.
    for (const tab of ["Completeness", "Lifecycle"]) {
      await user.click(screen.getByRole("tab", { name: tab }));
      expect(
        await screen.findByTestId("digital-twin-coord-unreachable"),
        tab
      ).toHaveTextContent(
        "Coord's live probe could not be made: coord could not be reached, so the live statuses below are not a current reading."
      );
      expectPresentationSafe(view, { forbidden: FAILURE_FORBIDDEN });
    }

    await user.click(screen.getByRole("tab", { name: "Delivery" }));
    await user.type(
      screen.getByPlaceholderText(/approach-d-conductor-engine/),
      "2026-06-15-twin-delivery-verdict-completion-view"
    );
    await user.click(screen.getByRole("button", { name: /look up/i }));
    await screen.findByText("Cited PRs");
    expect(
      screen.getByText(
        /Plan status “Status unknown”; 2 cited PRs, all merged\./
      )
    ).toBeInTheDocument();
    expectPresentationSafe(view, {
      forbidden: [...FAILURE_FORBIDDEN, "waiting-on"],
    });
  });
});

describe("/digital-twin restricted, in presentation mode", () => {
  const restricted = (): SubspacesProbeResponse => {
    const body = stubBody(
      "**/api/v1/digital-twin/subspaces"
    ) as SubspacesProbeResponse;
    return {
      ...body,
      restricted: true,
      subspaces: body.subspaces.map((s) => ({
        id: s.id,
        status: "restricted",
      })),
    };
  };

  it("names the restriction as a labelled UNKNOWN — never the internal-operators notice", async () => {
    state.probe = answered(restricted());
    const view = renderPresenting();
    const user = userEvent.setup();

    // The Twin map: every probe figure is UNKNOWN, with the reason.
    const observed = screen.getByTestId(
      "digital-twin-aspect-environment-fidelity-observed"
    );
    expect(observed).toHaveAttribute("data-fidelity-state", "unknown");
    expect(observed).toHaveTextContent(RESTRICTED_REASON);

    for (const tab of ["Completeness", "Lifecycle"]) {
      await user.click(screen.getByRole("tab", { name: tab }));
      const notice = await screen.findByTestId(
        "digital-twin-access-restricted"
      );
      expect(notice, tab).toHaveAttribute("data-reading", "unknown");
      expect(notice, tab).toHaveTextContent("UNKNOWN");
      expect(notice, tab).toHaveTextContent(
        /does not share the twin's live readings/
      );
      expect(document.body, tab).not.toHaveTextContent(
        /limited to internal Qontinui operators/
      );
      expectPresentationSafe(view);
    }
  });
});

describe("/digital-twin registration", () => {
  // Everything above proves the page is safe to show; this is what lets it be
  // shown. Without the entry in PRESENTATION_READY_ROUTES the layout's gate
  // (`PresentationPage`) withholds the whole page in presentation mode, and
  // none of the proof above would reach an evaluator.
  it("is registered as presentation-ready, so the layout's gate lets the page through", () => {
    expect(isPresentationReady("/digital-twin")).toBe(true);
    expect(isPresentationReady("/digital-twin?present=1")).toBe(true);
  });
});

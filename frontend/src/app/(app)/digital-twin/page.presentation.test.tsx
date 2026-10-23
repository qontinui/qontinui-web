/**
 * /digital-twin in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D3, Phase 5), through Phase 1's
 * helper and the REAL UI Bridge provider: every tab, the Twin map's
 * drill-down and the sub-space drawer must hold no enabled control that is
 * not navigation-only, no write registration, no cost, and the captions they
 * promise.
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
import type {
  CaptionKey,
  PresentationScopeState,
} from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import { RESTRICTED_REASON } from "./_lib/twin-aspects";
import type { SubspacesProbeResponse } from "./_lib/types";

const state = vi.hoisted(() => ({
  probe: {} as Record<string, unknown>,
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
vi.mock("./_hooks/useTwinCatalog", () => ({
  useTwinCatalog: () => answered(stubBody("**/api/v1/digital-twin/catalog")),
}));
vi.mock("./_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: (id: string | null, enabled: boolean) =>
    enabled && id === "schema"
      ? answered(stubBody("**/api/v1/digital-twin/subspace/schema/raw"))
      : {
          ...answered(undefined),
          isError: enabled,
          error: enabled
            ? new Error(
                `GET /api/v1/digital-twin/subspace/${id}/raw failed: 404 - none`
              )
            : null,
        },
}));
vi.mock("./_hooks/useTwinWorkUnits", () => ({
  useTwinWorkUnits: () => {
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
    answered(
      slug.trim()
        ? stubBody("**/api/v1/digital-twin/delivery/verdict**")
        : undefined
    ),
}));
const RUNNER = "device-presentation-test";
vi.mock("./_hooks/useUiBridge", () => {
  const idle = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    refetch: () => {},
  };
  return {
    useRunnerApps: () => idle,
    useRunnerSpecList: () => idle,
    useRunnerSpecGraph: () => idle,
    useRunnerSnapshot: () => idle,
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
});

function renderPresenting() {
  return renderInPresentationMode(<DigitalTwinPage />, { scope: SCOPE });
}

describe("/digital-twin in presentation mode", () => {
  it("opens on the Twin map, captioned, with nothing to press but navigation and no cost", () => {
    const view = renderPresenting();
    expect(screen.getByRole("tab", { name: "Twin map" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expectPresentationSafe(view, { captions: TWIN_MAP_CAPTIONS });
    // Every fidelity figure and plan count carries its source and age.
    const map = screen.getByTestId("digital-twin-twin-map");
    expect(
      map.querySelectorAll("[data-provenance]").length
    ).toBeGreaterThanOrEqual(4 * 4 + 4);
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

    // Filtering by a part is navigation, and stays safe.
    await user.click(within(detail).getByTestId("digital-twin-part-gates"));
    expectPresentationSafe(view);
  });

  it("keeps every other tab — and the sub-space drawer — safe to show", async () => {
    const view = renderPresenting();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Completeness" }));
    await screen.findByTestId("digital-twin-cell-gates");
    // Ask the Twin is replaced, not hidden: no input, no Ask button, no socket.
    expect(screen.getByTestId("ask-the-twin-presented")).toBeInTheDocument();
    expectPresentationSafe(view, { captions: ["digital-twin.page"] });

    // A row Ask the Twin can answer: the drawer's ask is held back too.
    await user.click(screen.getByTestId("digital-twin-cell-gates"));
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: /ask the twin about this/i })
    ).toBeNull();
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
    expectPresentationSafe(view);

    await user.click(screen.getByRole("tab", { name: "Delivery" }));
    const slug = screen.getByPlaceholderText(/approach-d-conductor-engine/);
    await user.type(slug, "2026-06-15-twin-delivery-verdict-completion-view");
    await user.click(screen.getByRole("button", { name: /look up/i }));
    await screen.findByText("Cited PRs");
    // No raw JSON, and no PR repository an outsider could follow.
    expect(screen.queryByRole("button", { name: /raw data/i })).toBeNull();
    expect(document.querySelector('a[href*="github.com"]')).toBeNull();
    expectPresentationSafe(view);

    await user.click(screen.getByRole("tab", { name: "UI Bridge" }));
    expect(
      await screen.findByTestId("ui-bridge-presented")
    ).toBeInTheDocument();
    expectPresentationSafe(view);
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

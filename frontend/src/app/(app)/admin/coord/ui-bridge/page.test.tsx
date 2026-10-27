/**
 * The UI Bridge dashboard, driven through its REAL hooks, the digital twin's
 * reused hooks and the real relay client — only `httpClient` is faked, with
 * real-shaped runner bodies (`__fixtures__/runnerBodies.ts`).
 *
 * What these pin:
 * - every panel renders the runner's answer;
 * - a runner whose build predates the dashboard's relay entries (403) renders
 *   a labelled UNKNOWN naming that build, never an empty panel or a zero;
 * - an unreachable runner renders a labelled UNKNOWN with its reason;
 * - each action's declared effect is a badge, and the undeclared count counts
 *   the actions with none;
 * - the occlusion row reads UNKNOWN on every runner, whatever any runner
 *   answers and whatever page health returns — the sweep is not asked for,
 *   because no relay carries it (coord finding 99796499);
 * - the live snapshot and page health run only when asked;
 * - the web app registry, which is not partitioned by project, is read only
 *   for staff: any other viewer — a coord admin who is not staff, or a member
 *   who opened the URL — makes no such read, and reads that half as UNKNOWN.
 *
 * The occlusion sweep's own honesty rule, for the day a relay carries it, is
 * driven through the page in `page.sweepRelayed.test.tsx`.
 */

import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";
import {
  BUILD_ID,
  COMPONENTS_ALL_DECLARED_BODY,
  DEVICE_ID,
  DEVICE_NOT_OWNED_BODY,
  EGRESS_OFF_BODY,
  FLEET_APPS,
  NOT_CARRIED_BODY,
  NOT_CONNECTED_BODY,
  REQUEST_ID_NOT_CONNECTED,
  REQUEST_ID_NOT_OWNED,
  VISIBILITY_CLEAR_OBSERVED,
  VISIBILITY_CLEAR_UNOBSERVED,
  VISIBILITY_HIDES_TEXT,
  NATIVE_CAPTURE_NOTE,
  PAGE_HEALTH_BODY,
  SPEC_GRAPH_BODY,
  SPEC_LIST_BODY,
  componentsBodyWithDisclosure,
  nativeCaptureSnapshotBody,
  pageHealthBodyWith,
} from "./__fixtures__/runnerBodies";
import { json, relayFake, type RelayFake } from "./__fixtures__/relayResponder";

/** Staff: the one viewer the web app registry is read for. */
const STAFF = { is_superuser: true, coord_is_admin: true };
/** A coord admin of the active tenant who is not staff — offered the page. */
const COORD_ADMIN = { is_superuser: false, coord_is_admin: true };
/** A plain member, who can open the page by its URL. */
const MEMBER = { is_superuser: false, coord_is_admin: false };

const state = vi.hoisted(() => ({
  target: { kind: "pending" } as RunnerTarget,
  relay: null as RelayFake | null,
  fleetApps: (async () => []) as () => Promise<unknown>,
  /** Every `GET /api/v1/fleet/apps` the page made. */
  fleetAppsReads: 0,
  user: null as { is_superuser: boolean; coord_is_admin: boolean } | null,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useRunnerTarget: () => state.target,
  useActiveRunner: () => ({
    activeRunner: null,
    runners: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Build box",
        hostname: "build-host-1",
      },
    ],
  }),
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (url: string, init?: RequestInit) => {
      if (!state.relay) throw new Error("relay not set");
      return state.relay.fetch(url, init);
    },
    get: (url: string) => {
      if (url !== "/api/v1/fleet/apps")
        throw new Error(`unexpected GET ${url}`);
      state.fleetAppsReads += 1;
      return state.fleetApps();
    },
  },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));
// Who is signed in. The page mounts under the app's `AuthProvider`; here the
// hook answers with the viewer the test sets.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: state.user }),
}));

import UiBridgeDashboardPage from "./page";

const RUNNER: RunnerTarget = {
  kind: "runner",
  runner: { id: DEVICE_ID, name: "Build box" },
  locality: "unknown",
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <UiBridgeDashboardPage />
    </QueryClientProvider>
  );
  return { ...view, client };
}

beforeEach(() => {
  state.target = RUNNER;
  state.relay = relayFake();
  state.fleetApps = async () => FLEET_APPS;
  state.fleetAppsReads = 0;
  state.user = STAFF;
});

afterEach(() => {
  state.relay = null;
});

describe("every panel renders the runner's answers", () => {
  it("counts the actions, badges each effect, and counts the undeclared", async () => {
    renderPage();
    const counts = await screen.findByTestId("coord-ui-bridge-actions-counts");
    // The fixture: 2 read, 1 write, 1 destructive, 3 with no declared effect.
    expect(
      within(counts).getByTestId("coord-ui-bridge-actions-count-undeclared")
    ).toHaveTextContent("undeclared actions 3");
    // Every entry was read, so the header's counts are exact.
    const summary = screen.getByTestId("coord-ui-bridge-actions-summary");
    expect(summary).toHaveTextContent(/^7 actions · 3 undeclared$/);
    expect(summary).not.toHaveAttribute("title");
    expect(
      within(counts).getByTestId("coord-ui-bridge-actions-count-read")
    ).toHaveTextContent("read actions 2");
    expect(
      within(counts).getByTestId("coord-ui-bridge-actions-count-destructive")
    ).toHaveTextContent("destructive actions 1");

    // Each component row's badge is its most consequential action.
    const rows = screen.getAllByTestId("coord-ui-bridge-component-row");
    expect(rows).toHaveLength(3);
    const kinds = rows.map((r) =>
      r.querySelector("[data-status-kind]")?.getAttribute("data-status-kind")
    );
    expect(kinds).toEqual(["undeclared", "undeclared", "read"]);

    // Opening a row lists every action with its own effect badge.
    fireEvent.click(within(rows[1]).getByRole("button"));
    const actions = within(rows[1]).getAllByTestId("coord-ui-bridge-action");
    expect(actions.map((a) => a.getAttribute("data-effect"))).toEqual([
      "undeclared",
      "destructive",
      "undeclared",
    ]);
    // The malformed declaration says what it said.
    expect(within(rows[1]).getByText(/declares “mutate”/)).toBeInTheDocument();
  });

  it("opens with a strip naming how many actions declare no effect", async () => {
    renderPage();
    const strip = await screen.findByTestId("coord-ui-bridge-health-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent("3 of 7 actions declare no effect")
    );
    expect(strip).toHaveAttribute("data-health-level", "amber");
    expect(strip).toHaveTextContent(`build ${BUILD_ID}`);
    expect(strip).toHaveTextContent("Build box");
  });

  it("shows the SDK inventory, the binding and the build from /health", async () => {
    renderPage();
    const features = await screen.findByTestId("coord-ui-bridge-sdk-features");
    expect(features).toHaveTextContent("SDK features 3");
    expect(features).toHaveTextContent("snapshotF3");
    expect(screen.getByTestId("coord-ui-bridge-sdk-build")).toHaveTextContent(
      BUILD_ID
    );
    const binding = screen.getByTestId("coord-ui-bridge-sdk-binding-counts");
    expect(binding).toHaveTextContent("shadow (counting, not refusing)");
    expect(binding).toHaveTextContent("would refuse 5");
  });

  it("merges the web registry with an UNKNOWN runner side — GET /apps is carried by no relay", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId("coord-ui-bridge-app-row")).toHaveLength(2)
    );
    const unknown = screen.getByTestId("coord-ui-bridge-apps-runner-unknown");
    expect(unknown).toHaveTextContent("UNKNOWN");
    await waitFor(() =>
      expect(unknown).toHaveTextContent(
        `No runner's relay carries this runner's own app list yet, so this runner (build ${BUILD_ID}) answered HTTP 403.`
      )
    );
    // Presence needs both registries, so neither row claims "web only".
    for (const row of screen.getAllByTestId("coord-ui-bridge-app-row")) {
      expect(
        row
          .querySelector("[data-status-kind]")
          ?.getAttribute("data-status-kind")
      ).toBe("unknown");
    }
    // …and the total is a floor: an app only the runner records is uncounted.
    expect(screen.getByTestId("coord-ui-bridge-apps-total")).toHaveTextContent(
      "apps ≥2"
    );
    expect(screen.getByTestId("coord-ui-bridge-health-apps")).toHaveTextContent(
      "apps ≥2"
    );
    expect(screen.getByTestId("coord-ui-bridge-health-apps")).toHaveAttribute(
      "title",
      "At least 2: this runner's app list was not read, so an app only it records is not counted"
    );
  });

  it("says the app total is unknown — not 0 — when the web registry is empty and the runner's list unread", async () => {
    state.fleetApps = async () => [];
    renderPage();
    expect(
      await screen.findByTestId("coord-ui-bridge-apps-empty")
    ).toBeInTheDocument();
    await screen.findByTestId("coord-ui-bridge-apps-runner-unknown");
    expect(screen.getByTestId("coord-ui-bridge-apps-total")).toHaveTextContent(
      "apps –"
    );
    expect(screen.getByTestId("coord-ui-bridge-health-apps")).toHaveTextContent(
      "apps –"
    );
    expect(
      screen.getByTestId("coord-ui-bridge-apps-summary")
    ).toHaveTextContent("– apps");
  });

  it("counts the runner app's screens, states and transitions from the graph", async () => {
    renderPage();
    const counts = await screen.findByTestId("coord-ui-bridge-spec-counts");
    await waitFor(() => expect(counts).toHaveTextContent("states 4"));
    expect(counts).toHaveTextContent("screens 2");
    expect(counts).toHaveTextContent("transitions 2");
    expect(
      screen
        .getAllByTestId("coord-ui-bridge-spec-screen")
        .map((s) => s.textContent)
    ).toEqual([
      expect.stringContaining("terminal"),
      expect.stringContaining("settings"),
    ]);
  });
});

describe("the wrapper-app disclosure beside the component counts", () => {
  const disclosure = () =>
    screen.findByTestId("coord-ui-bridge-actions-wrappers");

  it("says wrapper apps are not consulted over the relay, as a relayed read reports", async () => {
    renderPage();
    const line = await disclosure();
    expect(line).toHaveAttribute("data-wrappers", "withheld");
    expect(line).toHaveTextContent(
      "are not consulted over the relay, so this is the runner's own registry only"
    );
    expect(line).not.toHaveTextContent("UNKNOWN");
    expect(line).not.toHaveTextContent("Wrapper apps were consulted");
  });

  it("says they were consulted — and that the list does not say whose each entry is — when the runner reports included", async () => {
    state.relay = relayFake({
      components: () => json(200, componentsBodyWithDisclosure("included")),
    });
    renderPage();
    const line = await disclosure();
    expect(line).toHaveAttribute("data-wrappers", "included");
    expect(line).toHaveTextContent("Wrapper apps were consulted");
    expect(line).toHaveTextContent("does not say which entry came from which");
    expect(line).not.toHaveTextContent("are not consulted");
  });

  it.each([
    [
      "absent, as an older runner build sends it",
      undefined,
      "this runner's reply does not say (an older runner build does not)",
    ],
    [
      "a word the runner does not use",
      "maybe",
      "this runner's reply gave an answer this page does not know",
    ],
    [
      "null",
      null,
      "this runner's reply gave an answer this page does not know",
    ],
    [
      "the wrong case",
      "Withheld",
      "this runner's reply gave an answer this page does not know",
    ],
  ])(
    "renders UNKNOWN — claiming neither answer — when the disclosure is %s",
    async (_label, said, reason) => {
      state.relay = relayFake({
        components: () => json(200, componentsBodyWithDisclosure(said)),
      });
      renderPage();
      const line = await disclosure();
      expect(line).toHaveAttribute("data-wrappers", "unknown");
      expect(line).toHaveTextContent("UNKNOWN");
      expect(line).toHaveTextContent(
        `Whether wrapper apps were consulted is unknown: ${reason}.`
      );
      expect(line).not.toHaveTextContent("are not consulted");
      expect(line).not.toHaveTextContent("Wrapper apps were consulted:");
      // The word the runner sent is not repeated back.
      expect(line).not.toHaveTextContent("maybe");
      // It qualifies the list; it does not erase it.
      expect(
        screen.getByTestId("coord-ui-bridge-actions-count-undeclared")
      ).toHaveTextContent("undeclared actions 3");
    }
  );

  it("says nothing about wrapper apps for a panel that read no components", async () => {
    state.relay = relayFake({ components: () => json(403, NOT_CARRIED_BODY) });
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-unknown");
    expect(
      screen.queryByTestId("coord-ui-bridge-actions-wrappers")
    ).not.toBeInTheDocument();
  });
});

describe("a runner whose build predates the dashboard's relay entries", () => {
  beforeEach(() => {
    state.relay = relayFake({
      components: () => json(403, NOT_CARRIED_BODY),
      pageHealth: () => json(403, NOT_CARRIED_BODY),
    });
  });

  it("renders the component actions as UNKNOWN naming the build — not an empty list, not a zero", async () => {
    renderPage();
    const unknown = await screen.findByTestId(
      "coord-ui-bridge-actions-unknown"
    );
    await waitFor(() => expect(unknown).toHaveTextContent(BUILD_ID));
    expect(unknown).toHaveTextContent("UNKNOWN");
    expect(unknown).toHaveTextContent(
      "This runner's relay does not carry the runner's component actions, so it answered HTTP 403."
    );
    expect(
      screen.queryByTestId("coord-ui-bridge-actions-empty")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("coord-ui-bridge-actions-summary")
    ).toHaveTextContent("– actions · – undeclared");
    const strip = screen.getByTestId("coord-ui-bridge-health-strip");
    expect(strip).toHaveTextContent("component actions are UNKNOWN");
    expect(strip).toHaveTextContent("undeclared actions –");
  });

  it("says UNKNOWN in the page-health header after a run that failed — never 'not run'", async () => {
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-unknown");
    const summary = screen.getByTestId("coord-ui-bridge-health-summary");
    expect(summary).toHaveTextContent("not run");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    await screen.findByTestId("coord-ui-bridge-health-unknown");
    expect(summary).toHaveAttribute("data-read-state", "failed");
    expect(summary).toHaveTextContent("UNKNOWN");
    expect(summary).not.toHaveTextContent("not run");
  });

  it("renders page health as UNKNOWN naming the build, beside the occlusion row that names no build at all", async () => {
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-unknown");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    const health = await screen.findByTestId("coord-ui-bridge-health-unknown");
    expect(health).toHaveTextContent(BUILD_ID);
    expect(health).toHaveTextContent(
      "predates the relay entries this page reads"
    );
    // The occlusion row's cause is the relay's, not this runner's build: the
    // sweep was never asked of it, so there is no HTTP 403 to name.
    const row = await screen.findByTestId("coord-ui-bridge-occlusion");
    expect(row).toHaveAttribute("data-occlusion", "unknown");
    expect(row).toHaveTextContent(
      "The visibility sweep is not available over the relay yet"
    );
    expect(row).not.toHaveTextContent("HTTP 403");
    expect(row).not.toHaveTextContent(BUILD_ID);
  });
});

describe("an unreachable runner", () => {
  beforeEach(() => {
    const notConnected = () => json(503, NOT_CONNECTED_BODY);
    state.relay = relayFake({
      health: notConnected,
      components: notConnected,
      apps: notConnected,
      specList: notConnected,
      specGraph: notConnected,
    });
  });

  it("renders every runner panel as UNKNOWN with the relay's reason", async () => {
    renderPage();
    const sdk = await screen.findByTestId("coord-ui-bridge-sdk-unknown");
    await waitFor(() => expect(sdk).toHaveTextContent("UNKNOWN"));
    expect(sdk).toHaveTextContent("could not be read");
    expect(sdk).toHaveTextContent(
      /held a relay session until .*then dropped it/
    );
    // Operator mode: the request id is the operator's, to grep the backend log.
    expect(sdk).toHaveTextContent(`request ${REQUEST_ID_NOT_CONNECTED}`);
    expect(
      await screen.findByTestId("coord-ui-bridge-actions-unknown")
    ).toHaveTextContent("could not be read");
    // The list and the graph failed alike, so they say it once.
    expect(
      await screen.findByTestId("coord-ui-bridge-spec-unknown")
    ).toHaveTextContent(
      "app's screens, states and transitions could not be read"
    );
    const strip = screen.getByTestId("coord-ui-bridge-health-strip");
    expect(strip).toHaveTextContent(
      "Build box's health did not answer, so its build and SDK features are UNKNOWN. Its component actions are UNKNOWN too — the read failed."
    );
    expect(strip).toHaveAttribute("data-health-level", "amber");
  });

  it("says only the health is unknown when the health alone did not answer — the components it read stand", async () => {
    state.relay = relayFake({ health: () => json(503, NOT_CONNECTED_BODY) });
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    const strip = screen.getByTestId("coord-ui-bridge-health-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent(
        "Build box's health did not answer, so its build and SDK features are UNKNOWN."
      )
    );
    expect(strip).not.toHaveTextContent("every runner panel");
    expect(strip).not.toHaveTextContent("component actions are UNKNOWN");
    expect(strip).toHaveTextContent("actions 7");
    expect(strip).toHaveAttribute("data-health-level", "amber");
  });

  it("still turns the strip red when page health finds the page broken — a /health that did not answer says nothing about the page", async () => {
    state.relay = relayFake({
      health: () => json(503, NOT_CONNECTED_BODY),
      pageHealth: () => json(200, pageHealthBodyWith({ summary: "CRITICAL" })),
    });
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    await screen.findByTestId("coord-ui-bridge-health-counts");
    const strip = screen.getByTestId("coord-ui-bridge-health-strip");
    await waitFor(() =>
      expect(strip).toHaveAttribute("data-health-level", "red")
    );
    expect(strip).toHaveTextContent(
      "Page health reports Build box's current page as broken."
    );
    expect(
      screen.getByTestId("coord-ui-bridge-health-summary")
    ).toHaveTextContent("critical");
  });

  it("names the component figures as an earlier read's when their refresh failed beside the health", async () => {
    let componentReads = 0;
    state.relay = relayFake({
      health: () => json(503, NOT_CONNECTED_BODY),
      components: () => {
        componentReads += 1;
        return componentReads === 1
          ? json(200, COMPONENTS_ALL_DECLARED_BODY)
          : json(503, NOT_CONNECTED_BODY);
      },
    });
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-ui-bridge-refresh"));
    });
    await screen.findByTestId("coord-ui-bridge-actions-stale");
    const strip = screen.getByTestId("coord-ui-bridge-health-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent(
        "Build box's health did not answer, so its build and SDK features are UNKNOWN. The last refresh of its component actions failed, so what this page shows of it is from an earlier read."
      )
    );
    expect(strip).toHaveTextContent("actions 7");
    expect(strip).toHaveAttribute("data-health-level", "amber");
  });

  it("still reads the web registry, which needs no runner", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId("coord-ui-bridge-app-row")).toHaveLength(2)
    );
  });
});

describe("a stale pairing", () => {
  it("names the device id the backend does not know — to the operator", async () => {
    const notOwned = () => json(404, DEVICE_NOT_OWNED_BODY);
    state.relay = relayFake({
      health: notOwned,
      components: notOwned,
      apps: notOwned,
      specList: notOwned,
      specGraph: notOwned,
    });
    renderPage();
    const sdk = await screen.findByTestId("coord-ui-bridge-sdk-unknown");
    await waitFor(() =>
      expect(sdk).toHaveTextContent(
        `The backend has no device (${DEVICE_ID}) registered to your account`
      )
    );
    expect(sdk).toHaveTextContent(`request ${REQUEST_ID_NOT_OWNED}`);
    // Operator mode: the reason is the operator's, verbatim.
    expect(sdk.querySelector("[data-redacted]")).toBeNull();
  });
});

/**
 * The web app registry answers any signed-in user with every row of
 * `project.apps`, which is not partitioned by project, and the menu does not
 * stand between a viewer and this page — any signed-in member can open its
 * URL. So the page makes that read only for staff (`webRegistryAccessOf`).
 */
describe("a viewer who is not staff", () => {
  /** Let any request a render or a press would start actually start. */
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

  it.each([
    ["a coord admin of the active tenant", COORD_ADMIN],
    ["a member who opened the URL", MEMBER],
  ])(
    "makes no web registry read for %s — on mount or on Refresh — and reads that half as UNKNOWN with the reason",
    async (_label, user) => {
      state.user = user;
      renderPage();
      await screen.findByTestId("coord-ui-bridge-actions-counts");
      await act(async () => {
        fireEvent.click(screen.getByTestId("coord-ui-bridge-refresh"));
      });
      await settle();
      // The refresh did run: the runner reads it covers were asked again.
      expect(
        state.relay?.requests.filter((r) => r === "GET health").length
      ).toBeGreaterThanOrEqual(2);
      expect(state.fleetAppsReads).toBe(0);

      expect(
        screen.getByTestId("coord-ui-bridge-apps-web-not-read")
      ).toHaveTextContent(
        "UNKNOWNThe web app registry is read only for staff: it is not kept per project, so it can list other projects' applications."
      );
      expect(
        screen.queryByTestId("coord-ui-bridge-apps-web-unknown")
      ).not.toBeInTheDocument();
      expect(screen.queryAllByTestId("coord-ui-bridge-app-row")).toEqual([]);
      expect(
        screen.getByTestId("coord-ui-bridge-apps-counts")
      ).toHaveTextContent("in the web registry –");
      // The runner's own list is still asked of the viewer's own runner.
      expect(state.relay?.requests).toContain("GET apps");
      expect(
        await screen.findByTestId("coord-ui-bridge-apps-runner-unknown")
      ).toHaveTextContent("UNKNOWN");
      // Neither registry answered, so the total is a dash, never a count.
      expect(
        screen.getByTestId("coord-ui-bridge-health-apps")
      ).toHaveTextContent("apps –");
      // Refresh's title names the reads its press makes — not the web's.
      expect(screen.getByTestId("coord-ui-bridge-refresh")).toHaveAttribute(
        "title",
        "Re-reads the runner's health, components and screens and its own app list now. The web app registry is read only for staff. The live snapshot and page health run only from their own buttons."
      );
    }
  );

  it("still reads the web registry for staff — the same page, the same runner", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId("coord-ui-bridge-app-row")).toHaveLength(2)
    );
    expect(state.fleetAppsReads).toBe(1);
    expect(
      screen.queryByTestId("coord-ui-bridge-apps-web-not-read")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-ui-bridge-refresh")).toHaveAttribute(
      "title",
      "Re-reads the runner's health, components and screens and both app registries now. The live snapshot and page health run only from their own buttons."
    );
  });
});

describe("the web registry failing", () => {
  it("renders its own UNKNOWN and keeps the page", async () => {
    state.fleetApps = async () => {
      throw new Error("GET /api/v1/fleet/apps failed: 500 - boom");
    };
    renderPage();
    expect(
      await screen.findByTestId("coord-ui-bridge-apps-web-unknown")
    ).toHaveTextContent("The web's app registry could not be read.");
    expect(
      await screen.findByTestId("coord-ui-bridge-apps-none-read")
    ).toHaveTextContent("unknown — not none");
    // The operator also reads the backend's own refusal.
    expect(
      screen.getByTestId("coord-ui-bridge-apps-web-unknown")
    ).toHaveTextContent("boom");
  });
});

const SWEEP = "POST ui-bridge/control/visibility";

describe("the occlusion row is UNKNOWN on every runner", () => {
  async function runPageHealth() {
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    return screen.findByTestId("coord-ui-bridge-occlusion");
  }

  it("shows no occlusion row before page health is asked for", async () => {
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    expect(screen.getByTestId("coord-ui-bridge-health-idle")).toHaveTextContent(
      "Not run yet — page health reads"
    );
    expect(
      screen.queryByTestId("coord-ui-bridge-occlusion")
    ).not.toBeInTheDocument();
  });

  it("says why in plain words — the visibility sweep is not available over the relay yet — and asks the runner nothing about occlusion", async () => {
    const row = await runPageHealth();
    expect(row).toHaveAttribute("data-occlusion", "unknown");
    expect(row).toHaveTextContent("UNKNOWN");
    expect(row).toHaveTextContent(
      "The visibility sweep is not available over the relay yet, so whether anything on the screen covers anything else is unknown — not clear."
    );
    expect(row).not.toHaveTextContent("Nothing covered");
    await screen.findByTestId("coord-ui-bridge-health-counts");
    expect(state.relay?.requests).toContain(
      "POST ui-bridge/control/page-health"
    );
    expect(state.relay?.requests).not.toContain(SWEEP);
  });

  it.each([
    ["a clear sweep that observed occlusion data", VISIBILITY_CLEAR_OBSERVED],
    ["a clear sweep that observed none", VISIBILITY_CLEAR_UNOBSERVED],
    ["hidden text", VISIBILITY_HIDES_TEXT],
  ])(
    "stays UNKNOWN even if the runner would answer %s — the sweep is never asked",
    async (_label, body) => {
      state.relay = relayFake({
        // Every action declared, so nothing but the occlusion row can hold
        // the strip off green — or turn it red.
        components: () => json(200, COMPONENTS_ALL_DECLARED_BODY),
        visibility: () => json(200, body),
      });
      const row = await runPageHealth();
      await screen.findByTestId("coord-ui-bridge-health-counts");
      expect(row).toHaveAttribute("data-occlusion", "unknown");
      expect(row).not.toHaveTextContent("Nothing covered");
      expect(row).not.toHaveTextContent("hiding text");
      expect(state.relay?.requests).not.toContain(SWEEP);
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-ui-bridge-health-strip")
        ).toHaveTextContent("occlusion is UNKNOWN")
      );
      expect(
        screen.getByTestId("coord-ui-bridge-health-strip")
      ).toHaveAttribute("data-health-level", "amber");
    }
  );

  describe.each([
    ["OK", "OK"],
    ["WARNING", "WARNING"],
    ["CRITICAL", "CRITICAL"],
    ["absent", undefined],
  ])("whatever page health says (%s)", (_name, summary) => {
    it.each([
      ["no occlusion field, as the real report is", {}],
      ["occlusionDataObserved: true", { occlusionDataObserved: true }],
      ["occlusionDataObserved: false", { occlusionDataObserved: false }],
      [
        "a clear verdict that observed occlusion data",
        { verdict: "clear", occlusionDataObserved: true, occlusions: [] },
      ],
    ])("with %s the row is UNKNOWN, never clear", async (_label, extra) => {
      state.relay = relayFake({
        pageHealth: () => json(200, pageHealthBodyWith({ summary, ...extra })),
      });
      const row = await runPageHealth();
      // Page health has been READ before the row is judged: the row must not
      // be unknown merely because the report had not arrived yet.
      await screen.findByTestId("coord-ui-bridge-health-counts");
      expect(row).toHaveAttribute("data-occlusion", "unknown");
      expect(
        row
          .querySelector("[data-status-kind]")
          ?.getAttribute("data-status-kind")
      ).toBe("unknown");
      expect(row).not.toHaveTextContent("Nothing covered");
      expect(row).toHaveTextContent(
        "The visibility sweep is not available over the relay yet"
      );
    });
  });

  it("keeps the strip amber and names occlusion, never folding it into a green", async () => {
    state.relay = relayFake({
      components: () => json(200, COMPONENTS_ALL_DECLARED_BODY),
    });
    await runPageHealth();
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-ui-bridge-health-strip")
      ).toHaveTextContent(
        "every one of its 7 actions declares its effect, but its occlusion is UNKNOWN."
      )
    );
  });

  it("still shows page health's findings in plain words beside the standing UNKNOWN", async () => {
    await runPageHealth();
    const findings = await screen.findAllByTestId(
      "coord-ui-bridge-health-finding"
    );
    expect(findings.map((f) => f.getAttribute("data-check"))).toEqual([
      "spatial_coverage",
      "layout_regions",
      "element_diversity",
      "text_signals",
      "interactive_readiness",
      "visual_anomalies",
    ]);
    expect(
      screen.getByTestId("coord-ui-bridge-health-heatmap")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-ui-bridge-health-counts")
    ).toHaveTextContent("elements 47");
    // Operator mode shows the text the check quoted from the window.
    expect(
      screen.getByTestId("coord-ui-bridge-health-quotes")
    ).toHaveTextContent("Loading sessions for Partner A");
    expect(screen.getByTestId("coord-ui-bridge-occlusion")).toHaveAttribute(
      "data-occlusion",
      "unknown"
    );
  });
});

describe("on-demand reads", () => {
  it("captures the live snapshot and runs page health only when asked", async () => {
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    const asked = () => state.relay?.requests ?? [];
    expect(asked()).not.toContain("GET ui-bridge/control/snapshot");
    expect(asked()).not.toContain("POST ui-bridge/control/page-health");
    expect(
      screen.getByTestId("coord-ui-bridge-snapshot-idle")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-ui-bridge-health-idle")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("coord-ui-bridge-snapshot-capture"));
    const counts = await screen.findByTestId("coord-ui-bridge-snapshot-counts");
    expect(counts).toHaveTextContent("elements 3");
    expect(counts).toHaveTextContent("components 1");
    expect(asked()).toContain("GET ui-bridge/control/snapshot");

    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    await screen.findByTestId("coord-ui-bridge-health-counts");
    expect(asked()).toContain("POST ui-bridge/control/page-health");
    // The header states the answer, as the closed panel shows it.
    expect(
      screen.getByTestId("coord-ui-bridge-health-summary")
    ).toHaveTextContent("warning");
    // No relay carries the occlusion sweep, so running page health does not
    // ask for it: the occlusion row is decided without a runner's answer.
    expect(asked()).not.toContain("POST ui-bridge/control/visibility");
  });

  it("renders page health the project's egress setting withheld as UNKNOWN with its sentence", async () => {
    state.relay = relayFake({ pageHealth: () => json(409, EGRESS_OFF_BODY) });
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    expect(
      await screen.findByTestId("coord-ui-bridge-health-unknown")
    ).toHaveTextContent(
      "The runner withheld the runner's page health: Terminal streaming is off for this project."
    );
  });

  it("re-runs neither when the page comes back to a runner it switched away from — they read as not run until asked", async () => {
    const view = renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-snapshot-capture"));
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    await screen.findByTestId("coord-ui-bridge-snapshot-counts");
    await screen.findByTestId("coord-ui-bridge-health-counts");
    const askedOfA = (route: string) =>
      (state.relay?.requestsFor ?? []).filter(
        (r) => r === `${route} for ${DEVICE_ID}`
      ).length;
    expect(askedOfA("GET ui-bridge/control/snapshot")).toBe(1);
    expect(askedOfA("POST ui-bridge/control/page-health")).toBe(1);

    const rerender = () =>
      view.rerender(
        <QueryClientProvider client={view.client}>
          <UiBridgeDashboardPage />
        </QueryClientProvider>
      );
    // Away to another runner, asking nothing there, and back.
    state.target = {
      kind: "runner",
      runner: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Spare box" },
      locality: "unknown",
    };
    rerender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    state.target = RUNNER;
    rerender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(askedOfA("GET ui-bridge/control/snapshot")).toBe(1);
    expect(askedOfA("POST ui-bridge/control/page-health")).toBe(1);
    expect(
      screen.getByTestId("coord-ui-bridge-snapshot-idle")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-ui-bridge-health-idle")
    ).toBeInTheDocument();
  });

  it("renders a snapshot the project's egress setting withheld as UNKNOWN with its sentence", async () => {
    state.relay = relayFake({ snapshot: () => json(409, EGRESS_OFF_BODY) });
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-snapshot-capture"));
    expect(
      await screen.findByTestId("coord-ui-bridge-snapshot-unknown")
    ).toHaveTextContent(
      "The runner withheld a live snapshot of the runner's screen: Terminal streaming is off for this project."
    );
  });
});

/**
 * The page-health header is what stays in view while the panel is closed
 * (R7), so it states the read as it stands: a kept verdict as the earlier
 * run's, and a run with no reading without guessing why.
 */
describe("the page-health header", () => {
  const badgeTitle = (summary: HTMLElement) =>
    summary.querySelector("[data-status-kind]")?.getAttribute("title") ?? "";

  it("marks a kept verdict as the earlier run's after a re-run that failed — never as current", async () => {
    let runs = 0;
    state.relay = relayFake({
      pageHealth: () => {
        runs += 1;
        return runs === 1
          ? json(200, PAGE_HEALTH_BODY)
          : json(503, NOT_CONNECTED_BODY);
      },
    });
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    await screen.findByTestId("coord-ui-bridge-health-counts");
    const summary = screen.getByTestId("coord-ui-bridge-health-summary");
    expect(summary).toHaveAttribute("data-read-state", "ok");
    expect(summary).toHaveTextContent(/^warning$/);

    // Run it again; this time the relay does not answer.
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    });
    await screen.findByTestId("coord-ui-bridge-health-stale");
    expect(summary).toHaveAttribute("data-read-state", "stale");
    expect(summary).toHaveTextContent(/^warning from the earlier run$/);
    expect(badgeTitle(summary)).toBe(
      "warning — The last run failed, so this is the run before it — not a reading of the page as it is now."
    );
  });

  it("says page health has no reading — not that it did not answer — when the runner answered in a shape the page cannot read", async () => {
    state.relay = relayFake({ pageHealth: () => json(200, null) });
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    expect(
      await screen.findByTestId("coord-ui-bridge-health-unknown")
    ).toHaveTextContent(
      "the runner answered, but not in the shape this page reads"
    );
    const summary = screen.getByTestId("coord-ui-bridge-health-summary");
    expect(summary).toHaveAttribute("data-read-state", "failed");
    expect(badgeTitle(summary)).toContain(
      "Page health has no reading; the panel says why."
    );
    expect(badgeTitle(summary)).not.toMatch(/did not answer/);
  });
});

describe("no runner", () => {
  it("asks the runner nothing and says why in every runner panel", async () => {
    state.target = { kind: "unavailable", reason: "no_eligible_runner" };
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId("coord-ui-bridge-app-row")).toHaveLength(2)
    );
    expect(state.relay?.requests).toEqual([]);
    expect(
      screen.getByTestId("coord-ui-bridge-actions-unknown")
    ).toHaveTextContent(
      "Nothing was asked for the runner's component actions: none of your runners is available right now."
    );
    expect(
      screen.getByTestId("coord-ui-bridge-health-strip")
    ).toHaveTextContent("No runner to read");
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-ui-bridge-snapshot-capture"));
    });
    expect(state.relay?.requests).toEqual([]);
  });

  it("refreshes no runner read — none is sent, and none is run without a device to send it to", async () => {
    state.target = { kind: "unavailable", reason: "no_eligible_runner" };
    const { client } = renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId("coord-ui-bridge-app-row")).toHaveLength(2)
    );
    // …and its title claims no runner read either.
    expect(screen.getByTestId("coord-ui-bridge-refresh")).toHaveAttribute(
      "title",
      "Re-reads the web app registry now. No runner is targeted, so nothing is asked of a runner."
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-ui-bridge-refresh"));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(state.relay?.requests).toEqual([]);
    // A query's own `refetch()` ignores `enabled`: Refresh pressing it on a
    // read with no runner would RUN that read, which can only fail.
    const runnerReads = client
      .getQueryCache()
      .findAll({ queryKey: ["ui-bridge-dashboard"] })
      .filter((q) => q.queryKey[1] !== "fleet-apps");
    expect(runnerReads.length).toBeGreaterThan(0);
    expect(
      runnerReads.map((q) => `${String(q.queryKey[1])} ${q.state.status}`)
    ).toEqual(runnerReads.map((q) => `${String(q.queryKey[1])} pending`));
  });
});

describe("a refresh that fails after a good read", () => {
  it("keeps the earlier figures, labelled, and holds the strip at amber — never the earlier green", async () => {
    let componentReads = 0;
    state.relay = relayFake({
      components: () => {
        componentReads += 1;
        return componentReads === 1
          ? json(200, COMPONENTS_ALL_DECLARED_BODY)
          : json(503, NOT_CONNECTED_BODY);
      },
    });
    renderPage();
    const strip = await screen.findByTestId("coord-ui-bridge-health-strip");
    await waitFor(() =>
      expect(strip).toHaveAttribute("data-health-level", "green")
    );
    expect(strip).toHaveTextContent(
      "every one of its 7 actions declares its effect."
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-ui-bridge-refresh"));
    });
    // The panel keeps the figures and says they are an earlier read's…
    await screen.findByTestId("coord-ui-bridge-actions-stale");
    // …and so does the strip, which no longer calls them current.
    await waitFor(() =>
      expect(strip).toHaveAttribute("data-health-level", "amber")
    );
    expect(strip).toHaveTextContent(
      "Build box: the last refresh of its component actions failed, so what this page shows of it is from an earlier read."
    );
    expect(strip).not.toHaveTextContent("every one of its 7 actions declares");
    expect(strip).toHaveTextContent("actions 7");
  });

  it("labels the strip's app total as an earlier read's when the web registry's refresh failed", async () => {
    let webReads = 0;
    state.fleetApps = async () => {
      webReads += 1;
      if (webReads === 1) return FLEET_APPS;
      throw new Error("GET /api/v1/fleet/apps failed: 503 - down");
    };
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId("coord-ui-bridge-app-row")).toHaveLength(2)
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-ui-bridge-refresh"));
    });
    await screen.findByTestId("coord-ui-bridge-apps-web-stale");
    const apps = screen.getByTestId("coord-ui-bridge-health-apps");
    expect(apps).toHaveTextContent("apps ≥2");
    expect(apps.getAttribute("title")).toMatch(
      / — from an earlier read: the last refresh of an app registry failed$/
    );
  });
});

describe("registry entries the page cannot read", () => {
  it("counts an entry that is not an action as undeclared, and states every count as a floor beside an unreadable component", async () => {
    state.relay = relayFake({
      components: () =>
        json(200, {
          success: true,
          data: {
            components: [
              {
                id: "tabs",
                name: "Tabs",
                actions: [
                  "junk",
                  { id: "list", label: "List", effect: "read" },
                ],
                registeredAt: 1761200000000,
                mounted: true,
                scope: "global",
              },
              // No `actions` array: its actions are unknown, not none.
              { id: "broken", name: "Broken" },
            ],
            wrapperComponents: "withheld",
          },
        }),
    });
    renderPage();
    const counts = await screen.findByTestId("coord-ui-bridge-actions-counts");
    expect(
      within(counts).getByTestId("coord-ui-bridge-actions-count-undeclared")
    ).toHaveTextContent("undeclared actions 1");
    expect(
      screen.getByTestId("coord-ui-bridge-actions-unreadable")
    ).toHaveTextContent(
      "1 entry in the registry could not be read and is not counted, so the totals are a floor."
    );
    const rows = screen.getAllByTestId("coord-ui-bridge-component-row");
    expect(rows).toHaveLength(1);
    fireEvent.click(within(rows[0]).getByRole("button"));
    expect(
      within(rows[0]).getByTestId("coord-ui-bridge-action-unreadable")
    ).toHaveTextContent("so it counts as undeclared");

    const strip = screen.getByTestId("coord-ui-bridge-health-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent(
        "Build box: 1 of 2 actions declare no effect. 1 entry in its component registry could not be read, so both counts are floors."
      )
    );
    expect(strip).toHaveTextContent("actions ≥2");
    expect(strip).toHaveAttribute("data-health-level", "amber");
    // The panel's header states the same floors as the strip.
    expect(
      screen.getByTestId("coord-ui-bridge-actions-summary")
    ).toHaveTextContent("≥2 actions · ≥1 undeclared");
  });

  it("states the closed panel's header as floors — never an exact zero beside an entry it could not read", async () => {
    state.relay = relayFake({
      components: () =>
        json(200, {
          success: true,
          data: {
            components: [
              {
                id: "tabs",
                name: "Tabs",
                actions: [{ id: "list", label: "List", effect: "read" }],
                registeredAt: 1761200000000,
                mounted: true,
                scope: "global",
              },
              // No `actions` array: its actions are unknown, not none.
              { id: "broken", name: "Broken" },
            ],
            wrapperComponents: "withheld",
          },
        }),
    });
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    // Close the panel: the header is what stays in view (R7), and the body's
    // floor note goes with the body.
    const panel = screen.getByTestId("coord-ui-bridge-actions");
    fireEvent.click(within(panel).getAllByRole("button")[0]);
    expect(
      screen.queryByTestId("coord-ui-bridge-actions-unreadable")
    ).not.toBeInTheDocument();
    const summary = screen.getByTestId("coord-ui-bridge-actions-summary");
    expect(summary).toHaveTextContent(/^≥1 actions · ≥0 undeclared$/);
    expect(summary).toHaveAttribute(
      "title",
      "1 registry entry could not be read and is not counted, so these counts are floors."
    );
    // …as the strip does.
    expect(
      screen.getByTestId("coord-ui-bridge-health-undeclared")
    ).toHaveTextContent("undeclared actions ≥0");
  });
});

/**
 * A 200 whose body is not the object the page reads — `null`, or a list
 * holding an entry that is not an object. The page reads it as an answer it
 * cannot read: a labelled UNKNOWN, or a floor — never a stack trace.
 */
describe("an answer that is not the shape the page reads", () => {
  const UNREADABLE = "the runner answered, but not in the shape this page reads";

  it.each([
    [
      "the runner's app list",
      { apps: () => json(200, null) },
      "coord-ui-bridge-apps-runner-unknown",
      `This runner's own app list could not be read: ${UNREADABLE}.`,
    ],
    [
      "the spec list",
      { specList: () => json(200, null) },
      "coord-ui-bridge-spec-list-unknown",
      `The app's screens could not be read: ${UNREADABLE}.`,
    ],
    [
      "the spec graph",
      { specGraph: () => json(200, null) },
      "coord-ui-bridge-spec-graph-unknown",
      `The app's states and transitions could not be read: ${UNREADABLE}.`,
    ],
  ] as const)(
    "renders a null body for %s as a labelled UNKNOWN, and the page stays up",
    async (_label, over, testId, text) => {
      state.relay = relayFake(over);
      renderPage();
      expect(await screen.findByTestId(testId)).toHaveTextContent(text);
      expect(screen.getByTestId("coord-ui-bridge-page")).toBeInTheDocument();
      expect(
        screen.getByTestId("coord-ui-bridge-actions-counts")
      ).toBeInTheDocument();
    }
  );

  it("counts a graph page that is not an object as unreadable, and lists no screen for a spec entry that is not one", async () => {
    state.relay = relayFake({
      specList: () =>
        json(200, { ok: true, specs: [null, 7, ...SPEC_LIST_BODY.specs] }),
      specGraph: () =>
        json(200, { ok: true, pages: [null, ...SPEC_GRAPH_BODY.pages] }),
    });
    renderPage();
    const counts = await screen.findByTestId("coord-ui-bridge-spec-counts");
    await waitFor(() => expect(counts).toHaveTextContent("states 4"));
    expect(counts).toHaveTextContent("screens 3");
    expect(
      screen.getByTestId("coord-ui-bridge-spec-unreadable")
    ).toHaveTextContent("1 screen's model could not be read");
    expect(screen.getAllByTestId("coord-ui-bridge-spec-screen")).toHaveLength(
      2
    );
  });
});

describe("one label, one referent", () => {
  it("names what each count counts — actions in the stats and on the strip, components in the filter tabs", async () => {
    renderPage();
    const counts = await screen.findByTestId("coord-ui-bridge-actions-counts");
    // Three ACTIONS declare no effect…
    expect(
      within(counts).getByTestId("coord-ui-bridge-actions-count-undeclared")
    ).toHaveTextContent("undeclared actions 3");
    expect(
      screen.getByTestId("coord-ui-bridge-health-undeclared")
    ).toHaveTextContent("undeclared actions 3");
    // …held by two COMPONENTS, which is what the filter tab counts — under a
    // lead-in that says so, and in words no stat uses.
    const filters = screen.getByTestId("coord-ui-bridge-actions-filters");
    expect(filters.textContent?.startsWith("Components:")).toBe(true);
    expect(
      screen.getByTestId("coord-ui-bridge-actions-filter-undeclared")
    ).toHaveTextContent(/^With an undeclared action2$/);
    expect(
      screen.getByTestId("coord-ui-bridge-actions-filter-destructive")
    ).toHaveTextContent(/^With a destructive action1$/);
  });
});

describe("the on-demand buttons' titles", () => {
  it("say exactly what pressing one does on the runner — never that nothing changes", async () => {
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    for (const testId of [
      "coord-ui-bridge-health-run",
      "coord-ui-bridge-snapshot-capture",
    ]) {
      const title = screen.getByTestId(testId).getAttribute("title") ?? "";
      expect(title, testId).toContain(
        "It changes no setting, session, file or app state"
      );
      // Page health always, and the snapshot with nothing registered, make
      // the runner re-read its window — a side effect the title names.
      expect(title, testId).toMatch(/re-reads/);
      expect(title, testId).not.toMatch(/nothing on the runner changes/i);
    }
  });
});

/**
 * A native window capture — the runner's fallback when its webview's SDK did
 * not answer — carries no element tree, so its counts are UNKNOWN (`–`),
 * never zero, and the panel says why.
 */
describe("a snapshot with no element tree", () => {
  async function capture() {
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-snapshot-capture"));
    return screen.findByTestId("coord-ui-bridge-snapshot-no-tree");
  }

  it("says the counts are unknown, with the runner's own note, and dashes them — never zero", async () => {
    state.relay = relayFake({
      snapshot: () => json(200, nativeCaptureSnapshotBody()),
    });
    const notice = await capture();
    expect(notice).toHaveTextContent("UNKNOWN");
    expect(notice).toHaveTextContent(
      `The runner fell back to a window capture with no element tree, so its element counts are unknown. It said: ${NATIVE_CAPTURE_NOTE}`
    );
    const counts = screen.getByTestId("coord-ui-bridge-snapshot-counts");
    expect(counts).toHaveTextContent("elements –");
    expect(counts).toHaveTextContent("components –");
    expect(counts).toHaveTextContent("element types –");
    expect(counts).not.toHaveTextContent(/elements 0/);
    expect(
      screen.getByTestId("coord-ui-bridge-snapshot-summary")
    ).toHaveTextContent("– elements");
    expect(
      screen.queryByTestId("coord-ui-bridge-snapshot-types")
    ).not.toBeInTheDocument();
  });

  it("says the same without a note when the runner sent none", async () => {
    state.relay = relayFake({
      snapshot: () => json(200, nativeCaptureSnapshotBody(null)),
    });
    const notice = await capture();
    expect(notice).toHaveTextContent(
      /so its element counts are unknown\.$/
    );
    expect(notice).not.toHaveTextContent("It said");
    expect(screen.getByTestId("coord-ui-bridge-snapshot-counts")).toHaveTextContent(
      "elements –"
    );
  });
});

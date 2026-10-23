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
 * - a "clear" occlusion sweep that observed nothing renders UNKNOWN;
 * - the live snapshot and page health run only when asked.
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
  VISIBILITY_CLEAR_OBSERVED,
  VISIBILITY_CLEAR_UNOBSERVED,
  VISIBILITY_HIDES_TEXT,
} from "./__fixtures__/runnerBodies";
import { json, relayFake, type RelayFake } from "./__fixtures__/relayResponder";

const state = vi.hoisted(() => ({
  target: { kind: "pending" } as RunnerTarget,
  relay: null as RelayFake | null,
  fleetApps: (async () => []) as () => Promise<unknown>,
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
      return state.fleetApps();
    },
  },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
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
  return render(
    <QueryClientProvider client={client}>
      <UiBridgeDashboardPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  state.target = RUNNER;
  state.relay = relayFake();
  state.fleetApps = async () => FLEET_APPS;
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
    ).toHaveTextContent("undeclared 3");
    expect(
      within(counts).getByTestId("coord-ui-bridge-actions-count-read")
    ).toHaveTextContent("read 2");
    expect(
      within(counts).getByTestId("coord-ui-bridge-actions-count-destructive")
    ).toHaveTextContent("destructive 1");

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
    expect(strip).toHaveTextContent("undeclared –");
  });

  it("renders page health as UNKNOWN naming the build, and the sweep as carried by no runner", async () => {
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-unknown");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    const health = await screen.findByTestId("coord-ui-bridge-health-unknown");
    expect(health).toHaveTextContent(BUILD_ID);
    expect(health).toHaveTextContent(
      "predates the relay entries this page reads"
    );
    const sweep = await screen.findByTestId(
      "coord-ui-bridge-occlusion-unknown"
    );
    expect(sweep).toHaveTextContent(
      `No runner's relay carries the occlusion sweep yet, so this runner (build ${BUILD_ID}) answered HTTP 403.`
    );
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
    expect(sdk).toHaveTextContent("request req-503");
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
      "did not answer, so every runner panel is UNKNOWN"
    );
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
    expect(sdk).toHaveTextContent("request req-404");
    // Operator mode: the reason is the operator's, verbatim.
    expect(sdk.querySelector("[data-redacted]")).toBeNull();
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

describe("occlusion honesty", () => {
  async function runPageHealth() {
    renderPage();
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
    return screen.findByTestId("coord-ui-bridge-occlusion");
  }

  it("renders a clear sweep that observed no occlusion data as UNKNOWN, never clear", async () => {
    state.relay = relayFake({
      // Every action declared, so nothing but the sweep can hold the strip
      // off green.
      components: () => json(200, COMPONENTS_ALL_DECLARED_BODY),
      visibility: () => json(200, VISIBILITY_CLEAR_UNOBSERVED),
    });
    const row = await runPageHealth();
    expect(row).toHaveAttribute("data-occlusion", "unknown");
    expect(row).toHaveTextContent("UNKNOWN");
    expect(row).not.toHaveTextContent("Nothing covered");
    expect(row).toHaveTextContent("nothing was observed");
    // …and the strip does not fold that UNKNOWN into its green.
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-ui-bridge-health-strip")
      ).toHaveTextContent("occlusion is UNKNOWN")
    );
  });

  it("renders a clear sweep that DID observe occlusion data as clear", async () => {
    state.relay = relayFake({
      visibility: () => json(200, VISIBILITY_CLEAR_OBSERVED),
    });
    const row = await runPageHealth();
    expect(row).toHaveAttribute("data-occlusion", "clear");
    expect(row).toHaveTextContent("Nothing covered across 47 elements");
  });

  it("calls hidden text out in red", async () => {
    state.relay = relayFake({
      visibility: () => json(200, VISIBILITY_HIDES_TEXT),
    });
    const row = await runPageHealth();
    expect(row).toHaveAttribute("data-occlusion", "hides-text");
    expect(row).toHaveTextContent(
      "2 occlusions across 47 elements, 1 hiding text."
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-ui-bridge-health-strip")
      ).toHaveAttribute("data-health-level", "red")
    );
  });

  it("shows page health's findings in plain words beside the separate sweep", async () => {
    state.relay = relayFake({
      visibility: () => json(200, VISIBILITY_CLEAR_OBSERVED),
    });
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
    // Operator mode shows the text the check quoted from the window.
    expect(
      screen.getByTestId("coord-ui-bridge-health-quotes")
    ).toHaveTextContent("Loading sessions for Partner A");
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
    expect(asked()).toContain("POST ui-bridge/control/visibility");
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
});

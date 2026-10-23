/**
 * The UI Bridge dashboard in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D1–D3), rendered with Phase 1's
 * helper over the REAL UI Bridge provider, every panel populated — the
 * on-demand snapshot and page health included, so their sections are checked
 * too.
 *
 * `expectPresentationSafe` fails on an enabled control that is not
 * navigation-only, a write or undeclared UI Bridge registration, a cost
 * figure, or a missing caption. Beyond it, this file pins D3.3 on this page:
 * the runner is aliased, text the scope cannot clear is withheld (another
 * app's name, component and action names, the window's own text), and the
 * runner's own app — whose repository the scope does clear — is named.
 *
 * And the reasons an UNKNOWN gives: a reason that quotes words from outside
 * the page — an app id typed before presenting began (in the runner's
 * `app-not-found` answer, or in the page's own "not a valid app id"), a stale
 * pairing's device id, a dispatch refusal naming the runner the operator
 * picked — is withheld while presenting, and the operator still reads it.
 */

import React, { type ReactNode } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";
import {
  FixedPresentationMode,
  PresentationScopeProvider,
  sessionMachineAliases,
  type CaptionKey,
} from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import {
  DEVICE_ID,
  DEVICE_NOT_OWNED_BODY,
  FLEET_APPS,
  SPEC_GRAPH_BODY,
  SPEC_LIST_BODY,
  VISIBILITY_HIDES_TEXT,
  appNotFoundBody,
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
    get: async (url: string) => {
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

/** Every caption the page carries — the page's and each panel's. */
const CAPTIONS: CaptionKey[] = [
  "ui-bridge.page",
  "ui-bridge.apps",
  "ui-bridge.spec-graph",
  "ui-bridge.snapshot",
  "ui-bridge.sdk-posture",
  "ui-bridge.component-actions",
  "ui-bridge.page-health",
];

/** The tenant's scope: its own owner first-party, and one confidential term. */
const SCOPE = {
  status: "ready" as const,
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Partner A"] },
};

function Queries({ children }: { children: ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderPresenting() {
  const view = renderInPresentationMode(<UiBridgeDashboardPage />, {
    scope: SCOPE,
    wrapper: Queries,
  });
  await screen.findByTestId("coord-ui-bridge-actions-counts");
  // The on-demand reads are navigation-only, so they work while presenting —
  // run both, so the panels they fill are checked as well.
  fireEvent.click(screen.getByTestId("coord-ui-bridge-snapshot-capture"));
  fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
  await screen.findByTestId("coord-ui-bridge-snapshot-counts");
  await screen.findByTestId("coord-ui-bridge-health-counts");
  await screen.findByTestId("coord-ui-bridge-occlusion");
  await waitFor(() =>
    expect(screen.getByTestId("coord-ui-bridge-spec-counts")).toHaveTextContent(
      "states 4"
    )
  );
  return view;
}

beforeEach(() => {
  state.target = {
    kind: "runner",
    runner: { id: DEVICE_ID, name: "Build box" },
    locality: "unknown",
  };
  state.relay = relayFake({
    visibility: () => json(200, VISIBILITY_HIDES_TEXT),
  });
  state.fleetApps = async () => FLEET_APPS;
  sessionMachineAliases.reset();
  window.sessionStorage.clear();
});

describe("the UI Bridge dashboard while presenting", () => {
  it("is safe to show an outsider: no write control, no cost, every caption", async () => {
    const view = await renderPresenting();
    expectPresentationSafe(view, { captions: CAPTIONS });
  });

  it("aliases the runner and never prints its hostname or name", async () => {
    await renderPresenting();
    expect(screen.getByTestId("coord-ui-bridge-runner")).toHaveTextContent(
      "Reading Machine A over the cloud relay."
    );
    expect(
      screen.getByTestId("coord-ui-bridge-health-strip")
    ).toHaveTextContent("Machine A");
    // Not in the text, and not in any attribute either — a title or a
    // data attribute is in front of the audience too.
    expect(document.body.innerHTML).not.toContain("build-host-1");
    expect(document.body.innerHTML).not.toContain("Build box");
  });

  it("withholds every text the scope cannot clear, and names the runner's own app", async () => {
    await renderPresenting();
    const body = document.body;
    // Another app's name: its registry row proves no owner.
    expect(body).not.toHaveTextContent("Example Portal");
    expect(body).not.toHaveTextContent("example-portal");
    // Component and action names: the merged registry says nobody's.
    expect(body).not.toHaveTextContent("Terminal tabs");
    expect(body).not.toHaveTextContent("Delete profile");
    // The window's own text, quoted by page health and the sweep.
    expect(body).not.toHaveTextContent("Partner A");
    // Local paths and URLs stay with the operator.
    expect(body).not.toHaveTextContent("/home/dev/src");
    expect(body).not.toHaveTextContent("127.0.0.1");
    // The runner's own app is first-party under this scope, so it is named.
    const rows = screen.getAllByTestId("coord-ui-bridge-app-row");
    expect(
      rows.some((r) => within(r).queryByText("Qontinui Runner") !== null)
    ).toBe(true);
    expect(
      body.querySelectorAll('[data-redacted="true"]').length
    ).toBeGreaterThan(0);
  });

  it("still shows the effect badges, the undeclared count and the findings", async () => {
    await renderPresenting();
    expect(
      screen.getByTestId("coord-ui-bridge-actions-count-undeclared")
    ).toHaveTextContent("undeclared 3");
    expect(
      screen
        .getAllByTestId("coord-ui-bridge-component-row")
        .map((r) =>
          r
            .querySelector("[data-status-kind]")
            ?.getAttribute("data-status-kind")
        )
    ).toEqual(["undeclared", "undeclared", "read"]);
    expect(screen.getByTestId("coord-ui-bridge-occlusion")).toHaveAttribute(
      "data-occlusion",
      "hides-text"
    );
    expect(
      screen.getAllByTestId("coord-ui-bridge-health-finding")
    ).toHaveLength(6);
  });

  it("puts provenance beside the figures and leaves the operator's tools out", async () => {
    await renderPresenting();
    const chips = document.body.querySelectorAll("[data-provenance]");
    expect(chips.length).toBeGreaterThanOrEqual(7);
    expect(
      [...chips].every((c) => c.getAttribute("data-provenance-known") !== null)
    ).toBe(true);
    // The free-text app picker and the raw snapshot are operator-only.
    expect(screen.queryByTestId("coord-ui-bridge-spec-app")).toBeNull();
    expect(
      screen.getByTestId("coord-ui-bridge-spec-app-shown")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("coord-ui-bridge-snapshot-raw")).toBeNull();
    expect(screen.queryByTestId("coord-ui-bridge-health-quotes")).toBeNull();
  });

  it("names both spec reads behind the screens and states", async () => {
    await renderPresenting();
    const panel = screen.getByTestId("coord-ui-bridge-spec");
    expect(
      within(panel)
        .getAllByText(/^source: /)
        .map((c) => c.textContent)
    ).toEqual([
      "source: the runner's spec list",
      "source: the runner's spec graph",
    ]);
  });

  it("names where the strip's figures come from, and when", async () => {
    await renderPresenting();
    const chips = within(
      screen.getByTestId("coord-ui-bridge-strip-provenance")
    ).getAllByText(/^source: /);
    expect(chips.map((c) => c.textContent)).toEqual([
      "source: the runner's component registry",
      "source: the runner's health",
      "source: web app registry",
      "source: this runner's app list",
    ]);
    // The registry and the health answered, so they carry a time; the
    // runner's app list is carried by no relay, so its time is UNKNOWN.
    const known = [
      ...screen
        .getByTestId("coord-ui-bridge-strip-provenance")
        .querySelectorAll("[data-provenance]"),
    ].map((c) => c.getAttribute("data-provenance-known"));
    expect(known).toEqual(["true", "true", "true", "false"]);
    // The app total is a floor while that list is unread — never a bare count.
    expect(screen.getByTestId("coord-ui-bridge-health-apps")).toHaveTextContent(
      "apps ≥2"
    );
  });
});

/**
 * The page in a lens whose mode its test sets — so a value the operator typed
 * in operator mode is still in the page's state when presenting begins, as it
 * is when the header toggle is pressed on a live page.
 */
function renderSwitchable() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (presenting: boolean) => (
    <FixedPresentationMode presenting={presenting}>
      <PresentationScopeProvider state={SCOPE}>
        <QueryClientProvider client={client}>
          <UiBridgeDashboardPage />
        </QueryClientProvider>
      </PresentationScopeProvider>
    </FixedPresentationMode>
  );
  const view = render(tree(false));
  return { ...view, present: () => view.rerender(tree(true)) };
}

describe("a reason that quotes the outside world is withheld while presenting", () => {
  it("never shows an app id typed before presenting began through the runner's refusal", async () => {
    state.relay = relayFake({
      specList: (path) =>
        path.startsWith("apps/acme-portal/")
          ? json(404, appNotFoundBody("acme-portal"))
          : json(200, SPEC_LIST_BODY),
      specGraph: (path) =>
        path.startsWith("apps/acme-portal/")
          ? json(404, appNotFoundBody("acme-portal"))
          : json(200, SPEC_GRAPH_BODY),
    });
    const view = renderSwitchable();
    fireEvent.change(await screen.findByTestId("coord-ui-bridge-spec-app"), {
      target: { value: "acme-portal" },
    });
    // The operator reads the runner's own answer, id and all.
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-ui-bridge-spec-unknown")
      ).toHaveTextContent('The runner has no app registered as "acme-portal"')
    );

    view.present();
    expect(document.body.innerHTML).not.toContain("acme-portal");
    const reason = screen.getByTestId("coord-ui-bridge-spec-unknown");
    expect(reason).toHaveTextContent("UNKNOWN");
    expect(reason).toHaveTextContent("Reason · area unknown · read failed");
    expect(reason.querySelector('[data-redacted="true"]')).not.toBeNull();
  });

  it("never shows an invalid app id typed before presenting began", async () => {
    const view = renderSwitchable();
    fireEvent.change(await screen.findByTestId("coord-ui-bridge-spec-app"), {
      target: { value: "Acme Portal" },
    });
    expect(
      await screen.findByTestId("coord-ui-bridge-spec-invalid")
    ).toHaveTextContent('"Acme Portal" is not a valid app id');

    view.present();
    expect(document.body.innerHTML).not.toContain("Acme Portal");
    const reason = screen.getByTestId("coord-ui-bridge-spec-invalid");
    expect(reason).toHaveTextContent("UNKNOWN");
    expect(reason).toHaveTextContent(
      "Reason · area unknown · not a valid app id"
    );
  });

  it("never prints a stale pairing's device id", async () => {
    const notOwned = () => json(404, DEVICE_NOT_OWNED_BODY);
    state.relay = relayFake({
      health: notOwned,
      components: notOwned,
      apps: notOwned,
      specList: notOwned,
      specGraph: notOwned,
    });
    const view = renderInPresentationMode(<UiBridgeDashboardPage />, {
      scope: SCOPE,
      wrapper: Queries,
    });
    const sdk = await screen.findByTestId("coord-ui-bridge-sdk-unknown");
    await waitFor(() => expect(sdk).toHaveTextContent("read failed"));
    expect(sdk).toHaveTextContent("UNKNOWN");
    expect(
      screen.getByTestId("coord-ui-bridge-actions-unknown")
    ).toHaveTextContent("read failed");
    expect(document.body.innerHTML).not.toContain(DEVICE_ID);
    expectPresentationSafe(view, { captions: CAPTIONS });
  });

  it("leaves the web backend's own refusal out, keeping the registry's UNKNOWN", async () => {
    state.fleetApps = async () => {
      throw new Error("GET /api/v1/fleet/apps failed: 500 - boom");
    };
    const view = renderInPresentationMode(<UiBridgeDashboardPage />, {
      scope: SCOPE,
      wrapper: Queries,
    });
    const unknown = await screen.findByTestId(
      "coord-ui-bridge-apps-web-unknown"
    );
    expect(unknown).toHaveTextContent(
      "UNKNOWNThe web's app registry could not be read."
    );
    expect(unknown).not.toHaveTextContent("boom");
    await screen.findByTestId("coord-ui-bridge-actions-counts");
    expectPresentationSafe(view, { captions: CAPTIONS });
  });

  it("gives the no-runner reason in fixed words, never the refusal that names the runner", async () => {
    state.target = {
      kind: "unavailable",
      reason: "resolver_unavailable",
      message:
        "Your pick Build box is not currently listed, and the device resolver did not answer. Retry, or pick a runner.",
    };
    renderInPresentationMode(<UiBridgeDashboardPage />, {
      scope: SCOPE,
      wrapper: Queries,
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("coord-ui-bridge-app-row")).toHaveLength(2)
    );
    expect(document.body).not.toHaveTextContent("Build box");
    expect(
      screen.getByTestId("coord-ui-bridge-health-strip")
    ).toHaveTextContent(
      "No runner to read — no runner is chosen and coord's device resolver did not answer."
    );
    expect(
      screen.getByTestId("coord-ui-bridge-actions-unknown")
    ).toHaveTextContent("coord's device resolver did not answer");
  });
});

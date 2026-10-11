/**
 * The UI Bridge tab's counters, driven through the REAL hooks and relay client
 * with real-shaped runner bodies — only `httpClient.fetch` is faked.
 *
 * `UiBridgePanel.target.test.tsx` mocks the hooks to idle, which is why three
 * wrong-number defects passed it:
 *  - the snapshot is `{ success, data }` and the panel read its top level, so
 *    a healthy snapshot showed "0 elements";
 *  - "states" was summed from the spec LIST's `config.stateMachine`, which the
 *    list projection does not carry, so every app showed "0 states" — the
 *    GRAPH carries them, as `stateIds` / `transitionIds`;
 *  - the App field defaulted to `qontinui-web`, which a normal runner never
 *    registered, and the 404's `app-not-found` was rendered as a bare
 *    "The relay answered HTTP 404."
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";

const DESK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  target: { kind: "pending" } as RunnerTarget,
  fetch: (async () => {
    throw new Error("fetch not stubbed");
  }) as (url: string, init?: RequestInit) => Promise<Response>,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useRunnerTarget: () => state.target,
  useActiveRunner: () => ({ activeRunner: null, runners: [] }),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (url: string, init?: RequestInit) => state.fetch(url, init),
  },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import { UiBridgePanel } from "./UiBridgePanel";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** `GET /apps/qontinui-runner/spec/list` — the projection has no state machine. */
const SPEC_LIST = {
  ok: true,
  specs: [
    {
      specId: "runs",
      appName: "Qontinui Runner",
      config: { version: "1", description: "Runs", groups: [], metadata: null },
    },
    {
      specId: "settings",
      appName: "Qontinui Runner",
      config: {
        version: "1",
        description: "Settings",
        groups: [],
        metadata: null,
      },
    },
  ],
};

/** `GET /apps/qontinui-runner/spec/graph` — state and transition IDS. */
const SPEC_GRAPH = {
  ok: true,
  pages: [
    {
      id: "runs",
      stateIds: ["runs-list", "runs-empty", "runs-detail"],
      transitionIds: ["open-run"],
    },
    {
      id: "settings",
      stateIds: ["settings-general", "settings-accounts"],
      transitionIds: [],
    },
  ],
};

/** `GET /ui-bridge/control/snapshot` — `Json<ApiResponse<…>>`, i.e. enveloped. */
const SNAPSHOT_ENVELOPE = {
  success: true,
  data: {
    timestamp: 1760190000000,
    elements: [
      { id: "nav-runs", type: "button", actions: ["click"] },
      { id: "nav-settings", type: "button", actions: ["click"] },
      { id: "runs-filter", type: "input", actions: ["type", "clear"] },
    ],
    components: [{ id: "runs-table", name: "RunsTable" }],
    workflows: [],
    activeRuns: [],
    page: {
      url: "http://tauri.localhost/",
      pathname: "/",
      title: "Qontinui Runner",
    },
    appId: "qontinui-runner",
    route: "/",
  },
};

/**
 * The same route when the SDK did not answer and the runner fell back to a
 * native window capture (`ui_bridge_get_snapshot_handler`): still a success
 * envelope, but with no element tree.
 */
const NATIVE_CAPTURE_ENVELOPE = {
  success: true,
  data: {
    source: "native_capture",
    reason: "UI Bridge request timed out after 10000ms",
    screenshot: "iVBORw0KGgo=",
    width: 1280,
    height: 800,
    elements: [],
    note: "SDK was not connected. This is a native window capture fallback — no element tree is available.",
  },
};

const PROXY = "https://api.test/api/v1/device-bridge/runner-proxy/";

/** What the snapshot route answers in the current test. */
let snapshotBody: unknown = SNAPSHOT_ENVELOPE;

/** The runner, as the relay carries it: registered app → bodies; else 404. */
function runner(url: string): Promise<Response> {
  const path = url.startsWith(PROXY) ? url.slice(PROXY.length) : url;
  if (path === "apps/qontinui-runner/spec/list") {
    return Promise.resolve(json(200, SPEC_LIST));
  }
  if (path === "apps/qontinui-runner/spec/graph") {
    return Promise.resolve(json(200, SPEC_GRAPH));
  }
  if (path === "ui-bridge/control/snapshot") {
    return Promise.resolve(json(200, snapshotBody));
  }
  const app = /^apps\/([^/]+)\/spec\//.exec(path)?.[1];
  if (app) {
    // qontinui-runner `spec_api/apps.rs` `app_error_into_response`.
    return Promise.resolve(
      json(404, {
        ok: false,
        reason: "app-not-found",
        detail: { appId: decodeURIComponent(app) },
      })
    );
  }
  return Promise.reject(new Error(`unexpected relay path ${path}`));
}

const requested: string[] = [];
let client: QueryClient;

function renderPanel() {
  return render(
    <QueryClientProvider client={client}>
      <UiBridgePanel />
    </QueryClientProvider>
  );
}

const count = (label: string) =>
  screen.getByTestId(`ui-bridge-count-${label}`).textContent;

beforeEach(() => {
  state.target = { kind: "runner", runner: { id: DESK }, locality: "unknown" };
  snapshotBody = SNAPSHOT_ENVELOPE;
  requested.length = 0;
  state.fetch = (url) => {
    requested.push(url.slice(PROXY.length));
    return runner(url);
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
});

describe("UiBridgePanel counters (real hooks, real-shaped bodies)", () => {
  it("defaults to the runner's own app id", async () => {
    renderPanel();

    expect((screen.getByLabelText("App") as HTMLInputElement).value).toBe(
      "qontinui-runner"
    );
    await waitFor(() =>
      expect(requested).toEqual(
        expect.arrayContaining([
          "apps/qontinui-runner/spec/list",
          "apps/qontinui-runner/spec/graph",
        ])
      )
    );
  });

  it("counts states and transitions from the graph's id lists", async () => {
    renderPanel();

    await waitFor(() => expect(count("states")).toBe("5 states"));
    expect(count("pages")).toBe("2 pages");
    expect(count("transitions")).toBe("1 transitions");
    expect(count("graph-nodes")).toBe("2 graph nodes");
    // Per-page counts come from the graph too, joined on the page id.
    const runsRow = screen.getByText("runs").closest("li");
    expect(runsRow?.textContent).toContain("3 states");
  });

  it("counts the snapshot's elements from inside the { success, data } envelope", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /capture snapshot/i }));

    await waitFor(() => expect(count("elements")).toBe("3 elements"));
    expect(count("components")).toBe("1 components");
    // The payload carries no states/activeStates, so no counter claims "0".
    expect(screen.queryByTestId("ui-bridge-count-active")).toBeNull();
    expect(requested).toContain("ui-bridge/control/snapshot");
  });

  it("shows a native window capture's counts as unknown, not zero", async () => {
    snapshotBody = NATIVE_CAPTURE_ENVELOPE;
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /capture snapshot/i }));

    // `elements: []` is not read as "0", and the runner's own note says why.
    await waitFor(() => expect(count("elements")).toBe("— elements"));
    expect(count("components")).toBe("— components");
    expect(
      screen.getByText(/native window capture fallback/, { selector: "p" })
    ).toBeTruthy();
  });

  it("labels the snapshot with what IT says it captured, not the App field", async () => {
    renderPanel();
    // Point the App field elsewhere: the snapshot still comes from the
    // runner's own window, and must say so.
    fireEvent.change(screen.getByLabelText("App"), {
      target: { value: "qontinui-web" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture snapshot/i }));

    const subject = await screen.findByTestId("ui-bridge-snapshot-subject");
    expect(subject.textContent).toContain("qontinui-runner");
    expect(subject.textContent).toContain("http://tauri.localhost/");
    expect(subject.textContent).not.toContain("qontinui-web");
  });

  it("names the runner's app-not-found instead of a bare HTTP 404", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("App"), {
      target: { value: "qontinui-web" },
    });

    // The list and the graph fail alike, so they share one alert.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      'The runner has no app registered as "qontinui-web" (app-not-found).'
    );
    expect(alert.textContent).not.toContain("The relay answered HTTP 404");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

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
  if (path === "apps") {
    // A published runner whose relay allowlist predates `GET /apps`.
    return Promise.resolve(json(403, { detail: "path not allowed" }));
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

/** The "Live (automation)" card — the snapshot's half of the tab. */
function liveCard(): HTMLElement {
  const card = screen.getByText("Live (automation)").closest("section");
  if (!card) throw new Error("no Live (automation) card");
  return card;
}

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
    // The payload carries no states/activeStates, so no counter claims them.
    // Scoped to the Live card (the Processed card rightly counts states), and
    // checked by text as well as by test id: the old counters had no ids.
    const live = liveCard();
    expect(
      within(live)
        .getAllByTestId(/^ui-bridge-count-/)
        .map((el) => el.getAttribute("data-testid"))
    ).toEqual(["ui-bridge-count-elements", "ui-bridge-count-components"]);
    expect(within(live).queryAllByText(/\b(states|active)\b/)).toHaveLength(0);
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

    // The list and the graph fail alike, so ONE alert names both. Wait for
    // that grouped box specifically: the first alert to appear can be either
    // query's own, before the other has failed.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "spec pages or the state-machine graph for qontinui-web"
      )
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      'The runner has no app registered as "qontinui-web" (app-not-found).'
    );
    expect(alert.textContent).not.toContain("The relay answered HTTP 404");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it.each(["qontinui/web", "Qontinui-Runner", "qontinui web"])(
    "does not send %j, an id the runner could never have registered",
    async (appId) => {
      renderPanel();
      // Let the default id's reads settle, so what follows is about the edit.
      await waitFor(() => expect(count("states")).toBe("5 states"));
      requested.length = 0;

      fireEvent.change(screen.getByLabelText("App"), {
        target: { value: appId },
      });
      // Give any request the edit could start time to be made.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const message = screen.getByTestId("ui-bridge-app-id-invalid");
      expect(message.textContent).toContain(appId);
      expect(message.textContent).toContain("is not a valid app id");
      expect(screen.getByLabelText("App").getAttribute("aria-invalid")).toBe(
        "true"
      );
      expect(
        (screen.getByRole("button", { name: /refresh/i }) as HTMLButtonElement)
          .disabled
      ).toBe(true);
      // Nothing was asked of the runner, so there is no relay failure to show
      // and no count for an app that was never read.
      expect(requested).toEqual([]);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByTestId("ui-bridge-count-pages")).toBeNull();
    }
  );
});

/**
 * A read whose refetch failed keeps its last good `data` beside `isError`
 * (react-query). The failure leads, and nothing below it may read as current:
 * the graph's counts are the graph's only while its latest read succeeded
 * (the snapshot's kept capture is the next describe's matrix).
 */
describe("UiBridgePanel — a read kept after its latest attempt failed", () => {
  /** Answer `path` as the runner does `times` times, then fail it with a 503. */
  function failAfter(path: string, times: number) {
    let reads = 0;
    state.fetch = (url) => {
      const relayPath = url.slice(PROXY.length);
      requested.push(relayPath);
      if (relayPath === path && ++reads > times) {
        return Promise.resolve(json(503, { detail: "runner busy" }));
      }
      return runner(url);
    };
  }

  it("counts nothing from a graph whose refetch failed, and keeps the list's count", async () => {
    failAfter("apps/qontinui-runner/spec/graph", 1);
    renderPanel();
    await waitFor(() => expect(count("states")).toBe("5 states"));

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "the state-machine graph for qontinui-runner"
      )
    );
    expect(count("states")).toBe("— states");
    expect(count("transitions")).toBe("— transitions");
    expect(count("graph-nodes")).toBe("— graph nodes");
    // The list's latest read answered, so its count is current.
    expect(count("pages")).toBe("2 pages");
    // No page row claims the failed graph's states either.
    expect(screen.getByText("runs").closest("li")?.textContent).not.toMatch(
      /states/
    );
  });
});

/**
 * The Live card over every state of its read, read three ways: in the mount
 * that pressed Capture; after the inspector was unmounted and mounted again
 * with the same query client, which is what leaving the tab and coming back
 * does (Radix unmounts an inactive tab) and what presentation mode on and
 * off does (`OperatorOnly`); and after the target switched to another runner
 * and back.
 *
 * Everything the card says follows the snapshot read's own state, which
 * react-query keeps per runner, so all three say the same: a capture is
 * dated by when it was taken, a failed attempt leads, dated by when it
 * failed, and a capture kept after a re-capture failed sits under that
 * failure, introduced as the one before it (style guide R6, §6.5). Nothing
 * is captured but by a press: not by a mount, and not of a runner the target
 * switched to after a capture of another.
 */
describe("UiBridgePanel — the Live card reads the same in any mount", () => {
  const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const T0 = Date.parse("2026-10-27T09:00:00Z");
  /** Each press is five minutes after the one before. */
  const pressedAt = (i: number) => T0 + i * 5 * 60_000;

  /** What a press of Capture is answered with: the envelope, or a 503. */
  type Answer = "ok" | "fail";

  /** The snapshot requests made, by the device each was relayed to. */
  let snapshots: string[];
  /** What each snapshot request answers, in order. */
  let plan: Answer[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    snapshots = [];
    plan = [];
    state.fetch = (url, init) => {
      const path = url.slice(PROXY.length);
      requested.push(path);
      if (path === "ui-bridge/control/snapshot") {
        const device = new Headers(init?.headers).get("X-Qontinui-Device-Id");
        snapshots.push(device ?? "");
        const answer = plan[snapshots.length - 1];
        if (answer === undefined) {
          return Promise.reject(new Error("a capture nobody pressed for"));
        }
        return Promise.resolve(
          answer === "ok"
            ? json(200, SNAPSHOT_ENVELOPE)
            : json(503, { detail: "runner busy" })
        );
      }
      return runner(url);
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The chip's title, which names its instant in the browser's locale. */
  const asOf = (ms: number) => `As of ${new Date(ms).toLocaleString()}.`;

  /** Press Capture at `at`, answered with `answer`, and wait for it to settle. */
  async function press(answer: Answer, at: number) {
    vi.setSystemTime(at);
    plan.push(answer);
    fireEvent.click(screen.getByRole("button", { name: /capture snapshot/i }));
    const chip =
      answer === "ok"
        ? "ui-bridge-snapshot-provenance"
        : "ui-bridge-snapshot-failure-provenance";
    await waitFor(() =>
      expect(screen.getByTestId(chip).getAttribute("title")).toContain(asOf(at))
    );
  }

  const STATES: readonly {
    name: string;
    presses: readonly Answer[];
  }[] = [
    { name: "never captured", presses: [] },
    { name: "captured", presses: ["ok"] },
    { name: "a capture that failed, nothing kept", presses: ["fail"] },
    {
      name: "a re-capture that failed over a capture",
      presses: ["ok", "fail"],
    },
    { name: "a capture after a failed one", presses: ["fail", "ok"] },
    {
      name: "a re-capture after a failed re-capture",
      presses: ["ok", "fail", "ok"],
    },
  ];

  const target = (id: string): RunnerTarget => ({
    kind: "runner",
    runner: { id },
    locality: "unknown",
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <UiBridgePanel />
    </QueryClientProvider>
  );

  const READS = ["as captured", "remounted", "after a runner switch"] as const;

  const following = (a: Node, b: Node) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  for (const c of STATES) {
    for (const read of READS) {
      it(`${c.name} · ${read}`, async () => {
        const view = render(tree());
        for (const [i, answer] of c.presses.entries()) {
          await press(answer, pressedAt(i));
        }
        // The latest attempt, the latest capture, and when each was made.
        const last = c.presses.length - 1;
        const failed = c.presses[last] === "fail";
        const captured = c.presses.lastIndexOf("ok");

        if (read === "remounted") {
          view.unmount();
          render(tree());
        } else if (read === "after a runner switch") {
          state.target = target(OTHER);
          view.rerender(tree());
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
          });
          // Nothing was asked of the other runner, and nothing of this
          // one's read is shown as its.
          expect(snapshots.filter((d) => d === OTHER)).toEqual([]);
          expect(
            within(liveCard()).queryByTestId("ui-bridge-snapshot-subject")
          ).toBeNull();
          expect(within(liveCard()).queryByRole("alert")).toBeNull();
          state.target = target(DESK);
          view.rerender(tree());
        }
        // Let anything a mount or a switch would start be made.
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        // Only the presses captured, and only of this runner.
        expect(snapshots).toEqual(c.presses.map(() => DESK));

        const live = liveCard();
        const alert = within(live).queryByRole("alert");
        const failureChip = within(live).queryByTestId(
          "ui-bridge-snapshot-failure-provenance"
        );
        const lead = within(live).queryByTestId("ui-bridge-snapshot-retained");
        const subject = within(live).queryByTestId(
          "ui-bridge-snapshot-subject"
        );
        const captureChip = within(live).queryByTestId(
          "ui-bridge-snapshot-provenance"
        );

        if (failed) {
          // The latest attempt failed: it leads, dated by that attempt.
          expect(alert?.textContent).toContain("HTTP 503");
          expect(failureChip?.getAttribute("title")).toContain(
            asOf(pressedAt(last))
          );
          expect(failureChip).toHaveAttribute("data-provenance-known", "true");
          expect(following(alert!, failureChip!)).toBe(true);
        } else {
          expect(alert).toBeNull();
          expect(failureChip).toBeNull();
        }

        if (captured >= 0) {
          // The capture, dated by when it was taken — not by a later attempt.
          expect(subject?.textContent).toContain("qontinui-runner");
          expect(captureChip?.textContent).toMatch(
            /^source: the runner's live snapshot · as of /
          );
          expect(captureChip?.getAttribute("title")).toContain(
            asOf(pressedAt(captured))
          );
          expect(captureChip).toHaveAttribute("data-provenance-known", "true");
          expect(count("elements")).toBe("3 elements");
          expect(following(subject!, captureChip!)).toBe(true);
        } else {
          expect(subject).toBeNull();
          expect(captureChip).toBeNull();
          expect(
            within(live).queryByTestId("ui-bridge-count-elements")
          ).toBeNull();
        }

        if (failed && captured >= 0) {
          // A capture kept after a failed re-capture: the failure leads, then
          // the line that says what follows is the one before it.
          expect(lead?.textContent).toBe(
            "As last captured, before that failure:"
          );
          expect(following(failureChip!, lead!)).toBe(true);
          expect(following(lead!, subject!)).toBe(true);
        } else {
          expect(lead).toBeNull();
        }
      });
    }
  }
});

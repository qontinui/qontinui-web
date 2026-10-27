/**
 * The dashboard's read hooks, driven through the real relay client with only
 * `httpClient` faked:
 *
 * - which runner the page reads, and every identifier it holds for it (the
 *   presentation lens aliases all of them, so none may go missing);
 * - the metadata reads ask nothing until a runner is targeted;
 * - page health (and the occlusion sweep, where a relay carries it) drives a
 *   full `discover` of the runner's window, so it runs ONLY when asked and
 *   ONLY for the runner it was asked for — switching runners never fires it
 *   for the new one;
 * - where no relay carries the sweep — every runner today — it is not asked at
 *   all, and the occlusion row is decided without reading any answer to it
 *   (`occlusionReadOf`; coord finding 99796499);
 * - the web app registry, which is not partitioned by project, is read only
 *   for staff and never while presenting (`webRegistryAccessOf`), and a half
 *   the page declines is never handed on (`appRegistryReadsOf`).
 */

import React, { type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";
import { FixedPresentationMode } from "@/components/presentation";
import {
  DEVICE_ID,
  FLEET_APPS,
  VISIBILITY_CLEAR_OBSERVED,
  VISIBILITY_CLEAR_UNOBSERVED,
  VISIBILITY_HIDES_TEXT,
} from "../__fixtures__/runnerBodies";
import { relayFake, type RelayFake } from "../__fixtures__/relayResponder";
import {
  OCCLUSION_NOT_RELAYED,
  type OcclusionReading,
} from "./occlusionStatus";
import {
  RUNNER_APP_LIST_NOT_IN_LENS,
  WEB_REGISTRY_NOT_IN_LENS,
  WEB_REGISTRY_STAFF_ONLY,
} from "./appRegistryStatus";
import type { QueryView, ReadState } from "./readState";

const OTHER_DEVICE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const state = vi.hoisted(() => ({
  target: { kind: "pending" } as RunnerTarget,
  relay: null as RelayFake | null,
  gets: [] as string[],
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
    get: async (url: string) => {
      state.gets.push(url);
      return FLEET_APPS;
    },
  },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: state.user }),
}));

import {
  FLEET_APPS_PATH,
  appRegistryReadsOf,
  occlusionReadOf,
  refreshTitleOf,
  useDashboardRunner,
  useFleetAppsRead,
  usePageHealthRun,
  useRunnerComponentsRead,
  useRunnerHealthRead,
  webRegistryAccessOf,
} from "./useUiBridgeDashboard";

const STAFF = { is_superuser: true, coord_is_admin: true };
const COORD_ADMIN = { is_superuser: false, coord_is_admin: true };

/** A relay that carries the sweep — no runner's does yet; the follow-up's case. */
const RELAYED = true;
/** What every runner's relay is today. */
const NOT_RELAYED = false;

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** Let any request a render would start actually start. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

const PAGE_HEALTH = "POST ui-bridge/control/page-health";
const SWEEP = "POST ui-bridge/control/visibility";
const asked = () => state.relay?.requestsFor ?? [];
const askedFor = (route: string, device: string) =>
  asked().filter((r) => r === `${route} for ${device}`).length;

beforeEach(() => {
  state.relay = relayFake();
  state.gets = [];
  state.user = STAFF;
});

afterEach(() => {
  state.relay = null;
});

describe("useDashboardRunner", () => {
  it("reads the targeted runner, with the name and hostname the runner list holds", () => {
    state.target = {
      kind: "runner",
      runner: { id: DEVICE_ID, name: "Build box" },
      locality: "unknown",
    };
    const { result } = renderHook(() => useDashboardRunner());
    expect(result.current).toEqual({
      deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      identity: {
        deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        hostname: "build-host-1",
        displayName: "Build box",
      },
      noRunner: null,
    });
  });

  it("keeps the target's own name for a runner the list has not caught up with", () => {
    state.target = {
      kind: "runner",
      runner: { id: OTHER_DEVICE_ID, name: "Spare box" },
      locality: "unknown",
    };
    const { result } = renderHook(() => useDashboardRunner());
    expect(result.current.deviceId).toBe(OTHER_DEVICE_ID);
    expect(result.current.identity).toEqual({
      deviceId: OTHER_DEVICE_ID,
      hostname: undefined,
      displayName: "Spare box",
    });
    expect(result.current.noRunner).toBeNull();
  });

  it("targets no device, and says why, while the runner list has not answered", () => {
    state.target = { kind: "pending" };
    const { result } = renderHook(() => useDashboardRunner());
    expect(result.current.deviceId).toBeNull();
    expect(result.current.identity).toEqual({
      deviceId: undefined,
      hostname: undefined,
      displayName: undefined,
    });
    expect(result.current.noRunner).toBe(
      "the runner list has not answered yet"
    );
  });

  it("says the target's own reason when coord names one", () => {
    state.target = {
      kind: "unavailable",
      reason: "no_eligible_runner",
      message: "Every runner is drained for maintenance",
    };
    const { result } = renderHook(() => useDashboardRunner());
    expect(result.current.deviceId).toBeNull();
    expect(result.current.noRunner).toBe(
      "Every runner is drained for maintenance"
    );
  });
});

describe("useDashboardRunner while presenting", () => {
  it("gives the fixed phrase, never the refusal that names the runner the operator picked", () => {
    state.target = {
      kind: "unavailable",
      reason: "resolver_unavailable",
      message:
        "Your pick Build box is not currently listed, and the device resolver did not answer.",
    };
    const { result } = renderHook(() => useDashboardRunner(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <FixedPresentationMode presenting>{children}</FixedPresentationMode>
      ),
    });
    expect(result.current.noRunner).toBe(
      "no runner is chosen and coord's device resolver did not answer"
    );
  });
});

describe("the metadata reads", () => {
  it("ask a runner nothing until one is targeted", async () => {
    const opts = { wrapper: wrapper() };
    renderHook(() => useRunnerHealthRead(null), opts);
    renderHook(() => useRunnerComponentsRead(null), opts);
    await settle();
    expect(asked()).toEqual([]);
  });

  it("ask nothing with no runner targeted even when refetched — `refetch()` ignores `enabled`", async () => {
    const opts = { wrapper: wrapper() };
    const health = renderHook(() => useRunnerHealthRead(null), opts);
    const components = renderHook(() => useRunnerComponentsRead(null), opts);
    await act(async () => {
      await Promise.allSettled([
        health.result.current.refetch(),
        components.result.current.refetch(),
      ]);
    });
    await settle();
    // Without a runner the relay would be asked with no device id at all.
    expect(asked()).toEqual([]);
  });

  it("read the targeted runner's health and components over the relay", async () => {
    const opts = { wrapper: wrapper() };
    const health = renderHook(() => useRunnerHealthRead(DEVICE_ID), opts);
    const components = renderHook(
      () => useRunnerComponentsRead(DEVICE_ID),
      opts
    );
    await waitFor(() => expect(health.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(components.result.current.isSuccess).toBe(true));
    expect(asked()).toEqual(
      expect.arrayContaining([
        `GET health for ${DEVICE_ID}`,
        `GET ui-bridge/control/components for ${DEVICE_ID}`,
      ])
    );
  });

  it("read the web registry from the web backend for staff, needing no runner", async () => {
    const { result } = renderHook(() => useFleetAppsRead(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(FLEET_APPS_PATH).toBe("/api/v1/fleet/apps");
    expect(state.gets).toEqual(["/api/v1/fleet/apps"]);
    expect(asked()).toEqual([]);
  });
});

describe("the web registry read — staff only, never while presenting", () => {
  it.each([
    ["a coord admin who is not staff", COORD_ADMIN],
    ["a member", { is_superuser: false, coord_is_admin: false }],
    ["nobody resolved", null],
  ])(
    "makes no read for %s — not even on refetch(), which ignores `enabled`",
    async (_label, user) => {
      state.user = user;
      const { result } = renderHook(() => useFleetAppsRead(), {
        wrapper: wrapper(),
      });
      await settle();
      await act(async () => {
        await result.current.refetch().catch(() => undefined);
      });
      await settle();
      expect(state.gets).toEqual([]);
      expect(result.current.data).toBeUndefined();
    }
  );

  it("makes no read for staff while presenting", async () => {
    const Queries = wrapper();
    const { result } = renderHook(() => useFleetAppsRead(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <FixedPresentationMode presenting>
          <Queries>{children}</Queries>
        </FixedPresentationMode>
      ),
    });
    await settle();
    await act(async () => {
      await result.current.refetch().catch(() => undefined);
    });
    await settle();
    expect(state.gets).toEqual([]);
  });

  it("is decided in one place: staff in operator mode only, with the reason each other viewer is given", () => {
    expect(webRegistryAccessOf({ presenting: false, staff: true })).toEqual({
      read: true,
    });
    expect(webRegistryAccessOf({ presenting: false, staff: false })).toEqual({
      read: false,
      reason: WEB_REGISTRY_STAFF_ONLY,
    });
    // Presenting declines it for staff too, with the lens's own reason.
    for (const staff of [true, false]) {
      expect(webRegistryAccessOf({ presenting: true, staff })).toEqual({
        read: false,
        reason: WEB_REGISTRY_NOT_IN_LENS,
      });
    }
  });
});

describe("appRegistryReadsOf — a half the page declines is never handed on", () => {
  /** A query that DID answer — as a value an earlier read left in the cache. */
  const answered = <D,>(data: D): QueryView<D> => ({
    data,
    error: null,
    isError: false,
    isFetching: false,
    dataUpdatedAt: 5,
    asked: true,
  });
  const web = answered(FLEET_APPS);
  const runner = answered({ ok: true, apps: [] });

  it("hands staff both reads in operator mode", () => {
    const reads = appRegistryReadsOf({
      presenting: false,
      webAccess: { read: true },
      web,
      runner,
    });
    expect(reads.web.state).toBe("ok");
    expect(reads.runner.state).toBe("ok");
  });

  it("hands a viewer who is not staff the runner's list, and the web half as not read — whatever the cache holds", () => {
    const reads = appRegistryReadsOf({
      presenting: false,
      webAccess: webRegistryAccessOf({ presenting: false, staff: false }),
      web,
      runner,
    });
    expect(reads.web).toEqual({
      state: "not-read",
      reason: WEB_REGISTRY_STAFF_ONLY,
    });
    expect(reads.runner.state).toBe("ok");
  });

  it("hands on neither while presenting", () => {
    const reads = appRegistryReadsOf({
      presenting: true,
      webAccess: webRegistryAccessOf({ presenting: true, staff: true }),
      web,
      runner,
    });
    expect(reads.web).toEqual({
      state: "not-read",
      reason: WEB_REGISTRY_NOT_IN_LENS,
    });
    expect(reads.runner).toEqual({
      state: "not-read",
      reason: RUNNER_APP_LIST_NOT_IN_LENS,
    });
  });
});

describe("usePageHealthRun — only when asked, only for the runner asked (a relay that carries the sweep)", () => {
  it("asks nothing until run() is called", async () => {
    const { result } = renderHook(() => usePageHealthRun(DEVICE_ID, RELAYED), {
      wrapper: wrapper(),
    });
    await settle();
    expect(asked()).toEqual([]);
    expect(result.current.requested).toBe(false);
    expect(result.current.pageHealth.fetchStatus).toBe("idle");
    expect(result.current.visibility.fetchStatus).toBe("idle");
  });

  it("runs page health and the sweep together for the runner asked", async () => {
    const { result } = renderHook(() => usePageHealthRun(DEVICE_ID, RELAYED), {
      wrapper: wrapper(),
    });
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(result.current.pageHealth.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.visibility.isError).toBe(true));
    expect(result.current.requested).toBe(true);
    expect(askedFor(PAGE_HEALTH, DEVICE_ID)).toBe(1);
    expect(askedFor(SWEEP, DEVICE_ID)).toBe(1);
  });

  it("never fires for a runner switched to after a run — that runner was not asked", async () => {
    const { result, rerender } = renderHook(
      ({ deviceId }: { deviceId: string | null }) =>
        usePageHealthRun(deviceId, RELAYED),
      { wrapper: wrapper(), initialProps: { deviceId: DEVICE_ID } }
    );
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(askedFor(PAGE_HEALTH, DEVICE_ID)).toBe(1));

    rerender({ deviceId: OTHER_DEVICE_ID });
    await settle();
    expect(askedFor(PAGE_HEALTH, OTHER_DEVICE_ID)).toBe(0);
    expect(askedFor(SWEEP, OTHER_DEVICE_ID)).toBe(0);
    expect(result.current.requested).toBe(false);
    expect(result.current.pageHealth.data).toBeUndefined();
    expect(result.current.pageHealth.fetchStatus).toBe("idle");

    // Asked for the new runner, it runs there…
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(askedFor(PAGE_HEALTH, OTHER_DEVICE_ID)).toBe(1));
    expect(askedFor(SWEEP, OTHER_DEVICE_ID)).toBe(1);

    // …and switching back shows nothing new for the first: it is not re-run.
    rerender({ deviceId: DEVICE_ID });
    await settle();
    expect(askedFor(PAGE_HEALTH, DEVICE_ID)).toBe(1);
    expect(askedFor(SWEEP, DEVICE_ID)).toBe(1);
  });

  it("does not re-run for a runner switched away from and back to with no new request — it reads as not asked", async () => {
    const { result, rerender } = renderHook(
      ({ deviceId }: { deviceId: string | null }) =>
        usePageHealthRun(deviceId, RELAYED),
      { wrapper: wrapper(), initialProps: { deviceId: DEVICE_ID } }
    );
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(result.current.pageHealth.isSuccess).toBe(true));
    await waitFor(() => expect(askedFor(SWEEP, DEVICE_ID)).toBe(1));

    // Away to another runner WITHOUT running there, then back.
    rerender({ deviceId: OTHER_DEVICE_ID });
    await settle();
    rerender({ deviceId: DEVICE_ID });
    await settle();
    expect(askedFor(PAGE_HEALTH, DEVICE_ID)).toBe(1);
    expect(askedFor(SWEEP, DEVICE_ID)).toBe(1);
    expect(result.current.requested).toBe(false);
    // The earlier answer is still cached, but the page is not handed it.
    expect(result.current.pageHealth.data).toBeDefined();
    expect(result.current.pageHealthView.asked).toBe(false);
    expect(result.current.pageHealthView.data).toBeUndefined();

    // Asked again, it runs again.
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(askedFor(PAGE_HEALTH, DEVICE_ID)).toBe(2));
  });

  it("re-runs both reads when asked again, and settles when both have", async () => {
    const { result } = renderHook(() => usePageHealthRun(DEVICE_ID, RELAYED), {
      wrapper: wrapper(),
    });
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(result.current.pageHealth.isSuccess).toBe(true));
    await waitFor(() =>
      expect(result.current.visibility.isFetching).toBe(false)
    );

    const again: { ran?: Promise<unknown> | void } = {};
    act(() => {
      again.ran = result.current.run();
    });
    expect(again.ran).toBeInstanceOf(Promise);
    await act(async () => {
      await again.ran;
    });
    expect(askedFor(PAGE_HEALTH, DEVICE_ID)).toBe(2);
    expect(askedFor(SWEEP, DEVICE_ID)).toBe(2);
  });

  it("does nothing with no runner to ask", async () => {
    const { result } = renderHook(() => usePageHealthRun(null, RELAYED), {
      wrapper: wrapper(),
    });
    const call: { ran?: Promise<unknown> | void } = { ran: Promise.resolve() };
    act(() => {
      call.ran = result.current.run();
    });
    expect(call.ran).toBeUndefined();
    await settle();
    expect(asked()).toEqual([]);
    expect(result.current.requested).toBe(false);
  });
});

describe("usePageHealthRun — where no relay carries the sweep (every runner today)", () => {
  it("asks page health and never the sweep", async () => {
    const { result } = renderHook(
      () => usePageHealthRun(DEVICE_ID, NOT_RELAYED),
      { wrapper: wrapper() }
    );
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(result.current.pageHealth.isSuccess).toBe(true));
    await settle();
    expect(result.current.requested).toBe(true);
    expect(askedFor(PAGE_HEALTH, DEVICE_ID)).toBe(1);
    expect(askedFor(SWEEP, DEVICE_ID)).toBe(0);
    expect(result.current.visibility.fetchStatus).toBe("idle");
    expect(result.current.visibility.data).toBeUndefined();
  });

  it("re-runs page health alone — `refetch` would ignore `enabled`, so the sweep is left out of it", async () => {
    const { result } = renderHook(
      () => usePageHealthRun(DEVICE_ID, NOT_RELAYED),
      { wrapper: wrapper() }
    );
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(result.current.pageHealth.isSuccess).toBe(true));

    const again: { ran?: Promise<unknown> | void } = {};
    act(() => {
      again.ran = result.current.run();
    });
    expect(again.ran).toBeInstanceOf(Promise);
    await act(async () => {
      await again.ran;
    });
    expect(askedFor(PAGE_HEALTH, DEVICE_ID)).toBe(2);
    expect(askedFor(SWEEP, DEVICE_ID)).toBe(0);
  });

  it("never asks for the sweep of a runner switched to, either", async () => {
    const { result, rerender } = renderHook(
      ({ deviceId }: { deviceId: string | null }) =>
        usePageHealthRun(deviceId, NOT_RELAYED),
      { wrapper: wrapper(), initialProps: { deviceId: DEVICE_ID } }
    );
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(askedFor(PAGE_HEALTH, DEVICE_ID)).toBe(1));
    rerender({ deviceId: OTHER_DEVICE_ID });
    act(() => {
      void result.current.run();
    });
    await waitFor(() => expect(askedFor(PAGE_HEALTH, OTHER_DEVICE_ID)).toBe(1));
    await settle();
    expect(asked().filter((r) => r.startsWith(SWEEP))).toEqual([]);
  });
});

/** A sweep query as a view — what the page hands `occlusionReadOf`. */
function sweepView(over: Partial<QueryView<unknown>> = {}): QueryView<unknown> {
  return {
    data: undefined,
    error: undefined,
    isError: false,
    isFetching: false,
    dataUpdatedAt: 0,
    asked: false,
    ...over,
  };
}

const bodyData = (body: Record<string, unknown>) => body.data;

describe("occlusionReadOf — the occlusion row's state, decided in one place", () => {
  const standing: ReadState<OcclusionReading> = {
    state: "ok",
    value: OCCLUSION_NOT_RELAYED,
    stale: false,
    asOf: null,
  };

  describe("where no relay carries the sweep", () => {
    it("has no row before page health is asked for", () => {
      expect(
        occlusionReadOf({
          sweepRelayed: NOT_RELAYED,
          requested: false,
          sweep: sweepView(),
        })
      ).toEqual({ state: "idle" });
    });

    it("is the standing UNKNOWN once page health is asked for, with no time", () => {
      const read = occlusionReadOf({
        sweepRelayed: NOT_RELAYED,
        requested: true,
        sweep: sweepView(),
      });
      expect(read).toEqual(standing);
      expect(read.state === "ok" && read.value.kind).toBe("unknown");
    });

    it("stays the standing UNKNOWN whatever the sweep's query holds — it is never read", () => {
      const answers: Array<[string, Partial<QueryView<unknown>>]> = [
        [
          "a clear sweep that observed occlusion data",
          {
            data: bodyData(VISIBILITY_CLEAR_OBSERVED),
            asked: true,
            dataUpdatedAt: 5,
          },
        ],
        [
          "a clear sweep that observed none",
          { data: bodyData(VISIBILITY_CLEAR_UNOBSERVED), asked: true },
        ],
        ["hidden text", { data: bodyData(VISIBILITY_HIDES_TEXT), asked: true }],
        [
          "a failed read",
          { error: new Error("boom"), isError: true, asked: true },
        ],
        ["a read in flight", { isFetching: true, asked: true }],
        [
          "a kept answer and a failed refetch",
          {
            data: bodyData(VISIBILITY_CLEAR_OBSERVED),
            error: new Error("boom"),
            isError: true,
            asked: true,
            dataUpdatedAt: 5,
          },
        ],
      ];
      for (const [label, over] of answers) {
        expect(
          occlusionReadOf({
            sweepRelayed: NOT_RELAYED,
            requested: true,
            sweep: sweepView(over),
          }),
          label
        ).toEqual(standing);
      }
    });
  });

  describe("where a relay carries the sweep (the follow-up's case)", () => {
    const read = (over: Partial<QueryView<unknown>>, requested = true) =>
      occlusionReadOf({
        sweepRelayed: RELAYED,
        requested,
        sweep: sweepView(over),
      });

    it("reads the sweep's own query, honestly", () => {
      expect(read({})).toEqual({ state: "idle" });
      expect(read({ isFetching: true, asked: true })).toEqual({
        state: "loading",
      });
      const clear = read({
        data: bodyData(VISIBILITY_CLEAR_OBSERVED),
        asked: true,
        dataUpdatedAt: 5,
      });
      expect(clear.state === "ok" && clear.value.kind).toBe("clear");
      const unobserved = read({
        data: bodyData(VISIBILITY_CLEAR_UNOBSERVED),
        asked: true,
        dataUpdatedAt: 5,
      });
      expect(unobserved.state === "ok" && unobserved.value.kind).toBe(
        "unknown"
      );
      expect(
        read({ error: new Error("boom"), isError: true, asked: true }).state
      ).toBe("failed");
    });
  });
});

describe("refreshTitleOf — Refresh's title names only the reads the press makes", () => {
  const STAFF_READ = webRegistryAccessOf({ presenting: false, staff: true });
  const NOT_STAFF = webRegistryAccessOf({ presenting: false, staff: false });
  const LENS = webRegistryAccessOf({ presenting: true, staff: true });
  const ON_DEMAND =
    "The live snapshot and page health run only from their own buttons.";

  it.each([
    [
      "a runner, staff, operator mode",
      { runner: true, presenting: false, webAccess: STAFF_READ },
      `Re-reads the runner's health, components and screens and both app registries now. ${ON_DEMAND}`,
    ],
    [
      "a runner, a viewer who is not staff",
      { runner: true, presenting: false, webAccess: NOT_STAFF },
      `Re-reads the runner's health, components and screens and its own app list now. The web app registry is read only for staff. ${ON_DEMAND}`,
    ],
    [
      "a runner, presenting",
      { runner: true, presenting: true, webAccess: LENS },
      `Re-reads the runner's health, components and screens now. Neither app registry is read while presenting. ${ON_DEMAND}`,
    ],
    [
      "no runner, staff",
      { runner: false, presenting: false, webAccess: STAFF_READ },
      "Re-reads the web app registry now. No runner is targeted, so nothing is asked of a runner.",
    ],
    [
      "no runner, a viewer who is not staff",
      { runner: false, presenting: false, webAccess: NOT_STAFF },
      "Re-reads nothing now: no runner is targeted, and the web app registry is read only for staff.",
    ],
    [
      "no runner, presenting",
      { runner: false, presenting: true, webAccess: LENS },
      "Re-reads nothing now: no runner is targeted, and neither app registry is read while presenting.",
    ],
  ])("with %s", (_label, scope, title) => {
    expect(refreshTitleOf(scope)).toBe(title);
  });

  it("never claims a registry read where the page declines it", () => {
    for (const presenting of [true, false]) {
      for (const runner of [true, false]) {
        const declined = webRegistryAccessOf({ presenting, staff: false });
        const title = refreshTitleOf({
          runner,
          presenting,
          webAccess: declined,
        });
        expect(title).not.toMatch(/both app registries/);
        expect(title).not.toMatch(/^Re-reads the web app registry/);
      }
    }
  });
});

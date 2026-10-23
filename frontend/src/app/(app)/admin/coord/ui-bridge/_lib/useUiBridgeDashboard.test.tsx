/**
 * The dashboard's read hooks, driven through the real relay client with only
 * `httpClient` faked:
 *
 * - which runner the page reads, and every identifier it holds for it (the
 *   presentation lens aliases all of them, so none may go missing);
 * - the metadata reads ask nothing until a runner is targeted;
 * - page health and the occlusion sweep each drive a full `discover` of the
 *   runner's window, so they run ONLY when asked and ONLY for the runner they
 *   were asked for — switching runners never fires them for the new one.
 */

import React, { type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";
import { FixedPresentationMode } from "@/components/presentation";
import { DEVICE_ID, FLEET_APPS } from "../__fixtures__/runnerBodies";
import { relayFake, type RelayFake } from "../__fixtures__/relayResponder";

const OTHER_DEVICE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const state = vi.hoisted(() => ({
  target: { kind: "pending" } as RunnerTarget,
  relay: null as RelayFake | null,
  gets: [] as string[],
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

import {
  FLEET_APPS_PATH,
  useDashboardRunner,
  useFleetAppsRead,
  usePageHealthRun,
  useRunnerComponentsRead,
  useRunnerHealthRead,
} from "./useUiBridgeDashboard";

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

  it("read the web registry from the web backend, needing no runner", async () => {
    const { result } = renderHook(() => useFleetAppsRead(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(FLEET_APPS_PATH).toBe("/api/v1/fleet/apps");
    expect(state.gets).toEqual(["/api/v1/fleet/apps"]);
    expect(asked()).toEqual([]);
  });
});

describe("usePageHealthRun — only when asked, only for the runner asked", () => {
  it("asks nothing until run() is called", async () => {
    const { result } = renderHook(() => usePageHealthRun(DEVICE_ID), {
      wrapper: wrapper(),
    });
    await settle();
    expect(asked()).toEqual([]);
    expect(result.current.requested).toBe(false);
    expect(result.current.pageHealth.fetchStatus).toBe("idle");
    expect(result.current.visibility.fetchStatus).toBe("idle");
  });

  it("runs page health and the sweep together for the runner asked", async () => {
    const { result } = renderHook(() => usePageHealthRun(DEVICE_ID), {
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
      ({ deviceId }: { deviceId: string | null }) => usePageHealthRun(deviceId),
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

  it("re-runs both reads when asked again, and settles when both have", async () => {
    const { result } = renderHook(() => usePageHealthRun(DEVICE_ID), {
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
    const { result } = renderHook(() => usePageHealthRun(null), {
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

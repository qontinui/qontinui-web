/**
 * `useRunnerSnapshot` reads the runner's window only when asked. Its two
 * callers ask two ways: the UI Bridge dashboard enables it per request
 * (`useOnDemandRequest`), and the digital twin's UI Bridge tab never enables
 * it and captures with `refetch()`. Its `staleTime: 0` makes every capture
 * stale at once, so with react-query's default a network reconnect read the
 * window again under an ENABLED one — the dashboard's, once asked — with
 * nobody pressing anything. Neither a mount nor a reconnect captures here.
 */

import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DESK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROXY = "https://api.test/api/v1/device-bridge/runner-proxy/";

const state = vi.hoisted(() => ({ snapshots: 0 }));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string) => {
      if (url !== `${PROXY}ui-bridge/control/snapshot`) {
        throw new Error(`unexpected relay request ${url}`);
      }
      state.snapshots += 1;
      return new Response(
        JSON.stringify({ success: true, data: { elements: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
  },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import { useRunnerSnapshot } from "./useUiBridge";

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.snapshots = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
});

/** Drop the network and bring it back, then give any refetch time to start. */
async function reconnect() {
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("useRunnerSnapshot — captured only when asked", () => {
  const CASES = [
    {
      name: "enabled per request (the UI Bridge dashboard)",
      enabled: true,
      // Enabling it IS the request: that one capture, and no other.
      onMount: 1,
    },
    {
      name: "never enabled (the digital twin's UI Bridge tab)",
      enabled: false,
      onMount: 0,
    },
  ] as const;

  for (const c of CASES) {
    it(`does not capture again on a reconnect — ${c.name}`, async () => {
      const { result } = renderHook(() => useRunnerSnapshot(DESK, c.enabled), {
        wrapper,
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(state.snapshots).toBe(c.onMount);

      await reconnect();
      expect(state.snapshots).toBe(c.onMount);

      // A press is what captures: `refetch()`, whichever way it is enabled.
      await act(async () => {
        await result.current.refetch();
      });
      await waitFor(() => expect(state.snapshots).toBe(c.onMount + 1));
    });
  }
});

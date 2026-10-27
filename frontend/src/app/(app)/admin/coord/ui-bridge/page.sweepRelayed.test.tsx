/**
 * The occlusion row on the day a relay DOES carry the sweep — the follow-up
 * that coord finding `99796499-8e46-4d69-94ba-a2ac9fe3ea22` and the plan's
 * Phase 6 amendment (2026-10-24) describe. No runner's relay carries it today,
 * so `page.test.tsx` pins the row UNKNOWN on every runner; this file pins what
 * the page does the moment `RUNNER_ROUTES.visibility` is no longer `never`, by
 * making `isRelayed` say so. The real page, hooks and relay client run; only
 * `httpClient` and that one predicate are faked.
 *
 * What it keeps true for that day: the sweep is asked alongside page health,
 * its verdict is read honestly (`clear` only with occlusion data observed;
 * hidden text is red), and a runner whose relay still refuses it is a labelled
 * UNKNOWN naming its build. Page health's body is still not a source.
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";
import {
  BUILD_ID,
  COMPONENTS_ALL_DECLARED_BODY,
  DEVICE_ID,
  FLEET_APPS,
  NOT_CARRIED_BODY,
  VISIBILITY_CLEAR_OBSERVED,
  VISIBILITY_CLEAR_UNOBSERVED,
  VISIBILITY_HIDES_TEXT,
  pageHealthBodyWith,
} from "./__fixtures__/runnerBodies";
import { json, relayFake, type RelayFake } from "./__fixtures__/relayResponder";

const state = vi.hoisted(() => ({
  target: { kind: "pending" } as RunnerTarget,
  relay: null as RelayFake | null,
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
      return FLEET_APPS;
    },
  },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));
// Staff: the viewer the web app registry is read for (`webRegistryAccessOf`).
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { is_superuser: true, coord_is_admin: true } }),
}));
// The one fake that makes this file this file: a relay that carries the sweep.
vi.mock("./_lib/relayReads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_lib/relayReads")>()),
  isRelayed: () => true,
}));

import UiBridgeDashboardPage from "./page";

const SWEEP = "POST ui-bridge/control/visibility";

beforeEach(() => {
  state.target = {
    kind: "runner",
    runner: { id: DEVICE_ID, name: "Build box" },
    locality: "unknown",
  };
  state.relay = relayFake();
});

afterEach(() => {
  state.relay = null;
});

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

/** Run page health, and wait for the occlusion row (or its UNKNOWN panel). */
async function runPageHealth() {
  renderPage();
  await screen.findByTestId("coord-ui-bridge-actions-counts");
  fireEvent.click(screen.getByTestId("coord-ui-bridge-health-run"));
}

describe("when a relay carries the occlusion sweep", () => {
  it("asks for the sweep alongside page health", async () => {
    await runPageHealth();
    await screen.findByTestId("coord-ui-bridge-health-counts");
    await waitFor(() => expect(state.relay?.requests).toContain(SWEEP));
    expect(state.relay?.requests).toContain(
      "POST ui-bridge/control/page-health"
    );
  });

  it("renders a clear sweep that observed no occlusion data as UNKNOWN, never clear", async () => {
    state.relay = relayFake({
      // Every action declared, so nothing but the sweep can hold the strip
      // off green.
      components: () => json(200, COMPONENTS_ALL_DECLARED_BODY),
      visibility: () => json(200, VISIBILITY_CLEAR_UNOBSERVED),
    });
    await runPageHealth();
    const row = await screen.findByTestId("coord-ui-bridge-occlusion");
    expect(row).toHaveAttribute("data-occlusion", "unknown");
    expect(row).toHaveTextContent("UNKNOWN");
    expect(row).not.toHaveTextContent("Nothing covered");
    expect(row).toHaveTextContent("nothing was observed");
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
    await runPageHealth();
    const row = await screen.findByTestId("coord-ui-bridge-occlusion");
    await waitFor(() => expect(row).toHaveAttribute("data-occlusion", "clear"));
    expect(row).toHaveTextContent("Nothing covered across 47 elements");
  });

  it("calls hidden text out in red", async () => {
    state.relay = relayFake({
      visibility: () => json(200, VISIBILITY_HIDES_TEXT),
    });
    await runPageHealth();
    const row = await screen.findByTestId("coord-ui-bridge-occlusion");
    await waitFor(() =>
      expect(row).toHaveAttribute("data-occlusion", "hides-text")
    );
    expect(row).toHaveTextContent(
      "2 occlusions across 47 elements, 1 hiding text."
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-ui-bridge-health-strip")
      ).toHaveAttribute("data-health-level", "red")
    );
  });

  it("renders a runner whose relay still refuses the sweep as UNKNOWN naming its build", async () => {
    state.relay = relayFake({ visibility: () => json(403, NOT_CARRIED_BODY) });
    await runPageHealth();
    const unknown = await screen.findByTestId(
      "coord-ui-bridge-occlusion-unknown"
    );
    await waitFor(() => expect(unknown).toHaveTextContent(BUILD_ID));
    expect(unknown).toHaveTextContent("UNKNOWN");
    expect(unknown).toHaveTextContent("HTTP 403");
  });

  it("still takes nothing from page health's body: an occlusion field there changes no verdict", async () => {
    state.relay = relayFake({
      pageHealth: () =>
        json(
          200,
          pageHealthBodyWith({
            occlusionDataObserved: true,
            verdict: "clear",
          })
        ),
      visibility: () => json(200, VISIBILITY_CLEAR_UNOBSERVED),
    });
    await runPageHealth();
    await screen.findByTestId("coord-ui-bridge-health-counts");
    const row = await screen.findByTestId("coord-ui-bridge-occlusion");
    await waitFor(() =>
      expect(row).toHaveAttribute("data-occlusion", "unknown")
    );
    expect(row).not.toHaveTextContent("Nothing covered");
  });
});

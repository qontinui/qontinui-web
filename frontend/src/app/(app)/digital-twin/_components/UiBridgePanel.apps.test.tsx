/**
 * The App field suggests the apps the CONNECTED RUNNER has registered, read
 * through the relay from its `GET /apps` (plan
 * 2026-10-12-digital-twin-runner-panels-end-to-end, Phase 3). When that read
 * is loading or fails — a published runner whose relay allowlist predates the
 * route answers 403 — it falls back to the static suggestions, with no error
 * banner: the field is free text either way.
 *
 * Real hooks and the real relay client; only the HTTP fetch is stubbed.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";

const DESK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  target: { kind: "pending" } as RunnerTarget,
  apps: (() => {
    throw new Error("apps not stubbed");
  }) as () => Promise<Response>,
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
    fetch: (url: string) => {
      const path = url.slice(PROXY.length);
      if (path === "apps") return state.apps();
      // The spec reads are not under test here: an empty, successful answer.
      if (path.endsWith("/spec/list"))
        return Promise.resolve(json(200, { ok: true, specs: [] }));
      if (path.endsWith("/spec/graph"))
        return Promise.resolve(json(200, { ok: true, pages: [] }));
      return Promise.reject(new Error(`unexpected relay path ${path}`));
    },
  },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import { UiBridgePanel } from "./UiBridgePanel";

const PROXY = "https://api.test/api/v1/device-bridge/runner-proxy/";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** `GET /apps` as qontinui-runner `spec_api/apps.rs` `handle_list_apps` sends it. */
const APPS = {
  ok: true,
  apps: [
    {
      app_id: "qontinui-runner",
      display_name: "Qontinui Runner",
      repo_root: "/home/u/qontinui-runner",
      ui_bridge_url: "http://127.0.0.1:9876",
      created_at_ms: 1,
      last_seen_at_ms: 2,
    },
    {
      app_id: "acme-shop",
      display_name: "Acme Shop",
      repo_root: "/home/u/acme",
      ui_bridge_url: "http://127.0.0.1:3000",
      created_at_ms: 1,
      last_seen_at_ms: 2,
    },
  ],
};

const STATIC_IDS = ["qontinui-runner", "qontinui-web", "qontinui-supervisor"];

let client: QueryClient;

function renderPanel() {
  return render(
    <QueryClientProvider client={client}>
      <UiBridgePanel />
    </QueryClientProvider>
  );
}

function options(): Array<{ value: string; label: string }> {
  return Array.from(
    document.querySelectorAll<HTMLOptionElement>("#dt-app-id-options option")
  ).map((o) => ({ value: o.value, label: o.getAttribute("label") ?? "" }));
}

beforeEach(() => {
  state.target = { kind: "runner", runner: { id: DESK }, locality: "unknown" };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
});

describe("UiBridgePanel app picker", () => {
  it("lists the runner's registered app ids, labelled with their display names", async () => {
    state.apps = () => Promise.resolve(json(200, APPS));
    renderPanel();

    await waitFor(() =>
      expect(options()).toEqual([
        { value: "qontinui-runner", label: "Qontinui Runner" },
        { value: "acme-shop", label: "Acme Shop" },
      ])
    );
    // The default app id is unchanged by the list.
    expect((screen.getByLabelText("App") as HTMLInputElement).value).toBe(
      "qontinui-runner"
    );
  });

  it("offers the static suggestions while the read is loading", () => {
    state.apps = () => new Promise<Response>(() => {});
    renderPanel();

    expect(options().map((o) => o.value)).toEqual(STATIC_IDS);
  });

  it("falls back to the static suggestions on a 403 from an older runner, with no banner", async () => {
    let answered = false;
    state.apps = () => {
      answered = true;
      return Promise.resolve(json(403, { detail: "path not allowed" }));
    };
    renderPanel();

    await waitFor(() => expect(answered).toBe(true));
    await waitFor(() =>
      expect(client.getQueryState(["digital-twin", "apps", DESK])?.status).toBe(
        "error"
      )
    );
    expect(options().map((o) => o.value)).toEqual(STATIC_IDS);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falls back to the static suggestions when the runner refuses in-body", async () => {
    state.apps = () =>
      Promise.resolve(
        json(500, { ok: false, reason: "list-apps-failed", detail: {} })
      );
    renderPanel();

    await waitFor(() =>
      expect(client.getQueryState(["digital-twin", "apps", DESK])?.status).toBe(
        "error"
      )
    );
    expect(options().map((o) => o.value)).toEqual(STATIC_IDS);
  });

  it("offers no suggestions when the runner answers that it has none registered", async () => {
    state.apps = () => Promise.resolve(json(200, { ok: true, apps: [] }));
    renderPanel();

    await waitFor(() =>
      expect(client.getQueryState(["digital-twin", "apps", DESK])?.status).toBe(
        "success"
      )
    );
    expect(options()).toEqual([]);
  });
});

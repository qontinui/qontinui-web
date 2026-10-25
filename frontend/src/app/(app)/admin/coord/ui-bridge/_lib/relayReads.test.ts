/**
 * The dashboard's relay call sites — the functions the runner's
 * `RELAY_ALLOWED` comments name — send exactly the `(method, path)` the
 * allowlist carries, with the body the runner's handler expects, and hand
 * back the payload in the shape the page reads.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import { RUNNER_NEEDS_LOCAL } from "@/lib/runner/api-client";
import { RunnerRelayError } from "@/app/(app)/digital-twin/_lib/runner-relay";
import {
  COMPONENTS_BODY,
  DEVICE_ID,
  HEALTH_BODY,
  NOT_CARRIED_BODY,
  PAGE_HEALTH_BODY,
  VISIBILITY_CLEAR_UNOBSERVED,
} from "../__fixtures__/runnerBodies";
import {
  fetchRunnerComponents,
  fetchRunnerHealth,
  fetchRunnerPageHealth,
  fetchRunnerVisibility,
  RUNNER_ROUTES,
} from "./relayReads";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function sent(): { url: string; init: RequestInit } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

const relayUrl = (path: string) =>
  `https://api.test/api/v1/device-bridge/runner-proxy/${path}`;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("the dashboard's relay call sites", () => {
  it("fetchRunnerComponents: GET /ui-bridge/control/components, unwrapped — the runner's own registry, wrapperComponents withheld", async () => {
    fetchMock.mockResolvedValue(json(200, COMPONENTS_BODY));
    const payload = (await fetchRunnerComponents(DEVICE_ID)) as {
      components: unknown[];
      wrapperComponents: unknown;
    };
    const { url, init } = sent();
    expect(url).toBe(relayUrl("ui-bridge/control/components"));
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(payload.components).toHaveLength(3);
    // The disclosure rides beside `components` inside `data`, so unwrapping
    // the envelope keeps it — and a relayed read is always `withheld`.
    expect(payload.wrapperComponents).toBe("withheld");
  });

  it("fetchRunnerPageHealth: POST /ui-bridge/control/page-health with `{}`", async () => {
    fetchMock.mockResolvedValue(json(200, PAGE_HEALTH_BODY));
    const payload = (await fetchRunnerPageHealth(DEVICE_ID)) as {
      summary: string;
    };
    const { url, init } = sent();
    expect(url).toBe(relayUrl("ui-bridge/control/page-health"));
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect(payload.summary).toBe("WARNING");
  });

  it("fetchRunnerVisibility: POST /ui-bridge/control/visibility with `{}`", async () => {
    fetchMock.mockResolvedValue(json(200, VISIBILITY_CLEAR_UNOBSERVED));
    const payload = (await fetchRunnerVisibility(DEVICE_ID)) as {
      occlusionDataObserved: boolean;
    };
    const { url, init } = sent();
    expect(url).toBe(relayUrl("ui-bridge/control/visibility"));
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(payload.occlusionDataObserved).toBe(false);
  });

  it("fetchRunnerHealth: GET /health with the envelope KEPT, so sdkFeatures survives", async () => {
    fetchMock.mockResolvedValue(json(200, HEALTH_BODY));
    const body = (await fetchRunnerHealth(DEVICE_ID)) as typeof HEALTH_BODY;
    const { url, init } = sent();
    expect(url).toBe(relayUrl("health"));
    expect(init.method).toBe("GET");
    expect(body.sdkFeatures).toEqual(HEALTH_BODY.sdkFeatures);
    expect(body.data.gitSha).toBe(HEALTH_BODY.data.gitSha);
  });

  it("rejects a route this runner's relay does not carry as RUNNER_NEEDS_LOCAL", async () => {
    fetchMock.mockResolvedValue(json(403, NOT_CARRIED_BODY));
    const err = await fetchRunnerComponents(DEVICE_ID).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RunnerRelayError);
    expect((err as RunnerRelayError).code).toBe(RUNNER_NEEDS_LOCAL);
    expect((err as RunnerRelayError).status).toBe(403);
  });
});

describe("RUNNER_ROUTES", () => {
  it("records each route as the runner's allowlist carries it", () => {
    expect(
      Object.fromEntries(
        Object.entries(RUNNER_ROUTES).map(([k, r]) => [
          k,
          `${r.method} /${r.path} ${r.carriage}`,
        ])
      )
    ).toEqual({
      health: "GET /health always",
      components: "GET /ui-bridge/control/components dashboard",
      pageHealth: "POST /ui-bridge/control/page-health dashboard",
      visibility: "POST /ui-bridge/control/visibility never",
      apps: "GET /apps never",
      specList: "GET /apps/{app_id}/spec/list always",
      specGraph: "GET /apps/{app_id}/spec/graph always",
      snapshot: "GET /ui-bridge/control/snapshot always",
    });
  });

  it("names the two functions the runner's allowlist comments name", () => {
    expect(RUNNER_ROUTES.components.callSite).toBe("fetchRunnerComponents");
    expect(RUNNER_ROUTES.pageHealth.callSite).toBe("fetchRunnerPageHealth");
  });
});

/**
 * Route contract for the call sites plan
 * `2026-09-12-four-frontend-routes-the-retry-sweep-found-dead-or-mismatched`
 * repointed, pinned against the backend's OpenAPI snapshot.
 *
 * Each case drives the REAL client function and captures the method and URL it
 * actually emits, then asserts that `(method, path template)` is served by
 * `lib/api-client/openapi-schema.json` — which backend CI regenerates from
 * `app.openapi()` and fails on any difference. So a client that drifts from the
 * backend (a `POST` against a `PUT` route, a `/api` prefix missing `/v1`) goes
 * red here instead of surfacing as a 404/405 in production.
 *
 * Never fix a failure by editing the expectations: they are read from the
 * snapshot. Fix the client.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  method: string;
  url: string;
}

const { captured, recordingFetch } = vi.hoisted(() => {
  const captured: { method: string; url: string }[] = [];
  const recordingFetch = async (
    url: string,
    options: { method?: string } = {}
  ) => {
    captured.push({ method: (options.method ?? "GET").toUpperCase(), url });
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
      blob: async () => new Blob(),
    } as unknown as Response;
  };
  return { captured, recordingFetch };
});

// `integration-testing.ts` calls the shared singleton's `fetch` directly.
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: recordingFetch },
}));

import { HttpClient } from "@/services/http-client";
import { DiscoveriesService } from "@/services/discoveries-service";
import {
  executeMockWorkflow,
  generatePDFReport,
  getScreenshotUrl,
  getStateScreenshots,
} from "./integration-testing";

const SNAPSHOT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../api-client/openapi-schema.json"
);

const SNAPSHOT_PATHS: Record<string, Record<string, unknown>> = JSON.parse(
  readFileSync(SNAPSHOT_PATH, "utf8")
).paths;

/** Concrete values the cases pass for path parameters. */
const DISCOVERY_ID = "11111111-2222-3333-4444-555555555555";
const RUN_ID = "run-abc123";
const SCREENSHOT = "shot-001.png";
const PARAM_VALUES = new Set([DISCOVERY_ID, RUN_ID, SCREENSHOT]);

/**
 * The real `HttpClient` verb helpers (`put`, `post`, …) over a recording
 * `fetch`, so the captured method is the one the helper really sends. Built
 * without the constructor: no token manager is needed to record a call.
 */
function recordingHttpClient(): HttpClient {
  const client = Object.create(HttpClient.prototype) as HttpClient;
  client.fetch = recordingFetch as HttpClient["fetch"];
  return client;
}

/** Strip origin and query string, leaving the path the backend routes on. */
function pathOf(url: string): string {
  const withoutOrigin = url.replace(/^https?:\/\/[^/]+/, "");
  return withoutOrigin.split("?")[0];
}

/**
 * The snapshot template a concrete path is served by, or `null`. A `{param}`
 * segment matches only one of the known parameter values above, so a literal
 * segment can never be swallowed by a wildcard.
 */
function templateFor(concretePath: string): string | null {
  const segments = concretePath.split("/");
  for (const template of Object.keys(SNAPSHOT_PATHS)) {
    const templateSegments = template.split("/");
    if (templateSegments.length !== segments.length) continue;
    const matches = templateSegments.every((seg, i) =>
      /^\{[^}]+\}$/.test(seg)
        ? PARAM_VALUES.has(segments[i])
        : seg === segments[i]
    );
    if (matches) return template;
  }
  return null;
}

function expectServed({ method, url }: Captured): void {
  const concretePath = pathOf(url);
  const template = templateFor(concretePath);
  expect(
    template,
    `${method} ${concretePath}: no snapshot path`
  ).not.toBeNull();
  const methods = Object.keys(SNAPSHOT_PATHS[template as string]).map((m) =>
    m.toUpperCase()
  );
  expect(methods, `${method} ${template}: verb not served`).toContain(method);
}

async function captureOne(call: () => Promise<unknown>): Promise<Captured> {
  captured.length = 0;
  await call();
  expect(captured).toHaveLength(1);
  return captured[0];
}

beforeEach(() => {
  captured.length = 0;
});

describe("route contract: discoveries-service", () => {
  const service = new DiscoveriesService(recordingHttpClient());

  it("acceptDiscovery hits a served (method, path)", async () => {
    expectServed(
      await captureOne(() => service.acceptDiscovery(DISCOVERY_ID, "ok"))
    );
  });

  it("rejectDiscovery hits a served (method, path)", async () => {
    expectServed(
      await captureOne(() => service.rejectDiscovery(DISCOVERY_ID, "no"))
    );
  });
});

describe("route contract: integration-testing", () => {
  it("executeMockWorkflow hits a served (method, path)", async () => {
    expectServed(
      await captureOne(() =>
        executeMockWorkflow({} as Parameters<typeof executeMockWorkflow>[0])
      )
    );
  });

  it("getStateScreenshots hits a served (method, path)", async () => {
    expectServed(await captureOne(() => getStateScreenshots(RUN_ID, ["Home"])));
  });

  it("getScreenshotUrl renders a served GET path", () => {
    expectServed({ method: "GET", url: getScreenshotUrl(RUN_ID, SCREENSHOT) });
  });

  it("generatePDFReport hits a served (method, path)", async () => {
    expectServed(
      await captureOne(() =>
        generatePDFReport({ executionResult: {}, screenshotsDir: "/tmp/shots" })
      )
    );
  });
});

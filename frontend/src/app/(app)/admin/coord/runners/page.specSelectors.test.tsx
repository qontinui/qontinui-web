/**
 * Every page-owned selector in the COMMITTED Spec-CI spec for `/runners`, run
 * against the real page with the spec's own route stubs as its data.
 *
 * Same shape as `admin/coord/trees/page.specSelectors.test.tsx`: it READS
 * `specs/pages/coord-runners/state-machine.derived.json` at test time and has
 * no copy of it, so it cannot drift from the spec. Each stub's `urlPattern`
 * fulfils the matching `httpClient` call, and every `id` criterion in a
 * page-owned state must resolve against the render.
 *
 * ## What it deliberately does NOT cover
 *
 * `coord-runners-shell` asserts the layout's `h1` and `CoordNav`, which are
 * not mounted by rendering the page in isolation; it is filtered out by name
 * rather than silently missed. (`CoordNav.test.tsx` pins the Runners crumb.)
 *
 * ## What it does not replace
 *
 * A jsdom render is not a browser and not the Spec-CI executor. The spec was
 * authored from source, not derived from a live authed UI Bridge snapshot —
 * its own description says so — and the authoritative check is still a live
 * run.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

interface SpecCriteria {
  id?: string;
  role?: string;
  text?: string;
}
interface SpecAssertion {
  id: string;
  target?: { criteria?: SpecCriteria };
}
interface SpecState {
  id: string;
  assertions: SpecAssertion[];
}
interface RouteStub {
  urlPattern: string;
  status: number;
  body: unknown;
}
interface DerivedSpec {
  id: string;
  states: SpecState[];
  metadata?: { routeStubs?: RouteStub[] };
}

const SPEC: DerivedSpec = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../../specs/pages/coord-runners/state-machine.derived.json"
    ),
    "utf-8"
  )
);

const STUBS = SPEC.metadata?.routeStubs ?? [];

/** The device the spec's own stubs describe — what run-spec-ci seeds in `?device=`. */
const DEVICE = (
  STUBS.find((s) => s.urlPattern.includes("/fleet/health"))?.body as {
    devices: { device_id: string }[];
  }
).devices[0].device_id;

/** `**\/api/v1/operations/sessions/fleet**` → `/api/v1/operations/sessions/fleet`. */
function stubFor(url: string): RouteStub | undefined {
  return STUBS.find((s) => url.includes(s.urlPattern.replace(/\*\*/g, "")));
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`device=${DEVICE}`),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const httpGet = vi.fn();
const httpFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...a: unknown[]) => httpGet(...a),
    fetch: (...a: unknown[]) => httpFetch(...a),
  },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

/** States this page owns. `coord-runners-shell` is the layout's, not ours. */
const PAGE_OWNED_STATES = SPEC.states.filter(
  (s) => s.id !== "coord-runners-shell"
);

import CoordRunnersPage from "./page";

beforeEach(() => {
  httpGet.mockReset();
  httpGet.mockImplementation(async (url: string) => {
    const stub = stubFor(url);
    if (!stub) throw new Error(`GET ${url} failed: 404 - not stubbed`);
    return stub.body;
  });
  httpFetch.mockReset();
  httpFetch.mockImplementation(async (url: string) => {
    const stub = stubFor(url);
    const status = stub?.status ?? 404;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => stub?.body,
      text: async () => JSON.stringify(stub?.body ?? "not stubbed"),
    };
  });
});

describe("coord-runners Spec-CI selectors resolve against the page", () => {
  it("covers the states the page owns, and says which it does not", () => {
    expect(SPEC.states.map((s) => s.id)).toEqual([
      "coord-runners-shell",
      "coord-runners-controls",
      "coord-runners-populated",
    ]);
    expect(PAGE_OWNED_STATES).toHaveLength(2);
  });

  it("stubs every read the page makes", () => {
    for (const fragment of [
      "/fleet/health",
      "/fleet/drain",
      "/fleet/resource-samples",
      "/sessions/fleet",
    ]) {
      expect(stubFor(`https://x/api/v1/operations${fragment}?q=1`)).toBeDefined();
    }
  });

  it("resolves every page-owned `id` criterion against the rendered page", async () => {
    render(<CoordRunnersPage />);

    await waitFor(() => {
      expect(
        screen.getAllByTestId("coord-runners-session-row").length
      ).toBeGreaterThan(0);
    });

    const missing: string[] = [];
    const checked: string[] = [];
    for (const state of PAGE_OWNED_STATES) {
      for (const a of state.assertions) {
        const id = a.target?.criteria?.id;
        if (!id) continue;
        checked.push(`${a.id} → #${id}`);
        if (screen.queryAllByTestId(id).length === 0) {
          missing.push(`${a.id} → ${id}`);
        }
      }
    }

    // Every page-owned assertion is an `id` criterion; a new shape would move
    // this count rather than be skipped by the loop.
    expect(checked).toHaveLength(
      PAGE_OWNED_STATES.reduce((n, s) => n + s.assertions.length, 0)
    );
    expect(missing).toEqual([]);
  });

  it("renders the two stubbed sessions and the unsafe verdict the stub engineered", async () => {
    render(<CoordRunnersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("coord-runners-session-row")).toHaveLength(2);
    });
    expect(screen.getByTestId("coord-runners-health")).toHaveTextContent(
      "Not safe to restart"
    );
  });
});

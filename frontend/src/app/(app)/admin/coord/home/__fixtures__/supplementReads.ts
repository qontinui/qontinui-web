/**
 * The transport for `/admin/coord/home`'s page tests, with the reads the page
 * makes BESIDE coord's project state (`_hooks/useHomeSupplements.ts`) answered
 * on their own: coord's machine roster, and the Gates and Questions pages'
 * queue reads. Every other `httpClient.fetch` goes to the test's own mock, so
 * a test about the project state still sees only the project-state read
 * there.
 *
 * By default the roster is one healthy machine and both queues are empty —
 * the calm control — so a test about the project state is not made amber by
 * a supplement it does not mention. A test about a supplement sets its own
 * answer on the exported mock.
 *
 * ```ts
 * vi.mock("@/services/service-factory", async () => {
 *   const s = await import("./__fixtures__/supplementReads");
 *   return { httpClient: s.homeTransport((...a) => httpFetch(...a)) };
 * });
 * ```
 */

import { vi } from "vitest";

export const FLEET_HEALTH_URL = "/api/v1/operations/fleet/health";
export const QUESTIONS_URL = "/api/v1/operations/agent-questions/pending";
export const GATES_URL = "/api/v1/admin-dev/overview";

/** A roster of machines in the given states (absent = no health state). */
export function roster(...states: Array<string | null>) {
  return {
    as_of: new Date().toISOString(),
    devices: states.map((state, i) => ({
      device_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      hostname: `example-host-${i}`,
      ...(state === null ? {} : { state }),
    })),
  };
}

export const CALM_ROSTER = () => roster("healthy");
export const EMPTY_QUESTIONS = () => ({ questions: [] });
export const EMPTY_GATES = () => ({
  generated_at: new Date().toISOString(),
  gates: [],
  counts: { open: 0 },
  rollouts: { auto_merge: { enabled: [], disabled: [] }, features: [] },
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

/** `/fleet/health`; resolves to the roster's body. */
export const fleetHealth = vi.fn(async () => CALM_ROSTER() as unknown);
/** `/agent-questions/pending`; resolves to the list's body. */
export const pendingQuestions = vi.fn(async () => EMPTY_QUESTIONS() as unknown);
/** `GET /admin-dev/overview` (`httpClient.get`); resolves to the overview. */
export const gatesOverview = vi.fn(async () => EMPTY_GATES() as unknown);

/** Put every supplement back to the calm default. */
export function resetSupplements() {
  fleetHealth.mockReset();
  fleetHealth.mockImplementation(async () => CALM_ROSTER());
  pendingQuestions.mockReset();
  pendingQuestions.mockImplementation(async () => EMPTY_QUESTIONS());
  gatesOverview.mockReset();
  gatesOverview.mockImplementation(async () => EMPTY_GATES());
}

/** `httpClient` for the page: supplements here, everything else to `rest`. */
export function homeTransport(rest: (...args: unknown[]) => Promise<Response>) {
  return {
    fetch: async (...args: unknown[]) => {
      const url = String(args[0]);
      const path = url.split("?")[0];
      if (path === FLEET_HEALTH_URL) return json(await fleetHealth());
      if (path === QUESTIONS_URL) return json(await pendingQuestions());
      return rest(...args);
    },
    get: async (url: string) => {
      if (url.split("?")[0] === GATES_URL) return gatesOverview();
      throw new Error(`GET ${url} failed: 404 - not mocked`);
    },
  };
}

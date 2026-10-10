/**
 * Route a mocked `httpClient.fetch` through a suite's existing per-verb mocks.
 *
 * Suites written against `httpClient.get` / `post` / `put` / `patch` /
 * `delete` keep their verb mocks and their assertions when the code under test
 * moves onto the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7), which calls `httpClient.fetch` instead. Each call is dispatched by
 * method with the helper-shaped arguments — `(url)` for `GET` / `DELETE`,
 * `(url, parsedBody)` for the rest — and the mock's resolved value comes back
 * as a 200 JSON `Response` (`undefined` as `null`). A rejection passes through
 * unchanged, so an error-path test sees the identical `Error`.
 *
 * Use inside an async `vi.mock` factory, which is hoisted above the suite's
 * consts and imports — load this module with `await import` there, and keep
 * passing arrow indirections, not the mocks themselves:
 *
 *     vi.mock("@/services/service-factory", async () => {
 *       const { withVerbFetch } = await import("@/test/verbFetch");
 *       return { httpClient: withVerbFetch({ get: (...a: unknown[]) => getMock(...a) }) };
 *     });
 */

type VerbMock = (...args: unknown[]) => unknown;

export interface VerbMocks {
  get?: VerbMock;
  post?: VerbMock;
  put?: VerbMock;
  patch?: VerbMock;
  delete?: VerbMock;
}

export function fetchViaVerbMocks(
  verbs: VerbMocks
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const key = method.toLowerCase() as keyof VerbMocks;
    const mock = verbs[key];
    if (!mock) throw new Error(`fetchViaVerbMocks: no mock for ${method} ${url}`);
    const args: unknown[] =
      method === "GET" || method === "DELETE"
        ? [url]
        : [url, typeof init.body === "string" ? JSON.parse(init.body) : undefined];
    const value = await mock(...args);
    return new Response(JSON.stringify(value === undefined ? null : value), {
      status: 200,
    });
  };
}

/** `verbs` plus a `fetch` that dispatches through them — a drop-in `httpClient` mock. */
export function withVerbFetch<V extends VerbMocks>(
  verbs: V
): V & { fetch: (url: string, init?: RequestInit) => Promise<Response> } {
  return { ...verbs, fetch: fetchViaVerbMocks(verbs) };
}

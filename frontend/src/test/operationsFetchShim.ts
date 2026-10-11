/**
 * Test shim for component tests written against `httpClient.get` / `post` /
 * `put` / `patch` / `delete` mocks, now that the typed `/operations` client
 * (`lib/api/operations/`) sends through `httpClient.fetch`.
 *
 * `withFetchShim(client)` returns `client` plus a `fetch` that routes each
 * request to the matching verb mock — `get(url)`, `delete(url)`,
 * `post|put|patch(url, parsedBody)` — and wraps the resolved value in a 200
 * `Response`. A rejected mock rejects the fetch itself, so the caller sees the
 * very `Error` the mock raised, as it did through the helpers.
 *
 * Use inside the `vi.mock` factory (hoisted), via a dynamic import:
 *
 *   vi.mock("@/services/service-factory", async () => {
 *     const { withFetchShim } = await import("@/test/operationsFetchShim");
 *     return { httpClient: withFetchShim({ get: ..., post: ... }) };
 *   });
 */

type Verb = "get" | "post" | "put" | "patch" | "delete";
type VerbMock = (...args: unknown[]) => unknown;

export function withFetchShim<T extends Partial<Record<Verb, VerbMock>>>(
  client: T
): T & {
  fetch: (
    url: string,
    init?: { method?: string; body?: string }
  ) => Promise<Response>;
} {
  return {
    ...client,
    fetch: async (
      url: string,
      init: { method?: string; body?: string } = {}
    ) => {
      const verb = (init.method ?? "GET").toLowerCase() as Verb;
      const mock = client[verb];
      if (!mock) throw new Error(`withFetchShim: no ${verb} mock for ${url}`);
      const value =
        verb === "get" || verb === "delete"
          ? await mock(url)
          : await mock(
              url,
              init.body === undefined ? undefined : JSON.parse(init.body)
            );
      return new Response(JSON.stringify(value ?? null), { status: 200 });
    },
  };
}

/**
 * Adapts per-verb mocks (`get(url)`, `post(url, body)`, …) to the
 * `httpClient.fetch(url, init)` the typed `/operations` client calls.
 *
 * A test written against `httpClient.get` / `post` / … keeps its assertions
 * and mock return values when the code under test moves onto the client: the
 * adapter turns the `fetch` call back into the verb call (body parsed from its
 * JSON string), and wraps the mock's resolved value in a 200 `Response`. A mock
 * that rejects propagates its error unchanged, exactly as the helpers' own
 * rejection did.
 */

type VerbMock = (...args: unknown[]) => unknown;

export interface VerbMocks {
  get?: VerbMock;
  post?: VerbMock;
  put?: VerbMock;
  patch?: VerbMock;
  delete?: VerbMock;
}

export function fetchFromVerbs(
  mocks: VerbMocks
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init = {}) => {
    const verb = (init.method ?? "GET").toLowerCase() as keyof VerbMocks;
    const mock = mocks[verb];
    if (!mock) throw new Error(`unexpected ${verb.toUpperCase()} ${url}`);
    const body =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const data =
      verb === "get" || verb === "delete"
        ? await mock(url)
        : await mock(url, body);
    return new Response(JSON.stringify(data ?? null), { status: 200 });
  };
}

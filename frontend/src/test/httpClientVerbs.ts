/**
 * Test helper: answer `httpClient.fetch` from per-verb mocks.
 *
 * The typed `/operations` client (`@/lib/api/operations/*`) sends every call
 * through `httpClient.fetch` (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D6 amendment) and parses the `Response` itself. Suites written when these
 * callers used `httpClient.get` / `put` pin behaviour through `getMock` /
 * `putMock`; this keeps those mocks authoritative by translating a `fetch`
 * into the verb call it replaced, and the mock's resolved value into the 2xx
 * JSON `Response` the client parses. A rejection from the mock propagates
 * unchanged, which is how those suites already model a failed read.
 *
 * Used from inside the `fetch` arrow of a `vi.mock` factory, so the static
 * import is only dereferenced at call time. The verb mock is invoked
 * synchronously, before the first `await`, so suites that count calls right
 * after an effect see them exactly when `httpClient.get` would have been
 * called.
 */

type VerbMock = (...args: unknown[]) => unknown;

export interface VerbMocks {
  get?: VerbMock;
  put?: VerbMock;
  post?: VerbMock;
}

/** The part of the init a verb helper would have received as `options`. */
function optionsOf(init: RequestInit & Record<string, unknown>) {
  const { method: _m, body: _b, idempotent: _i, ...rest } = init;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export async function fetchViaVerbs(
  url: string,
  init: (RequestInit & Record<string, unknown>) | undefined,
  verbs: VerbMocks
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const verb =
    method === "GET" ? verbs.get : method === "PUT" ? verbs.put : verbs.post;
  if (!verb) {
    throw new Error(`fetchViaVerbs: no mock for ${method} ${url}`);
  }
  const options = optionsOf(init ?? {});
  const args: unknown[] = [url];
  if (method !== "GET") {
    args.push(
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined
    );
  }
  if (options) args.push(options);
  const value = await verb(...args);
  return new Response(JSON.stringify(value ?? null), { status: 200 });
}

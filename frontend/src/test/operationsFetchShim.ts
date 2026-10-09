/**
 * Test shim for suites that mock `@/services/service-factory` with
 * `httpClient.get` / `post` fakes.
 *
 * The typed `/operations` client (`src/lib/api/operations/*`) calls
 * `httpClient.fetch` directly (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D6 amendment), so a suite that scripted the old `get` / `post` helpers adds
 * one line to its mock, `fetch: (url, init) => fetchViaGetPost(url, init, get,
 * post)`, and keeps scripting the same fakes. A GET calls `get(url, options)`
 * and a POST calls `post(url, body, options)` with the options the client
 * passed (minus `method`, `body` and `idempotent`, which the helpers never
 * received); the fake's resolved value becomes the 2xx JSON body and its
 * rejection propagates unchanged.
 */

type Fake = (...args: never[]) => unknown;

export async function fetchViaGetPost(
  url: string,
  init: RequestInit & { idempotent?: boolean } = {},
  get: Fake,
  post?: Fake
): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { method = "GET", body, idempotent, ...rest } = init;
  const options = Object.keys(rest).length > 0 ? rest : undefined;
  const call = (fn: Fake, ...args: unknown[]) =>
    (fn as (...a: unknown[]) => unknown)(...args);
  let result: unknown;
  if (method === "POST") {
    const parsed = typeof body === "string" ? JSON.parse(body) : undefined;
    result =
      options === undefined
        ? await call(post as Fake, url, parsed)
        : await call(post as Fake, url, parsed, options);
  } else {
    result =
      options === undefined
        ? await call(get, url)
        : await call(get, url, options);
  }
  return new Response(JSON.stringify(result ?? null), { status: 200 });
}

/**
 * Every route `/admin/coord/spawns` reads or writes, answered from a table a
 * test overrides — the page tests' one transport fake. Each test file mocks
 * `@/services/service-factory`'s `httpClient.fetch` onto
 * {@link answerSpawnsRequest}, so a failure arm runs through the real client,
 * the real classifiers and the hooks' real rejected-read branches. A URL the
 * table does not know throws: a read the page makes that no test answers is a
 * test that does not know what the page reads.
 */

import { DEVICE_A, DEVICE_B, ROSTER, listFx, statsFx } from "./coordSpawns";
import {
  concurrencyBody,
  defaultsBody,
  deliveryBody,
  drainBody,
  effectiveBody,
  mergeSettingsBody,
  nextStepBody,
  reposBody,
  scopeBody,
} from "./spawnPaths";

export interface Answer {
  status?: number;
  body: unknown;
}

export interface SpawnsRoutes {
  stats: (url: string) => Answer;
  list: (url: string) => Answer;
  pending: (url: string) => Answer;
  detail: (id: string) => Answer;
  fleet: () => Answer;
  roles: () => Answer;
  effective: () => Answer;
  defaults: () => Answer;
  nextStep: () => Answer;
  merge: () => Answer;
  repos: () => Answer;
  scope: (repo: string) => Answer;
  delivery: (repo: string) => Answer;
  drain: () => Answer;
  concurrency: (url: string) => Answer;
  /** `PUT /agent-registry/admin/registry/{name}`. */
  putRegistry: (name: string, body: unknown) => Answer;
  /** `PUT /operations/coord/next-step-settings`. */
  putNextStep: (body: unknown) => Answer;
  /** `PATCH /operations/pr-merge/settings`. */
  patchMerge: (body: unknown) => Answer;
}

export const ROLES_KNOWN = {
  state: "known",
  machines: [
    {
      device_id: DEVICE_A,
      name: "msi-wsl",
      role: { dispatch_role: "workhorse" },
      registration: "registered",
    },
    {
      device_id: DEVICE_B,
      name: "spaceship",
      role: { dispatch_role: "bench" },
      registration: "registered",
    },
  ],
};

/** A table where every read answers a plausible, loaded body. */
export function defaultSpawnsRoutes(): SpawnsRoutes {
  return {
    stats: () => ({ body: statsFx() }),
    list: () => ({ body: listFx([]) }),
    pending: () => ({ body: listFx([]) }),
    detail: () => ({ body: {} }),
    fleet: () => ({ body: ROSTER }),
    roles: () => ({ body: ROLES_KNOWN }),
    effective: () => ({ body: effectiveBody() }),
    defaults: () => ({ body: defaultsBody() }),
    nextStep: () => ({ body: nextStepBody() }),
    merge: () => ({ body: mergeSettingsBody() }),
    repos: () => ({ body: reposBody() }),
    scope: (repo) => ({ body: scopeBody(repo) }),
    delivery: (repo) => ({ body: deliveryBody(repo) }),
    drain: () => ({ body: drainBody(Date.now()) }),
    concurrency: () => ({ body: concurrencyBody() }),
    putRegistry: () => ({ body: {} }),
    putNextStep: () => ({ body: nextStepBody() }),
    patchMerge: () => ({ body: mergeSettingsBody() }),
  };
}

function queryParam(url: string, key: string): string {
  const q = url.split("?", 2)[1] ?? "";
  return new URLSearchParams(q).get(key) ?? "";
}

function parseBody(init?: RequestInit): unknown {
  if (typeof init?.body !== "string") return undefined;
  try {
    return JSON.parse(init.body) as unknown;
  } catch {
    return init.body;
  }
}

/**
 * The path below the `/operations` mount the typed client calls under (its
 * `OPERATIONS_BASE`), or `null` for a URL outside it — so the table routes on
 * each route's own path and never restates the client's prefix.
 */
function operationsPath(url: string): string | null {
  const mount = "/operations/";
  const at = url.indexOf(mount);
  return at < 0 ? null : url.slice(at + mount.length - 1);
}

/** Route one request through `routes`. Throws on a URL nobody answers. */
export function answerSpawnsRequest(
  routes: SpawnsRoutes,
  url: string,
  init?: RequestInit
): Response {
  const method = (init?.method ?? "GET").toUpperCase();
  const op = operationsPath(url);
  let answer: Answer;
  if (op?.startsWith("/spawns/stats")) answer = routes.stats(url);
  else if (op?.startsWith("/spawns?"))
    answer = url.includes("state=") ? routes.pending(url) : routes.list(url);
  else if (op?.startsWith("/spawns/"))
    answer = routes.detail(decodeURIComponent(url.split("/").pop() ?? ""));
  else if (op?.startsWith("/fleet/health")) answer = routes.fleet();
  else if (op?.startsWith("/fleet/dispatch-roles")) answer = routes.roles();
  else if (op?.startsWith("/fleet/drain")) answer = routes.drain();
  else if (
    url.startsWith("/api/v1/agent-registry/admin/registry/") &&
    method === "PUT"
  )
    answer = routes.putRegistry(
      decodeURIComponent(url.split("/").pop() ?? ""),
      parseBody(init)
    );
  else if (url === "/api/v1/agent-registry/admin/registry")
    answer = routes.defaults();
  else if (url === "/api/v1/agent-registry") answer = routes.effective();
  else if (op?.startsWith("/coord/next-step-settings"))
    answer =
      method === "PUT" ? routes.putNextStep(parseBody(init)) : routes.nextStep();
  else if (op?.startsWith("/pr-merge/settings"))
    answer =
      method === "PATCH" ? routes.patchMerge(parseBody(init)) : routes.merge();
  else if (op?.startsWith("/repos")) answer = routes.repos();
  else if (op?.startsWith("/post-merge-followup-scope"))
    answer = routes.scope(queryParam(url, "repo"));
  else if (op?.startsWith("/continuation-delivery-mode"))
    answer = routes.delivery(queryParam(url, "repo"));
  else if (op?.startsWith("/session-runs/concurrency"))
    answer = routes.concurrency(url);
  else throw new Error(`unexpected fetch ${method} ${url}`);
  return new Response(JSON.stringify(answer.body), {
    status: answer.status ?? 200,
  });
}

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

/** Route one request through `routes`. Throws on a URL nobody answers. */
export function answerSpawnsRequest(
  routes: SpawnsRoutes,
  url: string,
  init?: RequestInit
): Response {
  const method = (init?.method ?? "GET").toUpperCase();
  let answer: Answer;
  if (url.startsWith("/api/v1/operations/spawns/stats"))
    answer = routes.stats(url);
  else if (url.startsWith("/api/v1/operations/spawns?"))
    answer = url.includes("state=") ? routes.pending(url) : routes.list(url);
  else if (url.startsWith("/api/v1/operations/spawns/"))
    answer = routes.detail(decodeURIComponent(url.split("/").pop() ?? ""));
  else if (url.startsWith("/api/v1/operations/fleet/health"))
    answer = routes.fleet();
  else if (url.startsWith("/api/v1/operations/fleet/dispatch-roles"))
    answer = routes.roles();
  else if (url.startsWith("/api/v1/operations/fleet/drain"))
    answer = routes.drain();
  else if (url.startsWith("/api/v1/agent-registry/admin/registry/") && method === "PUT")
    answer = routes.putRegistry(
      decodeURIComponent(url.split("/").pop() ?? ""),
      parseBody(init)
    );
  else if (url === "/api/v1/agent-registry/admin/registry")
    answer = routes.defaults();
  else if (url === "/api/v1/agent-registry") answer = routes.effective();
  else if (url.startsWith("/api/v1/operations/coord/next-step-settings"))
    answer =
      method === "PUT" ? routes.putNextStep(parseBody(init)) : routes.nextStep();
  else if (url.startsWith("/api/v1/operations/pr-merge/settings"))
    answer =
      method === "PATCH" ? routes.patchMerge(parseBody(init)) : routes.merge();
  else if (url.startsWith("/api/v1/operations/repos")) answer = routes.repos();
  else if (url.startsWith("/api/v1/operations/post-merge-followup-scope"))
    answer = routes.scope(queryParam(url, "repo"));
  else if (url.startsWith("/api/v1/operations/continuation-delivery-mode"))
    answer = routes.delivery(queryParam(url, "repo"));
  else if (url.startsWith("/api/v1/operations/session-runs/concurrency"))
    answer = routes.concurrency(url);
  else throw new Error(`unexpected fetch ${method} ${url}`);
  return new Response(JSON.stringify(answer.body), {
    status: answer.status ?? 200,
  });
}

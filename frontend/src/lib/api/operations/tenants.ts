/**
 * `/operations/tenants*` and `/operations/repos` — the caller's tenants
 * ("Projects"), tenant create and rename, and the active tenant's registered
 * canonical repositories (list, register, deregister).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D5, Phase 7 batch 1). The tenant routes and the cached repo list are MOVED
 * here from `components/sessions/api.ts`; `fetchRepos` / `registerRepo` /
 * `deregisterRepo` replace the bare `fetch` calls of
 * `app/(app)/settings/repos/page.tsx`. The base is the RELATIVE
 * `OPERATIONS_BASE` (D6), and every call states its retry policy.
 *
 * Handlers mirrored (`backend/app/api/v1/endpoints/operations/__init__.py`):
 * `list_user_tenants`, `create_user_tenant`, the `PATCH /tenants/{tenant_id}`
 * rename, `list_repos`, `register_repo` and `deregister_repo`.
 *
 * Errors: the moved reads keep throwing {@link SessionsApiError}, and the two
 * tenant writes keep their typed {@link TenantCreateError} /
 * {@link TenantRenameError} (the project dialogs render from their `code` /
 * `reason`). The repo writes, which are new client functions, reject through
 * `readJson` with `<METHOD> <url> failed: <status> - <body>`.
 */

import type {
  RegisteredRepo,
  RegisteredReposResponse,
  TenantCreateRequest,
  TenantCreateResponse,
  TenantListResponse,
  TenantRenameRequest,
  TenantRenameResponse,
} from "@/components/sessions/types";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";
import { NON_IDEMPOTENT_POST_NO_RETRY_STATUSES, SessionsApiError } from "./sessions";

export async function listTenants(
  signal?: AbortSignal
): Promise<TenantListResponse> {
  const url = `${OPERATIONS_BASE}/tenants`;
  const res = await httpClient.fetch(url, { signal, idempotent: true });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as TenantListResponse;
}

/**
 * Error from `POST /api/v1/operations/tenants`, carrying enough for the
 * caller to say something TRUE about what went wrong.
 *
 * The web proxy re-raises coord's status and puts coord's raw response text
 * in FastAPI's `detail`, so the machine-readable reason survives the two
 * hops — but only if we unwrap both layers. `code` is coord's own error
 * token when one was found (`slug_taken`, `invalid_name`, …) and `null`
 * when coord answered something we cannot parse; `detail` is always the
 * most specific human-readable text we could recover, so an unrecognized
 * failure is surfaced verbatim rather than as "something went wrong".
 *
 * `cap`/`created`/`slug` are coord's STRUCTURED operands (see
 * `TenantCreateErrorFields`). Each is `undefined` when coord did not send it
 * or sent a value of the wrong type, so every renderer must have a sentence
 * that works without them — they enrich a message, they never gate one.
 */
export class TenantCreateError extends Error {
  status: number;
  code: string | null;
  detail: string;
  /** Coord's per-operator creation cap (`tenant_cap_reached`). */
  cap?: number;
  /** How many projects the operator has created (`tenant_cap_reached`). */
  created?: number;
  /** The derived slug coord rejected (`slug_taken` / `reserved_name`). */
  slug?: string;
  constructor(
    status: number,
    code: string | null,
    detail: string,
    fields: TenantCreateErrorFields = {}
  ) {
    super(detail || `POST tenants failed: ${status}`);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.cap = fields.cap;
    this.created = fields.created;
    this.slug = fields.slug;
    this.name = "TenantCreateError";
  }
}

/**
 * The structured operands coord puts NEXT TO its error token.
 *
 * Coord's bodies are not `{error, message}` pairs — they carry the numbers and
 * ids the message is about:
 *
 *     {"error":"tenant_cap_reached","cap":5,"created":5}
 *     {"error":"slug_taken","slug":"my-pizzeria"}
 *     {"error":"reserved_name","reason":"group_mapped","slug":"acme"}
 *
 * `parseTenantCreateError` used to read only `error`/`code` and
 * `message`/`detail`/`reason` and threw the rest away, so the cap message
 * could only say "you've reached the limit" — never *what* the limit is, which
 * is the one fact that makes it actionable. Every field is optional and
 * type-checked at the parse boundary: coord owns these bodies, so a missing or
 * renamed field must degrade the sentence, not break the dialog.
 */
export interface TenantCreateErrorFields {
  cap?: number;
  created?: number;
  slug?: string;
}

/**
 * Pull coord's error code + message out of the doubly-wrapped failure body.
 *
 * Two envelopes, because there are two hops:
 *   1. FastAPI's `{ "detail": <x> }` from the web proxy's `HTTPException`;
 *   2. coord's own JSON, which arrives as a STRING inside that `detail`
 *      (`_proxy_coord_post` passes `resp.text`, not `resp.json()`).
 *
 * Every layer is optional: a plain-text body, a non-JSON coord answer, or a
 * FastAPI 422 validation list all degrade to "no code, here is the text".
 * Exported for unit tests — the parsing, not the copy, is where this breaks.
 *
 * Alongside the code and the text it returns coord's structured operands
 * (`TenantCreateErrorFields`) when they are present AND of the right type, so
 * the cap message can name the cap and the collision message can name the id.
 */
export function parseTenantCreateError(rawBody: string): {
  code: string | null;
  detail: string;
} & TenantCreateErrorFields {
  const unwrapped = unwrapProxiedCoordError(rawBody);
  if (unwrapped.kind === "non_string") {
    // A FastAPI 422 validation list, or any object body. No coord code to
    // find; stringify so the operator still sees the real answer.
    return { code: null, detail: unwrapped.text };
  }

  let code: string | null = null;
  let text = unwrapped.text;
  const fields: TenantCreateErrorFields = {};
  // `inner` is null when coord answered plain text — `text` is already it.
  const obj = unwrapped.inner;
  if (obj) {
    const rawCode = obj.error ?? obj.code;
    if (typeof rawCode === "string") code = rawCode;
    const rawMessage = obj.message ?? obj.detail ?? obj.reason;
    if (typeof rawMessage === "string") text = rawMessage;
    else if (code) text = code;
    // The structured operands. Type-checked one at a time and dropped
    // individually — coord sending `cap` but not `created` (or a future
    // coord sending a string where a number was) must cost the numbers in
    // one sentence, never the whole parse.
    if (typeof obj.cap === "number" && Number.isFinite(obj.cap)) {
      fields.cap = obj.cap;
    }
    if (typeof obj.created === "number" && Number.isFinite(obj.created)) {
      fields.created = obj.created;
    }
    if (typeof obj.slug === "string" && obj.slug !== "") {
      fields.slug = obj.slug;
    }
  }
  return { code, detail: text, ...fields };
}

/**
 * The two-layer unwrap shared by every tenant write's error parser.
 *
 * Two envelopes, because there are two hops:
 *   1. the web proxy's `HTTPException`, in EITHER of its two shapes:
 *      - FastAPI's bare `{ "detail": <x> }` (what a router mounted without
 *        the app's handlers — every unit test — returns), or
 *      - the app's standardized envelope `{ "error": <STATUS_CODE_NAME>,
 *        "message": <x>, "timestamp", "path" }`, which is what production
 *        serves: `app/main.py` registers `http_exception_handler` for every
 *        route, and it moves a string `detail` into `message`. Reading only
 *        `detail` would take the envelope's generic status token for coord's
 *        code and never reach coord's body;
 *   2. coord's own JSON, which arrives as a STRING inside that layer
 *      (the proxies pass `resp.text`, not `resp.json()`).
 *
 * `kind: "non_string"` is a detail that was not a string at all (a FastAPI 422
 * validation list) — `text` is its JSON. Otherwise `text` is the detail string
 * and `inner` is coord's parsed object when that string was a JSON object.
 */
function unwrapProxiedCoordError(rawBody: string):
  | { kind: "non_string"; text: string; envelopeCode: string | null }
  | {
      kind: "string";
      text: string;
      inner: Record<string, unknown> | null;
      envelopeCode: string | null;
    } {
  let detail: unknown = rawBody;
  // The production envelope's own status token (`CONFLICT`, `BAD_GATEWAY`).
  // Kept apart from coord's code on purpose: it is a fallback label for the
  // STATUS, and reporting it as coord's code would claim coord said it.
  let envelopeCode: string | null = null;
  try {
    const outer: unknown = JSON.parse(rawBody);
    if (outer && typeof outer === "object" && "detail" in outer) {
      detail = (outer as { detail: unknown }).detail;
    } else if (outer && typeof outer === "object") {
      const envelope = outer as Record<string, unknown>;
      // The production envelope — see above. `path` is what distinguishes it
      // from coord's own `{error, message}` body arriving unwrapped.
      if (
        "error" in envelope &&
        "path" in envelope &&
        typeof envelope.message === "string"
      ) {
        detail = envelope.message;
        if (typeof envelope.error === "string" && envelope.error !== "") {
          envelopeCode = envelope.error;
        }
      }
    }
  } catch {
    // Not JSON at all — keep the raw text.
  }
  if (typeof detail !== "string") {
    return { kind: "non_string", text: JSON.stringify(detail), envelopeCode };
  }
  let inner: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed && typeof parsed === "object") {
      inner = parsed as Record<string, unknown>;
    }
  } catch {
    // coord answered plain text.
  }
  return { kind: "string", text: detail, inner, envelopeCode };
}

/**
 * Error from `PATCH /api/v1/operations/tenants/{tenant_id}`.
 *
 * `code` is coord's error token (`invalid_slug`, `reserved_name`,
 * `slug_pinned`, `slug_taken`, `tenant_mismatch`, …) or `null` when none could
 * be recovered. `reason` is coord's SECOND-level discriminator, carried
 * separately rather than folded into `detail`, because three of the rename's
 * codes mean nothing actionable without it (`invalid_slug` → which rule,
 * `reserved_name` → which list, `slug_pinned` → which pin). `detail` is the
 * most specific human-readable text recovered, for the verbatim fallback.
 */
export class TenantRenameError extends Error {
  status: number;
  code: string | null;
  reason: string | null;
  detail: string;
  /** The slug coord named, when it named one (`slug_taken`). */
  slug?: string;
  /** The production error envelope's status token (`BAD_GATEWAY`, …), when
   *  the body came through it — the fallback label when coord sent no code. */
  envelopeCode: string | null;
  constructor(
    status: number,
    code: string | null,
    reason: string | null,
    detail: string,
    slug?: string,
    envelopeCode: string | null = null
  ) {
    super(detail || `PATCH tenant failed: ${status}`);
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.detail = detail;
    this.slug = slug;
    this.envelopeCode = envelopeCode;
    this.name = "TenantRenameError";
  }
}

/**
 * Parse a rename failure body: `parseTenantCreateError`'s code/detail/slug
 * (the same two-layer unwrap), plus coord's `reason` when it sent a string
 * one. Exported for unit tests.
 */
export function parseTenantRenameError(rawBody: string): {
  code: string | null;
  reason: string | null;
  detail: string;
  slug?: string;
  envelopeCode: string | null;
} {
  const { code, detail, slug } = parseTenantCreateError(rawBody);
  const unwrapped = unwrapProxiedCoordError(rawBody);
  const rawReason =
    unwrapped.kind === "string" ? unwrapped.inner?.reason : undefined;
  const reason =
    typeof rawReason === "string" && rawReason !== "" ? rawReason : null;
  return { code, reason, detail, slug, envelopeCode: unwrapped.envelopeCode };
}

/**
 * Create a new tenant ("Project") owned by the calling operator.
 *
 * POSTs `/api/v1/operations/tenants`, which proxies coord's
 * `POST /coord/tenants` (plan
 * `2026-08-25-self-service-tenant-project-creation`). Coord creates the
 * tenant, seeds its policy row and grants the caller `admin` in it in ONE
 * transaction, so the membership is readable on the very next
 * `GET /operations/tenants`.
 *
 * **Never retried.** See `NON_IDEMPOTENT_POST_NO_RETRY_STATUSES`.
 */
export async function createTenant(
  body: TenantCreateRequest
): Promise<TenantCreateResponse> {
  const url = `${OPERATIONS_BASE}/tenants`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
    noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    const { code, detail, ...fields } = parseTenantCreateError(raw);
    throw new TenantCreateError(res.status, code, detail, fields);
  }
  return (await res.json()) as TenantCreateResponse;
}

/**
 * Rename a tenant ("Project") — its display name, its slug, or both.
 *
 * PATCHes `/api/v1/operations/tenants/{tenant_id}`, which proxies coord's
 * `PATCH /coord/tenants/:tenant_id` (plan `2026-09-17-tenant-rename`). Send
 * only the fields that changed. Coord allows it only for an `admin` of that
 * tenant; the web proxy sets the active-tenant header to the path tenant.
 *
 * **Never retried**, for the same reason as `createTenant`: a rename that
 * committed at 5.1s answers 504, and a retry is then judged against the NEW
 * slug — a no-op at best, a false failure the operator acts on at worst.
 */
export async function renameTenant(
  tenantId: string,
  body: TenantRenameRequest
): Promise<TenantRenameResponse> {
  const url = `${OPERATIONS_BASE}/tenants/${encodeURIComponent(tenantId)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    idempotent: false,
    noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
    // Longer than the default 60s ceiling, on purpose. A rename that changes
    // the slug is followed on the backend by the home-group migration, which
    // costs one Cognito write per member of the old group and is bounded by
    // its own budget. If the browser gives up first, the operator is told the
    // outcome is UNKNOWN for work the backend went on to finish and report —
    // the answer exists, we just stopped listening for it. This ceiling sits
    // above the backend's own so the report wins that race.
    timeoutMs: 120_000,
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    const { code, reason, detail, slug, envelopeCode } =
      parseTenantRenameError(raw);
    throw new TenantRenameError(
      res.status,
      code,
      reason,
      detail,
      slug,
      envelopeCode
    );
  }
  return (await res.json()) as TenantRenameResponse;
}

// ---- Registered repos (module-level cache) --------------------------------

let _repoCache: { repos: RegisteredRepo[]; fetchedAt: number } | null = null;
let _repoInflight: Promise<RegisteredRepo[]> | null = null;
const REPO_CACHE_TTL_MS = 30_000;

export async function listRegisteredRepos(
  signal?: AbortSignal
): Promise<RegisteredRepo[]> {
  if (_repoCache && Date.now() - _repoCache.fetchedAt < REPO_CACHE_TTL_MS) {
    return _repoCache.repos;
  }
  if (_repoInflight) return _repoInflight;

  _repoInflight = (async () => {
    try {
      const url = `${OPERATIONS_BASE}/repos`;
      const res = await httpClient.fetch(url, { signal, idempotent: true });
      if (!res.ok) {
        throw new SessionsApiError(
          `GET ${url} failed: ${res.status}`,
          res.status
        );
      }
      const data = (await res.json()) as RegisteredReposResponse;
      const repos = data.repos ?? [];
      _repoCache = { repos, fetchedAt: Date.now() };
      return repos;
    } finally {
      _repoInflight = null;
    }
  })();

  return _repoInflight;
}

export function registeredRepoSlugs(repos: RegisteredRepo[]): Set<string> {
  return new Set(repos.map((r) => r.repo));
}

export function findRegisteredRepo(
  repos: RegisteredRepo[],
  slug: string
): RegisteredRepo | undefined {
  return repos.find((r) => r.repo === slug);
}
/**
 * `GET /repos` — `list_repos`, UNCACHED. The repositories settings page reads
 * through this rather than {@link listRegisteredRepos}: it re-reads right
 * after its own register/deregister, which a 30s cache would hide.
 * `cache: "no-store"` is the browser-cache directive that page always sent.
 */
export async function fetchRepos(): Promise<RegisteredReposResponse> {
  const url = `${OPERATIONS_BASE}/repos`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    cache: "no-store",
    idempotent: true,
  });
  return readJson<RegisteredReposResponse>(res, `GET ${url}`);
}

/**
 * `POST /repos` — `register_repo`, proxying coord's canonical-repo register.
 * Not re-sent on a 5xx (`idempotent: false`): the register may have landed
 * behind a gateway timeout, and a repeat would answer as a conflict about the
 * operator's own successful write. The body is coord's and no caller reads
 * it, so a 2xx with no parseable body is still a success.
 */
export async function registerRepo(repo: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/repos`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    cache: "no-store",
    body: JSON.stringify({ repo }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `DELETE /repos?repo=<owner/name>` — `deregister_repo`. A `DELETE` is
 * retried on a 5xx by method: repeating a landed deregister removes nothing
 * further.
 */
export async function deregisterRepo(repo: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/repos?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    cache: "no-store",
    idempotent: true,
  });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}

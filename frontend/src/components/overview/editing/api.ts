/**
 * The overview authoring contract, client side (plan
 * `2026-09-20-overview-authoring-layer` §1). Every editable overview resource
 * is read and written through these calls; no page hand-rolls its own save.
 *
 * What the contract guarantees, and this module relies on:
 * - every record carries `id` and `version`;
 * - a write names the version it was built on (`If-Match`), and a stale one
 *   is refused with the SERVER'S copy — {@link VersionConflictError};
 * - every read carries `can_edit`, decided for the project on screen by the
 *   same rule the write enforces.
 *
 * Built on `httpClient.fetch` rather than its `get`/`patch` helpers, because
 * those flatten every failure into a message string and the conflict body is
 * the whole point of a 409 here.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

export const OVERVIEW_API = "/api/v1/overview";

/** Where a write comes from, recorded in the change log. Omitted means `api`. */
export type WriteSource = "ui" | "import";

export interface VersionedRecord {
  id: string;
  version: number;
}

export interface ResourceList<T> {
  items: T[];
  total: number;
  can_edit: boolean;
  /** The store answered but cannot see its data: an empty list is UNKNOWN. */
  degraded: string | null;
}

export interface ResourceItem<T> {
  item: T;
  can_edit: boolean;
}

export interface ResourceDescriptor {
  name: string;
  path: string;
  title: string;
  description: string;
  operations: string[];
  can_edit: boolean;
  schemas: Record<string, JsonSchema>;
}

export interface ResourceCatalog {
  tenant_id: string;
  resources: ResourceDescriptor[];
}

export interface ChangeLogEntry {
  id: string;
  resource: string;
  record_id: string;
  action: "create" | "update" | "delete";
  source: "ui" | "api" | "import";
  actor: string | null;
  created_at: string;
  version_before: number | null;
  version_after: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ChangeLogPage {
  entries: ChangeLogEntry[];
  truncated: boolean;
}

/** The subset of JSON Schema the served write schemas use. */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  pattern?: string;
  enum?: unknown[];
  title?: string;
  "x-numeric"?: { precision: number; scale: number };
  [key: string]: unknown;
}

/** Any refusal: the status, the server's `error` code and a readable line. */
export class ResourceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = "ResourceError";
  }
}

/** A write built on a version the server has moved past. Carries theirs. */
export class VersionConflictError<T> extends ResourceError {
  constructor(readonly current: T) {
    super(
      409,
      "version_conflict",
      "Somebody else saved this since you opened it."
    );
    this.name = "VersionConflictError";
  }
}

/** A plain sentence for a failed write, for a reader who is not an engineer. */
export function describeWriteFailure(err: unknown): string {
  if (err instanceof ResourceError) {
    if (err.status === 403)
      return "You can read this project's overview but not change it.";
    if (err.status === 401) return "Your session has expired. Sign in again.";
    if (err.status >= 500)
      return "The service that stores this isn't responding. Your text is kept here; try again in a few minutes.";
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

async function readError(response: Response): Promise<ResourceError> {
  const text = await response.text().catch(() => "");
  let code: string | null = null;
  let message = text || `The request failed (${response.status}).`;
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const detail = (body.detail ?? body) as unknown;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const d = detail as Record<string, unknown>;
      if (typeof d.error === "string") code = d.error;
      if (typeof d.message === "string") message = d.message;
    } else if (Array.isArray(detail)) {
      // FastAPI validation: [{loc, msg}] — name the field and say why.
      message = detail
        .map((e) => {
          const item = e as { loc?: unknown[]; msg?: string };
          const field = item.loc?.slice(1).join(".") || "value";
          return `${field}: ${item.msg ?? "invalid"}`;
        })
        .join("; ");
      code = "validation";
    } else if (typeof detail === "string") {
      message = detail;
    }
  } catch {
    // Not JSON — keep the raw text.
  }
  return new ResourceError(response.status, code, message);
}

interface SendOptions {
  body?: unknown;
  ifMatch?: number;
  idempotencyKey?: string;
  source?: WriteSource;
}

async function send(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  options: SendOptions = {}
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.ifMatch !== undefined)
    headers["If-Match"] = `"${options.ifMatch}"`;
  if (options.idempotencyKey)
    headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.source) headers["X-Overview-Source"] = options.source;
  return httpClient.fetch(`${ApiConfig.getBaseUrl()}${url}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // A create carrying an Idempotency-Key is safe to re-issue: the server
    // answers a repeat with the record the first attempt made.
    idempotent: method === "POST" && Boolean(options.idempotencyKey),
  });
}

function query(params?: Record<string, string | readonly string[]>): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of typeof value === "string" ? [value] : value)
      qs.append(key, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export async function fetchCatalog(): Promise<ResourceCatalog> {
  const response = await send("GET", `${OVERVIEW_API}/resources`);
  if (!response.ok) throw await readError(response);
  return (await response.json()) as ResourceCatalog;
}

export async function listResource<T>(
  path: string,
  params?: Record<string, string | readonly string[]>
): Promise<ResourceList<T>> {
  const response = await send("GET", `${OVERVIEW_API}/${path}${query(params)}`);
  if (!response.ok) throw await readError(response);
  return (await response.json()) as ResourceList<T>;
}

export async function getResource<T>(
  path: string,
  id: string
): Promise<ResourceItem<T>> {
  const response = await send(
    "GET",
    `${OVERVIEW_API}/${path}/${encodeURIComponent(id)}`
  );
  if (!response.ok) throw await readError(response);
  return (await response.json()) as ResourceItem<T>;
}

export async function updateResource<T>(
  path: string,
  id: string,
  patch: Record<string, unknown>,
  version: number,
  source: WriteSource = "ui"
): Promise<T> {
  const response = await send(
    "PATCH",
    `${OVERVIEW_API}/${path}/${encodeURIComponent(id)}`,
    { body: patch, ifMatch: version, source }
  );
  if (response.status === 409) {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { error?: string; current?: T };
      if (body.error === "version_conflict" && body.current) {
        throw new VersionConflictError<T>(body.current);
      }
    } catch (err) {
      if (err instanceof VersionConflictError) throw err;
    }
    throw new ResourceError(409, null, text || "Conflict");
  }
  if (!response.ok) throw await readError(response);
  return ((await response.json()) as ResourceItem<T>).item;
}

export async function createResource<T>(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  source: WriteSource = "ui"
): Promise<T> {
  const response = await send("POST", `${OVERVIEW_API}/${path}`, {
    body,
    idempotencyKey,
    source,
  });
  if (!response.ok) throw await readError(response);
  return ((await response.json()) as ResourceItem<T>).item;
}

export async function fetchChangeLog(
  resource: string,
  recordId: string,
  limit = 20
): Promise<ChangeLogPage> {
  const response = await send(
    "GET",
    `${OVERVIEW_API}/change-log${query({
      resource,
      record_id: recordId,
      limit: String(limit),
    })}`
  );
  if (!response.ok) throw await readError(response);
  return (await response.json()) as ChangeLogPage;
}

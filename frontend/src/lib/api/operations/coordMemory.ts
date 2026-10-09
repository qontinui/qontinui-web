/**
 * `/operations/memory/*` — coord's agent-memory store: the list, one memory's
 * head, one pinned version, an upsert (which writes a NEW version), a
 * tombstone delete, and a restore of an older version as the new head.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7). The handlers live in
 * `backend/app/api/v1/endpoints/operations/__init__.py` and proxy coord's
 * `/coord/memory/*`.
 *
 * Every function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * with its URL inline, states its retry policy, and returns the PARSED body
 * through `readJson`. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`.
 */

import type { CoordMemoryRow } from "@/components/admin/coord/memoryStatus";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /memory/list` — `list_memory`. */
export interface MemoryListResponse {
  /** Canonical envelope key (matches `qontinui_types::memory::MemoryListResponse`). */
  items?: CoordMemoryRow[];
  /** Pre-Phase-6 legacy aliases — coord older than 2026-05-22 returned these. */
  entries?: CoordMemoryRow[];
  memories?: CoordMemoryRow[];
  count?: number;
  limit?: number;
}

/** One row of a memory's version history. */
export interface MemoryVersionEntry {
  version: number;
  written_at?: string | null;
  written_by_agent?: string | null;
}

/** `GET /memory/{name}` — `get_memory`: the head version plus its history. */
export interface CoordMemoryDetail {
  name: string;
  content: string;
  description?: string | null;
  type?: string | null;
  version?: number | null;
  written_at?: string | null;
  written_by_agent?: string | null;
  written_by_device?: string | null;
  history?: MemoryVersionEntry[];
  tombstoned?: boolean;
}

/** `GET /memory/{name}/version/{version}` — `get_memory_version`. */
export interface CoordMemoryVersionDetail {
  name: string;
  version: number;
  content: string;
  description?: string | null;
  type?: string | null;
  written_at?: string | null;
  written_by_agent?: string | null;
  written_by_device?: string | null;
}

/** The body of `POST /memory/upsert` (`upsert_memory`). */
export interface MemoryUpsert {
  name: string;
  content: string;
  description?: string;
  type?: string;
}

/** The body of `POST /memory/{name}/restore` (`restore_memory`). */
export interface MemoryRestore {
  version: number;
}

/**
 * `GET /memory/list`. `options` carries the caller's retry budget — the
 * dashboard poll passes `COORD_DASHBOARD_POLL_OPTIONS`.
 */
export async function fetchMemoryList(
  options?: HttpOptions
): Promise<MemoryListResponse> {
  const url = `${OPERATIONS_BASE}/memory/list`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<MemoryListResponse>(res, `GET ${url}`);
}

/** `GET /memory/{name}` — the latest version of one memory. */
export async function fetchMemory(name: string): Promise<CoordMemoryDetail> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CoordMemoryDetail>(res, `GET ${url}`);
}

/** `GET /memory/{name}/version/{version}` — one pinned version. */
export async function fetchMemoryVersion(
  name: string,
  version: string
): Promise<CoordMemoryVersionDetail> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(
    name
  )}/version/${encodeURIComponent(version)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CoordMemoryVersionDetail>(res, `GET ${url}`);
}

/**
 * `POST /memory/upsert` — write a new version of a memory. Not re-sent on a
 * 5xx (`idempotent: false`): a repeat of a write that landed is a second
 * version. The body's wire key order is fixed here, not by the caller.
 */
export async function upsertMemory(memory: MemoryUpsert): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/memory/upsert`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      name: memory.name,
      content: memory.content,
      description: memory.description,
      type: memory.type,
    }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `DELETE /memory/{name}` — tombstone a memory (recoverable via restore).
 * Retried on a 5xx by method: repeating a landed tombstone changes nothing.
 */
export async function deleteMemory(name: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: true,
  });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}

/**
 * `POST /memory/{name}/restore` — copy an older version forward as the new
 * head. Not re-sent on a 5xx (`idempotent: false`): each restore is a new
 * version.
 */
export async function restoreMemoryVersion(
  name: string,
  restore: MemoryRestore
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}/restore`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ version: restore.version }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

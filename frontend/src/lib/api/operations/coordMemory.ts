/**
 * `/operations` coord-memory reads and writes: the memory list
 * (`/memory/list`), one memory (`/memory/{name}`), its upsert
 * (`/memory/upsert`) and its tombstoning delete.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline and parses through `readJson`; a
 * non-2xx rejects with `<METHOD> <url> failed: <status> - <body>`. The proxy
 * handlers are the `memory/*` routes in
 * `backend/app/api/v1/endpoints/operations/__init__.py`.
 */

import { httpClient } from "@/services/service-factory";
import type { CoordMemoryRow } from "@/components/admin/coord/memoryStatus";
import { OPERATIONS_BASE, readJson } from "./base";

export interface MemoryListResponse {
  /** Canonical envelope key (matches `qontinui_types::memory::MemoryListResponse`). */
  items?: CoordMemoryRow[];
  /** Pre-Phase-6 legacy aliases — coord older than 2026-05-22 returned these. */
  entries?: CoordMemoryRow[];
  memories?: CoordMemoryRow[];
  count?: number;
  limit?: number;
}

export interface MemoryVersionEntry {
  version: number;
  written_at?: string | null;
  written_by_agent?: string | null;
}

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

/** The body of `POST /memory/upsert`. */
export interface MemoryUpsertWrite {
  name: string;
  content: string;
  description?: string;
  type?: string;
}

/**
 * `GET /memory/list` — the memory list. A dashboard poll: one request, no
 * client retries (`maxRetries: 0`), the next tick is the retry.
 */
export async function fetchMemoryList(): Promise<MemoryListResponse> {
  const url = `${OPERATIONS_BASE}/memory/list`;
  const res = await httpClient.fetch(url, { method: "GET", maxRetries: 0 });
  return readJson<MemoryListResponse>(res, `GET ${url}`);
}

/** `GET /memory/{name}` — the latest version of one memory. */
export async function fetchMemory(name: string): Promise<CoordMemoryDetail> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<CoordMemoryDetail>(res, `GET ${url}`);
}

/** `POST /memory/upsert` — writes a new version. Not re-sent on a 5xx. */
export async function upsertMemory(write: MemoryUpsertWrite): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/memory/upsert`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(write),
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/** `DELETE /memory/{name}` — tombstones a memory (recoverable via restore). */
export async function deleteMemory(name: string): Promise<void> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "DELETE" });
  // DELETE may answer 204 No Content.
  if (res.ok && res.status === 204) return;
  await readJson<unknown>(res, `DELETE ${url}`);
}

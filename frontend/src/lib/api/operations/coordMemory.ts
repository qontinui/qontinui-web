/**
 * `/operations/memory` — coord's named-memory store: the list, one memory's
 * head (with its version history), one historical version, and the three
 * writes (upsert a new head version, tombstone, restore a version as the new
 * head).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 9). Same conventions as `coordMembers.ts`: `httpClient.fetch`
 * on the RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated,
 * and a non-2xx rejecting with `<METHOD> <url> failed: <status> - <body>` —
 * the string `httpClient.get` / `post` / `delete` threw before, so the pages'
 * `isNotFoundError` and their error lines read a rejection unchanged.
 *
 * Every handler named below lives in
 * `backend/app/api/v1/endpoints/operations/__init__.py` and proxies coord.
 *
 * The writes' results are not read by any caller, so a 2xx whose body does
 * not parse resolves `null`: the 2xx is the fact that the write landed, and
 * failing it would invite a repeat of a write that already happened.
 */

import type { CoordMemoryRow } from "@/components/admin/coord/memoryStatus";
import { isNotFoundError } from "@/components/console/readFailure";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /memory/list` body — handler `get_memory_list`. */
export interface MemoryListResponse {
  /** Canonical envelope key (matches `qontinui_types::memory::MemoryListResponse`). */
  items?: CoordMemoryRow[];
  /** Pre-Phase-6 legacy aliases — coord older than 2026-05-22 returned these. */
  entries?: CoordMemoryRow[];
  memories?: CoordMemoryRow[];
  count?: number;
  limit?: number;
}

/** One entry of `CoordMemoryDetail.history`. */
export interface MemoryVersionEntry {
  version: number;
  written_at?: string | null;
  written_by_agent?: string | null;
}

/** `GET /memory/{name}` body — handler `get_memory_entry` (the head version). */
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
}

/** `GET /memory/{name}/version/{version}` body — handler `get_memory_version`. */
export interface CoordMemoryVersionDetail {
  name: string;
  version: number;
  content: string;
  description?: string | null;
  type?: string | null;
  written_at?: string | null;
  written_by_agent?: string | null;
  written_by_device?: string | null;
  /** True on the version that retracted the name (coord's `MemoryRow.is_tombstone`). */
  is_tombstone?: boolean;
}

/** What {@link fetchMemoryVersionTrail} read: the versions, oldest first. */
export interface MemoryVersionTrail {
  versions: CoordMemoryVersionDetail[];
  /** True when the read stopped at its cap rather than at a missing version. */
  truncated: boolean;
}

/** `POST /memory/upsert` body — handler `post_memory_upsert`. */
export interface MemoryUpsertBody {
  name: string;
  content: string;
  description?: string;
  type?: string;
}

/** `GET /memory/list` (handler `get_memory_list`) — polled, so the caller's retry budget. */
export async function fetchMemoryList(
  options: HttpOptions = {}
): Promise<MemoryListResponse> {
  const url = `${OPERATIONS_BASE}/memory/list`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<MemoryListResponse>(res, `GET ${url}`);
}

/** `GET /memory/{name}` (handler `get_memory_entry`). */
export async function fetchMemoryEntry(
  name: string
): Promise<CoordMemoryDetail> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CoordMemoryDetail>(res, `GET ${url}`);
}

/**
 * `GET /memory/{name}/version/{version}` (handler `get_memory_version`).
 * `version` is the route segment as given, encoded.
 */
export async function fetchMemoryVersion(
  name: string,
  version: string
): Promise<CoordMemoryVersionDetail> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}/version/${encodeURIComponent(version)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CoordMemoryVersionDetail>(res, `GET ${url}`);
}

/**
 * Every version of a memory, read one at a time through
 * {@link fetchMemoryVersion} from v1 upward, stopping at the first 404.
 *
 * This is how the page of a DELETED memory finds its versions: coord's
 * `GET /memory/{name}` 404s once the latest version is a tombstone (plan
 * `2026-10-16-coord-memories-latest-view-crosses-tenants`), so there is no
 * history array to read, while `GET /memory/{name}/version/{n}` still serves
 * every version, the tombstone included.
 *
 * Stopping at the first 404 is sound because coord numbers a tenant's versions
 * 1, 2, 3, … with no gaps: every writer appends `MAX(version) + 1` for its own
 * tenant, and the import writes 1 (measured in production 2026-10-16: all 203
 * memories contiguous from v1).
 *
 * A 404 on v1 resolves an EMPTY trail: the name has no versions. Any other
 * failure REJECTS, so a caller can render the versions as unknown rather than
 * as none. `max` bounds the reads; reaching it resolves `truncated: true`.
 */
export async function fetchMemoryVersionTrail(
  name: string,
  max = 50
): Promise<MemoryVersionTrail> {
  const versions: CoordMemoryVersionDetail[] = [];
  for (let n = 1; n <= max; n++) {
    try {
      versions.push(await fetchMemoryVersion(name, String(n)));
    } catch (e) {
      if (isNotFoundError(e)) return { versions, truncated: false };
      throw e;
    }
  }
  return { versions, truncated: true };
}

/**
 * `POST /memory/upsert` (handler `post_memory_upsert`) — append a new head
 * version. Never re-sent on a 5xx (`idempotent: false`): each call appends a
 * version.
 */
export async function upsertMemory(body: MemoryUpsertBody): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/memory/upsert`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `DELETE /memory/{name}` (handler `delete_memory_entry`) — tombstone the
 * memory (recoverable via restore).
 *
 * Retried like any `DELETE` (a 5xx by method, RFC 9110, and the 429 arm),
 * exactly as the `httpClient.delete` this replaced was. Coord's delete is
 * idempotent: a repeat of a tombstone that already landed appends one more
 * tombstone version, publishes one more `events.coord.memory.deleted.<name>`
 * event, and answers 200 (`qontinui-coord` `crates/coord/src/memories.rs`).
 * So a retry leaves the memory in the same deleted state, at the cost of a
 * redundant version and event. That is cheaper than failing the operator's
 * click on a transient 5xx and leaving them unsure whether the delete landed.
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
 * `POST /memory/{name}/restore` (handler `post_memory_restore`) — copy a
 * historical version into a fresh head version. Never re-sent on a 5xx
 * (`idempotent: false`): each call appends a version.
 */
export async function restoreMemoryVersion(
  name: string,
  version: number
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}/restore`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ version }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

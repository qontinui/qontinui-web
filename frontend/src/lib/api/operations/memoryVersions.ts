/**
 * `/operations/memory/{name}/version/{n}` and `/memory/{name}/restore` — one
 * stored version of a coord memory entry, and the write that re-heads it.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Each function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline and parses through `readJson`.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

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

/** `GET /memory/{name}/version/{version}` — one stored version. */
export async function fetchMemoryVersion(
  name: string,
  version: string
): Promise<CoordMemoryVersionDetail> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}/version/${encodeURIComponent(version)}`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<CoordMemoryVersionDetail>(res, `GET ${url}`);
}

/** `POST /memory/{name}/restore` — copy `version` forward as the new head. */
export async function restoreMemoryVersion(
  name: string,
  version: number
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/memory/${encodeURIComponent(name)}/restore`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
  return readJson<unknown>(res, `POST ${url}`);
}

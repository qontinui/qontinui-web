/**
 * `/operations/tenant-policy/transcript-sync` — the tenant's transcript-sync
 * setting.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Wire types live in
 * `app/(app)/admin/coord/tenant-policy/types.ts`.
 */

import type {
  TranscriptSyncView,
  TranscriptSyncWriteResult,
} from "@/app/(app)/admin/coord/tenant-policy/types";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /tenant-policy/transcript-sync`. */
export async function fetchTranscriptSync(): Promise<TranscriptSyncView> {
  const url = `${OPERATIONS_BASE}/tenant-policy/transcript-sync`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<TranscriptSyncView>(res, `GET ${url}`);
}

/** `PATCH /tenant-policy/transcript-sync` — flip the setting; the result carries coord's read-back. */
export async function patchTranscriptSync(
  enabled: boolean
): Promise<TranscriptSyncWriteResult> {
  const url = `${OPERATIONS_BASE}/tenant-policy/transcript-sync`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ transcript_sync_enabled: enabled }),
  });
  return readJson<TranscriptSyncWriteResult>(res, `PATCH ${url}`);
}

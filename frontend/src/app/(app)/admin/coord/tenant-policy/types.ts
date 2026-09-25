/**
 * Wire types for the tenant transcript-sync consent proxy.
 *
 * Mirrors `TenantTranscriptSyncView` / `TenantTranscriptSyncWriteResult` in
 * `backend/app/api/v1/endpoints/operations.py`, which proxy coord's
 * `GET`/`PATCH /tenant-policy` (qontinui-coord#2480). Plan
 * `2026-09-22-transcript-sync-default-on-with-tenant-and-user-controls` §3.6.
 */

export interface TranscriptSyncView {
  /**
   * `null` — coord's answer carried no such field (a coord predating the
   * gate). UNKNOWN, never "on": a coord that cannot report it does not enforce
   * it either.
   */
  transcript_sync_enabled: boolean | null;
  /**
   * `true` — coord read `false` only because the column is not provisioned
   * yet (fail closed during the deploy window), not because an admin chose it.
   */
  column_missing: boolean;
  /** Effective-tenant admin (or superuser). UI gating only; coord re-checks. */
  can_edit: boolean;
}

export interface TranscriptSyncWriteResult {
  written: boolean;
  /** Coord's own post-write re-read. `null` + `readback_error` = UNKNOWN. */
  effective: TranscriptSyncView | null;
  readback_error: string | null;
}

export const TRANSCRIPT_SYNC_API =
  "/api/v1/operations/tenant-policy/transcript-sync";

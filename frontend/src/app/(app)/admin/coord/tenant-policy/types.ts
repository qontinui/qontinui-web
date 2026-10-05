/**
 * Wire types for the tenant-policy page: the transcript-sync consent proxy,
 * and (at the bottom) the command-safety rewrite fleet-policy domain, whose
 * wire shape is the shared `_shared/fleetPolicy.ts` one.
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

// ──────────────────────── command-safety rewrite dial ────────────────────────

/**
 * The fleet-policy domain the command-safety rewrite toggle writes. Levels:
 * `on` | `off`; coord's no-row default is `on`.
 *
 * When `on`, a runner adds a `PreToolUse` `Bash` hook to the settings carrier
 * it hands each Claude Code session, so a command Claude Code's built-in
 * safety check would stop on is denied with rewrite instructions instead of
 * prompting. The runner decides this at spawn, so a change reaches only
 * terminals and agent sessions started after it. Plan
 * `2026-10-03-runner-sessions-stop-on-builtin-command-safety-prompts` D5/D6.
 */
export const COMMAND_SAFETY_REWRITE_DOMAIN = "command_safety_rewrite";

export const COMMAND_SAFETY_REWRITE_LEVELS = ["on", "off"] as const;
export type CommandSafetyRewriteLevel =
  (typeof COMMAND_SAFETY_REWRITE_LEVELS)[number];

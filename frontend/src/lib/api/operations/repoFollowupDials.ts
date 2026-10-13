/**
 * Per-repo follow-up dial routes: `/post-merge-followup-scope` and
 * `/continuation-delivery-mode`, each proxied by
 * `backend/app/api/v1/endpoints/repo_followup_dials.py`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 5). Same conventions as `repos.ts`: `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated, and a
 * non-2xx rejecting with `<METHOD> <url> failed: <status> - <body>` — what the
 * `httpClient.get` / `put` helpers these calls used to go through threw, so
 * `readErrorText` and `isNotFoundError` read a rejection exactly as before.
 *
 * The wire types moved here from
 * `admin/coord/agent-registry/_lib/repoFollowupStatus.ts`, which keeps the
 * display vocabulary and every pure derivation.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

export type FollowupScope = "all" | "code_only" | "none";

export type RolloutMode = "shadow" | "enforce" | "off";

export type DeliveryMode =
  | "in_session_with_spawn_fallback"
  | "spawn_always"
  | "notify_only";

/** Mirrors `PostMergeFollowupScopeView` (`get_post_merge_followup_scope`). */
export interface PostMergeFollowupScopeView {
  repo: string;
  scope: FollowupScope;
  code_paths: string[];
  /** `null` — coord did not say: UNKNOWN, neither "repo" nor "default". */
  resolved_scope: "repo" | "default" | null;
  /** `null` — coord did not say: UNKNOWN, not any of the three. */
  mode: RolloutMode | null;
  can_edit: boolean;
}

/** Mirrors `PostMergeFollowupScopeWriteResult` (`put_post_merge_followup_scope`). */
export interface PostMergeFollowupScopeWriteResult {
  ok: boolean;
  repo: string;
  written_scope: FollowupScope;
  stored_code_paths: string[] | null;
  updated_by: string | null;
  /** A SECOND, fresh read. `null` + `readback_error` = UNKNOWN. */
  effective: PostMergeFollowupScopeView | null;
  readback_error: string | null;
}

/** The `put_post_merge_followup_scope` request body. */
export interface PostMergeFollowupScopeWrite {
  repo: string;
  scope: FollowupScope;
  code_paths?: string[];
}

/** Mirrors `ContinuationDeliveryModeView` (`get_continuation_delivery_mode`). */
export interface ContinuationDeliveryModeView {
  repo: string;
  mode: DeliveryMode;
  /** Always `false` today — coord's read is fail-open. */
  provenance_known: boolean;
  can_edit: boolean;
}

/** Mirrors `ContinuationDeliveryModeWriteResult` (`put_continuation_delivery_mode`). */
export interface ContinuationDeliveryModeWriteResult {
  ok: boolean;
  repo: string;
  written_mode: DeliveryMode;
  effective: ContinuationDeliveryModeView | null;
  readback_error: string | null;
}

/** `GET /post-merge-followup-scope?repo=` (`get_post_merge_followup_scope`). */
export async function fetchPostMergeFollowupScope(
  repo: string
): Promise<PostMergeFollowupScopeView> {
  const url = `${OPERATIONS_BASE}/post-merge-followup-scope?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PostMergeFollowupScopeView>(res, `GET ${url}`);
}

/**
 * `PUT /post-merge-followup-scope` (`put_post_merge_followup_scope`). Declared
 * `idempotent: false` (a write); the client's method rule still treats a PUT
 * as retryable, exactly as the `httpClient.put` this replaced did.
 */
export async function putPostMergeFollowupScope(
  write: PostMergeFollowupScopeWrite
): Promise<PostMergeFollowupScopeWriteResult> {
  const url = `${OPERATIONS_BASE}/post-merge-followup-scope`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(write),
    idempotent: false,
  });
  return readJson<PostMergeFollowupScopeWriteResult>(res, `PUT ${url}`);
}

/** `GET /continuation-delivery-mode?repo=` (`get_continuation_delivery_mode`). */
export async function fetchContinuationDeliveryMode(
  repo: string
): Promise<ContinuationDeliveryModeView> {
  const url = `${OPERATIONS_BASE}/continuation-delivery-mode?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ContinuationDeliveryModeView>(res, `GET ${url}`);
}

/**
 * `PUT /continuation-delivery-mode` (`put_continuation_delivery_mode`).
 * `idempotent: false` is a no-op: the client's method rule still retries a
 * PUT on a 5xx, exactly as the `httpClient.put` this replaced did.
 */
export async function putContinuationDeliveryMode(
  repo: string,
  mode: DeliveryMode
): Promise<ContinuationDeliveryModeWriteResult> {
  const url = `${OPERATIONS_BASE}/continuation-delivery-mode`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify({ repo, mode }),
    idempotent: false,
  });
  return readJson<ContinuationDeliveryModeWriteResult>(res, `PUT ${url}`);
}

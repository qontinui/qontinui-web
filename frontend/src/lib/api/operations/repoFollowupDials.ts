/**
 * `/operations` per-repo follow-up dials: the post-merge follow-up scope and
 * the continuation-delivery mode (a `?repo=` read and a PUT each).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline and returns the PARSED body through
 * `readJson`; a non-2xx rejects with `<METHOD> <url> failed: <status> - <body>`.
 * The view/write types live with the panel's status model in
 * `agent-registry/_lib/repoFollowupStatus.ts`.
 */

import { httpClient } from "@/services/service-factory";
import type {
  ContinuationDeliveryModeView,
  ContinuationDeliveryModeWriteResult,
  DeliveryMode,
  FollowupScope,
  PostMergeFollowupScopeView,
  PostMergeFollowupScopeWriteResult,
} from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /post-merge-followup-scope?repo=`. */
export async function fetchPostMergeFollowupScope(
  repo: string
): Promise<PostMergeFollowupScopeView> {
  const url = `${OPERATIONS_BASE}/post-merge-followup-scope?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<PostMergeFollowupScopeView>(res, `GET ${url}`);
}

/** `PUT /post-merge-followup-scope`. */
export async function putPostMergeFollowupScope(body: {
  repo: string;
  scope: FollowupScope;
  code_paths?: string[];
}): Promise<PostMergeFollowupScopeWriteResult> {
  const url = `${OPERATIONS_BASE}/post-merge-followup-scope`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return readJson<PostMergeFollowupScopeWriteResult>(res, `PUT ${url}`);
}

/** `GET /continuation-delivery-mode?repo=`. */
export async function fetchContinuationDeliveryMode(
  repo: string
): Promise<ContinuationDeliveryModeView> {
  const url = `${OPERATIONS_BASE}/continuation-delivery-mode?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<ContinuationDeliveryModeView>(res, `GET ${url}`);
}

/** `PUT /continuation-delivery-mode`. */
export async function putContinuationDeliveryMode(body: {
  repo: string;
  mode: DeliveryMode;
}): Promise<ContinuationDeliveryModeWriteResult> {
  const url = `${OPERATIONS_BASE}/continuation-delivery-mode`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return readJson<ContinuationDeliveryModeWriteResult>(res, `PUT ${url}`);
}

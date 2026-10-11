/**
 * `/operations/merge/queue` and the `/operations/pr-merge/*` reads and actions
 * behind the merge pipeline board, the stuck-PR recovery panel, the dependency
 * graph, a PR's check details and the draft-state control.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7; the settings and kill-switch writes live in
 * `prMerge.ts`). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` (same-origin, D6) with its URL inline and states its retry
 * policy.
 *
 * Every function returns the raw `Response`. The callers read the status as a
 * fact of its own — a 404 from a coord a deploy behind is authoritative
 * emptiness, a non-2xx keeps the last known rows, an action's refusal body
 * words the toast — so folding them into one thrown error would lose it.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE } from "./base";

/** `GET /merge/queue` — the merge-train queue. A poll: no client retries. */
export function fetchMergeQueue(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/merge/queue`, {
    method: "GET",
    maxRetries: 0,
  });
}

/**
 * `GET /pr-merge/prs?merged_count_hours=<h>` — the open-PR list plus coord's
 * cheap merged COUNT over the window. The hot poll: no client retries.
 */
export function fetchPrMergePrsWithMergedCount(
  hours: number
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/prs?merged_count_hours=${hours}`,
    { method: "GET", maxRetries: 0 }
  );
}

/**
 * `GET /pr-merge/prs?include_merged=<h>` — the PR list WITH recently-merged
 * rows, an order of magnitude more expensive server-side. No client retry:
 * each attempt is a full coord query, and the next poll is the retry.
 */
export function fetchPrMergePrsIncludingMerged(
  hours: number
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/prs?include_merged=${hours}`,
    { method: "GET", maxRetries: 0 }
  );
}

/** `GET /pr-merge/prs` — the plain PR list, the stuck-PR panel's second read. A poll: no client retries. */
export function fetchPrMergePrList(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/prs`, {
    method: "GET",
    maxRetries: 0,
  });
}

/** `GET /pr-merge/suggestions` — coord's actionable merge suggestions. A poll: no client retries. */
export function fetchPrMergeSuggestions(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/suggestions`, {
    method: "GET",
    maxRetries: 0,
  });
}

/** `GET /pr-merge/blast-radius-blocks` — PRs held by the blast-radius gate. A poll: no client retries. */
export function fetchBlastRadiusBlocks(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/blast-radius-blocks`, {
    method: "GET",
    maxRetries: 0,
  });
}

/**
 * `POST /pr-merge/suggestions/{alert_id}/{action}` — accept, reject or mute
 * one suggestion. Default retry policy, as before the move onto the client.
 */
export function postSuggestionAction(
  alertId: number,
  action: "accept" | "reject" | "mute",
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/suggestions/${alertId}/${action}`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** `GET /pr-merge/health` — the merge train's health. Default retry policy. */
export function fetchPrMergeHealth(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/health`);
}

/**
 * `GET /pr-merge/prs/{repo}/{pr}/checks` — one PR's per-check state. The repo
 * (`owner/name`) is one percent-encoded path segment. A one-shot read on
 * expanding a row, so default retry policy.
 */
export function fetchPrChecks(
  repo: string,
  prNumber: number
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/prs/${encodeURIComponent(repo)}/${prNumber}/checks`
  );
}

/**
 * `GET /pr-merge/graph?<query>` — the dependency component of one PR. `query`
 * is the already-encoded `repo=…&pr=…`. Default retry policy.
 */
export function fetchPrMergeGraph(query: string): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/graph?${query}`);
}

/**
 * `GET /pr-merge/{repo}/stuck-nudges` — coord's "your PR is stuck" nudges for
 * a repo. `repo` is `owner/name`, inlined as two path segments (the backend
 * captures it as `{repo:path}`). A poll: no client retries.
 */
export function fetchStuckNudges(repo: string): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/${repo}/stuck-nudges`, {
    method: "GET",
    maxRetries: 0,
  });
}

/**
 * `GET /pr-merge/verdict/{owner}/{name}/{pr}` — coord's merge verdict for one
 * PR (the card needs `proposal.proposal_id`). A poll: no client retries.
 */
export function fetchPrMergeVerdict(
  owner: string,
  name: string,
  prNumber: number
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/verdict/${encodeURIComponent(
      owner
    )}/${encodeURIComponent(name)}/${prNumber}`,
    { method: "GET", maxRetries: 0 }
  );
}

/**
 * `POST /pr-merge/proposals/{id}/cancel` — cancel a merge proposal. Body
 * `{reason?, unblock}`; the two `unblock` values are different actions
 * (stop versus clear-the-block-and-re-enqueue).
 */
export function postProposalCancel(
  proposalId: string,
  body: { unblock: boolean; reason: string }
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/proposals/${encodeURIComponent(proposalId)}/cancel`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** `POST /pr-merge/prs/{owner}/{name}/{pr}/reevaluate` — re-run coord's merge decision. No body. */
export function postPrReevaluate(
  owner: string,
  name: string,
  prNumber: number
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/prs/${encodeURIComponent(
      owner
    )}/${encodeURIComponent(name)}/${prNumber}/reevaluate`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

/**
 * `POST /prs/{owner}/{repo}/{number}/draft-state` — set a PR's GitHub draft
 * state (`{draft: false}` releases it to the merge train, `{draft: true}` is
 * the documented hold).
 */
export function postPrDraftState(
  owner: string,
  repo: string,
  number: number,
  draft: boolean
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/prs/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/${number}/draft-state`,
    { method: "POST", body: JSON.stringify({ draft }) }
  );
}

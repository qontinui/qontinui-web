/**
 * The design reference library's intake client — `/api/v1/design-refs/capture-jobs*`.
 *
 * Plan `2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query`
 * Phase 1b-i (Add and Jobs views). The wire types are the generated ones
 * (`lib/api-client/generated-types.ts`), so a backend shape change is a type
 * error here, not a silent drift. Conventions are `taste.ts`'s: every call is a
 * RELATIVE URL written inline through `httpClient.fetch`, and a non-2xx rejects
 * with a `BackendError` the page renders with `BackendErrorMessage`.
 *
 * The tier is never sent: it is derived by the worker's pre-check and READ back
 * on the job (`derived_tier`, `tier_reason`); the backend never derives one.
 */

import type { components } from "@/lib/api-client/generated-types";
import { backendError } from "@/lib/errors/backend-error-message";
import { httpClient } from "@/services/service-factory";

type Schemas = components["schemas"];
export type CaptureJob = Schemas["CaptureJobOut"];
export type CaptureJobState = CaptureJob["state"];
export type CaptureJobBatchCreate = Schemas["CaptureJobBatchCreate"];
export type CaptureJobBatchResult = Schemas["CaptureJobBatchOut"];
export type CaptureJobBrowser = CaptureJob["browser"];

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await backendError(res);
  return (await res.json()) as T;
}

/** The newest jobs first; `state` narrows to one lifecycle state. */
export async function fetchCaptureJobs(
  options: { state?: CaptureJobState; limit?: number } = {}
): Promise<CaptureJob[]> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 200) });
  if (options.state) query.set("state", options.state);
  const res = await httpClient.fetch(
    `/api/v1/design-refs/capture-jobs?${query}`,
    { method: "GET" }
  );
  return readJson<CaptureJob[]>(res);
}

/** One job per URL of a pasted list. A refused URL is reported, not thrown. */
export async function createCaptureJobs(
  body: CaptureJobBatchCreate
): Promise<CaptureJobBatchResult> {
  const res = await httpClient.fetch("/api/v1/design-refs/capture-jobs/batch", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readJson<CaptureJobBatchResult>(res);
}

/** Re-queue a failed job (operator only), optionally as `attached`. */
export async function retryCaptureJob(
  jobId: string,
  browser?: CaptureJobBrowser
): Promise<CaptureJob> {
  const res = await httpClient.fetch(
    `/api/v1/design-refs/capture-jobs/${jobId}/retry`,
    { method: "POST", body: JSON.stringify(browser ? { browser } : {}) }
  );
  return readJson<CaptureJob>(res);
}

/** Approve (`queued`) or reject a discovery proposal, or cancel a waiting job. */
export async function moveCaptureJob(
  jobId: string,
  state: "queued" | "rejected" | "cancelled"
): Promise<CaptureJob> {
  const res = await httpClient.fetch(
    `/api/v1/design-refs/capture-jobs/${jobId}`,
    { method: "PATCH", body: JSON.stringify({ state }) }
  );
  return readJson<CaptureJob>(res);
}

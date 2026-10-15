/**
 * The taste inbox's client — `/api/v1/taste/*` plus the two image-store calls
 * the inbox makes (an image's bytes, an operator's reference upload).
 *
 * Plan `2026-10-13-image-generation-and-visual-judgment` Phase 23. The wire
 * types are the generated ones (`lib/api-client/generated-types.ts`, from the
 * backend's OpenAPI snapshot), so a backend shape change is a type error here,
 * not a silent drift.
 *
 * Conventions are the `/operations` client's (`operations/base.ts`): every
 * call goes through `httpClient.fetch` on a RELATIVE URL written inline (so
 * `route-walker.test.ts` checks each one against the snapshot), and a non-2xx
 * rejects with a {@link BackendError} — its `status` is what the page branches
 * on (a 409 is "someone else answered first", re-read), and its reading is
 * what `BackendErrorMessage` renders.
 */

import type { components } from "@/lib/api-client/generated-types";
import { backendError } from "@/lib/errors/backend-error-message";
import { httpClient } from "@/services/service-factory";

export const TASTE_BASE = "/api/v1/taste";
export const IMAGE_ASSETS_BASE = "/api/v1/image-assets";

type Schemas = components["schemas"];
export type TasteInbox = Schemas["TasteInbox"];
export type TastePair = Schemas["TastePairOut"];
export type TasteImage = Schemas["TasteImage"];
export type TasteBudget = Schemas["TasteBudget"];
export type TastePool = Schemas["TastePool"];
export type TasteLabelWrite = Schemas["TasteLabelWrite"];
export type TasteLabel = TasteLabelWrite["choice"];
export type TasteReason = Schemas["TasteInbox"]["reason_vocabulary"][number];
export type TasteSource = TastePair["source"];
export type CalibrationBatchResult = Schemas["CalibrationBatchResult"];
export type TasteSettingsOut = Schemas["TasteSettingsOut"];
export type ImageAssetUploadResponse = Schemas["ImageAssetUploadResponse"];

async function readTasteJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await backendError(res);
  return (await res.json()) as T;
}

/** The inbox page's one read. `overBudget` asks for the queue head even when
 *  this week's budget is spent. */
export async function fetchTasteInbox(options: {
  limit: number;
  overBudget: boolean;
}): Promise<TasteInbox> {
  const query = new URLSearchParams({
    limit: String(options.limit),
    over_budget: String(options.overBudget),
  });
  const res = await httpClient.fetch(`${TASTE_BASE}/inbox?${query}`, {
    method: "GET",
  });
  return readTasteJson<TasteInbox>(res);
}

export async function labelTastePair(
  pairId: string,
  body: TasteLabelWrite
): Promise<TastePair> {
  const res = await httpClient.fetch(`${TASTE_BASE}/pairs/${pairId}/label`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return readTasteJson<TastePair>(res);
}

export async function undoTasteLabel(pairId: string): Promise<TastePair> {
  const res = await httpClient.fetch(`${TASTE_BASE}/pairs/${pairId}/label`, {
    method: "DELETE",
  });
  return readTasteJson<TastePair>(res);
}

export async function skipTastePair(pairId: string): Promise<TastePair> {
  const res = await httpClient.fetch(`${TASTE_BASE}/pairs/${pairId}/skip`, {
    method: "POST",
  });
  return readTasteJson<TastePair>(res);
}

export async function buildCalibrationBatch(
  size: number
): Promise<CalibrationBatchResult> {
  const res = await httpClient.fetch(`${TASTE_BASE}/calibration-batch`, {
    method: "POST",
    body: JSON.stringify({ size }),
  });
  return readTasteJson<CalibrationBatchResult>(res);
}

export async function writeTasteBudget(
  weeklyBudget: number
): Promise<TasteSettingsOut> {
  const res = await httpClient.fetch(`${TASTE_BASE}/settings`, {
    method: "PUT",
    body: JSON.stringify({ weekly_budget: weeklyBudget }),
  });
  return readTasteJson<TasteSettingsOut>(res);
}

/**
 * Upload one of the operator's own reference images (step 3's upload slot).
 * It enters the store as an `exemplar` — so a calibration batch compares it
 * against every generated direction — with the operator named as its source.
 */
export async function uploadReferenceImage(
  file: File
): Promise<ImageAssetUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", "exemplar");
  form.append(
    "provenance",
    JSON.stringify({ source: "operator_reference", filename: file.name })
  );
  const res = await httpClient.fetch(IMAGE_ASSETS_BASE, {
    method: "POST",
    body: form,
  });
  return readTasteJson<ImageAssetUploadResponse>(res);
}

/** One stored image's bytes, through the tenant-checked content route. */
export async function fetchImageBlob(sha256: string): Promise<Blob> {
  const res = await httpClient.fetch(`${IMAGE_ASSETS_BASE}/${sha256}/content`, {
    method: "GET",
  });
  if (!res.ok) throw await backendError(res);
  return res.blob();
}

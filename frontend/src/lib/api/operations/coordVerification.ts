/**
 * `/operations/coord/verification/metrics` — coord's independent post-land
 * verification metrics, read by the overview's "Can I trust 'done'?" tile and
 * the `/admin/coord/verification` drill-down.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`).
 * Same conventions as `coordFindings.ts`: `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting with
 * `GET <url> failed: <status> - <body>`.
 *
 * Handler: `get_coord_verification_metrics` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`. Resolves `unknown`:
 * the shape is parsed by `parseVerificationMetrics`, which treats anything it
 * does not recognise as "could not look".
 *
 * `/operations/coord/verification/labels` — the operator's one-click label
 * on a sampled verdict (handler `post_coord_verification_label`; plan
 * `2026-10-11-reverify-verdicts-are-source-bound-tree-checked-and-judge-agreement-is-measured`,
 * Phase 4). Unlike the read above it never rejects: each of the door's
 * answers is a distinct {@link OperatorLabelResult}.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /coord/verification/metrics?window=…` — one metrics answer. */
export async function fetchVerificationMetrics(
  window: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/verification/metrics?window=${encodeURIComponent(window)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/** The operator's answer to "Did this hold up?" (Yes · No · Can't tell). */
export type OperatorLabelTruth = "holds" | "fails" | "cannot_tell";

/** coord's `201` body for a recorded judge case. */
export interface OperatorLabelRecord {
  id: string;
  label_source: "operator";
  verification_id: string;
  seed_class: null;
  truth: OperatorLabelTruth;
  verifier_verdict: "survived" | "refuted" | "unverifiable";
  labelled_by: string;
  created_at: string;
}

/**
 * Every answer the label door can give, each rendered differently:
 *
 * - `recorded` — `201`, the row coord wrote (the read-back);
 * - `already_labelled` — `409 duplicate_label`: this verdict carries an
 *   operator label already (`existingId` is that row);
 * - `refused` — `403`, e.g. `operator_principal_required`;
 * - `not_found` — `404`: `verification_not_found`, or no `code` at all when
 *   the door itself is not deployed;
 * - `failed` — anything else, including no answer (`status: null`). A
 *   timed-out write may still have landed; its `message` says so.
 */
export type OperatorLabelResult =
  | { kind: "recorded"; record: OperatorLabelRecord }
  | { kind: "already_labelled"; existingId: string | null }
  | { kind: "refused"; code: string | null; message: string }
  | { kind: "not_found"; code: string | null; message: string }
  | { kind: "failed"; status: number | null; message: string };

function errorFields(body: unknown): { code: string | null; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { code: null, message: "" };
  }
  const b = body as Record<string, unknown>;
  // coord's refusal is `{error, message}`; the web backend's own is
  // `{detail}` (or the refusal envelope's `message`).
  const code =
    typeof b.error === "string"
      ? b.error
      : typeof b.code === "string"
        ? b.code
        : null;
  const message =
    typeof b.message === "string"
      ? b.message
      : typeof b.detail === "string"
        ? b.detail
        : "";
  return { code, message };
}

/**
 * `POST /coord/verification/labels` — record the operator's label on one
 * verdict. Only `{label_source: "operator", verification_id, truth}` is sent;
 * the web proxy (`post_coord_verification_label`) forwards it with the
 * operator's own bearer, and coord derives the labeller and tenant from it.
 * Never rejects: every outcome is an {@link OperatorLabelResult}.
 */
export async function recordOperatorLabel(
  verificationId: string,
  truth: OperatorLabelTruth
): Promise<OperatorLabelResult> {
  const url = `${OPERATIONS_BASE}/coord/verification/labels`;
  let res: Response;
  try {
    res = await httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify({
        label_source: "operator",
        verification_id: verificationId,
        truth,
      }),
      idempotent: false,
    });
  } catch (err) {
    return {
      kind: "failed",
      status: null,
      message: `no answer from the label door (${err instanceof Error ? err.message : String(err)}) — it may or may not have been recorded`,
    };
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const { code, message } = errorFields(body);
  const said = message || text || `HTTP ${res.status}`;
  if (res.status === 201) {
    const b = body as Partial<OperatorLabelRecord> | null;
    if (b && typeof b.id === "string" && b.truth) {
      return { kind: "recorded", record: b as OperatorLabelRecord };
    }
    return {
      kind: "failed",
      status: 201,
      message:
        "coord answered 201 without a readable record — re-read before labelling again",
    };
  }
  if (res.status === 409 && code === "duplicate_label") {
    const id = (body as { id?: unknown } | null)?.id;
    return {
      kind: "already_labelled",
      existingId: typeof id === "string" ? id : null,
    };
  }
  if (res.status === 403) return { kind: "refused", code, message: said };
  if (res.status === 404) return { kind: "not_found", code, message: said };
  return { kind: "failed", status: res.status, message: said };
}

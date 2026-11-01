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
 * `/operations/coord/verification/label-sample` and
 * `/operations/coord/verification/labels` — the operator's one-click label on
 * this week's sampled verdicts (handlers `get_coord_verification_label_sample`
 * and `post_coord_verification_label`; plan
 * `2026-10-11-reverify-verdicts-are-source-bound-tree-checked-and-judge-agreement-is-measured`,
 * Phase 4). Unlike the metrics read, neither rejects: each answer is a
 * distinct {@link LabelSampleAnswer} / {@link OperatorLabelResult}.
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

/** A verifier verdict, as coord names it. */
export type VerifierVerdict = "survived" | "refuted" | "unverifiable";

const TRUTHS: readonly string[] = ["holds", "fails", "cannot_tell"];
const VERDICTS: readonly string[] = ["survived", "refuted", "unverifiable"];

export function isOperatorLabelTruth(v: unknown): v is OperatorLabelTruth {
  return typeof v === "string" && TRUTHS.includes(v);
}

export function isVerifierVerdict(v: unknown): v is VerifierVerdict {
  return typeof v === "string" && VERDICTS.includes(v);
}

/** coord's `201` body for a recorded judge case. */
export interface OperatorLabelRecord {
  id: string;
  label_source: "operator";
  verification_id: string;
  seed_class: null;
  truth: OperatorLabelTruth;
  verifier_verdict: VerifierVerdict;
  labelled_by: string;
  created_at: string;
}

/**
 * Every answer the label door can give, each rendered differently:
 *
 * - `recorded` — `201` whose body is the row this request asked for (its
 *   `verification_id`, a known `truth` and `verifier_verdict`);
 * - `already_labelled` — `409 duplicate_label`: this verdict carries an
 *   operator label already (`existingId` is that row);
 * - `refused` — `403`, e.g. `operator_principal_required`;
 * - `not_found` — `404`: `verification_not_found`, or no `code` at all when
 *   the door itself is not deployed;
 * - `rejected` — definitely NOT recorded: any other `4xx` (a `422`, a `409`
 *   that is not `duplicate_label`), or one of the web backend's OWN `502`s
 *   that says coord never took the write (`coord_unreachable`: coord was never
 *   reached; `coord_verification_label_credential_refused`: coord refused the
 *   bearer). "Own" is the {@link REFUSAL_ORIGIN_HEADER} header, which only the
 *   web's exception handler sets: a coord `502` passed through with the same
 *   discriminator is `unknown`;
 * - `unknown` — not known either way: no answer (`status: null`), a `504`,
 *   any other `5xx`, or a `201` whose body is not the requested row. Only
 *   this one is worth answering again.
 */
export type OperatorLabelResult =
  | { kind: "recorded"; record: OperatorLabelRecord }
  | { kind: "already_labelled"; existingId: string | null }
  | { kind: "refused"; code: string | null; message: string }
  | { kind: "not_found"; code: string | null; message: string }
  | { kind: "rejected"; status: number; code: string | null; message: string }
  | { kind: "unknown"; status: number | null; message: string };

/**
 * The web backend's own `502` discriminators that mean coord did not take the
 * write — a connect error, or coord refusing the operator's bearer.
 */
const NOT_TAKEN_DISCRIMINATORS: readonly string[] = [
  "coord_unreachable",
  "coord_verification_label_credential_refused",
];

/**
 * Set (to {@link REFUSAL_ORIGIN_WEB}) by the web backend's exception handler on
 * every refusal it raised itself (`app/core/refusal.py`), and never echoed from
 * a proxied coord response.
 */
export const REFUSAL_ORIGIN_HEADER = "X-Qontinui-Refusal-Origin";
export const REFUSAL_ORIGIN_WEB = "web";

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function errorFields(body: unknown): { code: string | null; message: string } {
  const b = asRecord(body);
  if (!b) return { code: null, message: "" };
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

/** The web refusal envelope's `refusal.discriminator`, when it has one. */
function refusalDiscriminator(body: unknown): string | null {
  const refusal = asRecord(asRecord(body)?.refusal);
  return typeof refusal?.discriminator === "string"
    ? refusal.discriminator
    : null;
}

/** The `201` body, when it is the row requested for `verificationId`. */
function recordFor(
  body: unknown,
  verificationId: string
): OperatorLabelRecord | null {
  const b = asRecord(body);
  if (
    !b ||
    typeof b.id !== "string" ||
    typeof b.verification_id !== "string" ||
    b.verification_id.toLowerCase() !== verificationId.toLowerCase() ||
    !isOperatorLabelTruth(b.truth) ||
    !isVerifierVerdict(b.verifier_verdict)
  ) {
    return null;
  }
  return b as unknown as OperatorLabelRecord;
}

async function readBody(
  res: Response
): Promise<{ text: string; body: unknown }> {
  const text = await res.text().catch(() => "");
  try {
    return { text, body: text ? JSON.parse(text) : null };
  } catch {
    return { text, body: null };
  }
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
      kind: "unknown",
      status: null,
      message: `no answer from the label door (${err instanceof Error ? err.message : String(err)}) — it may or may not have been recorded`,
    };
  }
  const { text, body } = await readBody(res);
  const { code, message } = errorFields(body);
  const said = message || text || `HTTP ${res.status}`;
  if (res.status === 201) {
    const record = recordFor(body, verificationId);
    if (record) return { kind: "recorded", record };
    return {
      kind: "unknown",
      status: 201,
      message:
        "coord answered 201 but not with the row this label asked for — re-read before labelling again",
    };
  }
  if (res.status === 409 && code === "duplicate_label") {
    const id = asRecord(body)?.id;
    return {
      kind: "already_labelled",
      existingId: typeof id === "string" ? id : null,
    };
  }
  if (res.status === 403) return { kind: "refused", code, message: said };
  if (res.status === 404) return { kind: "not_found", code, message: said };
  const discriminator = refusalDiscriminator(body);
  const raisedByWeb =
    res.headers.get(REFUSAL_ORIGIN_HEADER) === REFUSAL_ORIGIN_WEB;
  if (
    (res.status >= 400 && res.status < 500) ||
    (res.status === 502 &&
      raisedByWeb &&
      discriminator !== null &&
      NOT_TAKEN_DISCRIMINATORS.includes(discriminator))
  ) {
    return {
      kind: "rejected",
      status: res.status,
      code: code ?? discriminator,
      message: said,
    };
  }
  return { kind: "unknown", status: res.status, message: said };
}

/**
 * The label-sample door's answer. `answered` carries coord's `200` body
 * unparsed (`deriveLabelSampleView` reads it); every other outcome — a `404`
 * from a coord that predates the door, a `503 label_sample_unreadable`, no
 * answer at all — is `unavailable`, never an empty sample.
 */
export type LabelSampleAnswer =
  | { kind: "answered"; body: unknown }
  | {
      kind: "unavailable";
      status: number | null;
      code: string | null;
      message: string;
    };

/** `GET /coord/verification/label-sample` — this week's verdicts to label. */
export async function fetchLabelSample(): Promise<LabelSampleAnswer> {
  const url = `${OPERATIONS_BASE}/coord/verification/label-sample`;
  let res: Response;
  try {
    res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  } catch (err) {
    return {
      kind: "unavailable",
      status: null,
      code: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const { text, body } = await readBody(res);
  if (res.status === 200) return { kind: "answered", body };
  const { code, message } = errorFields(body);
  return {
    kind: "unavailable",
    status: res.status,
    code: code ?? refusalDiscriminator(body),
    message: message || text || `HTTP ${res.status}`,
  };
}

/**
 * The blast-radius contract for a Cognito group delete: the two preview-read
 * cause codes, the 200-body parser and the plural helpers. Pure (no React) —
 * `renderAffected`, its only JSX consumer, stays with the group row. Mirrors
 * backend `_BlastRadius` / `_coord_group_blast_radius`; the verdict's wire
 * type, `BlastRadiusVerdict`, is the client's (`cognitoGroups.ts`).
 */

import type { BlastRadiusVerdict } from "@/lib/api/operations/cognitoGroups";
import {
  bounded,
  MAX_CAUSE_LENGTH,
  messageFromErrorBody,
  plainSentence,
} from "@/lib/errors/backend-error-message";

/** Suffix coord treats as a home-tenant pin (`auth_sso::HOME_GROUP_SUFFIX`). */
export const HOME_GROUP_SUFFIX = "-home";

/** The two codes `_coord_group_blast_radius` raises when the PREVIEW read
 * fails. Named rather than inferred, because at the level this now reads them
 * every error body has an `error` key — see {@link blastRadiusReadCause}. */
export const BLAST_RADIUS_CAUSE_CODES = [
  "mapping_check_unavailable",
  "mapping_check_unreadable",
] as const;

/** Whether `value` is one of the two codes {@link blastRadiusReadCause} speaks
 * for. A type guard rather than a bare `includes`, so both arms narrow. */
function isBlastRadiusCauseCode(
  value: unknown
): value is (typeof BLAST_RADIUS_CAUSE_CODES)[number] {
  return (
    typeof value === "string" &&
    (BLAST_RADIUS_CAUSE_CODES as readonly string[]).includes(value)
  );
}

/**
 * A short cause for a failed blast-radius PREVIEW read, from the refusal's
 * body `text` and HTTP `status` (the halves `httpBodyOf` / `httpStatusOf` read
 * back out of the client's rejection).
 *
 * The backend's 502 detail is structured (`{error, coord_status, message}`)
 * and its `message` is the delete's own refusal sentence. For a preview the
 * useful part is the code and coord's status — "mapping_check_unavailable,
 * coord answered 404" tells an operator the route is not deployed yet; the
 * message's "Nothing was deleted" tells them about a click they never made.
 * Anything not in that shape falls back to `messageFromErrorBody`.
 *
 * ## It has to read the ENVELOPE too, not only `detail`
 *
 * This read `detail` alone, which is FastAPI's own shape and what a test app
 * produces. In PRODUCTION `http_exception_handler` splices a dict detail to
 * the TOP LEVEL and emits no `detail` key at all (`error_handler.py`), so on a
 * deployed backend the branch never matched and the whole thing fell through
 * to `messageFromErrorBody` — which returns the refusal sentence. The 300
 * ceiling hid that by refusing the sentence for its length; raising the
 * ceiling to fit the backend's real copy exposed it, and the dialog would have
 * told an operator "Nothing was deleted." about a delete they never clicked.
 *
 * Recognition is by CODE rather than by "an `error` key is present", because
 * at the top level every error body has one and matching on presence would
 * capture bodies this helper has nothing to say about. The SAME test applies
 * to the `detail` arm, which used to match on presence alone: without it, a
 * backend running no middleware (a test app, a local dev server — the exact
 * configuration the rest of this file goes out of its way to serve) had any
 * `{"detail": {"error": …}}` refusal on this route reduced to its bare code
 * with its sentence discarded, while production rendered the sentence. One
 * rule, both arms.
 */
export function blastRadiusReadCause(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    // `detail` when the middleware did not run, the body ITSELF when it did.
    // No second code test guards this choice: the one below decides, and it
    // reaches the same verdict on either shape, so a test here would read like
    // a guard while being a no-op.
    const detail = parsed?.detail ?? parsed;
    if (detail && typeof detail === "object") {
      const { error, coord_status, reason } = detail as {
        error?: unknown;
        coord_status?: unknown;
        reason?: unknown;
      };
      if (isBlastRadiusCauseCode(error)) {
        // Three shapes, and ABSENT is not `null`. `mapping_check_unavailable`
        // always carries `coord_status` — a number for coord's own answer,
        // `null` when coord never completed one. `mapping_check_unreadable`
        // carries no `coord_status` at all, deliberately: coord DID answer,
        // with a body that is not the verdict, and it carries a `reason`
        // instead. Reading absent as `null` would tell the operator coord
        // never answered in exactly the case where it did.
        if (typeof coord_status === "number") {
          return `${error}, coord answered ${coord_status}`;
        }
        if (coord_status === null) {
          return `${error}, coord never completed an answer`;
        }
        // GUARDED, and bounded to THIS SURFACE rather than to the toast's
        // ceiling. `reason` is `_raise_mapping_check_unreadable`'s argument,
        // and one of its thirteen call sites is `_verdict_is_about`, which
        // interpolates coord's ECHOED `group_id` — a value
        // `_is_attributable` checks for printability and non-emptiness but NOT
        // for length. So this is a body-controlled string.
        //
        // It lands in `ConfirmDestructiveDialog`, which renders into an
        // `AlertDialogContent` that is `fixed`, vertically centred, and
        // carries no `max-h` and no `overflow-y-auto`. A value at the toast's
        // 2000-character ceiling is ~33 lines at `max-w-lg`, which pushes the
        // type-to-confirm input and BOTH BUTTONS out of the viewport with no
        // way to scroll to them — on an irreversible pool-wide delete.
        // Bounding to the toast's ceiling is not enough here; the surface
        // decides the bound, and this one is a diagnostic code plus a short
        // clause, never prose.
        const safeReason =
          typeof reason === "string" && reason
            ? plainSentence(reason, MAX_CAUSE_LENGTH)
            : null;
        // The COMPOSITION is what the dialog receives, so that is what the
        // surface cap applies to — bounding only the half leaves the code and
        // its separator on top of it, which is the composed-return mistake
        // this file already made once at the rung level.
        return safeReason
          ? bounded(`${error}: ${safeReason}`, MAX_CAUSE_LENGTH)
          : error;
      }
    }
  } catch {
    // Not JSON — fall through to the generic reader, which returns the raw
    // body when it is a plain-text gateway sentence.
  }
  // The SURFACE bound, on this return too. Both of this function's
  // operator-facing returns land in the same dialog `<li>`, so an argument
  // about that `<li>` covers both; bounding one of them was the same
  // half-a-fix as bounding one half of a composition.
  //
  // No production body reaches here long today — every refusal this route
  // raises is a cause code or a short sentence. A DEV backend does:
  // `general_exception_handler` returns `str(exc)` unbounded under
  // `ENVIRONMENT == "development"`. Passing the limit costs one argument and
  // removes the need to re-derive that reachability argument every time a
  // refusal is added to the route.
  return messageFromErrorBody(text, status, MAX_CAUSE_LENGTH);
}

/**
 * The dialog's read of the verdict. `idle` while the dialog is closed;
 * `error` is UNKNOWN — a failed, refused or unreadable read — and is never
 * rendered as "breaks nothing".
 */
export type BlastRadiusRead =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; verdict: BlastRadiusVerdict };

function isCount(v: unknown): v is number {
  // `typeof true === "boolean"`, so a boolean never passes — but say it
  // anyway: the backend refuses a boolean count for the same reason
  // (`isinstance(True, int)` in Python), and the two sides should read alike.
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isSlugList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && s !== "");
}

/**
 * The verdict out of a 200 body — or `null` when the body is not one.
 *
 * A successful STATUS is not a successful READ. The backend has already
 * validated coord's answer field by field and would have answered 502 rather
 * than pass a malformed one through, so this is a shape check on OUR proxy's
 * body, not a re-run of coord's contract. It matters for the same reason the
 * section's `requireRows` does: `?? 0` on a missing count would fabricate
 * exactly the all-clear the dialog exists to stop fabricating.
 */
export function parseBlastRadiusVerdict(
  body: unknown
): BlastRadiusVerdict | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.group_name !== "string" ||
    !isCount(b.mapped_total) ||
    !isSlugList(b.mapped_own_tenant) ||
    !isCount(b.mapped_other_tenant_rows) ||
    !isCount(b.mapped_unmaterialized_rows) ||
    !isCount(b.strands_total) ||
    !isSlugList(b.strands_own_tenant) ||
    !isCount(b.strands_other_tenant_count)
  ) {
    return null;
  }
  return {
    group_name: b.group_name,
    mapped_total: b.mapped_total,
    mapped_own_tenant: b.mapped_own_tenant,
    mapped_other_tenant_rows: b.mapped_other_tenant_rows,
    mapped_unmaterialized_rows: b.mapped_unmaterialized_rows,
    strands_total: b.strands_total,
    strands_own_tenant: b.strands_own_tenant,
    strands_other_tenant_count: b.strands_other_tenant_count,
  };
}

export function pluralNoun(n: number, noun: string): string {
  return `${noun}${n === 1 ? "" : "s"}`;
}

export function plural(n: number, noun: string): string {
  return `${n} ${pluralNoun(n, noun)}`;
}

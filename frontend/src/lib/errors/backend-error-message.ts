/**
 * A guarded, bounded reader that turns a backend error `Response` into a
 * sentence an operator can act on — instead of `[object Object]`, a raw
 * HTML gateway page, a Python repr, a JSON array, or an unbounded dump.
 *
 * Extracted from `qontinui-web#1378`/`#1379` (the members page's error
 * reader), which took five independent review rounds to reach this shape —
 * see plan `2026-09-17-one-guarded-error-reader-for-every-operator-facing-
 * backend-error` for the review history and the phased adoption this module
 * exists to enable. `blastRadiusReadCause` in the members page is the one
 * caller that stays page-local: it classifies a failed read by two specific
 * codes rather than reading a general sentence, so it is not general enough
 * to live here.
 */

/**
 * The human sentence out of a backend error response.
 *
 * The envelope reader is the page's single door for a REASON: a new fetch
 * that renders why a call failed reads `!res.ok` through this (or
 * {@link messageFromErrorBody}, when the body is already consumed) and never
 * formats a status itself — the status fallback lives INSIDE, where it is
 * reached only once nothing better exists.
 *
 * `limit` is the SURFACE's bound, not this reader's — pass
 * {@link MAX_CAUSE_LENGTH} for a dialog rather than a toast. Defaults to
 * {@link MAX_SENTENCE_LENGTH}.
 */
export async function backendErrorMessage(
  res: Response,
  limit: number = MAX_SENTENCE_LENGTH
): Promise<string> {
  return messageFromErrorBody(await res.text(), res.status, limit);
}

/** The body-level half of {@link backendErrorMessage}, for callers that
 * have already consumed `res.text()`. */
export function messageFromErrorBody(
  text: string,
  status: number,
  limit: number = MAX_SENTENCE_LENGTH
): string {
  const sentence = sentenceFromErrorText(text, 0, limit);
  if (sentence !== null) return sentence;
  // Parsed as JSON and carries no READABLE candidate on any rung — `{}`, a
  // shape this does not know, or a body whose every candidate was refused. The
  // raw JSON is NOT a message: printing it puts `{}` or a brace-blob where the
  // operator expects a reason, which is the same defect as `[object Object]`
  // one shape along. The status is at least true, and it is what these call
  // sites showed before they were routed here.
  return `HTTP ${status}`;
}

/**
 * `"<field> — <reason>"` from the first entry of a validation-error list, or
 * `null` when the value is not that shape.
 *
 * TWO shapes, because two handlers produce one: `validation_exception_handler`
 * composes `{field, message, type}` and puts the list in a top-level `details`
 * beside the generic `message`, while FastAPI's OWN default handler — what a
 * test app that does not register the middleware runs, and what a local dev
 * backend answers — puts `{loc, msg, type}` straight into `detail`. Reading
 * only the first left the second rendering as a bare `HTTP 422`, on the arm the
 * envelope reader was extended to cover in the first place.
 */
function firstValidationDetail(
  details: unknown,
  limit: number = MAX_SENTENCE_LENGTH
): string | null {
  if (!Array.isArray(details) || details.length === 0) return null;
  const first = details[0];
  if (first === null || typeof first !== "object") return null;
  const {
    field,
    message,
    loc,
    msg: msgRaw,
  } = first as {
    field?: unknown;
    message?: unknown;
    loc?: unknown;
    msg?: unknown;
  };
  // `loc` is a path — `["body", "role"]` — and `body.role` is how the composed
  // handler spells the same thing, so the two shapes render identically.
  const locField = Array.isArray(loc)
    ? loc
        .filter((part) => typeof part === "string" || typeof part === "number")
        .join(".")
    : "";
  // Each HALF faces `plainSentence` on its own, before composition. Guarding
  // only the composed string does not work and was the first attempt here:
  // `body.role — <html>…</html>` starts with `body.role`, so it passes every
  // shape test while carrying a gateway page through the middle of itself.
  // These are values this file does not control — a `msg` from pydantic, a
  // `message` from `validation_exception_handler` — so a refused half is
  // dropped and the other half still answers.
  const name = plainSentence(
    (typeof field === "string" && field) || locField || "",
    limit
  );
  const reason = plainSentence(
    (typeof message === "string" && message) ||
      (typeof msgRaw === "string" && msgRaw) ||
      "",
    limit
  );
  // BOUNDED here rather than at each use. Both halves are separately capped,
  // so their composition can reach twice the ceiling, and `field` leaves
  // `sentenceFromErrorText` by three different returns — bounding at the
  // source is one place instead of three, and cannot be forgotten at a fourth.
  if (name && reason) return bounded(`${name} — ${reason}`, limit);
  return reason || name || null;
}

/**
 * How much of a sentence {@link plainSentence} will show. Longer values are
 * TRUNCATED, not refused — see below for why that asymmetry is the whole point.
 *
 * ## Length is not a shape, and this backend has no upper bound
 *
 * The other three tests in `plainSentence` reject the wrong KIND of thing: an
 * HTML page, a Python repr, a JSON array. Length is different — it describes
 * the right kind of thing, and too much of it — so refusing on it throws away
 * a message that was genuinely prose.
 *
 * That was not academic. Measured against `operations.py` at this sha:
 *
 *  - `_raise_mapping_check_unreadable` composes **425** characters with an
 *    empty `reason`. Its thirteen call sites add 15-48 more BEFORE their
 *    interpolations, so the shortest producible form is ~440. One of them,
 *    `_verdict_is_about`, interpolates coord's ECHOED `group_id`, which
 *    `_is_attributable` does not length-check at all — so that arm has no
 *    bound either. (Its other half, `group_name`, is Cognito-validated at 128.)
 *  - `home_group_requires_override` is **297** with both placeholders empty.
 *    Guard 2 fires on `endswith(HOME_GROUP_SUFFIX)`, so the shortest group it
 *    can fire for is `-home` itself, with an empty slug: **302**. Every longer
 *    name adds twice over, since the group appears whole and again stripped.
 *  - Guards 1 and 3 (`group_is_mapped`, `last_admin_mapping`) interpolate
 *    `_render_affected`, which is a `", ".join(named)` over a deduplicated
 *    tenant list. **There is no upper bound at all.**
 *
 * So no ceiling can be "big enough". At the 300 this started life as, every
 * one of those refused and the operator was told `HTTP 409` about a delete the
 * backend had just explained in full; at 2000 the same thing happens to a
 * heavily-mapped group, just less often. Truncating keeps the beginning —
 * which is where `_render_affected` puts the tenants and where the guards put
 * the instruction — and bounds the toast, which is what the ceiling was
 * really for.
 *
 * A dump truncated is still visibly a dump, and no more harmful than one
 * refused. A refusal sentence truncated still says what to do.
 *
 * Length was never what caught a gateway page anyway: the nginx 502 body is
 * ~150 characters, and the `<` test is what refuses it.
 */
export const MAX_SENTENCE_LENGTH = 2000;

/**
 * The bound for a value going into a delete-confirmation dialog rather than
 * a toast.
 *
 * A toast is its own box and scrolls with the page; a dialog built on
 * `AlertDialogContent` is typically `fixed`, vertically centred, and may
 * carry neither `max-h` nor `overflow-y-auto`, so everything below an
 * over-long child — including a type-to-confirm input and its buttons —
 * can leave the viewport unreachably. The value bounded by this is meant to
 * be a cause: a code plus a short clause, never prose, so a tight bound
 * costs nothing and the surface cannot be blown out.
 */
export const MAX_CAUSE_LENGTH = 200;

/**
 * A candidate string, if it is something an operator can actually read —
 * otherwise `null`, so the caller tries the NEXT candidate and only then the
 * status.
 *
 * Applied at EVERY level, not just the top: a plain-text gateway or proxy body
 * IS the sentence, but four things that arrive in the same slot are not, and
 * each is the brace-blob defect one shape further along.
 *
 *  - **An HTML error page.** `<html><head><title>502 Bad Gateway</title>…
 *    <center>nginx</center></html>` in a section's error paragraph is prose to
 *    nobody. This is the common shape from a load balancer.
 *  - **A Python `repr` of a dict.** `http_exception_handler` emits
 *    `str(detail_value)` when a dict detail carries `error` but no `message`,
 *    so `{'error': 'not_admin_in_target_tenant'}` — single quotes, not JSON,
 *    so the recursion's own parse fails and it would otherwise fall through
 *    here as "text". That is exactly the leak `_readable_coord_refusal` exists
 *    to stop server-side. The pattern deliberately matches only a brace
 *    followed by a QUOTE, so a legitimate sentence like
 *    `{role} is not a valid tier` still passes.
 *  - **A JSON ARRAY.** The same argument one bracket along, and it is the shape
 *    FastAPI's own 422 handler emits: `[{"loc": ["body", "role"], "msg": …}]`
 *    pasted into a toast is no more readable than `{…}` was. Decided by
 *    PARSING rather than by a pattern, because every pattern tried here was
 *    wrong in one direction or the other: matching `[` plus a quote or brace
 *    let `[]` and `[1,2,3]` through, and requiring whitespace after the
 *    closing bracket refused `[admin]: not a valid tier` and
 *    `[acme]-home pins its members' home tenant …` — which is reachable,
 *    since `invalid_group_name_reason` lets a Cognito group name begin with a
 *    bracket. "Does this parse as a JSON array?" is the actual question, and
 *    it has no false positives: prose that opens with a bracketed token is not
 *    valid JSON.
 *
 * Length is NOT in that list. It bounds rather than refuses — see
 * {@link MAX_SENTENCE_LENGTH}, where the reason is that this backend composes
 * some messages with no upper bound at all.
 */
export function plainSentence(
  value: string,
  limit: number = MAX_SENTENCE_LENGTH
): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith("<")) return null;
  if (/^\{\s*['"]/.test(raw)) return null;
  if (isJsonArray(raw)) return null;
  return bounded(raw, limit);
}

/** Whether `raw` is a JSON array document rather than prose. See the
 * JSON-ARRAY bullet on {@link plainSentence} for why this parses instead of
 * matching a pattern. */
function isJsonArray(raw: string): boolean {
  // Both ends before any parse. `raw` is already trimmed, so a JSON array must
  // close with `]` — which means the two cases this guard exists to keep
  // (`[admin] is not a valid tier`, a group named `[acme]-home`) never reach
  // `JSON.parse` at all. Without it, any body-controlled string merely STARTING
  // with `[` was parsed and materialised in full, which the old length test had
  // refused for nothing.
  if (!raw.startsWith("[") || !raw.endsWith("]")) return false;
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    // Not JSON, so it is prose that merely opens with a bracketed token —
    // `[admin] is not a valid tier`, or a group name starting with `[`.
    return false;
  }
}

/** `value`, cut to `limit` with an ellipsis when it is longer.
 *
 * Called on every COMPOSITION this module builds from two already-bounded
 * halves, since two of them reach twice the bound. Single values are bounded
 * by {@link plainSentence}, which calls this itself.
 *
 * `limit` is the SURFACE's, not the module's — see {@link MAX_CAUSE_LENGTH}.
 *
 * `slice` counts UTF-16 code units, so the cut can land between a surrogate
 * pair and leave an orphan that renders as a replacement glyph. The check is
 * on the LEADING (high) surrogate: a trailing one at `end - 1` always has its
 * leading half at `end - 2` and so is already whole. */
export function bounded(
  value: string,
  limit: number = MAX_SENTENCE_LENGTH
): string {
  if (value.length <= limit) return value;
  let end = limit;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${value.slice(0, end).trimEnd()}…`;
}

/** How many times {@link sentenceFromErrorText} will unwrap a body-in-a-body.
 * Two is the deepest shape that exists (the envelope's `message` holding
 * another service's body); the bound is what stops a pathological nest
 * looping. */
const MAX_ERROR_UNWRAP = 2;

/**
 * The operator-facing sentence inside one error body, or `null` when it has
 * none. `text` may be JSON or plain text.
 *
 * ## Why this recurses, and why it is not over-engineering
 *
 * A web-backend error can carry ANOTHER error body inside a string field, and
 * for the members page that is the ORDINARY case rather than an exotic one —
 * see `qontinui-web#1378`/`#1379` for the concrete plumbing this was measured
 * against (`_proxy_coord_get` / `_proxy_coord_post` / `_proxy_coord_delete`
 * raising `HTTPException(detail=resp.text)`, so a nested coord body arrives as
 * a plain string inside the envelope's `message`). A reader that stops at
 * `message` hands the operator `{"error":"not_admin_in_target_tenant"}` —
 * braces and all. Unwrapping one more level yields
 * `not_admin_in_target_tenant`, the string the backend actually chose to send.
 *
 * ## Rungs, and what a REFUSED rung means
 *
 * Order within one object: a string `detail`, a structured `detail.message`,
 * then `detail.error`, then the envelope's `message`, then its `error`, then
 * the offending field of a validation error.
 *
 * A rung whose value `plainSentence` refuses does NOT end the search. That is a
 * fact about one value — this string is HTML, a repr, an array, a dump — and
 * not about the body, which on this backend always carries a machine `error`
 * beside its human `message`. Returning on the first refusal throws that code
 * away and answers `HTTP <status>` on exactly the bodies this reader exists
 * for. So the first rung that SURVIVES wins, and the status is reached only
 * when none does.
 */
function sentenceFromErrorText(
  text: string,
  depth: number,
  limit: number = MAX_SENTENCE_LENGTH
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON — so this is either a real sentence or something that only
    // looks like one. `plainSentence` decides, and it is the SAME predicate
    // every rung below uses.
    return plainSentence(text, limit);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  // A string that is itself a JSON object is a nested BODY, not a sentence, so
  // recurse into it; its extraction result is authoritative either way, since
  // returning the raw braces when the nest carries nothing is the defect this
  // exists to stop. Anything else is a candidate sentence and faces the same
  // `plainSentence` test as a non-JSON top-level body.
  //
  // Every rung is guarded, and that is the whole point. An extracted value is
  // ONE LEVEL IN, which is often where the real body lives — a proxy in front
  // of another service can answer 502 with an HTML page that arrives inside
  // `message`. Guarding only the top level would refuse the HTML that is hard
  // to reach and pass the HTML that is easy to.
  const unwrap = (value: string): string | null =>
    depth < MAX_ERROR_UNWRAP && value.trimStart().startsWith("{")
      ? sentenceFromErrorText(value, depth + 1, limit)
      : plainSentence(value, limit);

  /** A non-empty string, or `null` — `""` is not a sentence. */
  const str = (value: unknown): string | null =>
    typeof value === "string" && value ? value : null;

  // A body carrying BOTH `error` and `message` is a composed envelope, so
  // a sibling `detail` on it is metadata rather than FastAPI's detail.
  // Declared here because the validation-field read below needs it too.
  const isComposedEnvelope =
    str(obj.error) !== null && str(obj.message) !== null;
  const detail = isComposedEnvelope ? undefined : obj.detail;

  // The specific half of a validation error, from either handler's spelling.
  // Read once, because it decorates the `message` rung AND stands alone as the
  // last rung when nothing else survived.
  const field =
    firstValidationDetail(obj.details, limit) ??
    firstValidationDetail(detail, limit);

  // ## A REFUSED candidate falls through; it does not end the search
  //
  // Each rung below asks `unwrap`, and a `null` back means "this value is not
  // something an operator can read" — HTML, a repr, a JSON array, a dump. That
  // is a fact about THAT VALUE, not about the body, and the production envelope
  // always carries a machine `error` code beside its human `message`. Returning
  // on the first refusal threw that code away and answered `HTTP <status>` on
  // exactly the bodies this reader exists for.
  //
  // So: first candidate that SURVIVES wins, and the status is reached only when
  // none does.

  // Rung 1-3 — `detail`, which is FastAPI's own default-handler shape.
  const detailStr = str(detail);
  if (detailStr) {
    const sentence = unwrap(detailStr);
    if (sentence) return sentence;
  } else if (
    detail !== null &&
    typeof detail === "object" &&
    !Array.isArray(detail)
  ) {
    const d = detail as Record<string, unknown>;
    // `detail.message` first, then `detail.error`: the structured refusal as
    // FastAPI renders it is `{"detail": {"error": "…"}}`, with no `message`
    // unless the backend composed one. Reading `error` here is what makes a
    // test app (which does not register production middleware) answer the
    // same sentence a deployed backend does.
    for (const key of ["message", "error"] as const) {
      const value = str(d[key]);
      if (!value) continue;
      const sentence = unwrap(value);
      if (!sentence) continue;
      // The SAME `<code> — <hint|reason>` composition rung 5 applies to a
      // spliced envelope. Without it one body answers two ways depending on
      // whether middleware spliced `hint`/`reason` to the top level or left
      // it under `detail`.
      if (key === "error") {
        for (const extraKey of ["hint", "reason"] as const) {
          const extra = str(d[extraKey]);
          if (!extra) continue;
          const safeExtra = plainSentence(extra, limit);
          if (!safeExtra) continue;
          return bounded(`${sentence} — ${safeExtra}`, limit);
        }
      }
      return sentence;
    }
  }

  // Rung 4 — the envelope's human `message`.
  const messageStr = str(obj.message);
  if (messageStr) {
    const sentence = unwrap(messageStr);
    // A validation handler can put the SAME generic `message` on every 422
    // and the only specific thing it knows in a sibling `details` array.
    // Returning the generic half alone would tell an operator a field is
    // wrong without saying which.
    if (sentence)
      return bounded(field ? `${sentence}: ${field}` : sentence, limit);
  }

  // Rung 5 — no readable sentence, but a code. `not_admin_in_target_tenant` is
  // a poor sentence and a far better answer than `HTTP 403`.
  const errorStr = str(obj.error);
  if (errorStr) {
    const code = unwrap(errorStr);
    if (code) {
      // Mirror a `<code> — <hint|reason|detail>` composition some backends
      // use server-side, so the two paths do not disagree about which half
      // of the body is worth showing.
      //
      // That third key, `detail`, is absent here on purpose: a string
      // `detail` is the FIRST rung of this function, so a body carrying one
      // was tried several branches ago. GUARDED, and a refused one falls
      // through to the next key rather than ending the rung.
      for (const key of ["hint", "reason"] as const) {
        const extra = str(obj[key]);
        if (!extra) continue;
        const safeExtra = plainSentence(extra, limit);
        if (!safeExtra) continue;
        return bounded(`${code} — ${safeExtra}`, limit);
      }
      // A validation field decorates this rung exactly as it decorates the
      // `message` one above.
      return bounded(field ? `${code}: ${field}` : code, limit);
    }
  }

  // Rung 6 — the offending field alone. Reached when a 422's `message` was
  // refused, where naming the field still beats `HTTP 422`.
  return field;
}

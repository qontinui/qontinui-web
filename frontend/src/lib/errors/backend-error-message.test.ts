import { describe, it, expect } from "vitest";
import {
  BackendError,
  backendError,
  backendErrorMessage,
  bounded,
  MAX_CAUSE_LENGTH,
  MAX_SENTENCE_LENGTH,
  messageFromErrorBody,
  plainSentence,
  readErrorBody,
} from "./backend-error-message";

/**
 * Unit tests for the reader extracted from the members page
 * (`qontinui-web#1378`/`#1379`) by plan
 * `2026-09-17-one-guarded-error-reader-for-every-operator-facing-backend-error`
 * Phase 1. This module had no unit suite of its own before extraction — it
 * was only exercised through `page.errorMessages.test.tsx` and
 * `page.cognitoMemberErrors.test.tsx`, which drive it through the rendered
 * page and stay in place, unedited, as the extraction's regression gate.
 *
 * Each guard here is written so that reverting it reds only its own case,
 * mirroring the mutation-proof discipline `#1379`'s own review ran.
 */

describe("plainSentence", () => {
  it("passes ordinary prose through unchanged", () => {
    expect(plainSentence("not_admin_in_target_tenant")).toBe(
      "not_admin_in_target_tenant"
    );
  });

  it("refuses an empty or whitespace-only value", () => {
    expect(plainSentence("")).toBeNull();
    expect(plainSentence("   ")).toBeNull();
  });

  it("refuses an HTML error page", () => {
    expect(
      plainSentence("<html><head><title>502 Bad Gateway</title></html>")
    ).toBeNull();
  });

  it("refuses a Python repr of a dict", () => {
    expect(plainSentence("{'error': 'not_admin_in_target_tenant'}")).toBeNull();
  });

  it("passes a sentence that merely starts with a brace-and-word", () => {
    // The repr guard matches a brace followed by a QUOTE, not any brace.
    expect(plainSentence("{role} is not a valid tier")).toBe(
      "{role} is not a valid tier"
    );
  });

  it("refuses a JSON array body", () => {
    expect(
      plainSentence('[{"loc": ["body", "role"], "msg": "field required"}]')
    ).toBeNull();
    expect(plainSentence("[]")).toBeNull();
    expect(plainSentence("[1,2,3]")).toBeNull();
  });

  it("does not mistake a bracketed prose token for a JSON array", () => {
    // Reachable: Cognito group names may start with a bracket.
    expect(plainSentence("[admin]: not a valid tier")).toBe(
      "[admin]: not a valid tier"
    );
    expect(plainSentence("[acme]-home pins its members' home tenant")).toBe(
      "[acme]-home pins its members' home tenant"
    );
  });

  it("bounds a value longer than the default ceiling", () => {
    const long = "a".repeat(MAX_SENTENCE_LENGTH + 50);
    const result = plainSentence(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(MAX_SENTENCE_LENGTH + 1); // +1 for the ellipsis
    expect(result!.endsWith("…")).toBe(true);
  });

  it("honors a caller-supplied limit", () => {
    const value = "a".repeat(50);
    expect(plainSentence(value, 10)).toBe(`${"a".repeat(10)}…`);
  });
});

describe("bounded", () => {
  it("returns a short value unchanged", () => {
    expect(bounded("short", 10)).toBe("short");
  });

  it("truncates with an ellipsis at the limit", () => {
    expect(bounded("abcdefghij", 5)).toBe("abcde…");
  });

  it("trims trailing whitespace before the ellipsis", () => {
    expect(bounded("abc   defgh", 6)).toBe("abc…");
  });

  it("does not split a surrogate pair at the cut point", () => {
    // U+1F600 (😀) is a surrogate pair in UTF-16; cutting between its two
    // code units would leave an orphan that renders as a replacement glyph.
    const value = `abcd${"\u{1F600}"}efgh`; // "abcd" + high+low surrogate + "efgh"
    const cut = bounded(value, 5); // cut lands ON the high surrogate
    expect(cut).toBe("abcd…");
  });
});

describe("messageFromErrorBody — rung fallthrough", () => {
  it("falls back to the status when the body carries nothing readable", () => {
    expect(messageFromErrorBody("{}", 404)).toBe("HTTP 404");
  });

  it("reads a plain-text (non-JSON) body as the sentence directly", () => {
    expect(messageFromErrorBody("coord is unreachable", 502)).toBe(
      "coord is unreachable"
    );
  });

  it("reads a string `detail` (FastAPI's own default shape)", () => {
    expect(
      messageFromErrorBody(
        JSON.stringify({ detail: "not_admin_in_target_tenant" }),
        403
      )
    ).toBe("not_admin_in_target_tenant");
  });

  it("reads `detail.message` over `detail.error`", () => {
    expect(
      messageFromErrorBody(
        JSON.stringify({
          detail: { error: "CODE", message: "a human sentence" },
        }),
        403
      )
    ).toBe("a human sentence");
  });

  it("falls through a REFUSED `message` to the `error` beside it", () => {
    // The production envelope always carries a machine `error` beside its
    // human `message` — a refused `message` must not end the search.
    const body = JSON.stringify({
      error: "cognito_pool_misconfigured",
      message: "<html>gateway page</html>",
    });
    expect(messageFromErrorBody(body, 500)).toBe("cognito_pool_misconfigured");
  });

  it("composes `<code> — <hint>` when the code rung is reached", () => {
    const body = JSON.stringify({
      error: "repo_has_no_remote",
      hint: "add a remote first",
    });
    expect(messageFromErrorBody(body, 400)).toBe(
      "repo_has_no_remote — add a remote first"
    );
  });

  it("unwraps a nested JSON body one level in", () => {
    const inner = JSON.stringify({ error: "not_admin_in_target_tenant" });
    const outer = JSON.stringify({
      error: "INSUFFICIENT_PERMISSIONS",
      message: inner,
    });
    expect(messageFromErrorBody(outer, 403)).toBe("not_admin_in_target_tenant");
  });

  it("reads the FastAPI validation shape {loc, msg}", () => {
    const body = JSON.stringify({
      detail: [{ loc: ["body", "role"], msg: "field required" }],
    });
    expect(messageFromErrorBody(body, 422)).toBe("body.role — field required");
  });

  it("reads the composed validation shape {field, message} beside `message`", () => {
    const body = JSON.stringify({
      message: "Invalid request data",
      details: [{ field: "role", message: "not a valid tier" }],
    });
    expect(messageFromErrorBody(body, 422)).toBe(
      "Invalid request data: role — not a valid tier"
    );
  });

  it("refuses a JSON array body rather than printing it raw", () => {
    const body = JSON.stringify([{ loc: ["body"], msg: "bad" }]);
    // A bare top-level array is not an object shape this reader recognizes at
    // all (sentenceFromErrorText's Array.isArray(parsed) guard) — it falls to
    // the status, not to the raw array text.
    expect(messageFromErrorBody(body, 422)).toBe("HTTP 422");
  });

  it("honors a caller-supplied limit end to end", () => {
    const body = JSON.stringify({ detail: "a".repeat(50) });
    expect(messageFromErrorBody(body, 400, 10)).toBe(`${"a".repeat(10)}…`);
  });
});

describe("backendErrorMessage", () => {
  it("reads the response body and status", async () => {
    const res = new Response(JSON.stringify({ detail: "not found" }), {
      status: 404,
    });
    await expect(backendErrorMessage(res)).resolves.toBe("not found");
  });

  it("threads a caller-supplied limit down to the body reader", async () => {
    const res = new Response(JSON.stringify({ detail: "a".repeat(50) }), {
      status: 400,
    });
    await expect(backendErrorMessage(res, MAX_CAUSE_LENGTH)).resolves.toBe(
      "a".repeat(50) // under MAX_CAUSE_LENGTH, so unbounded here
    );
    const long = new Response(JSON.stringify({ detail: "a".repeat(300) }), {
      status: 400,
    });
    const result = await backendErrorMessage(long, MAX_CAUSE_LENGTH);
    expect(result.length).toBe(MAX_CAUSE_LENGTH + 1);
    expect(result.endsWith("…")).toBe(true);
  });
});

/**
 * The next-action contract (plan
 * `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`,
 * D3). The envelope arrives NESTED as `body.refusal` beside the pre-contract
 * `error`/`code`/`detail`, which stay for older readers.
 */
describe("readErrorBody — the Refusal envelope", () => {
  const AT = "2026-09-29T00:00:00Z";
  const refusal = {
    code: "workspace_root_unresolved",
    next_action: { kind: "set_setting", target: "workspace_root" },
    glossary_terms: ["tenant"],
    detail: "raw detail is not rendered",
    observed_at: AT,
    source: "web_backend",
  };
  // `Refusal::render()` for the envelope above — copied from the Rust test
  // `render_is_the_table_projection`.
  const RENDERED =
    'No workspace folder could be found for this operation. Set the "workspace_root" setting, then try again.';

  it("reads body.refusal and renders Refusal::render()'s sentence", () => {
    const body = JSON.stringify({
      error: "workspace_root_unresolved",
      detail: "an older reader shows this",
      refusal,
    });
    const reading = readErrorBody(body, 409);
    expect(reading.kind).toBe("refusal");
    expect(reading.sentence).toBe(RENDERED);
    expect(messageFromErrorBody(body, 409)).toBe(RENDERED);
  });

  it("reads body.detail.refusal (a dict detail wrapped by FastAPI)", () => {
    const body = JSON.stringify({ detail: { error: "x", refusal } });
    expect(readErrorBody(body, 409).sentence).toBe(RENDERED);
  });

  it("reads a top-level envelope carrying both code and next_action", () => {
    expect(readErrorBody(JSON.stringify(refusal), 409).sentence).toBe(RENDERED);
  });

  it("reads an envelope nested in a relayed body string", () => {
    const body = JSON.stringify({
      message: JSON.stringify({ error: "x", refusal }),
    });
    expect(readErrorBody(body, 502).sentence).toBe(RENDERED);
  });

  it("prefers body.refusal over a top-level envelope-shaped body", () => {
    const body = JSON.stringify({
      ...refusal,
      code: "unknown",
      refusal,
    });
    expect(readErrorBody(body, 409).sentence).toBe(RENDERED);
  });

  it("does NOT treat a string next_action as the envelope", () => {
    // `endpoint-unresolved.ts`'s pre-contract 503 body.
    const body = JSON.stringify({
      code: "endpoint_unresolved",
      endpoint: "backend",
      env_var: "BACKEND_URL",
      error: "This deployment is misconfigured.",
      next_action: "Set BACKEND_URL to the base URL of the backend API.",
    });
    const reading = readErrorBody(body, 503);
    expect(reading).toEqual({
      kind: "unstructured",
      sentence: "This deployment is misconfigured.",
    });
  });

  it("falls back to today's reading when body.refusal does not decode", () => {
    const body = JSON.stringify({
      error: "not_admin_in_target_tenant",
      refusal: { code: "unknown", next_action: { kind: "none_terminal" } },
    });
    expect(readErrorBody(body, 403)).toEqual({
      kind: "unstructured",
      sentence: "not_admin_in_target_tenant",
    });
  });

  it("classifies every pre-contract body as unstructured, with today's sentence", () => {
    for (const [text, status, sentence] of [
      ["{}", 500, "HTTP 500"],
      ["Bad gateway", 502, "Bad gateway"],
      [JSON.stringify({ detail: "nope" }), 400, "nope"],
      [JSON.stringify({ error: "e", message: "m" }), 409, "m"],
    ] as const) {
      expect(readErrorBody(text, status)).toEqual({
        kind: "unstructured",
        sentence,
      });
    }
  });

  it("bounds the rendered sentence by the caller's limit", () => {
    const body = JSON.stringify({ refusal });
    const s = readErrorBody(body, 409, 20).sentence;
    expect(s.length).toBeLessThanOrEqual(21);
    expect(s.endsWith("\u2026")).toBe(true);
  });

  it("backendError carries the reading and keeps err.message the sentence", async () => {
    const res = new Response(JSON.stringify({ error: "x", refusal }), {
      status: 409,
    });
    const err = await backendError(res);
    expect(err).toBeInstanceOf(BackendError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(RENDERED);
    expect(err.status).toBe(409);
    expect(err.reading.kind).toBe("refusal");
  });
});

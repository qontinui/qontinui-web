/**
 * Differential: the route's body peek against the platform's `Request.json()`
 * and against the installed SDK's JSON body reader.
 *
 * The route only strips a caller identity from a body its peek
 * (`passThroughBodyWithPeek`) parsed, so every body the SDK reads a value
 * from must parse in the peek, to the same value: one the SDK reads but the
 * peek refuses would reach a handler with any caller identity it names still
 * in it.
 *
 * Two oracles judge each corpus case independently. The global `Request` (the
 * platform parser itself, not the `NextRequest` subclass the peek builds) is
 * what the peek calls, and the peek must agree with it case by case. The
 * SDK's reader (since 0.46 `readJsonBody`, restated below and pinned in the
 * installed bundle by `route.real-sdk.test.ts`) is what reads the forwarded
 * body, and the peek must parse every value the SDK reads, to that value; the
 * cases where the two part are listed by name, so a platform or SDK release
 * that moves them fails here rather than in a handler. The corpus covers zero to
 * three leading byte-order marks, whitespace around and between them, a
 * lone surrogate (escaped, and as raw bytes), invalid UTF-8, duplicate keys,
 * numbers past double range and precision, negative zero, deep nesting,
 * `__proto__`, and non-object top-level values. An empty body is not in the
 * corpus: the peek reports it as absent and forwards nothing to strip.
 */

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { passThroughBodyWithPeek } from "./body-passthrough";

type Verdict = { parses: true; value: unknown } | { parses: false };

const BOM = [0xef, 0xbb, 0xbf];

/** Concatenate UTF-8 text and raw byte runs into one body. */
function bytes(...parts: Array<string | number[]>): Uint8Array {
  return new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...new TextEncoder().encode(part)] : part
    )
  );
}

/** `text` as UTF-16LE bytes behind a UTF-16LE byte-order mark. */
function utf16le(text: string): Uint8Array {
  const out = [0xff, 0xfe];
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out.push(unit & 0xff, unit >> 8);
  }
  return new Uint8Array(out);
}

/** The platform parser's verdict: `.json()` on a plain `Request`. */
async function platform(body: Uint8Array): Promise<Verdict> {
  try {
    const value: unknown = await new Request("http://localhost/", {
      method: "POST",
      body,
    }).json();
    return { parses: true, value };
  } catch {
    return { parses: false };
  }
}

/** What the SDK's reader makes of a body: a value, no body, or a refusal. */
type SdkRead =
  | { reads: "value"; value: unknown }
  | { reads: "no body" }
  | { reads: "refused" };

/**
 * The installed SDK's verdict: `readJsonBody` (ui-bridge
 * `src/server/request-body.ts`, the Next adapter's only body reader since
 * 0.46) on the request the route forwards. A default `TextDecoder` decodes the
 * bytes, a blank result is no body, and the rest is `JSON.parse`d. The
 * forwarded request always declares JSON, so the reader's "declared as
 * another type" arm, which reads an unparseable body as none, never runs.
 */
function sdkReader(body: Uint8Array): SdkRead {
  const text = new TextDecoder().decode(body);
  if (!text.trim()) return { reads: "no body" };
  try {
    return { reads: "value", value: JSON.parse(text) as unknown };
  } catch {
    return { reads: "refused" };
  }
}

/** The route peek's verdict on the same bytes. */
async function peek(body: Uint8Array): Promise<Verdict> {
  const { parsedBody, bodyState } = await passThroughBodyWithPeek(
    new NextRequest("http://localhost/api/ui-bridge/control/find", {
      method: "POST",
      body,
    }),
    "POST"
  );
  return bodyState === "parsed"
    ? { parses: true, value: parsedBody }
    : { parses: false };
}

const OBJ = '{"text":"Save","callerUserId":"user-a"}';
const NESTING = 1000;

const CORPUS: ReadonlyArray<readonly [string, Uint8Array]> = [
  ["no byte-order mark", bytes(OBJ)],
  ["one byte-order mark", bytes(BOM, OBJ)],
  ["two byte-order marks", bytes(BOM, BOM, OBJ)],
  ["three byte-order marks", bytes(BOM, BOM, BOM, OBJ)],
  ["one byte-order mark and nothing else", bytes(BOM)],
  ["two byte-order marks and nothing else", bytes(BOM, BOM)],
  ["whitespace around the body", bytes(" \t\r\n", OBJ, "\n ")],
  ["whitespace only", bytes(" \t\r\n ")],
  ["whitespace before a byte-order mark", bytes(" ", BOM, OBJ)],
  ["a mark, whitespace, then a mark", bytes(BOM, " ", BOM, OBJ)],
  ["two marks, then whitespace", bytes(BOM, BOM, "\r\n\t ", OBJ)],
  ["a no-break space before the body", bytes(" ", OBJ)],
  ["a UTF-16LE body behind its own mark", utf16le(OBJ)],
  [
    "an escaped lone surrogate",
    bytes('{"text":"\\ud800","callerUserId":"user-a"}'),
  ],
  [
    "a lone surrogate as raw bytes",
    bytes('{"text":"', [0xed, 0xa0, 0x80], '","callerUserId":"user-a"}'),
  ],
  [
    "invalid UTF-8 inside a string",
    bytes('{"text":"', [0xc3, 0x28], '","callerUserId":"user-a"}'),
  ],
  ["an overlong encoding", bytes('{"text":"', [0xc0, 0xaf], '"}')],
  [
    "invalid UTF-8 inside a key",
    bytes('{"caller', [0xff], 'UserId":"user-a"}'),
  ],
  ["a truncated sequence after the body", bytes(OBJ, [0xf0, 0x9f, 0x98])],
  [
    "duplicate keys",
    bytes('{"callerUserId":"user-a","text":"Save","callerUserId":"user-b"}'),
  ],
  ["a number past double range", bytes('{"n":1e400,"callerUserId":"user-a"}')],
  [
    "a number past double precision",
    bytes('{"n":123456789012345678901234567890}'),
  ],
  ["negative zero", bytes('{"n":-0}')],
  ["deep array nesting", bytes("[".repeat(NESTING) + "]".repeat(NESTING))],
  [
    "a caller deep inside nested objects",
    bytes(
      '{"request":'.repeat(NESTING) +
        '{"__callerUserId":"user-a"}' +
        "}".repeat(NESTING)
    ),
  ],
  [
    "__proto__ naming a caller",
    bytes('{"__proto__":{"callerUserId":"user-a"},"text":"Save"}'),
  ],
  [
    "constructor.prototype naming a caller",
    bytes('{"constructor":{"prototype":{"callerUserId":"user-a"}}}'),
  ],
  ["a top-level array", bytes('[{"callerUserId":"user-a"}]')],
  ["a top-level string", bytes('"callerUserId"')],
  ["a top-level number", bytes("42")],
  ["a top-level null", bytes("null")],
  ["a raw control character in a string", bytes('{"text":"a', [0x01], 'b"}')],
  ["an escaped NUL", bytes('{"text":"\\u0000"}')],
  ["trailing bytes after the body", bytes(OBJ, "x")],
  ["two bodies back to back", bytes(OBJ, OBJ)],
  ["a truncated body", bytes('{"text":')],
  ["a form-encoded body", bytes("text=Save&callerUserId=user-a")],
];

describe("body peek vs the platform's Request.json(), case by case", () => {
  it.each(CORPUS)("agrees on %s", async (_name, body) => {
    expect(await peek(body)).toEqual(await platform(body));
  });

  it("is not vacuous: the corpus holds bodies the platform parses and bodies it refuses", async () => {
    const verdicts = await Promise.all(
      CORPUS.map(([, body]) => platform(body))
    );
    expect(verdicts.filter((verdict) => verdict.parses).length).toBeGreaterThan(
      0
    );
    expect(
      verdicts.filter((verdict) => !verdict.parses).length
    ).toBeGreaterThan(0);
  });
});

describe("body peek vs the installed SDK's JSON body reader, case by case", () => {
  const sdkValues = CORPUS.flatMap(([name, body]) => {
    const read = sdkReader(body);
    return read.reads === "value" ? [[name, body, read.value] as const] : [];
  });

  it.each(sdkValues)(
    "parses %s, which the SDK reads a value from, to that value",
    async (_name, body, value) => {
      expect(await peek(body)).toEqual({ parses: true, value });
    }
  );

  it("parts from the SDK only on two leading marks and on a blank body", async () => {
    // Neither lets an unstripped value reach a handler: the peek parses a
    // body behind two marks (the platform's decode drops both) that the SDK
    // refuses, and refuses a blank body the SDK reads as no body.
    const laxer: string[] = [];
    const stricter: string[] = [];
    for (const [name, body] of CORPUS) {
      const read = sdkReader(body);
      const peeked = await peek(body);
      if (read.reads !== "value" && peeked.parses) laxer.push(name);
      if (read.reads === "no body" && !peeked.parses) stricter.push(name);
    }
    expect(laxer).toEqual([
      "two byte-order marks",
      "two marks, then whitespace",
    ]);
    expect(stricter).toEqual([
      "one byte-order mark and nothing else",
      "two byte-order marks and nothing else",
      "whitespace only",
    ]);
  });

  it("is not vacuous: the corpus holds bodies the SDK reads a value from, refuses, and reads as none", () => {
    const reads = CORPUS.map(([, body]) => sdkReader(body).reads);
    expect(reads).toContain("value");
    expect(reads).toContain("refused");
    expect(reads).toContain("no body");
  });
});

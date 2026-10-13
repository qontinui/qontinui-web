/**
 * Differential: the route's body peek against the platform's `Request.json()`.
 *
 * The SDK parses every body it reads with `request.json()` on the request the
 * route forwards. The route's peek (`passThroughBodyWithPeek`) must reach the
 * same verdict on the same bytes — parse or refuse — and, when both parse,
 * the same value. A body the peek refuses but the SDK parses would reach the
 * SDK with any caller identity it names still in it (the route only strips a
 * body it parsed), so the two must never disagree.
 *
 * Each corpus case is judged independently by the global `Request` (the
 * platform parser itself, not the `NextRequest` subclass the peek builds),
 * and the peek must agree with it case by case. The corpus covers zero to
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

/**
 * Differential: the route's body peek against the installed SDK's own Next
 * handler.
 *
 * The route only strips a caller identity from a body its peek
 * (`passThroughBodyWithPeek`) parsed, so the peek must reach the SDK's verdict
 * on every body: the same value where the SDK reads one, no body where it
 * reads none, a refusal where it refuses. A body the SDK reads a value from
 * but the peek did not would reach a handler with any caller identity it
 * names still in it.
 *
 * Each corpus case goes through the peek, and the request the peek hands on
 * — the one the route forwards — goes through the INSTALLED SDK's
 * `createNextRouteHandlers` POST on `/control/find`, a `bodyRequired` route,
 * whose `find` handler records what the adapter gave it. Nothing about the
 * SDK's reader is restated here; only the adapter's removal of its reserved
 * `__callerUserId` key after reading is, so the two values compare. The
 * corpus covers an empty body, zero to three leading byte-order marks,
 * whitespace around and between them, blank bodies, a lone surrogate
 * (escaped, and as raw bytes), invalid UTF-8, duplicate keys, numbers past
 * double range and precision, negative zero, deep nesting, `__proto__`, and
 * non-object top-level values.
 */

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createNextRouteHandlers } from "@qontinui/ui-bridge/server";

import { passThroughBodyWithPeek } from "./body-passthrough";

/** What a body means: a value, no body, or a refusal. */
type Read =
  | { reads: "value"; value: unknown }
  | { reads: "no body" }
  | { reads: "refused" };

/** What the SDK's `find` handler was called with, per request. */
const received: unknown[] = [];

const sdk = createNextRouteHandlers({
  find: async (request: unknown) => {
    received.push(request);
    return { success: true, data: null, timestamp: 0 };
  },
} as unknown as Parameters<typeof createNextRouteHandlers>[0]);

/**
 * The adapter's removal of its reserved caller key from a read body, before
 * any handler sees it: every `__callerUserId` key down to depth 64 (ui-bridge
 * `src/server/reserved-caller.ts` `withoutReservedCaller`, module-private).
 */
function withoutReservedCaller(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > 64) return value;
  if (Array.isArray(value)) {
    return value.map((item) => withoutReservedCaller(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "__callerUserId")
      .map(([key, item]) => [key, withoutReservedCaller(item, depth + 1)])
  );
}

/** The installed SDK's verdict on the request the route forwards. */
async function sdkRead(request: NextRequest): Promise<Read> {
  received.length = 0;
  const res = await sdk.POST(request as never, {
    params: { path: "control/find" },
  });
  if (res.status === 400) {
    const body = (await res.json()) as { error?: unknown };
    expect(body.error).toBe("Request body is not valid JSON");
    return { reads: "refused" };
  }
  expect(res.status, await res.clone().text()).toBe(200);
  expect(received).toHaveLength(1);
  const [given] = received;
  // With no body the adapter hands the handler a synthesized `{}` (this
  // request names no tab and no caller); no corpus body parses to `{}`.
  return isEmptyObject(given)
    ? { reads: "no body" }
    : { reads: "value", value: given };
}

/** The route peek's verdict, and the request it hands on. */
async function peek(
  body: Uint8Array
): Promise<{ read: Read; forwarded: NextRequest }> {
  const { request, parsedBody, bodyState } = await passThroughBodyWithPeek(
    new NextRequest("http://localhost/api/ui-bridge/control/find", {
      method: "POST",
      body,
    }),
    "POST"
  );
  expect(bodyState).not.toBe("unreadable");
  const read: Read =
    bodyState === "parsed"
      ? { reads: "value", value: withoutReservedCaller(parsedBody) }
      : bodyState === "absent"
        ? { reads: "no body" }
        : { reads: "refused" };
  return { read, forwarded: request };
}

function isEmptyObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

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

const CASES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ["an empty body", bytes()],
  ...CORPUS,
];

describe("body peek vs the installed SDK's Next handler, case by case", () => {
  it.each(CASES)("reaches the SDK's verdict on %s", async (_name, body) => {
    const { read, forwarded } = await peek(body);
    expect(await sdkRead(forwarded)).toEqual(read);
  });

  it("is not vacuous: the SDK reads a value from some bodies, no body from some, and refuses some", async () => {
    const reads = new Set<string>();
    for (const [, body] of CASES) {
      reads.add((await sdkRead((await peek(body)).forwarded)).reads);
    }
    expect(reads).toEqual(new Set(["value", "no body", "refused"]));
  });

  it("reads `{}` from no corpus body, so a synthesized `{}` means no body", async () => {
    for (const [name, body] of CASES) {
      const { read } = await peek(body);
      expect(read.reads === "value" && isEmptyObject(read.value), name).toBe(
        false
      );
    }
  });
});

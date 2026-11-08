/**
 * The block settings grammar (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2): a
 * small strict parser, not YAML. Keys are `[a-z][a-z0-9-]*`; a value is a bare
 * token or a double-quoted string; unknown keys are an error; a body line
 * wins over the meta for the same key.
 */

import { describe, expect, it } from "vitest";
import { parseBlockArgs } from "./parseBlockArgs";

const SPEC = { keys: ["report", "table", "group", "note"] };

describe("the fence's first line", () => {
  it("reads key=value pairs", () => {
    expect(
      parseBlockArgs("table=scorecard report=platform-review", "", SPEC)
    ).toEqual({
      ok: true,
      args: { table: "scorecard", report: "platform-review" },
    });
  });

  it("reads a bare value as the block's positional setting", () => {
    // Phase 9's own shorthand: ```overview-kpi forecast-finish
    expect(
      parseBlockArgs("forecast-finish", "", {
        keys: ["figure"],
        positional: "figure",
      })
    ).toEqual({ ok: true, args: { figure: "forecast-finish" } });
  });

  it("refuses a bare value when the block has no positional setting", () => {
    const parsed = parseBlockArgs("scorecard", "", SPEC);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toMatch(/needs a name/);
  });

  it("keeps a quoted value whole, spaces and all", () => {
    expect(parseBlockArgs('note="two words" table=t', "", SPEC)).toEqual({
      ok: true,
      args: { note: "two words", table: "t" },
    });
  });

  it("refuses a quote left open", () => {
    expect(parseBlockArgs('note="open', "", SPEC).ok).toBe(false);
  });

  it("refuses a key given twice", () => {
    const parsed = parseBlockArgs("table=a table=b", "", SPEC);
    expect(parsed).toEqual({
      ok: false,
      error: { key: "table", message: expect.stringMatching(/twice/) },
    });
  });
});

describe("the fence's body", () => {
  it("reads key: value lines, skipping blank ones", () => {
    expect(
      parseBlockArgs(
        null,
        "\nreport: platform-review\n\ntable: scorecard\n",
        SPEC
      )
    ).toEqual({
      ok: true,
      args: { report: "platform-review", table: "scorecard" },
    });
  });

  it("wins over the first line for the same key", () => {
    expect(parseBlockArgs("table=from-meta", "table: from-body", SPEC)).toEqual(
      {
        ok: true,
        args: { table: "from-body" },
      }
    );
  });

  it("reads a quoted value, with its two escapes", () => {
    expect(parseBlockArgs(null, 'note: "say \\"hi\\" \\\\ bye"', SPEC)).toEqual(
      {
        ok: true,
        args: { note: 'say "hi" \\ bye' },
      }
    );
  });

  it("refuses a line that is not key: value", () => {
    const parsed = parseBlockArgs(null, "just some words", SPEC);
    expect(parsed).toEqual({
      ok: false,
      error: { key: null, message: expect.stringMatching(/key: value/) },
    });
  });

  it("refuses a value of more than one word unless it is quoted", () => {
    const parsed = parseBlockArgs(null, "note: two words", SPEC);
    expect(parsed).toEqual({
      ok: false,
      error: { key: "note", message: expect.stringMatching(/quoted/) },
    });
  });

  it("refuses an empty value", () => {
    expect(parseBlockArgs(null, "table:", SPEC).ok).toBe(false);
  });

  it("refuses a key given on two lines", () => {
    const parsed = parseBlockArgs(null, "table: a\ntable: b", SPEC);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.key).toBe("table");
  });
});

describe("what a setting may be", () => {
  it("refuses a key the block does not have, naming it", () => {
    for (const [meta, body] of [
      ["colour=red", ""],
      [null, "colour: red"],
    ] as const) {
      expect(parseBlockArgs(meta, body, SPEC)).toEqual({
        ok: false,
        error: { key: "colour", message: expect.stringMatching(/no setting/) },
      });
    }
  });

  it("refuses a key outside [a-z][a-z0-9-]*", () => {
    expect(parseBlockArgs("Table=x", "", SPEC).ok).toBe(false);
    expect(parseBlockArgs(null, "9table: x", SPEC).ok).toBe(false);
  });

  it("never reads markup or a URL as a bare value", () => {
    for (const value of ["<script>", "https://example.org/x", "a/b", "{x}"]) {
      expect(parseBlockArgs(null, `note: ${value}`, SPEC).ok).toBe(false);
    }
  });

  it("reads a report slug in any script as a bare value", () => {
    expect(parseBlockArgs(null, "report: видение-2026", SPEC)).toEqual({
      ok: true,
      args: { report: "видение-2026" },
    });
  });
});

/**
 * How a write whose own outcome was UNKNOWN reads afterwards, in the two
 * places the round 6 review found untested:
 *
 * 1. **The bridge's result** (`switchWriteResult`) for an open outcome whose
 *    re-read failed names both facts, not "reading back the change failed",
 *    which would say coord answered the write.
 * 2. **A later change** (`withWrite`) after an open outcome says a read made
 *    after the write gave the value — never "coord read back", which is what
 *    only an answered write's read-back may say.
 */

import { describe, expect, it } from "vitest";
import {
  switchWriteResult,
  withWrite,
  type GateCell,
  type SwitchWrite,
} from "./spawnPathGates";

function write(overrides: Partial<SwitchWrite> = {}): SwitchWrite {
  return {
    asked: "off",
    phase: "written",
    error: null,
    readbackError: null,
    settledState: "off",
    ...overrides,
  };
}

function cell(overrides: Partial<GateCell> = {}): GateCell {
  return { state: "on", text: "On", tone: "known", stale: false, ...overrides };
}

const askedText = (asked: string) => asked;

describe("switchWriteResult — an open outcome whose re-read failed", () => {
  it("says the outcome is unknown and the re-read failed", () => {
    expect(
      switchWriteResult(
        write({
          outcomeUnknown: true,
          readbackError: "HTTP 503",
          settledState: null,
        })
      )
    ).toEqual({
      outcome: "unknown",
      asked: "off",
      readBack: null,
      message:
        "whether the change to off landed is unknown, and reading what coord serves failed: HTTP 503",
    });
  });

  it("keeps the read-back wording for a write coord answered", () => {
    expect(
      switchWriteResult(
        write({ readbackError: "HTTP 503", settledState: null })
      ).message
    ).toBe("reading back the change to off failed: HTTP 503");
  });
});

describe("withWrite — a later change after an open outcome", () => {
  it("says a read made after it gave the value, not that coord read it back", () => {
    const note = withWrite(
      cell(),
      write({ outcomeUnknown: true }),
      askedText,
      false
    ).writeNote;
    expect(note).toBe(
      "Changed since your write: a read made after it gave off, and a later read differs."
    );
  });

  it("says coord read it back for a write coord answered", () => {
    expect(withWrite(cell(), write(), askedText, false).writeNote).toBe(
      "Changed since your write: coord read back off after it, and a later read differs."
    );
  });
});

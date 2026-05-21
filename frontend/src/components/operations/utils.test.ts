import { describe, it, expect } from "vitest";
import {
  extractSymbol,
  SYMBOL_NAME_MAX_LEN,
  SYMBOL_CLAIMS_TOP_N,
} from "./utils";

/**
 * Unit tests for the Phase 4.4 helpers in `operations/utils.ts`.
 *
 * `extractSymbol` is load-bearing for the "Editing: foo, bar" sub-line —
 * a regression here mis-renders every symbol in the dashboard, so we
 * pin the shape against the qontinui-supervisor `symbol_watcher`'s
 * resource_key convention (`<repo>:<file>:<symbol>`).
 */
describe("extractSymbol", () => {
  it("returns the last colon-separated component", () => {
    expect(
      extractSymbol("qontinui-runner:src/main.rs:run_loop"),
    ).toBe("run_loop");
  });

  it("handles Windows-style backslash paths in the file segment", () => {
    expect(
      extractSymbol("qontinui-runner:src\\main.rs:run_loop"),
    ).toBe("run_loop");
  });

  it("handles symbols with underscores and digits", () => {
    expect(
      extractSymbol("qontinui-web:backend/app/services/foo.py:_do_thing_v2"),
    ).toBe("_do_thing_v2");
  });

  it("returns full string when there's no colon (defensive)", () => {
    expect(extractSymbol("not_a_resource_key")).toBe("not_a_resource_key");
  });

  it("returns empty string when key ends with a colon", () => {
    expect(extractSymbol("repo:file:")).toBe("");
  });

  it("truncates symbol names longer than SYMBOL_NAME_MAX_LEN", () => {
    const longName = "a".repeat(SYMBOL_NAME_MAX_LEN + 5);
    const out = extractSymbol(`repo:file.rs:${longName}`);
    expect(out.length).toBe(SYMBOL_NAME_MAX_LEN);
    // Last char is the U+2026 horizontal ellipsis.
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not truncate names exactly at SYMBOL_NAME_MAX_LEN", () => {
    const exactName = "a".repeat(SYMBOL_NAME_MAX_LEN);
    const out = extractSymbol(`repo:file.rs:${exactName}`);
    expect(out).toBe(exactName);
    expect(out.length).toBe(SYMBOL_NAME_MAX_LEN);
  });
});

describe("Phase 4.4 constants", () => {
  it("renders top-5 by default per the plan", () => {
    expect(SYMBOL_CLAIMS_TOP_N).toBe(5);
  });

  it("symbol name budget is 30 chars per the plan", () => {
    expect(SYMBOL_NAME_MAX_LEN).toBe(30);
  });
});

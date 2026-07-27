import { describe, it, expect } from "vitest";
import {
  extractSymbol,
  summarizeClearanceProvenance,
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
    expect(extractSymbol("qontinui-runner:src/main.rs:run_loop")).toBe(
      "run_loop"
    );
  });

  it("handles Windows-style backslash paths in the file segment", () => {
    expect(extractSymbol("qontinui-runner:src\\main.rs:run_loop")).toBe(
      "run_loop"
    );
  });

  it("handles symbols with underscores and digits", () => {
    expect(
      extractSymbol("qontinui-web:backend/app/services/foo.py:_do_thing_v2")
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

/**
 * Clearance-provenance summary (plan
 * `2026-07-27-configurable-gate-clearance-authority` Phase 6).
 *
 * The load-bearing contract is the NULL case: a coord that predates the
 * provenance columns omits every field, and the summary MUST be null so the
 * gates panel / admin table render byte-identical to today. The positive
 * cases pin the sentence shape ("attested by agent <id8> on <id8> under rule
 * <id8>") and the graceful degrade for partial/unknown values.
 */
describe("summarizeClearanceProvenance", () => {
  const AGENT = "6f2a91c3-0000-0000-0000-000000000001";
  const DEVICE = "1b2c3d4e-0000-0000-0000-000000000002";
  const RULE = "9e8d7c6b-0000-0000-0000-000000000003";

  it("returns null when every field is absent (pre-deploy coord)", () => {
    expect(summarizeClearanceProvenance({})).toBeNull();
  });

  it("returns null when every field is explicitly null", () => {
    expect(
      summarizeClearanceProvenance({
        cleared_via: null,
        cleared_by_device_id: null,
        cleared_by_agent_id: null,
        cleared_under_rule: null,
      })
    ).toBeNull();
  });

  it("renders the full attest sentence with agent, device, and rule", () => {
    expect(
      summarizeClearanceProvenance({
        cleared_via: "agent_attest",
        cleared_by_agent_id: AGENT,
        cleared_by_device_id: DEVICE,
        cleared_under_rule: RULE,
      })
    ).toBe("attested by agent 6f2a91c3 on 1b2c3d4e under rule 9e8d7c6b");
  });

  it("device-only clearance says 'by <device>' (no fabricated agent)", () => {
    expect(
      summarizeClearanceProvenance({
        cleared_via: "agent_attest",
        cleared_by_device_id: DEVICE,
      })
    ).toBe("attested by 1b2c3d4e");
  });

  it("maps each cleared_via door to its verb", () => {
    const verb = (via: string) =>
      summarizeClearanceProvenance({ cleared_via: via });
    expect(verb("operator_route")).toBe("cleared by operator");
    expect(verb("agent_reject")).toBe("rejected");
    expect(verb("withdraw")).toBe("withdrawn");
    expect(verb("force_clear")).toBe("force-cleared");
    expect(verb("sweep")).toBe("cleared by sweep");
  });

  it("degrades an unknown cleared_via to 'cleared via <value>'", () => {
    expect(summarizeClearanceProvenance({ cleared_via: "future_door" })).toBe(
      "cleared via future_door"
    );
  });

  it("renders ids without cleared_via using the neutral 'cleared' verb", () => {
    expect(
      summarizeClearanceProvenance({ cleared_under_rule: RULE })
    ).toBe("cleared under rule 9e8d7c6b");
  });
});

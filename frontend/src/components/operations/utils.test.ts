import { describe, it, expect } from "vitest";
import {
  extractSymbol,
  formatBytes,
  percentFree,
  readingAgeMs,
  summarizeClearanceProvenance,
  SYMBOL_NAME_MAX_LEN,
  SYMBOL_CLAIMS_TOP_N,
  VOLUME_CRIT_FREE_BYTES,
  VOLUME_WARN_FREE_BYTES,
  volumeSeverity,
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

  it("actor-naming verbs take 'on <device>', never a double 'by'", () => {
    expect(
      summarizeClearanceProvenance({
        cleared_via: "operator_route",
        cleared_by_device_id: DEVICE,
      })
    ).toBe("cleared by operator on 1b2c3d4e");
    expect(
      summarizeClearanceProvenance({
        cleared_via: "sweep",
        cleared_by_device_id: DEVICE,
      })
    ).toBe("cleared by sweep on 1b2c3d4e");
  });

  it("degrades an unknown cleared_via to 'cleared via <value>'", () => {
    expect(summarizeClearanceProvenance({ cleared_via: "future_door" })).toBe(
      "cleared via future_door"
    );
  });

  it("renders ids without cleared_via using the neutral 'cleared' verb", () => {
    expect(summarizeClearanceProvenance({ cleared_under_rule: RULE })).toBe(
      "cleared under rule 9e8d7c6b"
    );
  });

  // -- band annotation (plan 2026-08-10-agent-gate-management P3) -----------
  //
  // The band is NOT on the gates wire; the caller derives it from the rule
  // set. These pin that the sentence reports exactly what it was TOLD, and
  // that "could not establish a band" reads as unknown rather than as either
  // band.

  it("names the band of the deciding rule when the caller supplies one", () => {
    const p = { cleared_via: "agent_attest", cleared_under_rule: RULE };
    expect(summarizeClearanceProvenance(p, { ruleBand: "tenant" })).toBe(
      "attested under tenant rule 9e8d7c6b"
    );
    expect(summarizeClearanceProvenance(p, { ruleBand: "system" })).toBe(
      "attested under system default rule 9e8d7c6b"
    );
  });

  it("says 'band unknown' rather than guessing when the band could not be established", () => {
    expect(
      summarizeClearanceProvenance(
        { cleared_via: "agent_attest", cleared_under_rule: RULE },
        { ruleBand: "unknown" }
      )
    ).toBe("attested under rule 9e8d7c6b (band unknown)");
  });

  it("is byte-identical to the un-annotated sentence when no band is given", () => {
    const p = { cleared_via: "agent_attest", cleared_under_rule: RULE };
    expect(summarizeClearanceProvenance(p, {})).toBe(
      summarizeClearanceProvenance(p)
    );
    expect(summarizeClearanceProvenance(p, { ruleBand: null })).toBe(
      summarizeClearanceProvenance(p)
    );
  });

  it("reports the audience default only for an AGENT door with no rule", () => {
    // Agent doors run a clearance-authority resolution, so a null rule id
    // means the built-in default decided — a real answer.
    expect(
      summarizeClearanceProvenance(
        { cleared_via: "agent_attest", cleared_by_device_id: DEVICE },
        { noteAudienceDefault: true }
      )
    ).toBe(
      "attested by 1b2c3d4e — no clearance rule matched (audience default)"
    );
    expect(
      summarizeClearanceProvenance(
        { cleared_via: "agent_reject" },
        { noteAudienceDefault: true }
      )
    ).toBe("rejected — no clearance rule matched (audience default)");
    // Operator/withdraw/sweep doors never resolve an authority, so claiming a
    // default decided them would be a fabrication.
    for (const via of ["operator_route", "withdraw", "force_clear", "sweep"]) {
      expect(
        summarizeClearanceProvenance(
          { cleared_via: via },
          { noteAudienceDefault: true }
        )
      ).toBe(summarizeClearanceProvenance({ cleared_via: via }));
    }
  });

  it("does not note the audience default unless the caller opts in", () => {
    expect(summarizeClearanceProvenance({ cleared_via: "agent_attest" })).toBe(
      "attested"
    );
  });
});

// ---------------------------------------------------------------------------
// Volume free-space formatters (disk monitoring Phase 1)
// ---------------------------------------------------------------------------
//
// These are the last mile of the honesty rule: a value that could not be
// computed must SAY so. Every one of these assertions exists to stop a
// fabricated `0`.

describe("formatBytes", () => {
  it("formats binary units with an explicit GiB/TiB label", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(100 * 1024 ** 3)).toBe("100.0 GiB");
    expect(formatBytes(4 * 1024 ** 4)).toBe("4.0 TiB");
  });

  it("returns 'unknown' for a value that could not be computed", () => {
    expect(formatBytes(Number.NaN)).toBe("unknown");
    expect(formatBytes(null)).toBe("unknown");
    expect(formatBytes(undefined)).toBe("unknown");
    expect(formatBytes(-1)).toBe("unknown");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("unknown");
  });
});

describe("percentFree", () => {
  it("computes a one-decimal percentage", () => {
    expect(percentFree(50, 100)).toBe(50);
    expect(percentFree(1, 3)).toBe(33.3);
  });

  it("returns null — not 0 — when the total is unusable", () => {
    expect(percentFree(10, 0)).toBeNull();
    expect(percentFree(10, -1)).toBeNull();
    expect(percentFree(Number.NaN, 100)).toBeNull();
    expect(percentFree(10, Number.NaN)).toBeNull();
  });
});

describe("volumeSeverity", () => {
  it("bands on the runner's own thresholds (100 GiB warn / 25 GiB crit)", () => {
    expect(volumeSeverity(VOLUME_WARN_FREE_BYTES)).toBe("ok");
    expect(volumeSeverity(VOLUME_WARN_FREE_BYTES - 1)).toBe("warn");
    expect(volumeSeverity(VOLUME_CRIT_FREE_BYTES)).toBe("warn");
    expect(volumeSeverity(VOLUME_CRIT_FREE_BYTES - 1)).toBe("critical");
    expect(volumeSeverity(0)).toBe("critical");
  });

  it("returns null — NOT 'ok' — for a non-finite reading", () => {
    // `NaN < CRIT` and `NaN < WARN` are BOTH false, so a naive banding falls
    // through to the green arm and badges an unmeasured volume as healthy.
    // The guard lives here, in the shared helper, rather than at each call
    // site: the next consumer is the one that forgets to check.
    expect(volumeSeverity(Number.NaN)).toBeNull();
    expect(volumeSeverity(Number.POSITIVE_INFINITY)).toBeNull();
    expect(volumeSeverity(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(volumeSeverity(Number.NaN)).not.toBe("ok");
  });
});

describe("readingAgeMs", () => {
  it("returns null for an absent or unparseable timestamp", () => {
    expect(readingAgeMs(null)).toBeNull();
    expect(readingAgeMs(undefined)).toBeNull();
    expect(readingAgeMs("not-a-date")).toBeNull();
  });

  it("clamps a future timestamp to 0 rather than going negative", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(readingAgeMs(future)).toBe(0);
  });

  it("measures elapsed time for a past timestamp", () => {
    const past = new Date(Date.now() - 120_000).toISOString();
    const age = readingAgeMs(past);
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(119_000);
  });
});

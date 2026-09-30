/**
 * The runner-report derivation (plan
 * `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8) and the one rule it holds: a report coord could not serve is
 * UNKNOWN with its reason — never "no incidents", never "no mechanisms".
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  CAPABILITY_ATTENTION_BY_STATE,
  CAPABILITY_PALETTE,
  WEDGE_ATTENTION_BY_STATE,
  WEDGE_PALETTE,
  capabilityStatus,
  groupCapability,
  resolveRunnerReports,
  wedgeStatus,
} from "./runnerReportStatus";
import type { RunnerReportMeta, RunnerReportsMeta } from "./useFleetHealth";

const FRESH: RunnerReportMeta = {
  absent_reason: null,
  received_at: "2026-09-30T09:59:00Z",
  stale: false,
  dropped_entries: 0,
  omitted_by_runner: 0,
  error: null,
};

function meta(
  wedge: Partial<RunnerReportMeta>,
  capability: Partial<RunnerReportMeta> = {}
): RunnerReportsMeta {
  return {
    wedge_incidents: { ...FRESH, ...wedge },
    capability: { ...FRESH, ...capability },
    stale_after_secs: 900,
  };
}

describe("palettes agree with their audit tables (§4.2)", () => {
  it("capability", () => {
    expect(
      paletteDisagreements(CAPABILITY_ATTENTION_BY_STATE, CAPABILITY_PALETTE)
    ).toEqual([]);
  });
  it("wedge", () => {
    expect(
      paletteDisagreements(WEDGE_ATTENTION_BY_STATE, WEDGE_PALETTE)
    ).toEqual([]);
  });
  it("unknown is never calm", () => {
    expect(CAPABILITY_ATTENTION_BY_STATE.unknown).toBe("waiting");
  });
});

describe("capabilityStatus / groupCapability", () => {
  it("maps each wire state and names an unrecognised one as unknown", () => {
    expect(
      capabilityStatus({ mechanism: "m", state: "INOPERATIVE-ON-THIS-MACHINE" })
        .kind
    ).toBe("inoperative");
    const odd = capabilityStatus({ mechanism: "m", state: "HALF-WORKING" });
    expect(odd.kind).toBe("unknown");
    expect(odd.reason).toContain('"HALF-WORKING"');
  });

  it("says when coord aged the runner's verdict", () => {
    const aged = capabilityStatus({
      mechanism: "m",
      state: "UNKNOWN",
      reported_state: "OPERATIVE",
    });
    expect(aged.kind).toBe("unknown");
    expect(aged.reason).toContain("(OPERATIVE) to UNKNOWN");
  });

  it("groups INOPERATIVE first, then degraded, unknown, operative; empty groups dropped", () => {
    const groups = groupCapability([
      { mechanism: "z-ok", state: "OPERATIVE" },
      { mechanism: "b-dead", state: "INOPERATIVE-ON-THIS-MACHINE" },
      { mechanism: "a-dead", state: "INOPERATIVE-ON-THIS-MACHINE" },
      { mechanism: "q", state: "UNKNOWN" },
    ]);
    expect(groups.map((g) => g.kind)).toEqual([
      "inoperative",
      "unknown",
      "operative",
    ]);
    expect(groups[0].rows.map((r) => r.mechanism)).toEqual(["a-dead", "b-dead"]);
  });
});

describe("wedgeStatus", () => {
  it("an incident with no end is OPEN and red", () => {
    const w = wedgeStatus({
      kind: "backend_wedged",
      began_at: "2026-09-30T09:00:00Z",
      ended_at: null,
    });
    expect(w.kind).toBe("open");
    expect(w.attention).toBe("author");
    expect(w.label).toBe("wedged: backend_wedged");
  });
});

describe("resolveRunnerReports — null is unknown with a reason, never none", () => {
  it("served lists are reads; an empty list is a measured none", () => {
    const r = resolveRunnerReports({
      wedge_incidents: [],
      capability: [],
      runner_reports: meta({}),
    });
    expect(r.wedge.state).toBe("read");
    expect(r.capability.state).toBe("read");
    if (r.wedge.state === "read") {
      expect(r.wedge.items.open).toEqual([]);
      expect(r.wedge.stale).toBe(false);
    }
  });

  it("carries coord's absent_reason verbatim, with the runner's own error", () => {
    const r = resolveRunnerReports({
      wedge_incidents: null,
      capability: null,
      runner_reports: meta(
        { absent_reason: "build_nameable_key_absent", received_at: null, stale: null },
        {
          absent_reason: "publisher_error",
          error: "capability dir unreadable",
        }
      ),
    });
    expect(r.wedge).toMatchObject({
      state: "unknown",
      reason: "build_nameable_key_absent",
    });
    expect(r.capability).toMatchObject({
      state: "unknown",
      reason: "publisher_error",
    });
    if (r.capability.state === "unknown") {
      expect(r.capability.detail).toContain("capability dir unreadable");
    }
  });

  it("a failed runner-report read is coord's failure, not the runner's silence", () => {
    const r = resolveRunnerReports({
      wedge_incidents: null,
      capability: null,
      runner_reports: null,
      runner_reports_scrape_up: false,
    });
    expect(r.wedge).toMatchObject({
      state: "unknown",
      reason: "runner-report read failed",
    });
  });

  it("a coord predating the fields is unknown, never none", () => {
    const r = resolveRunnerReports({});
    expect(r.wedge).toMatchObject({
      state: "unknown",
      reason: "coord does not serve runner reports",
    });
    expect(r.capability.state).toBe("unknown");
  });

  it("a stale or undated served report is shown but labelled stale", () => {
    const stale = resolveRunnerReports({
      wedge_incidents: [],
      capability: [],
      runner_reports: meta({ stale: true }, { stale: null }),
    });
    expect(stale.wedge.state === "read" && stale.wedge.stale).toBe(true);
    expect(stale.capability.state === "read" && stale.capability.stale).toBe(
      true
    );
  });

  it("splits open from ended incidents", () => {
    const r = resolveRunnerReports({
      wedge_incidents: [
        { kind: "a", began_at: "2026-09-30T09:00:00Z", ended_at: null },
        {
          kind: "b",
          began_at: "2026-09-29T09:00:00Z",
          ended_at: "2026-09-29T09:05:00Z",
          ended_by: "cleared",
        },
      ],
      capability: [],
      runner_reports: meta({}),
    });
    if (r.wedge.state !== "read") throw new Error("expected a read");
    expect(r.wedge.items.open.map((w) => w.incident.kind)).toEqual(["a"]);
    expect(r.wedge.items.ended.map((w) => w.incident.kind)).toEqual(["b"]);
  });
});

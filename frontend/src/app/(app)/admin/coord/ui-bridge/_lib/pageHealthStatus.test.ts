/**
 * Page health: the runner's report read into plain words, its severities
 * mapped without guessing, and the window's quoted text kept apart.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import { PAGE_HEALTH_BODY } from "../__fixtures__/runnerBodies";
import {
  OTHER_CHECK_LABEL,
  PAGE_HEALTH_ATTENTION_BY_KIND,
  PAGE_HEALTH_PALETTE,
  pageHealthKindOf,
  readPageHealth,
} from "./pageHealthStatus";

const report = () => {
  const r = readPageHealth(PAGE_HEALTH_BODY.data);
  if (r === null) throw new Error("fixture did not read");
  return r;
};

describe("pageHealthKindOf", () => {
  it("maps the runner's three severities and floors anything else at unknown", () => {
    expect(pageHealthKindOf("OK")).toBe("ok");
    expect(pageHealthKindOf("WARNING")).toBe("warning");
    expect(pageHealthKindOf("CRITICAL")).toBe("critical");
    for (const v of ["ok", "FATAL", undefined, null, 3]) {
      expect(pageHealthKindOf(v), String(v)).toBe("unknown");
    }
  });
});

describe("readPageHealth", () => {
  it("reads the summary, the counts and every finding", () => {
    const r = report();
    expect(r.summary).toBe("warning");
    expect(r.elementCount).toBe(47);
    expect(r.visibleCount).toBe(40);
    expect(r.findings.map((f) => [f.check, f.kind])).toEqual([
      ["spatial_coverage", "ok"],
      ["layout_regions", "ok"],
      ["element_diversity", "ok"],
      ["text_signals", "warning"],
      ["interactive_readiness", "ok"],
      ["visual_anomalies", "ok"],
    ]);
    expect(r.heatmap).toHaveLength(20);
  });

  it("names each check in an operator's words and says what it measured", () => {
    const byCheck = new Map(report().findings.map((f) => [f.check, f]));
    expect(byCheck.get("spatial_coverage")?.label).toBe("Screen coverage");
    expect(byCheck.get("spatial_coverage")?.summary).toBe(
      "Elements cover 64% of the window (left half 70%, right half 58%)."
    );
    expect(byCheck.get("layout_regions")?.summary).toBe(
      "12 in the sidebar, 4 in the header, 31 in the content area."
    );
    expect(byCheck.get("element_diversity")?.summary).toBe(
      "3 element types across 47 elements."
    );
    expect(byCheck.get("text_signals")?.summary).toBe(
      "0 error messages, 1 loading message, 0 empty-state messages, 0 loading styles."
    );
    expect(byCheck.get("interactive_readiness")?.summary).toBe(
      "20 controls, 2 disabled."
    );
    expect(byCheck.get("visual_anomalies")?.summary).toBe(
      "0 zero-size elements, 0 outside the window."
    );
  });

  it("keeps the window's quoted text apart from the counts", () => {
    const text = report().findings.find((f) => f.check === "text_signals");
    expect(text?.quoted?.loading).toEqual(["Loading sessions for Partner A"]);
    // The plain summary carries the count, never the quoted words.
    expect(text?.summary).not.toMatch(/Partner A/);
    const other = report().findings.find((f) => f.check === "layout_regions");
    expect(other?.quoted).toBeNull();
  });

  it("labels a check it does not know without inventing a reading", () => {
    const r = readPageHealth({
      summary: "OK",
      findings: [
        { check: "brand_new", severity: "OK", detail: "x=1", data: {} },
      ],
    });
    expect(r?.findings[0].label).toBe(OTHER_CHECK_LABEL);
    expect(r?.findings[0].summary).toBeNull();
    expect(r?.findings[0].runnerDetail).toBe("x=1");
  });

  it("is UNKNOWN (null) for a payload that is not a report", () => {
    expect(readPageHealth(undefined)).toBeNull();
    expect(readPageHealth({ summary: "OK" })).toBeNull();
  });

  it("reads a missing summary as unknown, never OK", () => {
    expect(readPageHealth({ findings: [] })?.summary).toBe("unknown");
  });

  it("rejects a malformed heatmap rather than drawing it", () => {
    expect(
      readPageHealth({ summary: "OK", findings: [], heatmap: ["#x#"] })?.heatmap
    ).toBeNull();
  });
});

describe("the page-health palette (R3)", () => {
  it("agrees with its attention table", () => {
    expect(
      paletteDisagreements(PAGE_HEALTH_ATTENTION_BY_KIND, PAGE_HEALTH_PALETTE)
    ).toEqual([]);
  });

  it("borrows red only for CRITICAL and amber only for UNKNOWN", () => {
    expect(PAGE_HEALTH_ATTENTION_BY_KIND).toEqual({
      ok: "none",
      warning: "none",
      critical: "author",
      unknown: "waiting",
    });
  });
});

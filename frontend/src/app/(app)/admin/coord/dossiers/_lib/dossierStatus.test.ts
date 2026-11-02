import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import { deriveFindingsBound } from "../../findings/_lib/findingStatus";
import {
  DOSSIER_ATTENTION_BY_REMEDIATION,
  DOSSIER_STATUS_PALETTE,
  REMEDIATION_STATES,
  deriveDossierStatus,
  deriveDossiersHealth,
  readinessLabel,
  readinessOptions,
  recurrenceLabel,
  remediationFacetCount,
  remediationHref,
  remediationKindOf,
} from "./dossierStatus";

describe("dossierStatus", () => {
  it("the palette agrees with the attention table", () => {
    expect(
      paletteDisagreements(
        DOSSIER_ATTENTION_BY_REMEDIATION,
        DOSSIER_STATUS_PALETTE
      )
    ).toEqual([]);
  });

  it("covers every state coord serves", () => {
    for (const s of REMEDIATION_STATES) {
      expect(remediationKindOf(s)).toBe(s);
    }
  });

  it("a state newer than this frontend is unrecognised and amber, never calm", () => {
    const status = deriveDossierStatus({ remediation_state: "superseded" });
    expect(status.kind).toBe("unrecognised");
    expect(status.attention).toBe("waiting");
    expect(deriveDossierStatus({ remediation_state: null }).kind).toBe(
      "unrecognised"
    );
  });

  it("unknown is amber and never reads as no plan", () => {
    const unknown = deriveDossierStatus({ remediation_state: "unknown" });
    const none = deriveDossierStatus({ remediation_state: "none" });
    expect(unknown.attention).toBe("waiting");
    expect(none.attention).toBe("none");
    expect(unknown.label).not.toBe(none.label);
    expect(unknown.reason).toMatch(/not none/);
  });

  it("null readiness and recurrence read as unknown, never a default", () => {
    expect(readinessLabel(null)).toBe("readiness unknown");
    expect(readinessLabel("  ")).toBe("readiness unknown");
    expect(readinessLabel("ready_for_pvi")).toBe("ready for pvi");
    expect(recurrenceLabel(null)).toBe("recurrences unknown");
    expect(recurrenceLabel(0)).toBe("0 recurrences");
    expect(recurrenceLabel(1)).toBe("1 recurrence");
  });

  it("links a remediation only when coord resolved its work unit", () => {
    expect(
      remediationHref({ plan: "2026-10-03-a b", live_status: "in_progress" })
    ).toBe("/admin/coord/work-units/2026-10-03-a%20b");
    // coord resolves the stem with the directory and `.md` stripped; so must the link.
    expect(
      remediationHref({ plan: "plans/2026-10-03-x.md", live_status: "draft" })
    ).toBe("/admin/coord/work-units/2026-10-03-x");
    expect(remediationHref({ plan: "x", live_status: null })).toBeNull();
    expect(remediationHref({ plan: " ", live_status: "draft" })).toBeNull();
  });

  it("readiness options follow the facet by count and keep the selected values", () => {
    expect(
      readinessOptions({ accumulating: 3, ready_for_pvi: 5, none: 3 }, [
        "folded",
      ])
    ).toEqual([
      { value: "ready_for_pvi", count: 5 },
      { value: "accumulating", count: 3 },
      { value: "none", count: 3 },
      { value: "folded", count: 0 },
    ]);
    // No facet: the vocabulary is unknown, so a selected value's count is too.
    expect(readinessOptions(null, ["folded"])).toEqual([
      { value: "folded", count: null },
    ]);
  });

  it("a missing remediation facet counts nothing, rather than zero", () => {
    expect(remediationFacetCount(null, "none")).toBeNull();
    expect(remediationFacetCount({ none: 0 }, "none")).toBe(0);
    expect(remediationFacetCount({}, "none")).toBeNull();
  });

  describe("deriveDossiersHealth", () => {
    const complete = deriveFindingsBound({
      boundKind: "complete",
      truncated: false,
      limit: 50,
      lastPageRows: 3,
      rowsLoaded: 3,
      total: 3,
    });

    it("an unread list is a dash and amber", () => {
      const h = deriveDossiersHealth({
        bound: null,
        loaded: false,
        failed: false,
        unavailable: null,
      });
      expect(h.level).toBe("amber");
      expect(h.badges[0]?.label).toBe("– shown");
    });

    it("a degraded read says it could not read, with no count", () => {
      const h = deriveDossiersHealth({
        bound: complete,
        loaded: false,
        failed: false,
        unavailable: "coord is down",
      });
      expect(h.headline).toBe("Dossiers could not be read");
      expect(h.badges).toHaveLength(1);
      expect(h.badges[0]?.label).toBe("– shown");
    });

    it("a complete list is green and carries coord's total", () => {
      const h = deriveDossiersHealth({
        bound: complete,
        loaded: true,
        failed: false,
        unavailable: null,
      });
      expect(h.level).toBe("green");
      expect(h.badges.map((b) => b.label)).toEqual(["all 3 shown", "3 match"]);
    });

    it("a list whose bound is unknown is amber", () => {
      const unknown = deriveFindingsBound({
        boundKind: null,
        truncated: null,
        limit: 50,
        lastPageRows: 50,
        rowsLoaded: 50,
        total: null,
      });
      const h = deriveDossiersHealth({
        bound: unknown,
        loaded: true,
        failed: false,
        unavailable: null,
      });
      expect(h.level).toBe("amber");
    });
  });
});

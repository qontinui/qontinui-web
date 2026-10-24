import { describe, expect, it } from "vitest";

import { manifest } from "./resolve";
import {
  RESTRICTED_COUNT_MEANING,
  STATUS_STYLES,
  formatRatio,
  pageAccessLabel,
  presentStatus,
} from "./status-presentation";

describe("presentStatus", () => {
  it("sends a row to Ask the Twin only when Ask the Twin can call its tool", () => {
    expect(
      presentStatus({ cellStatus: "interactive", ask_via: "ask-the-twin" })
    ).toEqual(STATUS_STYLES.interactive);
    // The Lifecycle tab renders these cells too, and Ask the Twin is not on
    // it — so the tooltip names the tab the panel lives on.
    expect(STATUS_STYLES.interactive.meaning).toContain(
      "Ask the Twin (Completeness tab)"
    );
  });

  it("points a delivery row at the Delivery tab", () => {
    const style = presentStatus({
      cellStatus: "interactive",
      ask_via: "delivery-tab",
    });
    expect(style.meaning).toContain("Delivery tab");
    expect(style.meaning).not.toContain("ask it in Ask the Twin");
    expect(style.dot).toBe(STATUS_STYLES.interactive.dot);
  });

  it("never offers a door the page does not have", () => {
    const style = presentStatus({
      cellStatus: "interactive",
      ask_via: "not-on-this-page",
    });
    expect(style.label).toBe("Built · not askable here");
    expect(style.meaning).toContain("nothing on this page can ask it");
    expect(style.meaning).not.toContain("ask it in Ask the Twin");
  });

  it("leaves every other status as STATUS_STYLES renders it", () => {
    expect(
      presentStatus({ cellStatus: "unprobed", ask_via: "not-on-this-page" })
    ).toEqual(STATUS_STYLES.unprobed);
    expect(presentStatus({ cellStatus: "implemented" })).toEqual(
      STATUS_STYLES.implemented
    );
  });
});

describe("pageAccessLabel", () => {
  it("says how this page can read each kind of row", () => {
    expect(pageAccessLabel({ query_kind: "snapshot" })).toBe("Live-probed");
    expect(
      pageAccessLabel({ query_kind: "parameterized", ask_via: "ask-the-twin" })
    ).toBe("Ask the Twin (Completeness tab)");
    expect(
      pageAccessLabel({ query_kind: "parameterized", ask_via: "delivery-tab" })
    ).toBe("Delivery tab");
    expect(
      pageAccessLabel({
        query_kind: "parameterized",
        ask_via: "not-on-this-page",
      })
    ).toBe("Not askable here");
    expect(pageAccessLabel({ query_kind: "none" })).toBe(
      "Manifest claim (no coord tool)"
    );
  });

  it("lets coord's declaration outrank the manifest's query kind", () => {
    // coord declares a row the manifest calls parameterized: live-probed.
    expect(
      pageAccessLabel({
        query_kind: "parameterized",
        ask_via: "ask-the-twin",
        liveProbed: true,
      })
    ).toBe("Live-probed");
    // A manifest snapshot row coord does not declare: drift, said as drift.
    expect(pageAccessLabel({ query_kind: "snapshot", liveProbed: false })).toBe(
      "Not served by coord"
    );
  });

  it("never shows the raw query kind, which contradicts coord's catalog for some tools", () => {
    // coord's catalog lists these tools as kind `snapshot`; on this page
    // `parameterized` only means "not probed here".
    const byId = new Map(manifest.subspaces.map((s) => [s.id, s]));
    expect(pageAccessLabel(byId.get("twin_fidelity")!)).toBe(
      "Ask the Twin (Completeness tab)"
    );
    expect(pageAccessLabel(byId.get("cost")!)).toBe("Not askable here");
    for (const s of manifest.subspaces) {
      expect(pageAccessLabel(s), s.id).not.toMatch(/snapshot|parameterized/i);
    }
  });
});

describe("the per-cell statuses Phase 9 adds", () => {
  it("words a refused cell as that sub-space being internal, not the whole twin", () => {
    expect(STATUS_STYLES.restricted.meaning).toContain("Qontinui-internal");
    expect(STATUS_STYLES.restricted.meaning).toContain(
      "other sub-spaces are unaffected"
    );
  });

  it("keeps a served report out of the healthy and the failed vocabulary", () => {
    for (const status of ["implemented", "partial", "error"] as const) {
      expect(STATUS_STYLES.served.dot).not.toBe(STATUS_STYLES[status].dot);
    }
    expect(STATUS_STYLES.served.meaning).toContain("not graded");
  });

  it("names manifest/coord drift as not served by coord", () => {
    expect(STATUS_STYLES["not-served"].label).toBe("Not served by coord");
  });
});

describe("formatRatio", () => {
  it("formats a ratio as a rounded percentage", () => {
    expect(formatRatio(0.9)).toBe("90%");
    expect(formatRatio(1)).toBe("100%");
    expect(formatRatio(0)).toBe("0%");
    expect(formatRatio(0.954)).toBe("95%");
  });

  it("renders an em-dash for null / undefined", () => {
    expect(formatRatio(null)).toBe("—");
    expect(formatRatio(undefined)).toBe("—");
  });

  it("renders an em-dash for NaN (the prod Auth-credibility bug)", () => {
    // A coord verdict can carry a non-numeric credibility; it must not render
    // as "NaN%" — observed live on the Auth sub-space cell.
    expect(formatRatio(NaN)).toBe("—");
  });
});

describe("STATUS_STYLES.restricted", () => {
  it("never shares a fill class with a roadmap row or an in-flight probe", () => {
    // The Lifecycle bar paints its restricted, pending and unbuilt segments
    // from these same three dots, and the matrix shows restricted cells
    // beside planned ones. Class tokens are compared, so each light and
    // dark variant is checked against its counterpart.
    const restricted = STATUS_STYLES.restricted.dot.split(" ");
    for (const other of ["planned", "probing", "not-built"] as const) {
      const fills = STATUS_STYLES[other].dot.split(" ");
      expect(restricted.filter((c) => fills.includes(c))).toEqual([]);
    }
  });

  it("describes a per-cell refusal, not the whole-twin gate", () => {
    expect(STATUS_STYLES.restricted.meaning).toContain("this sub-space");
    expect(STATUS_STYLES.restricted.meaning).not.toContain(
      "internal operators"
    );
  });

  it("gives the gauge's restricted count a plural tooltip", () => {
    expect(RESTRICTED_COUNT_MEANING).toContain("these sub-spaces");
  });
});

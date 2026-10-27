import { describe, expect, it } from "vitest";

import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import { manifest } from "./resolve";
import {
  RESTRICTED_COUNT_MEANING,
  STATUS_STYLES,
  formatRatio,
  pageAccessLabel,
  presentDrawerStatus,
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

describe("STATUS_STYLES.unknown — a live row the probe holds no reading of", () => {
  it("says UNKNOWN on the ignorance floor, never the failed read's red or a live hue", () => {
    expect(STATUS_STYLES.unknown.label).toBe("UNKNOWN");
    const dot = STATUS_STYLES.unknown.dot.split(" ");
    for (const c of UNKNOWN_AMBER.split(" ")) expect(dot).toContain(c);
    for (const other of ["error", "partial", "implemented"] as const) {
      const fills = STATUS_STYLES[other].dot.split(" ");
      expect(
        dot.filter((c) => fills.includes(c)),
        other
      ).toEqual([]);
    }
    expect(STATUS_STYLES.unknown.meaning).not.toContain("was probed");
  });

  it("names why there is no reading in the row's meaning, not the observer failing", () => {
    const reason =
      "coord's live probe could not be made: coord could not be reached";
    const style = presentStatus({
      cellStatus: "unknown",
      unknownReason: reason,
    });
    expect(style.label).toBe("UNKNOWN");
    expect(style.meaning).toMatch(
      /^Coord's live probe could not be made: coord could not be reached, so there is no current reading of this observer/
    );
    expect(style.meaning).not.toBe(STATUS_STYLES.error.meaning);
    // Without a reason it still says what it is.
    expect(presentStatus({ cellStatus: "unknown" })).toEqual(
      STATUS_STYLES.unknown
    );
  });
});

describe("presentDrawerStatus — the drawer's own read beside an UNKNOWN row", () => {
  const reason = "coord's live probe could not be read (HTTP 502)";
  const unknownRow = { cellStatus: "unknown" as const, unknownReason: reason };

  it("stops saying there is no reading once the drawer's own read has answered", () => {
    const style = presentDrawerStatus(unknownRow, true);
    // The page still has no status for the row: the cell's UNKNOWN stands.
    expect(style.label).toBe("UNKNOWN");
    expect(style.dot).toBe(STATUS_STYLES.unknown.dot);
    expect(style.meaning).toBe(
      "Coord's live probe could not be read (HTTP 502), so this page has no status for this observer; the Summary above is this drawer's own read of it."
    );
    expect(style.meaning).not.toMatch(/no current reading/);
  });

  it("keeps the row's own meaning while the drawer holds no read of its own", () => {
    // No read made, one in flight, or one that failed: nothing on the page
    // has read the observer, so "no current reading" is true.
    expect(presentDrawerStatus(unknownRow, false)).toEqual(
      presentStatus(unknownRow)
    );
    expect(presentDrawerStatus(unknownRow, false).meaning).toMatch(
      /so there is no current reading of this observer/
    );
  });

  it("changes nothing for a row the probe has a status for", () => {
    for (const cellStatus of ["implemented", "error", "probing"] as const) {
      expect(presentDrawerStatus({ cellStatus }, true), cellStatus).toEqual(
        presentStatus({ cellStatus })
      );
    }
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

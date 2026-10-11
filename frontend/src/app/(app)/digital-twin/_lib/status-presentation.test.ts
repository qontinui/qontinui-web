import { describe, expect, it } from "vitest";

import {
  STATUS_STYLES,
  formatRatio,
  presentStatus,
} from "./status-presentation";

describe("presentStatus", () => {
  it("sends a row to Ask the Twin only when Ask the Twin can call its tool", () => {
    expect(
      presentStatus({ cellStatus: "interactive", ask_via: "ask-the-twin" })
    ).toEqual(STATUS_STYLES.interactive);
    expect(STATUS_STYLES.interactive.meaning).toContain("Ask the Twin");
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

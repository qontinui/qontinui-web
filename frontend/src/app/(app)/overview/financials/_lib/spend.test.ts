import { describe, expect, it } from "vitest";
import {
  breakdownRows,
  combineFigure,
  combinedText,
  dailyBars,
  daysBetween,
  meterTone,
  unavailableSentence,
} from "./spend";
import type { SpendAlert, SpendSeriesRow, SpendVendor } from "./spend-api";

/**
 * The page's two promises, as pure rules: an UNKNOWN figure is never added
 * as 0 (a total over it is a floor that names who is missing), and a day
 * nobody reported is a gap, not a $0 day.
 */

function vendor(over: Partial<SpendVendor> = {}): SpendVendor {
  return {
    id: "gh",
    name: "GitHub",
    category: "source_hosting",
    connector: "github_billing",
    status: "ok",
    status_reason: null,
    last_ok_at: "2026-10-03T06:10:00Z",
    newest_complete_day: "2026-10-02",
    expected_lag_hours: 24,
    provenance: "as reported by GitHub billing usage API",
    month_to_date_micros: 997_790_000,
    ceiling_micros: 750_000_000,
    ceiling_pct: 133,
    today_micros: 249_124_000,
    yesterday_micros: 359_446_000,
    last_month_micros: 3_867_340_000,
    balance_micros: null,
    ...over,
  };
}

const workspace = vendor({
  id: "gw",
  name: "Google Workspace",
  connector: null,
  status: "manual",
  provenance: null,
  month_to_date_micros: 36_000_000,
  ceiling_micros: null,
  ceiling_pct: null,
  today_micros: 1_200_000,
  yesterday_micros: 1_200_000,
  last_month_micros: 36_000_000,
});

describe("a figure added across providers", () => {
  it("is a plain total when every provider reported", () => {
    const combined = combineFigure(
      [vendor(), workspace],
      "month_to_date_micros"
    );
    expect(combined.knownMicros).toBe(1_033_790_000);
    expect(combinedText(combined, "USD")).toEqual({
      text: "$1,033.79",
      partial: false,
    });
  });

  it("is a floor naming the provider that is not available — never a bare total", () => {
    const aws = vendor({
      id: "aws",
      name: "AWS",
      status: "failed",
      status_reason: "Cost Explorer refused the request",
      month_to_date_micros: null,
    });
    const combined = combineFigure([vendor(), aws], "month_to_date_micros");
    expect(combined.missing.map((v) => v.name)).toEqual(["AWS"]);
    const { text, partial } = combinedText(combined, "USD");
    expect(partial).toBe(true);
    expect(text).toBe("at least $997.79 (AWS not available)");
  });

  it("does not count an unknown figure as zero", () => {
    const unknown = vendor({ yesterday_micros: null, status: "stale" });
    const combined = combineFigure([unknown], "yesterday_micros");
    expect(combined.knownMicros).toBeNull();
    expect(combinedText(combined, "USD").text).toBeNull();
  });

  it("keeps a real $0 as $0", () => {
    const play = vendor({
      id: "gp",
      name: "Google Play",
      status: "manual",
      connector: null,
      today_micros: 0,
    });
    const combined = combineFigure([play], "today_micros");
    expect(combinedText(combined, "USD")).toEqual({
      text: "$0",
      partial: false,
    });
  });

  it("marks a stale provider's figure as possibly incomplete", () => {
    const stale = vendor({ status: "stale" });
    const { text } = combinedText(
      combineFigure([stale, workspace], "month_to_date_micros"),
      "USD"
    );
    expect(text).toBe("at least $1,033.79 (GitHub may be incomplete)");
  });
});

describe("an unavailable provider says since when and why", () => {
  it("names the last complete day and the reason", () => {
    expect(
      unavailableSentence(
        vendor({
          status: "stale",
          newest_complete_day: "2026-10-01",
          status_reason: "no day newer than Oct 1 has been imported",
        })
      )
    ).toBe(
      "Not available since Oct 1, 2026 — no day newer than Oct 1 has been imported"
    );
  });

  it("has no date for a provider never fetched", () => {
    expect(
      unavailableSentence(
        vendor({
          status: "never",
          newest_complete_day: null,
          last_ok_at: null,
          status_reason: null,
        })
      )
    ).toBe("Not available — nothing has been fetched from this provider yet");
  });
});

describe("the daily bars", () => {
  const series: SpendSeriesRow[] = [
    {
      key: "2026-10-01",
      vendor_id: "gh",
      net_micros: 389_220_000,
      gross_micros: null,
      discount_micros: null,
      source: "connector",
    },
    {
      key: "2026-10-03",
      vendor_id: "gh",
      net_micros: 0,
      gross_micros: 0,
      discount_micros: 0,
      source: "connector",
    },
    {
      key: "2026-10-03",
      vendor_id: "gw",
      net_micros: 1_200_000,
      gross_micros: null,
      discount_micros: null,
      source: "recurring",
    },
  ];
  const bars = dailyBars(
    series,
    [vendor(), workspace],
    "2026-10-01",
    "2026-10-03"
  );

  it("has one entry per day in the window", () => {
    expect(bars.map((b) => b.day)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("leaves a day nobody reported as a gap, not zeros", () => {
    const oct2 = bars[1]!;
    expect(oct2.hasData).toBe(false);
    expect(oct2.values).toEqual({ gh: null, gw: null });
  });

  it("leaves a provider that did not report a day as null beside one that did", () => {
    expect(bars[0]!.values).toEqual({ gh: 389.22, gw: null });
  });

  it("keeps a reported zero as zero", () => {
    expect(bars[2]!.values).toEqual({ gh: 0, gw: 1.2 });
  });

  it("refuses a reversed window rather than inventing days", () => {
    expect(daysBetween("2026-10-03", "2026-10-01")).toEqual([]);
  });
});

describe("the breakdown rows", () => {
  it("keeps gross and discount unreported rather than zero, and sorts by net", () => {
    const rows = breakdownRows([
      {
        key: "qontinui-web",
        vendor_id: "gh",
        net_micros: 10_000_000,
        gross_micros: 12_000_000,
        discount_micros: 2_000_000,
        source: "connector",
      },
      {
        key: "Workspace",
        vendor_id: "gw",
        net_micros: 36_000_000,
        gross_micros: null,
        discount_micros: null,
        source: "recurring",
      },
      {
        key: "unknown",
        vendor_id: "gh",
        net_micros: null,
        gross_micros: null,
        discount_micros: null,
        source: "connector",
      },
    ]);
    expect(rows.map((r) => r.key)).toEqual([
      "Workspace",
      "qontinui-web",
      "unknown",
    ]);
    expect(rows[0]).toMatchObject({
      gross: null,
      discount: null,
      net: 36_000_000,
    });
    expect(rows[2]).toMatchObject({ net: null, incomplete: true });
  });
});

describe("the month-to-date meter", () => {
  const alert: SpendAlert = {
    id: "a1",
    rule: "mtd_threshold",
    scope_key: "org",
    period_key: "2026-10",
    observed_micros: 400_000_000,
    threshold_micros: 375_000_000,
    fired_at: "2026-10-02T06:00:00Z",
    push_status: "delivered",
    resolved_at: null,
    vendor_id: "gh",
    coord_status: "pending",
    detail: {},
  };

  it("is over at or past the ceiling", () => {
    expect(meterTone(vendor(), [], "2026-10")).toBe("over");
  });

  it("turns warning once a threshold alert fired this month", () => {
    const under = vendor({ ceiling_pct: 53 });
    expect(meterTone(under, [], "2026-10")).toBe("normal");
    expect(meterTone(under, [alert], "2026-10")).toBe("warning");
    expect(meterTone(under, [alert], "2026-11")).toBe("normal");
  });
});

describe("a connector's covered days", () => {
  const covered = vendor({
    oldest_covered_day: "2026-10-02",
    newest_complete_day: "2026-10-03",
    uncovered_days: [],
  });

  it("reads a covered day with no line as a reported $0", () => {
    const bars = dailyBars([], [covered], "2026-10-01", "2026-10-04");
    expect(bars.map((b) => b.values.gh)).toEqual([null, 0, 0, null]);
    expect(bars.map((b) => b.hasData)).toEqual([false, true, true, false]);
  });

  it("assumes nothing when the server does not say what it covers", () => {
    const unknownCoverage = vendor({ newest_complete_day: "2026-10-03" });
    expect("oldest_covered_day" in unknownCoverage).toBe(false);
    const bars = dailyBars([], [unknownCoverage], "2026-10-02", "2026-10-03");
    expect(bars.map((b) => b.values.gh)).toEqual([null, null]);
  });

  it("keeps a hole in the covered span as a gap", () => {
    const holed = vendor({
      oldest_covered_day: "2026-10-01",
      newest_complete_day: "2026-10-03",
      uncovered_days: ["2026-10-02"],
    });
    const bars = dailyBars([], [holed], "2026-10-01", "2026-10-03");
    expect(bars.map((b) => b.values.gh)).toEqual([0, null, 0]);
  });

  it("fills nothing when the server does not list the span's holes", () => {
    const noHoles = vendor({
      oldest_covered_day: "2026-10-01",
      newest_complete_day: "2026-10-03",
    });
    expect("uncovered_days" in noHoles).toBe(false);
    const bars = dailyBars([], [noHoles], "2026-10-01", "2026-10-03");
    expect(bars.map((b) => b.values.gh)).toEqual([null, null, null]);
  });

  it("never fills a manual vendor's days", () => {
    const manual = vendor({
      connector: null,
      status: "manual",
      oldest_covered_day: "2026-10-01",
      newest_complete_day: "2026-10-03",
      uncovered_days: [],
    });
    const bars = dailyBars([], [manual], "2026-10-01", "2026-10-02");
    expect(bars.map((b) => b.values.gh)).toEqual([null, null]);
  });
});

/**
 * The words of the work-unit KPIs (plan
 * `2026-10-09-kpi-telemetry-and-dashboards` Phase 4).
 *
 * Pinned, because each is a way to turn UNKNOWN into a number:
 *   - `value === null` is `unknown` with its reason in words and its coverage —
 *     never `0`, never a dash, never blank;
 *   - a KNOWN zero is `0`, and is not mistaken for unknown (the inverse error);
 *   - partial coverage prints `(n/m)` beside the number;
 *   - cost is labelled a list-price equivalent, on the column and the row;
 *   - a half-known token pair is never summed or padded;
 *   - a unit coord returned no row for is "none in window" or "unknown" by
 *     whether the answer was truncated — not a row of zeros.
 */

import { describe, expect, it } from "vitest";
import { kpi, payload, unit, unknown } from "@/test/kpisFixtures";
import {
  KPI_COLUMNS,
  LIST_PRICE_LABEL,
  coverageText,
  describeKpi,
  describeKpiIndex,
  formatCompactCount,
  formatMicroUsd,
  formatSeconds,
  indexKpis,
  interventionsSplitText,
  kpiCell,
  kpiPanelSummary,
  kpiTitle,
  outsideChipText,
  prsText,
  reasonWords,
  unitBlockRows,
  unitColumnViews,
  KPI_PENDING,
  NEGATIVE_COST_TEXT,
  NEGATIVE_DURATION_TEXT,
  formatSessions,
} from "./workUnitKpis";
import { formatDurationSecs } from "@/components/operations/fleetReadout";

describe("describeKpi", () => {
  it("renders a null value as unknown with its reason and coverage — never 0", () => {
    const v = describeKpi(unknown("no_usage_rows"), (n) => String(n));
    expect(v.kind).toBe("unknown");
    expect(v.text).toBe("unknown");
    expect(v.detail).toBe("unknown — no usage rows recorded (0 of 3 observed)");
    expect(v.reason).toBe("no_usage_rows");
    expect(v.partial).toBe(false);
    for (const s of [v.text, v.detail]) {
      expect(s).not.toMatch(/^0$/);
      expect(s).not.toBe("-");
      expect(s).not.toBe("");
    }
  });

  it("keeps an unrecognised reason as its raw code rather than dropping it", () => {
    const v = describeKpi(unknown("brand_new_reason"), String);
    expect(v.detail).toBe("unknown — brand_new_reason (0 of 3 observed)");
    expect(v.reason).toBe("brand_new_reason");
  });

  it("says so when an UNKNOWN figure arrives with no reason (a contract breach), still not zero", () => {
    const broken = { ...unknown("x"), reason: null };
    const v = describeKpi(broken, String);
    expect(v.kind).toBe("unknown");
    expect(v.detail).toContain("unknown — no reason given");
  });

  it("treats a non-null reason as UNKNOWN even when a value rides along — the number is not shown", () => {
    // The contract: reason is non-null IFF value is null. A figure carrying
    // both is coord contradicting itself; it must not print as `$0.00`.
    const contradictory = {
      value: 0,
      coverage_n: 0,
      population_n: 3,
      basis: "list-price equivalent",
      reason: "no_usage_rows",
    };
    const v = describeKpi(contradictory, formatMicroUsd, {
      suffix: LIST_PRICE_LABEL,
    });
    expect(v.kind).toBe("unknown");
    expect(v.text).toBe("unknown");
    expect(v.detail).toBe("unknown — no usage rows recorded (0 of 3 observed)");
    expect(v.reason).toBe("no_usage_rows");
    expect(v.partial).toBe(false);
    for (const s of [v.text, v.detail]) expect(s).not.toMatch(/\$/);
    // A non-zero value with a reason is hidden the same way.
    expect(describeKpi({ ...contradictory, value: 7 }, String).text).toBe(
      "unknown"
    );
  });

  it("keeps an absent reason on a known value known", () => {
    const { reason: _reason, ...noReason } = kpi(5);
    expect(describeKpi(noReason as never, String).kind).toBe("known");
  });

  it("treats a figure missing from the answer as unknown, not as zero", () => {
    const v = describeKpi(undefined, String);
    expect(v.kind).toBe("unknown");
    expect(v.text).toBe("unknown");
    expect(v.detail).toBe("unknown — not served by this coord");
    expect(v.coverage).toBe("coverage unknown");
  });

  it("renders a KNOWN zero as 0 — the inverse mistake is also a lie", () => {
    const v = describeKpi(kpi(0), (n) => String(n));
    expect(v.kind).toBe("known");
    expect(v.text).toBe("0");
    expect(v.detail).toBe("0 (1 of 1 observed)");
  });

  it("marks partial coverage on the cell text and the sentence", () => {
    const v = describeKpi(
      kpi(5400, { coverage_n: 2, population_n: 3, basis: "units" }),
      formatSeconds
    );
    expect(v.kind).toBe("known");
    expect(v.partial).toBe(true);
    expect(v.text).toBe("1h 30m (2/3)");
    expect(v.detail).toBe("1h 30m (2 of 3 observed)");
    expect(v.basis).toBe("units");
  });

  it("does not mark full coverage as partial", () => {
    const v = describeKpi(
      kpi(5400, { coverage_n: 3, population_n: 3 }),
      formatSeconds
    );
    expect(v.partial).toBe(false);
    expect(v.text).toBe("1h 30m");
  });

  it("puts a unit suffix on the sentence only", () => {
    const v = describeKpi(kpi(2_500_000), formatMicroUsd, {
      suffix: LIST_PRICE_LABEL,
    });
    expect(v.text).toBe("$2.50");
    expect(v.detail).toBe("$2.50 list-price equivalent (1 of 1 observed)");
  });

  it("builds a hover from label, sentence and basis", () => {
    const v = describeKpi(kpi(7, { basis: "cited PRs" }), String);
    expect(kpiTitle("CI attempts", v)).toBe(
      "CI attempts: 7 (1 of 1 observed) — cited PRs"
    );
  });
});

describe("negative durations", () => {
  it("prints a negative duration as a visible anomaly, never 0s", () => {
    expect(formatSeconds(-120)).toBe(NEGATIVE_DURATION_TEXT);
    expect(NEGATIVE_DURATION_TEXT).toBe("negative (timestamps out of order)");
    const v = describeKpi(kpi(-120), formatSeconds);
    expect(v.kind).toBe("known");
    expect(v.text).toBe("negative (timestamps out of order)");
    expect(v.text).not.toContain("0s");
  });

  it("reaches the segment rows of a unit whose PR was opened before it went in_progress", () => {
    const rows = unitBlockRows(
      unit("a", {
        lead_time_segments: {
          in_progress_to_first_pr_opened_seconds: kpi(-300),
          first_pr_opened_to_last_landed_seconds: kpi(3600),
        },
      })
    );
    const seg = rows.find((r) => r.id === "lead_time_to_first_pr")!;
    expect(seg.view.text).toBe("negative (timestamps out of order)");
    expect(seg.view.detail).toBe(
      "negative (timestamps out of order) (1 of 1 observed)"
    );
    expect(seg.view.detail).not.toContain("0s");
  });

  it("leaves zero and positive durations as they were", () => {
    expect(formatSeconds(0)).toBe("0s");
    expect(formatSeconds(5400)).toBe("1h 30m");
  });

  it("does not change the shared helper's clamp for its other callers", () => {
    expect(formatDurationSecs(-5)).toBe("0s");
  });
});

describe("formatters", () => {
  it("formats micro-USD as dollars, with four places below a cent", () => {
    expect(formatMicroUsd(2_500_000)).toBe("$2.50");
    expect(formatMicroUsd(0)).toBe("$0.00");
    expect(formatMicroUsd(1_234)).toBe("$0.0012");
    expect(formatMicroUsd(1_000_000_000)).toBe("$1,000.00");
  });

  it("prints <$0.0001 for a positive cost that would round to zero — never $0.0000", () => {
    for (const micro of [1, 2, 25, 49]) {
      expect(formatMicroUsd(micro)).toBe("<$0.0001");
    }
    // The boundary: 50 micro-USD is $0.00005, which rounds up to $0.0001.
    expect(formatMicroUsd(50)).toBe("$0.0001");
    expect(formatMicroUsd(99)).toBe("$0.0001");
    // A known zero is still a zero.
    expect(formatMicroUsd(0)).toBe("$0.00");
  });

  it("prints any negative cost as an anomaly — never a zero-looking -$0.0000", () => {
    for (const micro of [-0.4, -1, -49, -50, -10_000, -2_500_000]) {
      expect(formatMicroUsd(micro)).toBe(NEGATIVE_COST_TEXT);
    }
    expect(NEGATIVE_COST_TEXT).toBe("negative (cost out of range)");
    // Through the cell as well, labelled and with its coverage.
    const v = describeKpi(kpi(-49), formatMicroUsd, {
      suffix: LIST_PRICE_LABEL,
    });
    expect(v.kind).toBe("known");
    expect(v.text).toBe("negative (cost out of range)");
    expect(v.detail).toBe(
      "negative (cost out of range) list-price equivalent (1 of 1 observed)"
    );
    expect(v.text).not.toMatch(/\$/);
    // The positive and zero forms are unchanged.
    expect(formatMicroUsd(49)).toBe("<$0.0001");
    expect(formatMicroUsd(50)).toBe("$0.0001");
    expect(formatMicroUsd(0)).toBe("$0.00");
  });

  it("formats token counts compactly", () => {
    expect(formatCompactCount(950)).toBe("950");
    expect(formatCompactCount(12_345)).toBe("12.3K");
    expect(formatCompactCount(2_000_000)).toBe("2M");
  });

  it("words coverage the way the domain-cost ledger does", () => {
    expect(coverageText(40, 52)).toBe("40 of 52 observed");
  });

  it("words every reason in coord's closed vocabulary", () => {
    for (const r of [
      "not_yet_measured",
      "no_usage_rows",
      "no_cited_prs",
      "not_landed",
      "not_established",
      "door_unavailable",
      "no_red_main_attribution",
      "revert_probe_not_run",
      "empty_population",
    ]) {
      expect(reasonWords(r)).not.toBe(r);
      expect(reasonWords(r)).not.toContain("_");
    }
    expect(reasonWords(null)).toBe("no reason given");
    expect(reasonWords("   ")).toBe("no reason given");
  });
});

describe("sessions", () => {
  const sessions = (v: number, coverage: number, population: number) =>
    unitBlockRows(
      unit("a", {
        sessions: kpi(v, {
          coverage_n: coverage,
          population_n: population,
          basis: "sessions of the unit",
        }),
      })
    ).find((r) => r.id === "sessions")!;

  it("words an exact count with 'with usage data', not as a part-seen number", () => {
    const row = sessions(3, 2, 3);
    expect(row.view.kind).toBe("known");
    expect(row.view.text).toBe("3 sessions");
    expect(row.view.detail).toBe("3 sessions, 2 with usage data");
    // The count is exact: it is not partial and carries no (n/m).
    expect(row.view.partial).toBe(false);
    expect(row.view.detail).not.toMatch(/observed|\(2\/3\)|\(2 of 3/);
  });

  it("uses the singular for one session", () => {
    expect(sessions(1, 1, 1).view.detail).toBe("1 session, 1 with usage data");
    expect(formatSessions(1)).toBe("1 session");
  });

  it("keeps a unit with sessions but no usage rows a KNOWN count, with the gap said", () => {
    expect(sessions(3, 0, 3).view.detail).toBe("3 sessions, 0 with usage data");
    expect(sessions(3, 0, 3).view.kind).toBe("known");
  });

  it("still renders an unknown session count as unknown", () => {
    const row = unitBlockRows(
      unit("a", { sessions: unknown("not_established", { population_n: 0 }) })
    ).find((r) => r.id === "sessions")!;
    expect(row.view.kind).toBe("unknown");
    // Only `unknown` and why: no "(0 with usage data)" beside an unknown count.
    expect(row.view.detail).toBe("unknown — not established");
    expect(row.view.detail).not.toMatch(/usage data|\d/);
    expect(row.view.coverage).not.toMatch(/\d/);
  });

  it("does the same for a sessions count that arrives with both a value and a reason", () => {
    const row = unitBlockRows(
      unit("a", {
        sessions: {
          value: 3,
          coverage_n: 0,
          population_n: 3,
          basis: "sessions of the unit",
          reason: "no_usage_rows",
        },
      })
    ).find((r) => r.id === "sessions")!;
    expect(row.view.kind).toBe("unknown");
    expect(row.view.detail).toBe("unknown — no usage rows recorded");
    expect(row.view.text).toBe("unknown");
  });

  it("keeps the 'N of M observed' coverage on an unknown figure that is not an exact count", () => {
    const row = unitBlockRows(
      unit("a", { ci_attempts: unknown("no_cited_prs") })
    ).find((r) => r.id === "ci_attempts")!;
    expect(row.view.detail).toBe("unknown — no cited PRs (0 of 3 observed)");
  });

  it("does not change how every other count is worded", () => {
    const ci = unitBlockRows(
      unit("a", { ci_attempts: kpi(7, { coverage_n: 1, population_n: 2 }) })
    ).find((r) => r.id === "ci_attempts")!;
    expect(ci.view.detail).toBe("7 (1 of 2 observed)");
    expect(ci.view.partial).toBe(true);
  });
});

describe("columns", () => {
  it("lists the seven figures the plan names, and labels cost a list-price equivalent", () => {
    expect(KPI_COLUMNS.map((c) => c.key)).toEqual([
      "lead_time",
      "tokens",
      "cost",
      "ci_attempts",
      "red_to_green",
      "interventions",
      "rework",
    ]);
    const cost = KPI_COLUMNS.find((c) => c.key === "cost")!;
    expect(cost.short).toContain("list-price equiv");
    expect(cost.label).toContain("list-price equivalent");
  });

  it("renders every column of a known unit", () => {
    const v = unitColumnViews(unit("a"));
    expect(v.lead_time.text).toBe("1h 30m");
    expect(v.tokens.text).toBe("in 12.3K · out 4.1K");
    expect(v.cost.text).toBe("$2.50");
    expect(v.cost.detail).toContain("list-price equivalent");
    expect(v.ci_attempts.text).toBe("4");
    expect(v.red_to_green.text).toBe("1");
    expect(v.interventions.text).toBe("2");
    // A KNOWN zero, not an unknown.
    expect(v.rework.kind).toBe("known");
    expect(v.rework.text).toBe("0");
  });

  it("collapses tokens to one unknown when both are unknown, and never sums a half-known pair", () => {
    const none = unitColumnViews(
      unit("a", {
        tokens: {
          input: unknown("no_usage_rows"),
          output: unknown("no_usage_rows"),
          cache_creation_input: unknown("no_usage_rows"),
          cache_read_input: unknown("no_usage_rows"),
        },
      })
    ).tokens;
    expect(none.kind).toBe("unknown");
    expect(none.text).toBe("unknown");
    expect(none.reason).toBe("no_usage_rows");

    const half = unitColumnViews(
      unit("a", {
        tokens: {
          input: kpi(12_345),
          output: unknown("no_usage_rows"),
          cache_creation_input: kpi(1),
          cache_read_input: kpi(1),
        },
      })
    ).tokens;
    expect(half.kind).toBe("known");
    expect(half.text).toBe("in 12.3K · out unknown");
    expect(half.detail).toContain("output — unknown — no usage rows recorded");
  });

  it("renders a token figure that carries both a value and a reason as UNKNOWN, with no number", () => {
    const contradictory = (value: number) => ({
      value,
      coverage_n: 0,
      population_n: 3,
      basis: "sessions with a usage row",
      reason: "no_usage_rows",
    });
    // Both classes contradictory: the cell collapses to one unknown.
    const both = unitColumnViews(
      unit("a", {
        tokens: {
          input: contradictory(12_345),
          output: contradictory(4_100),
          cache_creation_input: kpi(1),
          cache_read_input: kpi(1),
        },
      })
    ).tokens;
    expect(both.kind).toBe("unknown");
    expect(both.text).toBe("unknown");
    expect(both.reason).toBe("no_usage_rows");
    expect(both.text).not.toMatch(/\d|12|4\.1/);
    expect(both.detail).not.toMatch(/12K|12\.3K|4\.1K|12,345/);

    // One contradictory, one known: the contradictory side is unknown, the
    // known side still prints, and the hidden number appears nowhere.
    const half = unitColumnViews(
      unit("a", {
        tokens: {
          input: contradictory(12_345),
          output: kpi(4_100),
          cache_creation_input: kpi(1),
          cache_read_input: kpi(1),
        },
      })
    ).tokens;
    expect(half.kind).toBe("known");
    expect(half.text).toBe("in unknown · out 4.1K");
    expect(half.detail).toContain("input — unknown — no usage rows recorded");
    expect(half.text + half.detail).not.toMatch(/12\.3K|12,345/);
  });

  it("flags a partially covered token pair as partial", () => {
    const v = unitColumnViews(
      unit("a", {
        tokens: {
          input: kpi(1000, { coverage_n: 1, population_n: 3 }),
          output: kpi(1000),
          cache_creation_input: kpi(1),
          cache_read_input: kpi(1),
        },
      })
    ).tokens;
    expect(v.partial).toBe(true);
    expect(v.text).toBe("in 1K (1/3) · out 1K");
  });
});

describe("the detail block", () => {
  it("has a row for every figure the plan lists, plus segments, sessions and cache classes", () => {
    const ids = unitBlockRows(unit("a")).map((r) => r.id);
    expect(ids).toEqual([
      "lead_time",
      "lead_time_to_first_pr",
      "lead_time_first_pr_to_landed",
      "sessions",
      "tokens_input",
      "tokens_output",
      "tokens_cache_creation_input",
      "tokens_cache_read_input",
      "cost",
      "ci_attempts",
      "red_to_green",
      "interventions",
      "rework",
    ]);
  });

  it("labels the cost row a list-price equivalent, in the label and the sentence, even if coord's basis does not", () => {
    const cost = unitBlockRows(
      unit("a", { cost_microusd: kpi(2_500_000, { basis: "tokens x price" }) })
    ).find((r) => r.id === "cost")!;
    expect(cost.label).toBe("Cost (list-price equivalent)");
    expect(cost.view.detail).toContain("list-price equivalent");
  });

  it("states an unknown cost as unknown, still labelled", () => {
    const cost = unitBlockRows(
      unit("a", { cost_microusd: unknown("no_usage_rows") })
    ).find((r) => r.id === "cost")!;
    expect(cost.label).toContain("list-price equivalent");
    expect(cost.view.kind).toBe("unknown");
    expect(cost.view.detail).toBe(
      "unknown — no usage rows recorded (0 of 3 observed)"
    );
  });

  it("reports the intervention split with null as 'not reported', not 0", () => {
    expect(
      interventionsSplitText(
        unit("a", {
          interventions_split: {
            policy_authorized_true: 1,
            policy_authorized_false: null,
            policy_authorized_unknown: 0,
          },
        })
      )
    ).toBe(
      "policy-authorized 1 · not policy-authorized not reported · authorization unknown 0"
    );
  });

  it("reports PR counts, and a malformed count as not reported", () => {
    expect(prsText(unit("a"))).toBe("cited 2 · landed 2");
    const bad = unit("a", {
      prs: { cited: "x" as unknown as number, landed: 1 },
    });
    expect(prsText(bad)).toBe("cited not reported · landed 1");
  });
});

describe("kpiCell and the page-level sentence", () => {
  const read = "2026-10-24T12:01:00Z";

  it("is pending before an answer and unavailable after a failure — no unit either way", () => {
    expect(kpiCell(KPI_PENDING, "a")).toEqual({ kind: "pending" });
    expect(
      kpiCell({ state: "unavailable", reason: "coord is not reachable" }, "a")
    ).toEqual({ kind: "unavailable", reason: "coord is not reachable" });
  });

  it("finds a unit by slug", () => {
    const a = unit("a");
    const idx = indexKpis(payload([a, unit("b")]), read);
    expect(kpiCell(idx, "a")).toEqual({ kind: "unit", unit: a });
  });

  it("says a unit absent from a COMPLETE answer has no KPIs in the window — not zeros", () => {
    const idx = indexKpis(payload([unit("a")]), read);
    const cell = kpiCell(idx, "draft-one");
    expect(cell.kind).toBe("outside");
    if (cell.kind !== "outside") return;
    expect(cell.coverageUnknown).toBe(false);
    expect(cell.sentence).toBe(
      "No KPIs in the last 28 days: this work unit is not among the 1 shipped work unit coord measured for that window."
    );
    expect(outsideChipText(cell)).toBe("no KPIs in window");
  });

  it("says a unit absent from a TRUNCATED answer is unknown, not none", () => {
    const idx = indexKpis(
      payload([unit("a")], {
        population: {
          shipped_units: 250,
          units_returned: 100,
          truncated: true,
        },
      }),
      read
    );
    const cell = kpiCell(idx, "somewhere-in-the-other-150");
    expect(cell.kind).toBe("outside");
    if (cell.kind !== "outside") return;
    expect(cell.coverageUnknown).toBe(true);
    expect(cell.sentence).toContain("unknown —");
    expect(cell.sentence).toContain("100 of 250");
    expect(outsideChipText(cell)).toBe("KPIs unknown");
  });

  it("says 'No KPIs recorded' for a slug read that came back without the unit — never zeros, no window to reason about", () => {
    const idx = indexKpis(payload([]), read, null, "no-such-unit");
    const cell = kpiCell(idx, "no-such-unit");
    expect(cell).toEqual({
      kind: "unrecorded",
      sentence: "No KPIs recorded: coord has no KPI row for this work unit.",
    });
    // Not the window sentence, and not a truncation unknown: neither applies.
    expect(JSON.stringify(cell)).not.toMatch(/last \d+ days|shipped work unit/);
  });

  it("still finds the unit on a slug read that returned it", () => {
    const a = unit("a");
    const idx = indexKpis(payload([a]), read, null, "a");
    expect(kpiCell(idx, "a")).toEqual({ kind: "unit", unit: a });
  });

  it("does not let a truncated flag turn a slug read's absence into 'unknown'", () => {
    const idx = indexKpis(
      payload([], {
        population: { shipped_units: 250, units_returned: 0, truncated: true },
      }),
      read,
      null,
      "a"
    );
    expect(kpiCell(idx, "a").kind).toBe("unrecorded");
  });

  it("describes each read state; unavailable carries no figure", () => {
    expect(describeKpiIndex(KPI_PENDING)).toBe("Reading KPIs…");
    const unavailable = describeKpiIndex({
      state: "unavailable",
      reason: "coord does not serve work-unit KPIs yet (GET /coord/kpis)",
    });
    expect(unavailable).toBe(
      "KPIs unavailable — coord does not serve work-unit KPIs yet (GET /coord/kpis). No KPI figures are shown; nothing else on this page depends on them."
    );
    const loaded = describeKpiIndex(indexKpis(payload([unit("a")]), read));
    expect(loaded).toContain("last 28 days (2026-09-26 to 2026-10-24)");
    expect(loaded).toContain("1 of 1 returned");
    expect(loaded).toContain(LIST_PRICE_LABEL);
    expect(loaded).toContain(
      "Read 2026-10-24 12:01Z; re-read only on Refresh or a window change."
    );
    expect(loaded).not.toContain("TRUNCATED");
  });

  it("says TRUNCATED, and that a re-read failed, when they are true", () => {
    const text = describeKpiIndex(
      indexKpis(
        payload([unit("a")], {
          population: { shipped_units: 9, units_returned: 1, truncated: true },
        }),
        read,
        "HTTP 502"
      )
    );
    expect(text).toContain("1 of 9 returned, TRUNCATED");
    expect(text).toContain("The latest re-read failed (HTTP 502)");
  });

  it("describes a slug read as this unit's KPIs, with no window sentence", () => {
    const text = describeKpiIndex(
      indexKpis(payload([unit("a")]), read, null, "a")
    );
    expect(text).toContain("KPIs for this work unit.");
    expect(text).toContain(LIST_PRICE_LABEL);
    expect(text).toContain("Read 2026-10-24 12:01Z; read once per page load.");
    expect(text).not.toMatch(/last \d+ days|returned|window/);
    expect(
      describeKpiIndex(indexKpis(payload([unit("a")]), read, "HTTP 502", "a"))
    ).toContain("The latest re-read failed (HTTP 502)");
  });

  it("keeps the folded panel's header a word or a window, never a count", () => {
    const loaded = indexKpis(payload([unit("a")]), read);
    expect(kpiPanelSummary(loaded, kpiCell(loaded, "a"))).toBe("28d window");
    expect(kpiPanelSummary(loaded, kpiCell(loaded, "zzz"))).toBe(
      "none in window"
    );
    const bySlug = indexKpis(payload([unit("a")]), read, null, "a");
    expect(kpiPanelSummary(bySlug, kpiCell(bySlug, "a"))).toBe("recorded");
    const none = indexKpis(payload([]), read, null, "a");
    expect(kpiPanelSummary(none, kpiCell(none, "a"))).toBe("none recorded");
    expect(kpiPanelSummary(KPI_PENDING, { kind: "pending" })).toBe("reading");
    expect(
      kpiPanelSummary(
        { state: "unavailable", reason: "x" },
        { kind: "unavailable", reason: "x" }
      )
    ).toBe("unavailable");
  });
});

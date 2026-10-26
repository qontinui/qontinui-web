/**
 * sessionLoadStatus — the pure derivations behind `/admin/coord/session-load`.
 *
 * What each block pins, and why it would go red:
 *
 * - **Formatting never turns an unknown into 0**: `null` slot-hours,
 *   percentiles, counts and shares all read `unknown`; units are named.
 * - **Readers and failures**: coord's `503 schema_missing` is `not_deployed`
 *   (not a read deadline, which is also a 503); a 400 is coord's refusal with
 *   its field; a body for another window is refused.
 * - **By work type**: percentiles over no observed end read UNKNOWN with the
 *   reason; held-after-finish is a share of slot-hours, UNKNOWN when no run
 *   declared itself finished; lines rank by slot-hours.
 * - **By machine**: the three budget states are read from coord's `state`
 *   (never a role); a silent or unregistered machine's open runs are UNKNOWN;
 *   over-budget is amber, nothing is red; slices come from the device×type
 *   stats.
 * - **Growth**: only complete recorded days are drawn; the trend is withheld
 *   when history is too short or a machine began recording inside its
 *   window; a rising line projects a crossing of 80 % with its method named.
 * - **Runs**: open / observed / inferred readings and the console links.
 * - **The strip**: not-deployed is amber "unknown", never "no runs";
 *   unclassified or inferred share past 5 % turns it amber.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  DAY_MS,
  DEVICE_A,
  DEVICE_B,
  TODAY_MS,
  concurrencyFx,
  deviceFx,
  deviceStatsFx,
  groupFx,
  growthFx,
  runFx,
  statsFx,
} from "../__fixtures__/sessionLoad";
import {
  MACHINE_ATTENTION_BY_KIND,
  MACHINE_STATUS_PALETTE,
  RUN_ATTENTION_BY_KIND,
  RUN_STATUS_PALETTE,
  TREND_DAYS,
  backfilledOnlyBuckets,
  budgetText,
  classifySessionLoadError,
  completeGrowthDays,
  countText,
  deriveRunStatus,
  deriveSessionLoadHealth,
  fleetAvailable,
  fleetAvailableText,
  formatPercent,
  formatSeconds,
  formatSlotHours,
  formatSlotHoursPerDay,
  growthTrend,
  heldShareText,
  issueClearsRetained,
  linearFit,
  machineLines,
  matchesRunFilter,
  openVsBudgetText,
  readBudget,
  readConcurrency,
  readGrowth,
  readRunList,
  readStats,
  runFilterCounts,
  runLinks,
  runResumeText,
  runWallText,
  runsText,
  sessionLoadIssueText,
  trendText,
  wallTimeText,
  workTypeLabel,
  workTypeLines,
  workTypeSpark,
  type ConcurrencyWire,
  type GrowthWire,
  type SessionRunWire,
  type StatsWire,
} from "./sessionLoadStatus";

function rejection(status: number, body: unknown): Error {
  return new Error(
    `GET /api/v1/operations/session-runs/stats failed: ${status} - ${JSON.stringify(body)}`
  );
}

const stats = () => statsFx() as unknown as StatsWire;
const growth = (n: number, slot: (i: number) => number, over = {}) =>
  growthFx(n, slot, over) as unknown as GrowthWire;

describe("formatting names units and never turns unknown into 0", () => {
  it("slot-hours", () => {
    expect(formatSlotHours(null)).toBe("unknown");
    expect(formatSlotHours(undefined)).toBe("unknown");
    expect(formatSlotHours(Number.NaN)).toBe("unknown");
    expect(formatSlotHours(-1)).toBe("unknown");
    expect(formatSlotHours(0)).toBe("0 slot-h");
    expect(formatSlotHours(0.04)).toBe("<0.1 slot-h");
    expect(formatSlotHours(2.46)).toBe("2.5 slot-h");
    expect(formatSlotHours(1234.4)).toBe("1,234 slot-h");
    expect(formatSlotHoursPerDay(12)).toBe("12 slot-h/day");
    expect(formatSlotHoursPerDay(null)).toBe("unknown");
  });

  it("durations, counts and shares", () => {
    expect(formatSeconds(null)).toBe("unknown");
    expect(formatSeconds(720)).toBe("12 min");
    expect(formatSeconds(5400)).toBe("1.5 h");
    expect(countText(undefined)).toBe("unknown");
    expect(runsText(1)).toBe("1 run");
    expect(runsText(3)).toBe("3 runs");
    expect(runsText(null)).toBe("unknown runs");
    expect(countText(0)).toBe("0");
    expect(formatPercent(null)).toBe("unknown");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.004)).toBe("<1%");
    expect(formatPercent(0.375)).toBe("38%");
  });

  it("work types in words, an unknown token as itself", () => {
    expect(workTypeLabel("post_merge")).toBe("post-merge follow-up");
    expect(workTypeLabel("vet_imp")).toBe("/vet-imp");
    expect(workTypeLabel("unknown")).toBe("unclassified");
    expect(workTypeLabel(null)).toBe("unclassified");
    expect(workTypeLabel("brand_new")).toBe("brand_new");
  });
});

describe("readers and failure readings", () => {
  it("schema_missing is not_deployed — not a read deadline, though both are 503s", () => {
    expect(
      classifySessionLoadError(
        rejection(503, { error: "schema_missing", degraded: true })
      )
    ).toEqual({ kind: "not_deployed" });
    expect(
      classifySessionLoadError(
        rejection(503, { error: "deadline", budget_ms: 2000 })
      )
    ).toEqual({ kind: "deadline", budgetMs: 2000 });
  });

  it("reads coord's typed 400, the admin gate's 403 and a missing route", () => {
    expect(
      classifySessionLoadError(
        rejection(400, {
          error: "invalid_query_parameter",
          field: "window",
          reason: "must be 1h..=400d",
        })
      )
    ).toEqual({
      kind: "refused",
      field: "window",
      reason: "must be 1h..=400d",
    });
    expect(
      classifySessionLoadError(
        rejection(403, { message: "not_coord_tenant_admin" })
      )
    ).toEqual({ kind: "forbidden" });
    expect(
      classifySessionLoadError(rejection(404, { error: "no_such_route" }))
    ).toEqual({
      kind: "route_unavailable",
    });
    expect(
      classifySessionLoadError(rejection(502, { detail: "coord unreachable" }))
        .kind
    ).toBe("error");
  });

  it("an answer about the data clears what was retained; a transport failure ages it", () => {
    expect(issueClearsRetained({ kind: "not_deployed" })).toBe(true);
    expect(
      issueClearsRetained({ kind: "refused", field: null, reason: null })
    ).toBe(true);
    expect(issueClearsRetained({ kind: "error", message: "x" })).toBe(false);
    expect(issueClearsRetained({ kind: "deadline", budgetMs: null })).toBe(
      false
    );
  });

  it("every issue says the subject is unknown, not empty", () => {
    expect(
      sessionLoadIssueText({ kind: "not_deployed" }, "session load")
    ).toMatch(/not deployed yet.*session load is unknown, not empty/);
    expect(sessionLoadIssueText({ kind: "route_unavailable" }, "x")).toMatch(
      /unknown, not empty/
    );
  });

  it("refuses a body that is not the contract's, or answers another window", () => {
    expect(readStats({}).kind).toBe("issue");
    expect(readStats(statsFx(), 7 * 86_400).kind).toBe("ok");
    expect(readStats(statsFx(undefined, 86_400), 7 * 86_400)).toEqual({
      kind: "issue",
      issue: {
        kind: "window_mismatch",
        askedSeconds: 604800,
        answeredSeconds: 86400,
      },
    });
    expect(readConcurrency(concurrencyFx(), 7 * 86_400).kind).toBe("ok");
    expect(readConcurrency({ devices: "x", as_of: "t" }).kind).toBe("issue");
    expect(readGrowth(growthFx(3, () => 1)).kind).toBe("ok");
    expect(
      readGrowth({ ...growthFx(3, () => 1), recording_since: 5 }).kind
    ).toBe("issue");
    expect(readRunList({ runs: [], as_of: "t" }).kind).toBe("ok");
    expect(readRunList({ runs: {} }).kind).toBe("issue");
  });
});

describe("by work type", () => {
  it("ranks by slot-hours and keeps every figure", () => {
    const lines = workTypeLines(stats());
    expect(lines.map((l) => l.workType)).toEqual(["vet_imp", "post_merge"]);
    const pm = lines[1]!;
    expect(pm.runs).toBe(10);
    expect(pm.wallP50).toBe(720);
    expect(pm.inferred).toBe(1);
    expect(wallTimeText(pm)).toBe(
      "median 12 min · p90 1.5 h wall time (7 observed ends)"
    );
  });

  it("wall time with no observed end is unknown, with the reason", () => {
    const vet = workTypeLines(stats())[0]!;
    expect(vet.wallP50).toBeNull();
    expect(wallTimeText(vet)).toMatch(
      /^wall time unknown — no run of this type has an observed end/
    );
  });

  it("held after finish is a share of slot-hours, unknown when nobody declared finished", () => {
    const [vet, pm] = workTypeLines(stats());
    // 7200 s = 2 h held, of 8 slot-hours.
    expect(pm!.held).toEqual({
      kind: "known",
      fraction: 0.25,
      heldHours: 2,
      samples: 3,
    });
    expect(heldShareText(pm!.held)).toBe(
      "25% of slot-hours (2 slot-h over 3 finished runs)"
    );
    expect(vet!.held.kind).toBe("unknown");
    expect(heldShareText(vet!.held)).toBe("unknown");
  });

  it("a missing count stays null — never 0", () => {
    const [line] = workTypeLines(
      statsFx([{ work_type: "steward" }]) as unknown as StatsWire
    );
    expect(line!.runs).toBeNull();
    expect(line!.slotHours).toBeNull();
    expect(line!.held.kind).toBe("unknown");
  });
});

describe("by machine", () => {
  const conc = (devices: unknown[]) =>
    concurrencyFx(devices) as unknown as ConcurrencyWire;

  it("reads the three budget states from coord's state, never a role", () => {
    expect(readBudget({ state: "published", value: 14 })).toEqual({
      state: "published",
      value: 14,
    });
    expect(readBudget({ state: "zero", value: 0 })).toEqual({ state: "zero" });
    expect(readBudget({ state: "none", value: null })).toEqual({
      state: "none",
    });
    expect(readBudget(undefined)).toEqual({ state: "unknown" });
    expect(readBudget({ state: "published", value: null })).toEqual({
      state: "unknown",
    });
    expect(budgetText({ state: "zero" })).toBe("zero budget published");
    expect(budgetText({ state: "none" })).toBe("no budget published");
  });

  it("a live machine within its budget is calm, with open runs against the budget", () => {
    const [m] = machineLines(
      conc([deviceFx()]),
      deviceStatsFx() as unknown as StatsWire
    );
    expect(m!.status.kind).toBe("within_budget");
    expect(m!.status.attention).toBe("none");
    expect(openVsBudgetText(m!)).toBe(
      "5 open of a configured session budget of 14"
    );
    expect(m!.peaks.map((p) => p.value)).toEqual([4, 9]);
    expect(m!.slices?.map((s) => [s.workType, s.slotHours])).toEqual([
      ["post_merge", 6],
      ["vet_imp", 2],
    ]);
  });

  it("a silent machine's open runs are UNKNOWN, with the recorded count beside", () => {
    const [m] = machineLines(
      conc([deviceFx({ heartbeat_age_seconds: 3600 })]),
      null
    );
    expect(m!.openNow).toBeNull();
    expect(m!.openRecorded).toBe(5);
    expect(m!.status.kind).toBe("silent");
    expect(m!.status.attention).toBe("waiting");
    expect(openVsBudgetText(m!)).toBe("open now unknown (5 recorded open)");
    expect(m!.slices).toBeNull();
  });

  it("no heartbeat at all, and an unregistered device, are unknown too", () => {
    const lines = machineLines(
      conc([
        deviceFx({ heartbeat_age_seconds: null, last_heartbeat: null }),
        deviceFx({
          device_id: DEVICE_B,
          known_device: false,
          name: null,
          budget: { state: "none" },
        }),
      ]),
      null
    );
    const byId = new Map(lines.map((l) => [l.deviceId, l]));
    expect(byId.get(DEVICE_A)!.status.kind).toBe("silent");
    expect(byId.get(DEVICE_B)!.status.kind).toBe("unregistered");
    expect(byId.get(DEVICE_B)!.budget).toEqual({ state: "unknown" });
    expect(byId.get(DEVICE_B)!.name).toBe(
      `unnamed device ${DEVICE_B.slice(0, 8)}`
    );
  });

  it("zero, none and over-budget readings — none of them red", () => {
    const lines = machineLines(
      conc([
        deviceFx({ budget: { state: "zero", value: 0 } }),
        deviceFx({
          device_id: DEVICE_B,
          budget: { state: "none", value: null },
        }),
        deviceFx({ device_id: "c", budget: { state: "published", value: 3 } }),
      ]),
      null
    );
    const kinds = Object.fromEntries(lines.map((l) => [l.deviceId, l.status]));
    expect(kinds[DEVICE_A]!.kind).toBe("zero_budget");
    expect(kinds[DEVICE_A]!.attention).toBe("none");
    expect(kinds[DEVICE_B]!.kind).toBe("no_budget");
    expect(kinds[DEVICE_B]!.attention).toBe("waiting");
    expect(kinds.c!.kind).toBe("over_budget");
    expect(kinds.c!.attention).toBe("waiting");
    expect(Object.values(MACHINE_ATTENTION_BY_KIND)).not.toContain("author");
  });

  it("both palettes agree with their attention tables", () => {
    expect(
      paletteDisagreements(MACHINE_ATTENTION_BY_KIND, MACHINE_STATUS_PALETTE)
    ).toEqual([]);
    expect(
      paletteDisagreements(RUN_ATTENTION_BY_KIND, RUN_STATUS_PALETTE)
    ).toEqual([]);
  });
});

describe("growth", () => {
  it("draws only complete recorded days — not the day holding now, not pre-recording buckets", () => {
    const g = growth(5, (i) => i + 1);
    const backfilled = {
      bucket_start: new Date(TODAY_MS - 20 * DAY_MS).toISOString(),
      partial: false,
      slot_hours: { post_merge: 99 },
      slot_hours_total: 99,
      backfilled_runs: 4,
    };
    g.series.unshift(backfilled);
    const days = completeGrowthDays(g);
    expect(days.map((d) => d.totalSlotHours)).toEqual([1, 2, 3, 4, 5]);
    expect(backfilledOnlyBuckets(g)).toBe(1);
    expect(workTypeSpark(days, "post_merge").map((p) => p.value)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    // A recorded day a type did not run on is a measured 0 for that type.
    expect(workTypeSpark(days, "vet_imp").map((p) => p.value)).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });

  it("nothing recorded yet draws nothing", () => {
    const g = growth(5, () => 1, {
      recording_since: null,
      devices_recording: [],
    });
    expect(completeGrowthDays(g)).toEqual([]);
  });

  it("states the fleet's available slot-hours and what it leaves out", () => {
    const a = fleetAvailable(growth(1, () => 1));
    expect(a).toEqual({
      kind: "known",
      perDay: 336,
      devicesWithBudget: 1,
      devicesZero: 0,
      devicesNone: 0,
    });
    expect(fleetAvailableText(a)).toMatch(
      /^Fleet slot-hours available: 336 slot-h\/day/
    );
    const none = fleetAvailable(
      growth(1, () => 1, {
        fleet: {
          available_slot_hours_per_day: null,
          available_state: "no_budget_published",
          devices_with_budget: 0,
          devices_zero_budget: 2,
          devices_without_budget: 1,
        },
      })
    );
    expect(none.kind).toBe("none_published");
    expect(fleetAvailableText(none)).toMatch(
      /unknown — no machine published a non-zero/
    );
    expect(fleetAvailable(growth(1, () => 1, { fleet: undefined })).kind).toBe(
      "unknown"
    );
  });

  it("fits a line by least squares", () => {
    const fit = linearFit([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ]);
    expect(fit.slope).toBeCloseTo(2);
    expect(fit.intercept).toBeCloseTo(1);
  });

  it("projects the 80 % crossing of a rising demand, naming method and window", () => {
    // 10 days rising 10 slot-h/day per day; the last 7 are 40..100.
    const g = growth(10, (i) => 10 + i * 10);
    const t = growthTrend(g, fleetAvailable(g));
    expect(t.kind).toBe("projection");
    if (t.kind !== "projection") return;
    expect(t.slopePerDay).toBeCloseTo(10);
    expect(t.targetPerDay).toBeCloseTo(268.8);
    expect(t.fittedLast).toBeCloseTo(100);
    // (268.8 - 100) / 10 = 16.88 days after the last complete day (yesterday).
    expect(t.crossingMs).toBeCloseTo(TODAY_MS - DAY_MS + 16.88 * DAY_MS, -3);
    expect(t.fromMs).toBe(TODAY_MS - TREND_DAYS * DAY_MS);
    expect(trendText(t)).toMatch(
      /^Demand reaches 80 % of available \(268\.8|^Demand reaches 80 % of available \(269/
    );
    expect(trendText(t)).toMatch(
      /linear extrapolation of the 7 complete days .* \(UTC\), not a forecast\.$/
    );
  });

  it("a flat or falling demand projects no crossing", () => {
    const g = growth(9, (i) => 50 - i);
    const t = growthTrend(g, fleetAvailable(g));
    expect(t.kind).toBe("not_rising");
    expect(trendText(t)).toMatch(
      /^Demand is not rising \(−1 slot-h\/day per day\)/
    );
  });

  it("a demand already past 80 % says so", () => {
    const g = growth(8, () => 300);
    expect(growthTrend(g, fleetAvailable(g)).kind).toBe("already_above");
  });

  it("withholds the crossing when history is too short", () => {
    const g = growth(4, (i) => i * 100);
    const t = growthTrend(g, fleetAvailable(g));
    expect(t.kind).toBe("history_too_short");
    expect(trendText(t)).toMatch(
      /history too short to extrapolate: recording began .*: 4 complete days recorded, 7 needed/
    );
  });

  it("withholds it when a machine began recording inside the window", () => {
    const g = growth(20, (i) => i * 5);
    g.devices_recording = [
      ...(g.devices_recording ?? []),
      {
        device_id: DEVICE_B,
        recording_since: new Date(TODAY_MS - 3 * DAY_MS).toISOString(),
      },
    ];
    const t = growthTrend(g, fleetAvailable(g));
    expect(t.kind).toBe("history_too_short");
    expect(trendText(t)).toMatch(
      /1 machine began recording inside the 7-day window .* would read its arrival as growth/
    );
  });

  it("a no-budget fleet whose figure coord sends as null reads 'none published', not 'no figures'", () => {
    const viaCount = fleetAvailable(
      growth(1, () => 1, {
        fleet: {
          available_slot_hours_per_day: null,
          devices_with_budget: 0,
          devices_zero_budget: 0,
          devices_without_budget: 3,
        },
      })
    );
    expect(viaCount.kind).toBe("none_published");
    const viaState = fleetAvailable(
      growth(1, () => 1, {
        fleet: {
          available_slot_hours_per_day: null,
          available_slot_hours_per_bucket: null,
          available_state: "no_budget_published",
          devices_with_budget: 0,
          devices_zero_budget: 1,
          devices_without_budget: 2,
        },
      })
    );
    expect(viaState.kind).toBe("none_published");
    // A null figure with budgets published is a genuine unknown.
    expect(
      fleetAvailable(
        growth(1, () => 1, {
          fleet: {
            available_slot_hours_per_day: null,
            available_state: "published",
            devices_with_budget: 2,
          },
        })
      ).kind
    ).toBe("unknown");
  });

  it("reads coord's available_state before the figure; an unknown state is unknown", () => {
    // The state decides even when a stale count disagrees.
    expect(
      fleetAvailable(
        growth(1, () => 1, {
          fleet: {
            available_slot_hours_per_day: null,
            available_state: "no_budget_published",
            devices_with_budget: 3,
          },
        })
      ).kind
    ).toBe("none_published");
    expect(
      fleetAvailable(
        growth(1, () => 1, {
          fleet: {
            available_slot_hours_per_day: 336,
            available_state: "something_new",
            devices_with_budget: 1,
          },
        })
      ).kind
    ).toBe("unknown");
    // A coord predating the field: zero budgets still read "none published".
    expect(
      fleetAvailable(
        growth(1, () => 1, {
          fleet: { available_slot_hours_per_day: 0, devices_with_budget: 0 },
        })
      ).kind
    ).toBe("none_published");
  });

  it("an unknown zero/none count is said, never folded into zero", () => {
    const a = fleetAvailable(
      growth(1, () => 1, {
        fleet: { available_slot_hours_per_day: 336, devices_with_budget: 1 },
      })
    );
    expect(fleetAvailableText(a)).toMatch(
      /not counted: unknown with a zero budget, unknown with none published/
    );
  });

  it("no published budget means nothing to cross — not a crossing at 0", () => {
    const g = growth(20, (i) => i, {
      fleet: {
        available_slot_hours_per_day: null,
        available_state: "no_budget_published",
        devices_with_budget: 0,
        devices_zero_budget: 1,
        devices_without_budget: 0,
      },
    });
    const t = growthTrend(g, fleetAvailable(g));
    expect(t.kind).toBe("no_available");
  });
});

describe("runs", () => {
  const run = (over = {}) => runFx(over) as unknown as SessionRunWire;

  it("open, observed and inferred readings", () => {
    expect(
      deriveRunStatus(run({ ended_at: null, end_source: null })).kind
    ).toBe("open");
    expect(deriveRunStatus(run()).kind).toBe("ended");
    expect(deriveRunStatus(run()).reason).toBe("the session exited");
    const inferred = deriveRunStatus(
      run({ end_source: "inferred", end_reason: "inferred_lost" })
    );
    expect(inferred.kind).toBe("inferred");
    expect(inferred.attention).toBe("waiting");
    expect(deriveRunStatus(run({ end_source: "guessed" })).kind).toBe(
      "unknown"
    );
  });

  it("wall time so far for an open run, in full for an ended one", () => {
    const nowMs = Date.parse("2026-10-26T10:30:00Z");
    expect(runWallText(run(), nowMs)).toBe("1 h wall time");
    expect(
      runWallText(run({ ended_at: null, wall_seconds: null }), nowMs)
    ).toBe("30 min so far");
    expect(runWallText(run({ wall_seconds: null }), nowMs)).toBe(
      "wall time unknown"
    );
  });

  it("names a resumed run by coord's own run_seq, which starts at 1", () => {
    expect(runResumeText(run({ run_seq: 1 }))).toBeNull();
    expect(runResumeText(run({ run_seq: 2 }))).toBe("resumed (run 2)");
    expect(runResumeText(run({ run_seq: 5 }))).toBe("resumed (run 5)");
  });

  it("links the gate, spawn request, session and work unit it names", () => {
    expect(runLinks(run()).map((l) => [l.key, l.href])).toEqual([
      ["gate", "/admin/coord/gates?gate=2d2c3b4a-0000-4000-8000-000000000002"],
      ["spawn", "/admin/coord/spawns"],
    ]);
    expect(
      runLinks(
        run({
          gate_id: null,
          spawn_request_id: null,
          coord_session_id: "s-1",
          work_unit_slug: "plan a",
        })
      ).map((l) => l.href)
    ).toEqual(["/sessions/s-1", "/admin/coord/work-units/plan%20a"]);
    expect(runLinks(run({ gate_id: null, spawn_request_id: null }))).toEqual(
      []
    );
  });

  it("filter counts are dashes until loaded, then counts", () => {
    expect(runFilterCounts(null)).toEqual({
      all: null,
      open: null,
      ended: null,
      inferred: null,
    });
    const rows = [
      run(),
      run({ id: "b", ended_at: null }),
      run({ id: "c", end_source: "inferred" }),
    ];
    expect(runFilterCounts(rows)).toEqual({
      all: 3,
      open: 1,
      ended: 1,
      inferred: 1,
    });
    expect(
      rows.filter((r) => matchesRunFilter(r, "open")).map((r) => r.id)
    ).toEqual(["b"]);
  });
});

describe("the health strip", () => {
  const base = {
    statsIssue: null,
    concurrencyIssue: null,
    growthLoaded: true,
    growthIssue: null,
    trend: null,
    windowLabel: "the last 7 days",
  };

  it("not deployed is amber UNKNOWN — never 'no runs'", () => {
    const h = deriveSessionLoadHealth({
      ...base,
      stats: null,
      statsIssue: { kind: "not_deployed" },
      machines: null,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Session run record not deployed yet — session load is unknown"
    );
    expect(h.headline).not.toMatch(/\b0\b|no runs/i);
  });

  it("a healthy fleet is green with its figures and units", () => {
    const machines = machineLines(
      concurrencyFx([deviceFx()]) as unknown as ConcurrencyWire,
      null
    );
    const s = statsFx([
      groupFx({ inferred_count: 0 }),
      groupFx({
        work_type: "vet_imp",
        runs: 4,
        open_now: 0,
        slot_hours: 12,
        inferred_count: 0,
      }),
    ]) as unknown as StatsWire;
    const h = deriveSessionLoadHealth({ ...base, stats: s, machines });
    expect(h.level).toBe("green");
    expect(h.headline).toBe(
      "14 runs in the last 7 days, holding 20 slot-h · 2 open now"
    );
    expect(h.badges.map((b) => b.label)).toEqual([
      "runs 14",
      "slot-h 20",
      "open 2",
    ]);
  });

  it("inferred ends past 5 % of runs turn it amber", () => {
    // statsFx(): 1 inferred end of 14 runs.
    const h = deriveSessionLoadHealth({
      ...base,
      stats: stats(),
      machines: [],
    });
    expect(h.level).toBe("amber");
    expect(h.detail).toMatch(/7% of runs ended by inference/);
  });

  it("unclassified past 5 %, a silent machine and an unread machine list turn it amber", () => {
    const s = statsFx([
      groupFx({ runs: 10, unknown_count: 1 }),
    ]) as unknown as StatsWire;
    const silent = machineLines(
      concurrencyFx([
        deviceFx({ heartbeat_age_seconds: 9999 }),
      ]) as unknown as ConcurrencyWire,
      null
    );
    const h = deriveSessionLoadHealth({ ...base, stats: s, machines: silent });
    expect(h.level).toBe("amber");
    expect(h.detail).toMatch(/10% of runs unclassified/);
    expect(h.detail).toMatch(/1 machine silent — open runs unknown/);
    expect(
      deriveSessionLoadHealth({ ...base, stats: s, machines: null }).detail
    ).toMatch(/per-machine load not read yet/);
  });

  it("a failed refresh behind kept figures is STALE — amber, never green", () => {
    const s = statsFx([groupFx({ inferred_count: 0 })]) as unknown as StatsWire;
    const machines = machineLines(
      concurrencyFx([deviceFx()]) as unknown as ConcurrencyWire,
      null
    );
    const fresh = deriveSessionLoadHealth({ ...base, stats: s, machines });
    expect(fresh.level).toBe("green");
    const err = { kind: "error", message: "502" } as const;
    for (const over of [
      { statsIssue: err },
      { concurrencyIssue: err },
      { growthIssue: err },
    ]) {
      const h = deriveSessionLoadHealth({
        ...base,
        stats: s,
        machines,
        ...over,
      });
      expect(h.level).toBe("amber");
      expect(h.detail).toMatch(
        /Last refresh failed — the .* are from the last good read/
      );
    }
  });

  it("a read that never answered is UNKNOWN on the strip", () => {
    const s = statsFx([groupFx({ inferred_count: 0 })]) as unknown as StatsWire;
    const err = { kind: "error", message: "502" } as const;
    const noMachines = deriveSessionLoadHealth({
      ...base,
      stats: s,
      machines: null,
      concurrencyIssue: err,
    });
    expect(noMachines.level).toBe("amber");
    expect(noMachines.detail).toMatch(
      /per-machine load unknown — coord did not answer/
    );
    const noGrowth = deriveSessionLoadHealth({
      ...base,
      stats: s,
      machines: [],
      growthLoaded: false,
      growthIssue: err,
    });
    expect(noGrowth.level).toBe("amber");
    expect(noGrowth.detail).toMatch(/growth unknown — coord did not answer/);
  });

  it("an unreadable budget gets its own clause, apart from 'no budget published'", () => {
    const s = statsFx([groupFx({ inferred_count: 0 })]) as unknown as StatsWire;
    const machines = machineLines(
      concurrencyFx([
        deviceFx({ budget: { state: "mystery" } }),
      ]) as unknown as ConcurrencyWire,
      null
    );
    const h = deriveSessionLoadHealth({ ...base, stats: s, machines });
    expect(h.detail).toMatch(/1 machine whose budget this page cannot read/);
    expect(h.detail).not.toMatch(/no budget published/);
  });

  it("a missing group count makes the total unknown, not a smaller sum", () => {
    const s = statsFx([
      groupFx(),
      { work_type: "steward" },
    ]) as unknown as StatsWire;
    const h = deriveSessionLoadHealth({ ...base, stats: s, machines: [] });
    expect(h.headline).toMatch(
      /^An unknown number of runs in the last 7 days, holding unknown/
    );
    expect(h.badges[0]!.label).toBe("runs –");
  });
});

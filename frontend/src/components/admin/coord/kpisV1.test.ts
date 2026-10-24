/**
 * `isKpisPayload` — the one guard between the proxy's verbatim body and the
 * work-unit pages.
 *
 * A body of another shape — another schema version, or a PARTIAL answer — is a
 * failed read ("KPIs unavailable"), never a half-rendered table with zeros
 * where the missing figures were.
 */

import { describe, expect, it } from "vitest";
import { kpi, payload, unit, unknown } from "@/test/kpisFixtures";
import { isKpi, isKpisPayload } from "./kpisV1";

describe("isKpi", () => {
  it("accepts a known figure and an UNKNOWN one carrying its reason", () => {
    expect(isKpi(kpi(5))).toBe(true);
    expect(isKpi(unknown("no_usage_rows"))).toBe(true);
    expect(isKpi(kpi(0))).toBe(true);
  });

  it("tolerates an absent reason on a known value", () => {
    const { reason: _reason, ...rest } = kpi(5);
    expect(isKpi(rest)).toBe(true);
  });

  it("refuses a value that is neither a finite number nor null", () => {
    expect(isKpi({ ...kpi(5), value: "5" })).toBe(false);
    expect(isKpi({ ...kpi(5), value: Number.NaN })).toBe(false);
    expect(isKpi({ ...kpi(5), value: undefined })).toBe(false);
  });

  it("refuses a figure missing its coverage or basis", () => {
    expect(isKpi({ ...kpi(5), coverage_n: undefined })).toBe(false);
    expect(isKpi({ ...kpi(5), population_n: "3" })).toBe(false);
    expect(isKpi({ ...kpi(5), basis: undefined })).toBe(false);
    expect(isKpi(null)).toBe(false);
    expect(isKpi(5)).toBe(false);
  });
});

describe("isKpisPayload", () => {
  it("accepts a complete kpis/v1 body, empty or not", () => {
    expect(isKpisPayload(payload([unit("a"), unit("b")]))).toBe(true);
    expect(isKpisPayload(payload([]))).toBe(true);
  });

  it("accepts a body whose aggregates this build does not render", () => {
    const body = { ...payload([unit("a")]), aggregates: undefined };
    expect(isKpisPayload(body)).toBe(true);
  });

  it("accepts a field a newer coord added", () => {
    expect(
      isKpisPayload({ ...payload([unit("a")]), added_later: { x: 1 } })
    ).toBe(true);
  });

  it("refuses another schema version", () => {
    expect(isKpisPayload({ ...payload([unit("a")]), schema: "kpis/v2" })).toBe(
      false
    );
    expect(isKpisPayload({ ...payload([unit("a")]), schema: undefined })).toBe(
      false
    );
  });

  it("refuses a body of another shape — the other proxies' answers, an error body", () => {
    expect(isKpisPayload(null)).toBe(false);
    expect(isKpisPayload([])).toBe(false);
    expect(isKpisPayload({ work_units: [] })).toBe(false);
    expect(isKpisPayload({ error: "no_such_route" })).toBe(false);
  });

  it("refuses a body without its window or population", () => {
    expect(isKpisPayload({ ...payload([]), window: undefined })).toBe(false);
    expect(isKpisPayload({ ...payload([]), population: undefined })).toBe(
      false
    );
    expect(
      isKpisPayload({
        ...payload([]),
        population: { shipped_units: 1, units_returned: 1 },
      })
    ).toBe(false);
  });

  it("refuses a body whose units are not an array", () => {
    expect(isKpisPayload({ ...payload([]), units: null })).toBe(false);
    expect(isKpisPayload({ ...payload([]), units: {} })).toBe(false);
  });

  it("refuses the WHOLE body when one unit is partial, rather than rendering it with holes", () => {
    const partial = unit("b");
    delete (partial as unknown as Record<string, unknown>).ci_attempts;
    expect(isKpisPayload(payload([unit("a"), partial]))).toBe(false);

    const noTokens = unit("c");
    delete (noTokens as unknown as Record<string, unknown>).tokens;
    expect(isKpisPayload(payload([noTokens]))).toBe(false);

    const noSegments = unit("d");
    delete (noSegments as unknown as Record<string, unknown>)
      .lead_time_segments;
    expect(isKpisPayload(payload([noSegments]))).toBe(false);

    expect(isKpisPayload(payload([unit("e", { slug: "" })]))).toBe(false);
  });
});

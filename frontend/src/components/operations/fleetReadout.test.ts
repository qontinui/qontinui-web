/**
 * The Dev Ops strip's readout badges (plan
 * `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8). The p90 never travels without its known-onset share, and every
 * absent figure reads "unknown — <reason>".
 */

import { describe, expect, it } from "vitest";
import {
  F2V_NO_KNOWN_ONSET,
  buildResolvabilityBadge,
  faultToVisibilityBadge,
  formatDurationSecs,
} from "./fleetReadout";
import {
  isFaultToVisibilityPayload,
  type FaultToVisibilityPayload,
} from "./useFaultToVisibility";

const BODY: FaultToVisibilityPayload = {
  window: "30d",
  computed_at: "2026-09-30T10:00:00Z",
  kinds: [
    {
      kind: "runner_wedged",
      episodes_n: 10,
      onset_known_n: 6,
      p50_secs: 600,
      p90_secs: 4380,
    },
  ],
  totals: { episodes_n: 40, onset_known_n: 12, p50_secs: 300, p90_secs: 4380 },
};

describe("formatDurationSecs", () => {
  it.each([
    [0, "0s"],
    [45, "45s"],
    [720, "12m"],
    [3600, "1h"],
    [4380, "1h 13m"],
    [86_400 * 2 + 3600 * 3, "2d 3h"],
  ])("%s → %s", (secs, out) => {
    expect(formatDurationSecs(secs)).toBe(out);
  });
});

describe("faultToVisibilityBadge", () => {
  it("shows p90 and onset_known_n/episodes_n together", () => {
    const b = faultToVisibilityBadge({ data: BODY, loading: false, error: null });
    expect(b.label).toBe("fault→visible p90 1h 13m · onset known 12/40");
    expect(b.title).toContain("12 of 40 episodes");
    expect(b.title).toContain("runner_wedged p90 1h 13m");
  });

  it("a null p90 is 'no episode with a known onset', with the 0/N share", () => {
    const b = faultToVisibilityBadge({
      data: {
        ...BODY,
        totals: { episodes_n: 9, onset_known_n: 0, p50_secs: null, p90_secs: null },
      },
      loading: false,
      error: null,
    });
    expect(b.label).toBe(
      `fault→visible p90 ${F2V_NO_KNOWN_ONSET} · onset known 0/9`
    );
    expect(b.label).not.toMatch(/p90 0s/);
  });

  it("no body is unknown with the failure, or not read yet", () => {
    expect(
      faultToVisibilityBadge({ data: null, loading: false, error: "HTTP 502" })
        .label
    ).toBe("fault→visible unknown — HTTP 502");
    expect(
      faultToVisibilityBadge({ data: null, loading: true, error: null }).label
    ).toBe("fault→visible unknown — not read yet");
  });

  it("a failed latest read over a retained body keeps the numbers, marked stale", () => {
    const b = faultToVisibilityBadge({ data: BODY, loading: false, error: "HTTP 504" });
    expect(b.label).toContain("(stale)");
    expect(b.title).toContain("The latest read failed (HTTP 504)");
  });
});

describe("isFaultToVisibilityPayload", () => {
  it("accepts the contract and refuses other shapes", () => {
    expect(isFaultToVisibilityPayload(BODY)).toBe(true);
    expect(isFaultToVisibilityPayload({})).toBe(false);
    expect(isFaultToVisibilityPayload({ kinds: [], totals: null })).toBe(false);
    expect(isFaultToVisibilityPayload(null)).toBe(false);
  });
});

describe("buildResolvabilityBadge", () => {
  const br = {
    value: 0.875,
    coverage_n: 7,
    population_n: 8,
    basis: "served_git_sha",
  };
  it("shows the share with its counts", () => {
    expect(
      buildResolvabilityBadge({ build_resolvability: br }, null).label
    ).toBe("builds nameable 88% (7/8)");
  });
  it.each([
    [null, "fleet-health 502", "builds nameable unknown — fleet-health 502"],
    [{}, null, "builds nameable unknown — coord does not serve it"],
    [
      { build_resolvability: null, runner_reports_scrape_up: false },
      null,
      "builds nameable unknown — runner-report read failed",
    ],
    [
      { build_resolvability: { ...br, value: null, coverage_n: 0, population_n: 0 } },
      null,
      "builds nameable unknown — no devices on the roster",
    ],
  ])("%j → unknown with its reason", (body, err, label) => {
    expect(buildResolvabilityBadge(body, err).label).toBe(label);
  });
});

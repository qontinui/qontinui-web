/**
 * ciDashboardStatus — the derivation behind `/admin/coord/ci`.
 *
 * Pins plan `2026-10-04-ci-dashboard-in-the-dev-ops-console` Phase 3's vitest
 * list: every non-measured state renders `–` with its reason; a `0` appears
 * only when `state == measured`; green is unreachable while any pool is not
 * measured or any pool's `required` is null; `hosted` is a refusal floor
 * (`≥N`, infra) only when observed and `–` otherwise, never `0`; and the 2026-10-04T12:08Z capture (`capacity_reading:
 * unknown_unrefreshed`, 65 `ci-failed`) derives UNKNOWN capacity, not
 * "0 runners". Plus the palette agrees with the attention table, and an
 * infra-shaped share never folds into the content-red count.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import type { RepoCiRow } from "@/components/operations/types";
import {
  CI_POOL_ATTENTION_BY_KIND,
  CI_POOL_PALETTE,
  CI_REPO_ATTENTION_BY_KIND,
  CI_REPO_PALETTE,
  DASH,
  buildRepoRows,
  cell,
  deriveCiHealth,
  formatDuration,
  groupPools,
  hostedBadge,
  hostedCell,
  hostedSummary,
  outcomeCells,
  poolGroupCells,
  poolLabel,
  poolMemberCells,
  poolRowStatus,
  repoRowStatus,
  stripLevel,
  type CiHostedWire,
  type CiOverviewWire,
  type CiPoolAlertWire,
  type CiUnattachedAlertWire,
  type CiPoolWire,
  type CiRepoOverviewWire,
  type CiStatusRead,
  type EconomicsRead,
  type ObservationState,
  type OverviewRead,
} from "./ciDashboardStatus";

const NOW = Date.parse("2026-10-04T12:10:00Z");
const AS_OF = "2026-10-04T12:08:00Z";

function pool(over: Partial<CiPoolWire> = {}): CiPoolWire {
  return {
    repo: "qontinui/qontinui-web",
    pool: "qontinui,self-hosted",
    state: "measured",
    state_reason: null,
    observed_at: "2026-10-04T12:07:00Z",
    stale_after_secs: 360,
    poll_ok: true,
    poll_complete: true,
    queued_jobs: 0,
    oldest_queued_age_secs: null,
    threshold_secs: 1800,
    p90_wait_secs: 42,
    eligibility_state: "eligible",
    eligible_runners: 2,
    eligible_registrations: 3,
    unknown_registrations: 0,
    eligible_runners_drained: 1,
    eligibility_observed_at: "2026-10-04T12:06:00Z",
    required: true,
    required_note: null,
    coverage_note: "repo-registered runners only",
    open_alerts: [],
    ...over,
  };
}

/** A non-measured pool exactly as the contract says coord writes one: NULL counts. */
function unmeasuredPool(
  state: ObservationState,
  over: Partial<CiPoolWire> = {}
): CiPoolWire {
  return pool({
    state,
    state_reason: null,
    poll_ok: state === "unknown" ? false : null,
    poll_complete: state === "unknown" ? false : null,
    queued_jobs: null,
    oldest_queued_age_secs: null,
    threshold_secs: null,
    p90_wait_secs: null,
    eligibility_state: null,
    eligible_runners: null,
    eligible_registrations: null,
    unknown_registrations: null,
    eligible_runners_drained: null,
    eligibility_observed_at: null,
    ...over,
  });
}

function repo(over: Partial<CiRepoOverviewWire> = {}): CiRepoOverviewWire {
  return {
    repo: "qontinui/qontinui-web",
    window_hours: 24,
    state: "measured",
    state_reason: null,
    outcomes: {
      pass: 120,
      content_fail: 3,
      infra_shaped: 7,
      neutral: 2,
      unknown: 0,
    },
    hosted: {
      state: "not_measured",
      note: "hosted-only workflows are not sampled (ci_job_sampler hosted-only memo); see Phase 5a",
    },
    ...over,
  };
}

function overview(over: Partial<CiOverviewWire> = {}): CiOverviewWire {
  return {
    as_of: AS_OF,
    coverage_note: "self-hosted jobs only",
    note: null,
    pools: [pool()],
    repos: [repo()],
    ...over,
  };
}

function ciRow(over: Partial<RepoCiRow> = {}): RepoCiRow {
  return {
    repo: "qontinui/qontinui-web",
    main_verdict: "green",
    open_pr_checks: { success: 4, failure: 0, pending: 0 },
    latest_details_url: null,
    main_head_sha: "abc",
    main_verdict_observed_at: "2026-10-04T12:00:00Z",
    pr_checks_observed_at: "2026-10-04T12:07:00Z",
    ...over,
  };
}

const read = (data: CiOverviewWire | null, failed = false): OverviewRead => ({
  data,
  failed,
  failureText: failed ? "HTTP 502" : null,
});
const status = (
  rows: RepoCiRow[] = [ciRow()],
  over: Partial<CiStatusRead> = {}
): CiStatusRead => ({
  rows,
  seeded: true,
  error: null,
  ...over,
});
const ECON: EconomicsRead = {
  byRepo: { "qontinui/qontinui-web": { candidate_ci_p90_secs: 600 } },
  asOf: AS_OF,
  failed: false,
};

const NON_MEASURED: ObservationState[] = ["stale", "never_observed", "unknown"];
/** Coord never serves `never_observed` on a POOL row (an unvisited pool reads `unknown`). */
const POOL_NON_MEASURED: ObservationState[] = ["stale", "unknown"];

/** An open alert as coord's build serves it: bigint id as a string, fire-time numbers. */
function alertFx(
  kind: string,
  over: Partial<CiPoolAlertWire> = {}
): CiPoolAlertWire {
  return {
    alert_id: "918273",
    kind,
    opened_at: "2026-10-03T09:00:00Z",
    last_seen_at: "2026-10-03T11:30:00Z",
    occurrences: 4,
    current_state_note: "pool has not been measured since the alert fired",
    summary: "0 eligible runners, 14 queued, oldest 3h12m",
    ...over,
  };
}

describe("cell — a number only on a measured row", () => {
  it.each(NON_MEASURED)(
    "%s renders – with a reason, never the value",
    (state) => {
      for (const v of [0, 5, null]) {
        const c = cell(v, state, null);
        expect(c.text).toBe(DASH);
        expect(c.known).toBe(false);
        expect(c.reason).toBeTruthy();
      }
    }
  );

  it("prefers coord's own reason", () => {
    expect(cell(null, "unknown", "registrar unrefreshed").reason).toBe(
      "registrar unrefreshed"
    );
  });

  it("renders a measured 0 as 0", () => {
    expect(cell(0, "measured", null)).toEqual({
      text: "0",
      known: true,
      reason: null,
    });
  });

  it("renders a measured null as – (null is never 0)", () => {
    const c = cell(null, "measured", null);
    expect(c.text).toBe(DASH);
    expect(c.known).toBe(false);
  });
});

describe("pool cells", () => {
  it.each(POOL_NON_MEASURED)(
    "every figure of a %s pool is – with a reason",
    (state) => {
      const cells = poolMemberCells(
        unmeasuredPool(state, { state_reason: "poll failed" })
      );
      for (const c of Object.values(cells)) {
        expect(c.text).toBe(DASH);
        expect(c.known).toBe(false);
        expect(c.reason).toBeTruthy();
      }
    }
  );

  it("a 0 appears only on a measured pool", () => {
    const measured = poolMemberCells(
      pool({ eligible_runners: 0, queued_jobs: 0, eligible_runners_drained: 0 })
    );
    expect(measured.eligible.text).toBe("0");
    expect(measured.queued.text).toBe("0");
    expect(measured.drained.text).toBe("0");
    // A stale row that still CARRIES zeros (a writer that kept old values)
    // must not print them.
    const stale = poolMemberCells(
      pool({ state: "stale", eligible_runners: 0, queued_jobs: 0 })
    );
    expect(stale.eligible.text).toBe(DASH);
    expect(stale.queued.text).toBe(DASH);
  });

  it("a measured queue with unknown eligibility does not print a runner count", () => {
    const cells = poolMemberCells(
      pool({ eligibility_state: "unknown", eligible_runners: 0 })
    );
    expect(cells.eligible.text).toBe(DASH);
    expect(cells.queued.text).toBe("0");
  });

  it("oldest age is rendered against its bound", () => {
    const cells = poolMemberCells(
      pool({
        queued_jobs: 14,
        oldest_queued_age_secs: 11520,
        threshold_secs: 1800,
      })
    );
    expect(cells.oldest.text).toBe("3h12m / 30m");
  });

  it("a group sums only when every member is measured", () => {
    const groups = groupPools([
      pool({ repo: "a/one", eligible_runners: 2, queued_jobs: 1 }),
      unmeasuredPool("unknown", { repo: "a/two" }),
    ]);
    const cells = poolGroupCells(groups[0]);
    expect(cells.eligible.text).toBe(DASH);
    expect(cells.eligible.reason).toMatch(/1 of 2 repos not measured/);
    const allMeasured = poolGroupCells(
      groupPools([
        pool({ repo: "a/one", eligible_runners: 2 }),
        pool({ repo: "a/two", eligible_runners: 1 }),
      ])[0]
    );
    expect(allMeasured.eligible.text).toBe("3");
  });
});

describe("poolRowStatus — colour means who must act", () => {
  it("a required pool with no eligible runner is red", () => {
    const s = poolRowStatus(
      pool({
        eligibility_state: "no_eligible_runner",
        eligible_runners: 0,
        queued_jobs: 14,
      })
    );
    expect(s.kind).toBe("no_eligible_runner");
    expect(s.attention).toBe("author");
  });

  it("a stall alert the current reading CONFIRMS is red, with the alert's age as reason", () => {
    const s = poolRowStatus(
      pool({
        queued_jobs: 14,
        oldest_queued_age_secs: 11520,
        threshold_secs: 1800,
        open_alerts: [alertFx("ci_job_queue_stalled")],
      })
    );
    expect(s.kind).toBe("queue_stalled");
    expect(s.attention).toBe("author");
    expect(s.reason).toContain("fired 2026-10-03T09:00:00Z");
    expect(s.reason).toContain("14 queued");
  });

  it.each([
    ["nothing queued", { queued_jobs: 0, oldest_queued_age_secs: null }],
    ["queue within bound", { queued_jobs: 3, oldest_queued_age_secs: 60 }],
  ] as const)(
    "a stall alert on a measured pool whose reading shows %s is amber alert_contradicted",
    (_label, over) => {
      const s = poolRowStatus(
        pool({ ...over, open_alerts: [alertFx("ci_job_queue_stalled")] })
      );
      expect(s.kind).toBe("alert_contradicted");
      expect(s.attention).toBe("waiting");
      expect(s.label).toBe("alert open · reading clear");
      expect(s.reason).toContain("fired 2026-10-03T09:00:00Z");
    }
  );

  it.each([
    [
      "no bound reported",
      { queued_jobs: 3, oldest_queued_age_secs: 9000, threshold_secs: null },
      "the stall bound",
    ],
    [
      "no oldest age",
      { queued_jobs: 3, oldest_queued_age_secs: null },
      "the oldest queued job's age",
    ],
  ] as const)(
    "a stall alert on a measured pool with %s is alert_incomplete (never 'reading clear')",
    (_label, over, missing) => {
      const s = poolRowStatus(
        pool({ ...over, open_alerts: [alertFx("ci_job_queue_stalled")] })
      );
      expect(s.kind).toBe("alert_incomplete");
      expect(s.attention).toBe("waiting");
      expect(s.label).toBe("alert open · reading incomplete");
      expect(s.reason).toContain(missing);
      expect(s.reason).toContain("fired 2026-10-03T09:00:00Z");
    }
  );

  it.each(["unknown", null] as const)(
    "a no-eligible-runner alert with eligibility_state %s is alert_incomplete",
    (eligibility) => {
      const s = poolRowStatus(
        pool({
          eligibility_state: eligibility,
          open_alerts: [alertFx("ci_pool_no_eligible_runner")],
        })
      );
      expect(s.kind).toBe("alert_incomplete");
      expect(s.reason).toContain("the eligibility verdict");
    }
  );

  it("a no-eligible-runner alert on a pool that reads eligible is amber alert_contradicted", () => {
    const s = poolRowStatus(
      pool({ open_alerts: [alertFx("ci_pool_no_eligible_runner")] })
    );
    expect(s.kind).toBe("alert_contradicted");
    expect(s.attention).toBe("waiting");
  });

  it("a no-eligible-runner alert the reading confirms (required pool) is red", () => {
    const s = poolRowStatus(
      pool({
        eligibility_state: "no_eligible_runner",
        eligible_runners: 0,
        open_alerts: [alertFx("ci_pool_no_eligible_runner")],
      })
    );
    expect(s.kind).toBe("no_eligible_runner");
    expect(s.attention).toBe("author");
  });

  it.each(POOL_NON_MEASURED)(
    "an open alert on a %s pool is AMBER with its age and note, never queue_stalled",
    (state) => {
      for (const kind of [
        "ci_job_queue_stalled",
        "ci_pool_no_eligible_runner",
      ]) {
        const s = poolRowStatus(
          unmeasuredPool(state, {
            state_reason: "queue watcher has not visited this pool",
            open_alerts: [alertFx(kind)],
          })
        );
        expect(s.kind).toBe("alert_unconfirmed");
        expect(s.attention).toBe("waiting");
        expect(s.reason).toContain("fired 2026-10-03T09:00:00Z");
        expect(s.reason).toContain("last re-confirmed 2026-10-03T11:30:00Z");
        expect(s.reason).toContain(
          "pool has not been measured since the alert fired"
        );
        expect(s.reason).toContain(`reads ${state} now`);
      }
    }
  );

  it("no eligible runner with required UNKNOWN is amber, not red", () => {
    const s = poolRowStatus(
      pool({ eligibility_state: "no_eligible_runner", required: null })
    );
    expect(s.attention).toBe("waiting");
  });

  it("no eligible runner on a pool no required check uses is calm", () => {
    const s = poolRowStatus(
      pool({ eligibility_state: "no_eligible_runner", required: false })
    );
    expect(s.attention).toBe("none");
  });

  it.each(POOL_NON_MEASURED)(
    "a %s pool is amber (the ignorance floor)",
    (state) => {
      const s = poolRowStatus(unmeasuredPool(state));
      expect(s.kind).toBe(state);
      expect(s.attention).toBe("waiting");
      expect(s.reason).toBeTruthy();
    }
  );

  it("an unrecognised wire state is treated as unknown", () => {
    expect(poolRowStatus(pool({ state: "half-measured" })).kind).toBe(
      "unknown"
    );
  });

  it("a queue past its bound with no stall alert is waiting", () => {
    const s = poolRowStatus(
      pool({
        queued_jobs: 3,
        oldest_queued_age_secs: 4000,
        threshold_secs: 1800,
      })
    );
    expect(s.kind).toBe("queue_over_bound");
    expect(s.attention).toBe("waiting");
  });

  it("measured, eligible, required → clear", () => {
    expect(poolRowStatus(pool()).kind).toBe("clear");
  });
});

describe("palettes agree with their attention tables", () => {
  it("pool palette", () => {
    expect(
      paletteDisagreements(CI_POOL_ATTENTION_BY_KIND, CI_POOL_PALETTE)
    ).toEqual([]);
  });
  it("repo palette", () => {
    expect(
      paletteDisagreements(CI_REPO_ATTENTION_BY_KIND, CI_REPO_PALETTE)
    ).toEqual([]);
  });
});

describe("hosted — a refusal floor, infra, never content and never 0", () => {
  const billing = {
    alert_id: "5521",
    opened_at: "2026-10-04T08:00:00Z",
    last_seen_at: "2026-10-04T12:00:00Z",
  };
  const observed = (n: number, over: Partial<CiHostedWire> = {}) =>
    repo({
      hosted: {
        state: "observed",
        hosted_refused: n,
        last_refused_at: "2026-10-04T11:40:00Z",
        billing_refusal: null,
        note: "hosted jobs GitHub never started",
        ...over,
      },
    });
  const healthOf = (repos: CiRepoOverviewWire[]) =>
    deriveCiHealth(read(overview({ repos })), status(), NOW);
  const badge = (h: ReturnType<typeof deriveCiHealth>, key: string) =>
    h.badges.find((b) => b.key === key);

  it("observed → the count shows as an infra floor, not in content_fail", () => {
    const cells = outcomeCells(observed(4));
    expect(cells.hosted.known).toBe(true);
    expect(cells.hosted.text).toBe("≥4 refused");
    expect(cells.hosted.tone).toBe("infra");
    expect(cells.hosted.note).toMatch(/not a code failure/);
    expect(cells.hosted.note).toMatch(/Cause not stored/);
    // content_fail is the fixture's own 3, untouched by the 4 refusals.
    expect(cells.content_fail.text).toBe("3");
    const h = healthOf([observed(4)]);
    expect(badge(h, "content-fail")?.label).toBe("content fail 24h 3");
    expect(badge(h, "infra")?.label).toBe("infra-shaped 24h 7");
    expect(badge(h, "main-red")).toBeUndefined();
    const hb = badge(h, "hosted");
    expect(hb?.label).toBe("hosted refused ≥4");
    expect(hb?.tone).toBe("waiting");
    expect(hb?.tone).not.toBe("attention");
  });

  it("observed refusals never move the strip level — green stays green, the detail names them", () => {
    const h = healthOf([observed(2)]);
    expect(h.level).toBe("green");
    expect(h.headline).toMatch(/^CI healthy/);
    expect(h.detail).toMatch(
      /≥2 hosted job\(s\) refused .* infra, not a code failure; cause not stored/
    );
    expect(badge(h, "hosted")?.tone).toBe("waiting");
  });

  it("none_observed → – never 0, with coord's note as the reason", () => {
    const c = hostedCell({
      state: "none_observed",
      hosted_refused: null,
      last_refused_at: null,
      billing_refusal: null,
      note: "no hosted job seen in 24h",
    });
    expect(c.text).toBe(DASH);
    expect(c.known).toBe(false);
    expect(c.reason).toMatch(/not a measured zero/);
    expect(c.reason).toMatch(/no hosted job seen in 24h/);
    const h = healthOf([
      repo({ hosted: { state: "none_observed", note: "x" } }),
    ]);
    expect(badge(h, "hosted")?.label).toBe(`hosted ${DASH}`);
    expect(badge(h, "hosted")?.label).not.toMatch(/0/);
  });

  it("a contract-violating observed 0 still renders –, never 0", () => {
    const c = hostedCell({ state: "observed", hosted_refused: 0 });
    expect(c.text).toBe(DASH);
    expect(c.known).toBe(false);
  });

  it("unknown → – UNKNOWN", () => {
    const c = hostedCell({ state: "unknown", note: "jobs read failed" });
    expect(c.text).toBe(DASH);
    expect(c.known).toBe(false);
    expect(c.reason).toMatch(/^UNKNOWN — jobs read failed/);
    const h = healthOf([repo({ hosted: { state: "unknown", note: null } })]);
    expect(badge(h, "hosted")?.label).toBe(`hosted ${DASH}`);
    expect(badge(h, "hosted")?.title).toMatch(/UNKNOWN/);
  });

  it("an otherwise-green strip stays green when hosted is unknown, with a muted hosted – badge", () => {
    // Intended: D4's no-green rule covers pools, not the hosted block.
    const h = healthOf([repo({ hosted: { state: "unknown", note: null } })]);
    expect(h.level).toBe("green");
    expect(h.detail).toBeNull();
    const hb = badge(h, "hosted");
    expect(hb?.label).toBe(`hosted ${DASH}`);
    expect(hb?.tone).toBe("muted");
  });

  it("a row with no hosted key → – UNKNOWN in the cell, counted unknown in the strip", () => {
    const r: CiRepoOverviewWire = repo();
    delete (r as Partial<CiRepoOverviewWire>).hosted;
    const c = outcomeCells(r).hosted;
    expect(c.text).toBe(DASH);
    expect(c.known).toBe(false);
    expect(c.reason).toBe("coord sent no hosted block — UNKNOWN");
    const s = hostedSummary(overview({ repos: [r] }));
    expect(s.unknownRepos).toEqual(["qontinui/qontinui-web"]);
    expect(s.refusedFloor).toBeNull();
    const hb = hostedBadge(s);
    expect(hb.label).toBe(`hosted ${DASH}`);
    expect(hb.title).toMatch(/UNKNOWN/);
  });

  it("an unrecognised hosted state (hosted_disabled) → – and counted unknown", () => {
    const r = repo({
      hosted: { state: "hosted_disabled", hosted_refused: 9, note: null },
    });
    const c = outcomeCells(r).hosted;
    expect(c.text).toBe(DASH);
    expect(c.known).toBe(false);
    expect(c.reason).toMatch(/^UNKNOWN/);
    const s = hostedSummary(overview({ repos: [r] }));
    expect(s.unknownRepos).toEqual(["qontinui/qontinui-web"]);
    expect(s.refusedFloor).toBeNull();
    expect(hostedBadge(s).label).toBe(`hosted ${DASH}`);
  });

  it("legacy not_measured (no other fields) → – with its note", () => {
    const c = outcomeCells(repo()).hosted;
    expect(c.text).toBe(DASH);
    expect(c.known).toBe(false);
    expect(c.reason).toMatch(/hosted-only workflows are not sampled/);
    expect(outcomeCells(null).hosted.text).toBe(DASH);
    const h = healthOf([repo()]);
    expect(badge(h, "hosted")?.label).toBe(`hosted ${DASH}`);
    expect(h.level).toBe("green");
  });

  it("billing_refusal present → the strip names GitHub Actions billing", () => {
    const h = healthOf([observed(3, { billing_refusal: billing })]);
    expect(h.level).toBe("green");
    expect(h.detail).toMatch(
      /^GitHub Actions billing refusing hosted jobs on qontinui\/qontinui-web — infra/
    );
    const hb = badge(h, "hosted");
    expect(hb?.label).toBe("billing refusing hosted ≥3");
    expect(hb?.tone).toBe("waiting");
    expect(hb?.title).toMatch(/spending limit/);
    const c = outcomeCells(observed(3, { billing_refusal: billing })).hosted;
    expect(c.text).toBe("≥3 refused (billing)");
    expect(c.note).toMatch(/Actions billing \/ spending limit/);
  });

  it("billing_refusal with none_observed still surfaces billing, as –", () => {
    const r = repo({
      hosted: {
        state: "none_observed",
        hosted_refused: null,
        last_refused_at: null,
        billing_refusal: billing,
        note: "none in window",
      },
    });
    expect(outcomeCells(r).hosted.text).toBe(DASH);
    expect(outcomeCells(r).hosted.reason).toMatch(/billing refusing hosted/);
    const h = healthOf([r]);
    expect(badge(h, "hosted")?.label).toBe(`billing refusing hosted ${DASH}`);
    expect(h.level).toBe("green");
    expect(h.detail).toMatch(/GitHub Actions billing refusing hosted jobs/);
  });

  it("billing never overrides a red verdict, it is added to the detail", () => {
    const h = deriveCiHealth(
      read(overview({ repos: [observed(1, { billing_refusal: billing })] })),
      status([ciRow({ main_verdict: "red" })]),
      NOW
    );
    expect(h.level).toBe("red");
    expect(h.headline).toMatch(/^Main is red/);
    expect(h.detail).toMatch(/GitHub Actions billing refusing hosted jobs/);
  });

  it("the summed badge is a floor (≥) across observed repos only", () => {
    const s = hostedSummary(
      overview({
        repos: [
          observed(2),
          { ...observed(5), repo: "qontinui/qontinui-coord" },
          repo({ repo: "a/b", hosted: { state: "unknown" } }),
          repo({ repo: "c/d", hosted: { state: "none_observed" } }),
        ],
      })
    );
    expect(s.refusedFloor).toBe(7);
    expect(s.unknownRepos).toEqual(["a/b"]);
    expect(hostedBadge(s).label).toBe("hosted refused ≥7");
  });
});

describe("outcomes — infra-shaped is never folded into content red", () => {
  it("content and infra are separate cells and separate badges", () => {
    const cells = outcomeCells(repo());
    expect(cells.content_fail.text).toBe("3");
    expect(cells.infra_shaped.text).toBe("7");
    const h = deriveCiHealth(read(overview()), status(), NOW);
    expect(h.badges.find((b) => b.key === "content-fail")?.label).toBe(
      "content fail 24h 3"
    );
    expect(h.badges.find((b) => b.key === "infra")?.label).toBe(
      "infra-shaped 24h 7"
    );
  });

  it.each(NON_MEASURED)("a %s outcome row dashes every count", (state) => {
    const cells = outcomeCells(
      repo({ state, outcomes: null, state_reason: "sampler behind" })
    );
    for (const k of [
      "pass",
      "content_fail",
      "infra_shaped",
      "neutral",
      "unknown",
    ] as const) {
      expect(cells[k].text).toBe(DASH);
      expect(cells[k].reason).toBeTruthy();
    }
  });

  it("the strip's content/infra badges dash when any repo is unmeasured", () => {
    const h = deriveCiHealth(
      read(
        overview({
          repos: [
            repo(),
            repo({ repo: "a/b", state: "unknown", outcomes: null }),
          ],
        })
      ),
      status(),
      NOW
    );
    expect(h.badges.find((b) => b.key === "content-fail")?.label).toBe(
      `content fail 24h ${DASH}`
    );
    expect(h.badges.find((b) => b.key === "infra")?.label).toBe(
      `infra-shaped 24h ${DASH}`
    );
  });
});

describe("deriveCiHealth — green is unreachable on ignorance", () => {
  it("is green only when everything is measured, required known, and clear", () => {
    const h = deriveCiHealth(read(overview()), status(), NOW);
    expect(h.level).toBe("green");
    expect(h.headline).toMatch(/^CI healthy — 1 pool measured/);
    expect(stripLevel(h.level)).toBe("green");
  });

  it.each(POOL_NON_MEASURED)(
    "a %s pool makes the strip UNKNOWN, never green",
    (state) => {
      const h = deriveCiHealth(
        read(
          overview({ pools: [pool(), unmeasuredPool(state, { repo: "a/b" })] })
        ),
        status(),
        NOW
      );
      expect(h.level).toBe("unknown");
      expect(h.headline).toMatch(/UNKNOWN/);
      expect(stripLevel(h.level)).toBe("amber");
    }
  );

  it("a measured pool with required === null keeps green unreachable", () => {
    const h = deriveCiHealth(
      read(overview({ pools: [pool({ required: null })] })),
      status(),
      NOW
    );
    expect(h.level).not.toBe("green");
    expect(h.level).toBe("unknown");
  });

  it("no pool observations at all is UNKNOWN, not an idle fleet", () => {
    const h = deriveCiHealth(
      read(overview({ pools: [], note: "tenant has no repos" })),
      status(),
      NOW
    );
    expect(h.level).toBe("unknown");
    expect(h.detail).toMatch(/tenant has no repos/);
  });

  it("a never-landed overview read is UNKNOWN with dashed counts", () => {
    const h = deriveCiHealth(read(null, true), status(), NOW);
    expect(h.level).toBe("unknown");
    expect(h.headline).toMatch(/could not be read/);
    expect(h.badges.find((b) => b.key === "pools")?.label).toBe(
      `pools ${DASH}`
    );
  });

  it("a failed refresh after a good read disqualifies green (stale ≠ current)", () => {
    const h = deriveCiHealth(read(overview(), true), status(), NOW);
    expect(h.level).toBe("unknown");
    expect(h.detail).toMatch(/Last overview refresh failed/);
  });

  it("a read older than three polls disqualifies green by the page clock", () => {
    const h = deriveCiHealth(
      read(overview({ as_of: "2026-10-04T11:00:00Z" })),
      status(),
      NOW
    );
    expect(h.level).toBe("unknown");
  });

  it("an undatable read (no as_of) disqualifies green", () => {
    const h = deriveCiHealth(read(overview({ as_of: null })), status(), NOW);
    expect(h.level).toBe("unknown");
  });

  it("an unseeded CI-status read disqualifies green", () => {
    const h = deriveCiHealth(
      read(overview()),
      status([], { seeded: false }),
      NOW
    );
    expect(h.level).toBe("unknown");
  });

  it("a vacuously-green main disqualifies green", () => {
    const h = deriveCiHealth(
      read(overview()),
      status([ciRow({ main_verdict: "vacuously_green" })]),
      NOW
    );
    expect(h.level).toBe("unknown");
  });

  it("a required pool with no eligible runner is red and named in the headline", () => {
    const h = deriveCiHealth(
      read(
        overview({
          pools: [
            pool({
              pool: "qontinui-ccfg,self-hosted",
              repo: "qontinui/qontinui-claude-config",
              eligibility_state: "no_eligible_runner",
              eligible_runners: 0,
              queued_jobs: 14,
              oldest_queued_age_secs: 11520,
            }),
          ],
        })
      ),
      status(),
      NOW
    );
    expect(h.level).toBe("red");
    expect(h.headline).toBe(
      "Stuck: [qontinui-ccfg, self-hosted] on qontinui/qontinui-claude-config has 0 eligible runners, 14 queued, oldest 3h12m"
    );
    expect(h.badges.find((b) => b.key === "stuck")?.label).toBe("stuck 1");
  });

  it("red main is red", () => {
    const h = deriveCiHealth(
      read(overview()),
      status([ciRow({ main_verdict: "red" })]),
      NOW
    );
    expect(h.level).toBe("red");
    expect(h.headline).toMatch(/Main is red/);
  });

  it("a queue past its bound is amber (waiting)", () => {
    const h = deriveCiHealth(
      read(
        overview({
          pools: [pool({ queued_jobs: 3, oldest_queued_age_secs: 4000 })],
        })
      ),
      status(),
      NOW
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/^Waiting:/);
  });
});

describe("deriveCiHealth — an open alert drives red only on a measured pool", () => {
  const CCFG_POOL = "qontinui-ccfg,self-hosted";

  it("a stall alert on a measured pool is RED and named 'Stuck'", () => {
    const h = deriveCiHealth(
      read(
        overview({
          pools: [
            pool({
              pool: CCFG_POOL,
              queued_jobs: 14,
              oldest_queued_age_secs: 11520,
              open_alerts: [alertFx("ci_job_queue_stalled")],
            }),
          ],
        })
      ),
      status(),
      NOW
    );
    expect(h.level).toBe("red");
    expect(h.headline).toMatch(/^Stuck: \[qontinui-ccfg, self-hosted\]/);
  });

  it("a stall alert the reading contradicts never drives the strip red", () => {
    const h = deriveCiHealth(
      read(
        overview({
          pools: [
            pool({
              queued_jobs: 0,
              open_alerts: [alertFx("ci_job_queue_stalled")],
            }),
          ],
        })
      ),
      status(),
      NOW
    );
    expect(h.level).toBe("amber");
    expect(h.headline).not.toMatch(/Stuck/);
  });

  it.each(POOL_NON_MEASURED)(
    "open alerts on a %s pool render UNKNOWN with their age — never red, never 'Stuck'",
    (state) => {
      // The Phase 0 census shape: coord keeps day-old fire-time alerts open
      // while the pool reads unknown now.
      const h = deriveCiHealth(
        read(
          overview({
            pools: [
              unmeasuredPool(state, {
                pool: CCFG_POOL,
                required: true,
                state_reason: "queue watcher has not visited this pool",
                open_alerts: [
                  alertFx("ci_pool_no_eligible_runner"),
                  alertFx("ci_job_queue_stalled", { alert_id: "918274" }),
                ],
              }),
            ],
          })
        ),
        status(),
        NOW
      );
      expect(h.level).toBe("unknown");
      expect(stripLevel(h.level)).toBe("amber");
      expect(h.headline).not.toMatch(/Stuck/);
      expect(h.headline).toMatch(/UNKNOWN/);
      expect(h.detail).toContain("fired 2026-10-03T09:00:00Z");
      expect(h.detail).toContain("last re-confirmed 2026-10-03T11:30:00Z");
      expect(h.detail).toContain(
        "pool has not been measured since the alert fired"
      );
      expect(h.badges.find((b) => b.key === "stuck")).toBeUndefined();
    }
  );
});

describe("deriveCiHealth — a stuck pool on a stale read is not current", () => {
  const stuckPool = pool({
    eligibility_state: "no_eligible_runner",
    eligible_runners: 0,
    queued_jobs: 14,
  });

  it("a failed refresh turns 'Stuck' into UNKNOWN 'Last read showed …', keeping the stuck badge", () => {
    const h = deriveCiHealth(
      read(overview({ pools: [stuckPool] }), true),
      status(),
      NOW
    );
    expect(h.level).toBe("unknown");
    expect(h.headline).toMatch(/^Last read showed \[qontinui, self-hosted\]/);
    expect(h.headline).toMatch(/— not current$/);
    expect(h.badges.find((b) => b.key === "stuck")?.label).toBe("stuck 1");
  });

  it("an overview older than three polls does the same", () => {
    const h = deriveCiHealth(
      read(overview({ pools: [stuckPool], as_of: "2026-10-04T11:00:00Z" })),
      status(),
      NOW
    );
    expect(h.level).toBe("unknown");
    expect(h.headline).toMatch(/^Last read showed/);
  });

  it("the same pool on a current read is red", () => {
    expect(
      deriveCiHealth(read(overview({ pools: [stuckPool] })), status(), NOW)
        .level
    ).toBe("red");
  });
});

describe("deriveCiHealth — red main on a stale CI-status read is not current", () => {
  it("a failed CI-status refresh turns red main into UNKNOWN 'Last read showed …'", () => {
    const h = deriveCiHealth(
      read(overview()),
      status([ciRow({ main_verdict: "red" })], { error: "HTTP 502" }),
      NOW
    );
    expect(h.level).toBe("unknown");
    expect(h.headline).toBe(
      "Last read showed main red on qontinui/qontinui-web — not current"
    );
    expect(h.badges.find((b) => b.key === "main-red")?.label).toBe(
      "main red 1"
    );
  });
});

describe("deriveCiHealth — green needs every repo row known", () => {
  it("a repo in the overview with no CI-status row blocks green", () => {
    const h = deriveCiHealth(
      read(overview({ repos: [repo(), repo({ repo: "a/other" })] })),
      status(),
      NOW
    );
    expect(h.level).toBe("unknown");
    expect(h.headline).toMatch(/UNKNOWN for 1 repo/);
  });

  it("a CI-status repo with no outcome row blocks green", () => {
    const h = deriveCiHealth(
      read(overview()),
      status([ciRow(), ciRow({ repo: "a/other" })]),
      NOW
    );
    expect(h.level).toBe("unknown");
  });

  it("a repo with unmeasured outcomes blocks green (never green beside a – badge)", () => {
    const h = deriveCiHealth(
      read(overview({ repos: [repo({ state: "stale", outcomes: null })] })),
      status(),
      NOW
    );
    expect(h.level).toBe("unknown");
    expect(h.badges.find((b) => b.key === "content-fail")?.label).toBe(
      `content fail 24h ${DASH}`
    );
  });

  it("no repos at all is UNKNOWN", () => {
    const h = deriveCiHealth(read(overview({ repos: [] })), status([]), NOW);
    expect(h.level).toBe("unknown");
  });
});

describe("pool group freshness is the OLDEST member's", () => {
  it("takes the minimum observed_at", () => {
    const [g] = groupPools([
      pool({ repo: "a/one", observed_at: "2026-10-04T12:07:00Z" }),
      pool({ repo: "a/two", observed_at: "2026-10-04T11:50:00Z" }),
    ]);
    expect(g?.observedAt).toBe("2026-10-04T11:50:00Z");
  });

  it("is null when any member's observed_at is unparseable", () => {
    const [g] = groupPools([
      pool({ repo: "a/one", observed_at: "2026-10-04T12:07:00Z" }),
      pool({ repo: "a/two", observed_at: "not-a-date" }),
    ]);
    expect(g?.observedAt).toBeNull();
  });

  it("is null when any member is undated", () => {
    const [g] = groupPools([
      pool({ repo: "a/one", observed_at: "2026-10-04T12:07:00Z" }),
      pool({ repo: "a/two", observed_at: null }),
    ]);
    expect(g?.observedAt).toBeNull();
  });
});

describe("the 2026-10-04T12:08Z capture — UNKNOWN capacity, not '0 runners'", () => {
  // coord_query_train_health for qontinui/qontinui-claude-config: 127 open
  // PRs, 65 ci-failed; ci_runner_inventory capacity_reading
  // "unknown_unrefreshed", tenant.online_hosts 0, registrar coverage
  // "unrefreshed". On the overview wire that is a pool row coord could not
  // measure (state unknown, NULL counts) beside a CI-status row with 65
  // failing PR checks.
  const CCFG = "qontinui/qontinui-claude-config";
  const capture = overview({
    pools: [
      unmeasuredPool("unknown", {
        repo: CCFG,
        pool: "qontinui-ccfg,self-hosted",
        state_reason:
          "registrar unrefreshed (capacity_reading: unknown_unrefreshed)",
        required: true,
      }),
    ],
    repos: [
      repo({
        repo: CCFG,
        state: "unknown",
        outcomes: null,
        state_reason: "registrar unrefreshed",
      }),
    ],
  });
  const ci = [
    ciRow({
      repo: CCFG,
      main_verdict: "unknown",
      open_pr_checks: { success: 40, failure: 65, pending: 22 },
    }),
  ];

  it("derives UNKNOWN capacity, never red and never green", () => {
    const h = deriveCiHealth(read(capture), status(ci), NOW);
    expect(h.level).toBe("unknown");
    expect(h.headline).toBe(
      "CI capacity UNKNOWN for 1 pool — registrar unrefreshed (capacity_reading: unknown_unrefreshed)"
    );
    expect(h.headline).not.toMatch(/0 (eligible )?runners/);
  });

  it("the pool row shows – for runners, not 0", () => {
    const cells = poolGroupCells(groupPools(capture.pools)[0]);
    expect(cells.eligible.text).toBe(DASH);
    expect(cells.eligible.reason).toMatch(/registrar unrefreshed/);
    expect(cells.queued.text).toBe(DASH);
  });

  it("the 65 failing PR checks are not counted as content red", () => {
    const h = deriveCiHealth(read(capture), status(ci), NOW);
    expect(h.badges.find((b) => b.key === "content-fail")?.label).toBe(
      `content fail 24h ${DASH}`
    );
    const [row] = buildRepoRows(capture, ci, ECON);
    expect(row.outcomes.content_fail.text).toBe(DASH);
    expect(row.outcomes.infra_shaped.text).toBe(DASH);
    // The PR-check count itself is a measured fact and is shown as one.
    expect(row.prChecks.text).toMatch(/^65 failing/);
    expect(row.status.attention).toBe("waiting");
  });
});

describe("repo rows", () => {
  it("joins ci-status and overview case-insensitively and links the Train tab", () => {
    const rows = buildRepoRows(
      overview({ repos: [repo({ repo: "Qontinui/Qontinui-Web" })] }),
      [ciRow()],
      ECON
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].trainHref).toBe(
      "/admin/coord/pipeline?tab=train&repo=qontinui%2Fqontinui-web"
    );
    expect(rows[0].candidateP90.text).toBe("10m");
    expect(rows[0].mainObservedAt).toBe("2026-10-04T12:00:00Z");
  });

  it("an unread economics map renders candidate p90 as –", () => {
    const [row] = buildRepoRows(overview(), [ciRow()], {
      byRepo: null,
      asOf: null,
      failed: true,
    });
    expect(row.candidateP90.text).toBe(DASH);
    expect(row.candidateP90.reason).toMatch(/failed/);
  });

  it("a repo coord's economics omits renders –, not 0", () => {
    const [row] = buildRepoRows(overview(), [ciRow()], {
      byRepo: {},
      asOf: AS_OF,
      failed: false,
    });
    expect(row.candidateP90.text).toBe(DASH);
  });

  it("vacuously green main renders – and is amber", () => {
    const s = repoRowStatus(
      "a/b",
      ciRow({ main_verdict: "vacuously_green" }),
      repo()
    );
    expect(s.kind).toBe("main_vacuous");
    expect(s.attention).toBe("waiting");
    const [row] = buildRepoRows(
      overview(),
      [ciRow({ main_verdict: "vacuously_green" })],
      ECON
    );
    expect(row.mainVerdict.text).toBe(DASH);
  });

  it("main green with unmeasured outcomes is amber, not healthy", () => {
    const s = repoRowStatus("a/b", ciRow(), repo({ state: "stale" }));
    expect(s.kind).toBe("outcomes_unknown");
  });
});

describe("formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(40)).toBe("40s");
    expect(formatDuration(600)).toBe("10m");
    expect(formatDuration(11520)).toBe("3h12m");
    expect(formatDuration(7200)).toBe("2h");
  });
  it("labels a pool as its label set", () => {
    expect(poolLabel("qontinui, self-hosted")).toBe("[qontinui, self-hosted]");
  });
});

// ---------------------------------------------------------------------------
// Coord AS-BUILT follow-up: unattached alerts, repo freshness, null queue half
// ---------------------------------------------------------------------------

/** coord's test sample, verbatim shape. */
const UNATTACHED: CiUnattachedAlertWire = {
  repo: "qontinui/qontinui-web",
  pool: "qontinui,self-hosted",
  alert_id: "47990",
  kind: "ci_pool_no_eligible_runner",
  opened_at: "2026-10-03T08:12:00Z",
  last_seen_at: "2026-10-03T08:40:00Z",
  occurrences: 3,
  summary: "0 eligible runners",
  current_state_note:
    "no persisted pool row matches this alert; its numbers are not current",
};

describe("unattached alerts — never red, never ignored", () => {
  it("make an otherwise-green strip UNKNOWN, with the alert's age in the detail", () => {
    const h = deriveCiHealth(
      read(overview({ unattached_alerts: [UNATTACHED] })),
      status(),
      NOW
    );
    expect(h.level).toBe("unknown");
    expect(h.headline).toBe(
      "CI health UNKNOWN — 1 open alert with no current pool reading"
    );
    expect(h.headline).not.toMatch(/Stuck/);
    expect(h.detail).toContain("fired 2026-10-03T08:12:00Z");
    expect(h.detail).toContain("last re-confirmed 2026-10-03T08:40:00Z");
    expect(h.detail).toContain("no persisted pool row matches");
    expect(h.badges.find((b) => b.key === "unattached-alerts")?.label).toBe(
      "alerts unconfirmed 1"
    );
    expect(h.badges.find((b) => b.key === "stuck")).toBeUndefined();
  });

  it("are reported even when coord has no pool rows at all", () => {
    const h = deriveCiHealth(
      read(overview({ pools: [], unattached_alerts: [UNATTACHED] })),
      status(),
      NOW
    );
    expect(h.level).toBe("unknown");
    expect(h.detail).toContain("no current pool reading");
  });

  it("an absent field (older coord) is no unattached alerts", () => {
    const h = deriveCiHealth(read(overview()), status(), NOW);
    expect(h.level).toBe("green");
  });

  it("do not lift a measured stuck pool off red", () => {
    const h = deriveCiHealth(
      read(
        overview({
          pools: [
            pool({
              eligibility_state: "no_eligible_runner",
              eligible_runners: 0,
            }),
          ],
          unattached_alerts: [UNATTACHED],
        })
      ),
      status(),
      NOW
    );
    expect(h.level).toBe("red");
  });
});

describe("repo freshness and watched pools", () => {
  it("carries last_observed_at and pools_watched onto the row", () => {
    const [row] = buildRepoRows(
      overview({
        repos: [
          repo({
            last_observed_at: "2026-10-04T11:52:10Z",
            pools_watched: false,
          }),
        ],
      }),
      [ciRow()],
      ECON
    );
    expect(row?.outcomesObservedAt).toBe("2026-10-04T11:52:10Z");
    expect(row?.poolsWatched).toBe(false);
  });

  it("absent fields (older coord) read as unknown, not false", () => {
    const [row] = buildRepoRows(overview(), [ciRow()], ECON);
    expect(row?.outcomesObservedAt).toBeNull();
    expect(row?.poolsWatched).toBeNull();
  });

  it("a repo whose 24h window is empty but has history reads unknown — amber –", () => {
    const ov = repo({
      state: "unknown",
      outcomes: null,
      state_reason: "no job in the last 24 h; older observations exist",
      last_observed_at: "2026-10-02T10:00:00Z",
    });
    const cells = outcomeCells(ov);
    expect(cells.content_fail.text).toBe(DASH);
    expect(cells.content_fail.reason).toBe(
      "no job in the last 24 h; older observations exist"
    );
    expect(repoRowStatus("qontinui/qontinui-web", ciRow(), ov).attention).toBe(
      "waiting"
    );
  });
});

describe("a pool whose queue half is all null", () => {
  const nullQueue = unmeasuredPool("unknown", {
    observed_at: null,
    stale_after_secs: null,
    poll_ok: null,
    poll_complete: null,
  });

  it("renders every figure – and its group is undated", () => {
    for (const c of Object.values(poolMemberCells(nullQueue))) {
      expect(c.text).toBe(DASH);
      expect(c.text).not.toMatch(/NaN|ago/);
    }
    const [g] = groupPools([nullQueue]);
    expect(g?.observedAt).toBeNull();
    expect(g?.status.kind).toBe("unknown");
  });
});

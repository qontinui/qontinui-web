/**
 * PlanCoveragePanel — the ways a set difference can be turned back into a lie
 * on the way to the screen.
 *
 * Phase 3 spent a whole backend module making four things impossible on the
 * wire: a ratio, a zeroed absence, an omitted key, and a numerator drawn from
 * a wider set than its denominator. Every one of them is reachable again in a
 * presentation layer — `?? 0`, a `toFixed` over the convenient denominator, a
 * key skipped because its numbers are `null` — and the operator would then
 * read a confident wrong figure off a response that refused to state one.
 *
 * So each test pins one rule, by MUTATION where a mutation exists: flip the
 * one field the rule keys on and the copy must change. Fixtures are shapes the
 * ROUTE can actually emit — `_unknown_coverage` nulls every count and keeps
 * the key, so a fixture with an `unknown` state and real integers teaches a
 * shape that does not exist and cannot catch the bug that does.
 *
 * The hook is mocked. `useScanRoots` is mocked alongside it because this
 * panel imports `shortDuration` from `ScanSourcesPanel`, which imports that
 * hook from the same module; a mock missing the export would fail at import
 * rather than at a test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const usePlanCoverageMock = vi.fn();
vi.mock("../_hooks/usePlanLibrary", () => ({
  usePlanCoverage: () => usePlanCoverageMock(),
  // Present only so `ScanSourcesPanel`'s import of it resolves — this suite
  // never renders that panel.
  useScanRoots: () => ({
    data: null,
    fetchedAt: null,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

import {
  PlanCoveragePanel,
  ageLabel,
  capturedNotAuthoredSentence,
  censusQualificationSentence,
  coverageKey,
  coverageStateLabel,
  denominatorSentence,
  distanceSentence,
  missingSentence,
  notEstablishedSentence,
  outOfScopeSentence,
  refSentence,
  splitDetail,
} from "./PlanCoveragePanel";
import type {
  PlanCensusSide,
  PlanCoverage,
  ScanRootListResponse,
} from "../types";

const DEVICE = "00000000-0000-4000-8000-000000000007";
const OTHER_DEVICE = "00000000-0000-4000-8000-000000000008";
const SOURCE = "qontinui-dev-notes/plans";
const KEY = `repo=${SOURCE}`;

function side(overrides: Partial<PlanCensusSide> = {}): PlanCensusSide {
  return {
    source: "ref",
    ref_sha: "aaa1111",
    ref_age_secs: 120,
    count: 4,
    listed_count: 4,
    truncated: false,
    digest: "2a8e",
    ...overrides,
  };
}

/**
 * A `measured` entry, in the shape `coverage_for_source` builds.
 *
 * **Every count is a DIFFERENT integer, deliberately.** With the three
 * rendered numbers all `2`, the assertions below pass under any permutation
 * of `both` / `authored_not_captured` / `captured` — and a transposition is
 * precisely the defect this panel cannot afford. These satisfy the backend's
 * own arithmetic, so they are a shape it can really emit:
 * `captured = |captured_slugs| = 4`, `both = |captured ∩ authored| = 3`,
 * `captured_not_authored = 4 - 3 = 1`, `authored_not_captured = 5 - 3 = 2`
 * against an authored side of 5, and `missing_sample` holds those 2.
 */
function measured(overrides: Partial<PlanCoverage> = {}): PlanCoverage {
  return {
    source_repo: SOURCE,
    state: "measured",
    detail: null,
    device_count: 1,
    census_device_id: DEVICE,
    other_census_device_ids: [],
    authored_at_ref: side({ count: 5, listed_count: 5 }),
    visible_to_scanner: side({
      source: "work_tree",
      ref_sha: null,
      count: 4,
      listed_count: 4,
      digest: "9ef6",
    }),
    captured: 4,
    both: 3,
    authored_not_captured: 2,
    captured_not_authored: 1,
    authored_not_captured_but_invisible: 1,
    out_of_scope_artifact_count: 3,
    missing_sample: ["2026-09-03-gamma", "2026-09-04-delta"],
    sample_truncated: false,
    min_behind: 254,
    min_behind_is_floor: false,
    observation_age_secs: 30,
    observation_fresh: true,
    counts_are_floors: false,
    ref_sha: "aaa1111",
    ...overrides,
  };
}

/**
 * An `unknown` entry, in the shape `_unknown_coverage` builds: EVERY count
 * null, the key kept, `min_behind` carried anyway (it comes from the roll-up,
 * not the census).
 */
function unknown(overrides: Partial<PlanCoverage> = {}): PlanCoverage {
  return {
    source_repo: SOURCE,
    state: "unknown",
    detail:
      "no_census: none of the 2 device(s) reporting this scan source has a " +
      "fresh, applied reading carrying BOTH stem listings with their stems, " +
      "so how much of what exists the corpus holds is not established — not " +
      "0 and not 100%",
    device_count: 2,
    census_device_id: null,
    other_census_device_ids: [],
    authored_at_ref: null,
    visible_to_scanner: null,
    captured: null,
    both: null,
    authored_not_captured: null,
    captured_not_authored: null,
    authored_not_captured_but_invisible: null,
    out_of_scope_artifact_count: null,
    missing_sample: [],
    sample_truncated: false,
    min_behind: 254,
    min_behind_is_floor: true,
    observation_age_secs: null,
    observation_fresh: null,
    counts_are_floors: null,
    ref_sha: null,
    ...overrides,
  };
}

function response(
  coverage: PlanCoverage[],
  overrides: Partial<ScanRootListResponse> = {}
): ScanRootListResponse {
  return {
    // The LIST response's vocabulary is ["reported", "unknown"] — a coverage
    // ENTRY's is ["measured", "unknown"], and the two are different enums on
    // different models. `measured` here is a shape the route cannot emit, and
    // this file's own contract is that every fixture is one it can.
    state: "reported",
    detail: null,
    fresh_within_secs: 2700,
    count: 1,
    fresh_count: 1,
    rows: [],
    by_source_repo: [],
    coverage,
    coverage_detail: coverage.length ? null : "not_computed_here: …",
    ...overrides,
  };
}

function mountWith(
  coverage: PlanCoverage[] | null,
  extra: Partial<{
    loading: boolean;
    error: string | null;
    data: ScanRootListResponse | null;
  }> = {}
) {
  usePlanCoverageMock.mockReturnValue({
    data: coverage === null ? null : response(coverage),
    fetchedAt: new Date("2026-09-15T10:00:00Z"),
    loading: false,
    error: null,
    reload: vi.fn(),
    ...extra,
  });
  return render(<PlanCoveragePanel />);
}

beforeEach(() => {
  usePlanCoverageMock.mockReset();
});

describe("PlanCoveragePanel — the three numbers", () => {
  it("renders the set difference as three LABELLED numbers", () => {
    mountWith([measured()]);
    const counts = screen.getByTestId(`plan-coverage-counts:${KEY}`);
    expect(
      within(counts).getByTestId(`plan-coverage-both:${KEY}`)
    ).toHaveTextContent(/At the ref and captured\s*3/);
    expect(
      within(counts).getByTestId(`plan-coverage-missing:${KEY}`)
    ).toHaveTextContent(/At the ref, not captured\s*2/);
    // The three integers are distinct, so a transposition of the fields
    // behind them fails here instead of passing silently.
    expect(
      within(counts).getByTestId(`plan-coverage-extra:${KEY}`)
    ).toHaveTextContent(/Captured, not at the ref\s*1/);
  });

  it("names BOTH denominators, and says which side each is", () => {
    mountWith([measured()]);
    const line = screen.getByTestId(`plan-coverage-denominators:${KEY}`);
    expect(line).toHaveTextContent("5 stems exist at the ref");
    expect(line).toHaveTextContent(
      "4 stems were visible in the working tree the body sync scans"
    );
  });

  it("puts ref_sha and min_behind beside the numbers", () => {
    mountWith([measured()]);
    const line = screen.getByTestId(`plan-coverage-distance:${KEY}`);
    expect(line).toHaveTextContent("exactly 254 behind");
    expect(line).toHaveTextContent("Differenced against aaa1111");
    expect(line).toHaveTextContent("2m old at that reading");
  });

  it("shows out_of_scope_artifact_count as its own line, not a footnote", () => {
    mountWith([measured()]);
    const line = screen.getByTestId(`plan-coverage-out-of-scope:${KEY}`);
    expect(line).toHaveTextContent(
      "3 plan rows in this organization sit under a different scan source, or under none"
    );
    expect(line).toHaveTextContent("never subtracted");
  });
});

describe("PlanCoveragePanel — the percentage rule", () => {
  /**
   * The rule the whole plan exists for. A percentage is allowed ONLY inside
   * the sentence that has already named both denominators; anywhere else on a
   * measured entry it is the headline figure that read 101.8%.
   */
  it("renders NO percentage anywhere but inside the denominators sentence", () => {
    const { container } = mountWith([measured()]);
    const denominators = screen.getByTestId(
      `plan-coverage-denominators:${KEY}`
    );
    const everythingElse = (container.textContent ?? "").replace(
      denominators.textContent ?? "",
      ""
    );
    expect(everythingElse).not.toContain("%");
    // And the one that IS allowed says which side it is over.
    expect(denominators).toHaveTextContent("60.0% of THAT side");
    expect(denominators).toHaveTextContent("not a share of the 4");
  });

  it("states that the permitted share cannot exceed 100%", () => {
    mountWith([measured()]);
    expect(
      screen.getByTestId(`plan-coverage-denominators:${KEY}`)
    ).toHaveTextContent("It cannot exceed 100%");
  });

  it("refuses a share over an EMPTY authored side rather than dividing by 0", () => {
    const entry = measured({
      authored_at_ref: side({ count: 0, listed_count: 0 }),
      both: 0,
      authored_not_captured: 0,
      authored_not_captured_but_invisible: 0,
      // With nothing at the ref, every captured row is captured-not-authored.
      captured_not_authored: 4,
      missing_sample: [],
    });
    expect(denominatorSentence(entry)).toContain("no share to state");
    expect(denominatorSentence(entry)).toContain("0 of 0 is not full coverage");
    expect(denominatorSentence(entry)).not.toContain("NaN");
  });

  it("states no share at all when a side is missing", () => {
    expect(denominatorSentence(unknown())).toBeNull();
    expect(
      denominatorSentence(measured({ visible_to_scanner: null }))
    ).toBeNull();
    expect(denominatorSentence(measured({ both: null }))).toBeNull();
  });

  it("divides by listed_count, never by the enumerated count", () => {
    // A census that enumerated 10 and sent 4 — the difference was taken over
    // the 4. Dividing by 10 would be a numerator from one set over a
    // denominator from another, which is the original defect in miniature.
    const entry = measured({
      authored_at_ref: side({ count: 10, listed_count: 4 }),
      both: 3,
      authored_not_captured: 1,
      missing_sample: ["2026-09-03-gamma"],
    });
    expect(denominatorSentence(entry)).toContain("75.0%");
    expect(denominatorSentence(entry)).toContain("4 stems exist at the ref");
  });
});

describe("PlanCoveragePanel — unknown is a sentence, never a zero", () => {
  it("renders 'not established, because …' built from the detail", () => {
    mountWith([unknown()]);
    const line = screen.getByTestId(`plan-coverage-not-established:${KEY}`);
    expect(line).toHaveTextContent(
      "How much of what exists the corpus holds is not established here, because none of the 2 device(s)"
    );
    expect(line).toHaveTextContent("no_census");
  });

  it("renders NO count badges for an unknown key", () => {
    mountWith([unknown()]);
    expect(
      screen.queryByTestId(`plan-coverage-counts:${KEY}`)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`plan-coverage-both:${KEY}`)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`plan-coverage-out-of-scope:${KEY}`)
    ).not.toBeInTheDocument();
  });

  it("keeps the key and never renders a 0 for it", () => {
    mountWith([unknown()]);
    const entry = screen.getByTestId(`plan-coverage-entry:${KEY}`);
    expect(entry).toHaveTextContent(SOURCE);
    expect(entry).toHaveTextContent("Not established");
    // Nothing this panel WRITES about an unknown key states a quantity. The
    // route's own detail is quoted verbatim and does contain "not 0 and not
    // 100%" — a refusal, not a count — so it is excluded rather than
    // paraphrased, which would put this panel's words in the route's mouth.
    const quoted =
      screen.getByTestId(`plan-coverage-not-established:${KEY}`).textContent ??
      "";
    const ours = (entry.textContent ?? "").replace(quoted, "");
    expect(ours).not.toMatch(/\b0\b/);
    expect(ours).not.toContain("%");
  });

  it("still renders the distance the roll-up carried onto it", () => {
    mountWith([unknown()]);
    expect(
      screen.getByTestId(`plan-coverage-distance:${KEY}`)
    ).toHaveTextContent("at least 254 behind");
  });

  it("MUTATION: a different reason changes the sentence", () => {
    const other = unknown({
      detail:
        "source_repo_unnamed: these readings name no scan source, so their " +
        "stems cannot be joined to the corpus rows they would be compared with",
      source_repo: null,
    });
    expect(notEstablishedSentence(other)).toContain(
      "these readings name no scan source"
    );
    expect(notEstablishedSentence(other)).not.toContain("no_census");
  });

  it("says so when a detail is missing entirely", () => {
    const sentence = notEstablishedSentence(unknown({ detail: null }));
    expect(sentence).toContain("served no reason");
    expect(sentence).toContain("not 0 captured");
  });
});

describe("PlanCoveragePanel — an empty coverage array", () => {
  it("renders coverage_detail, never an empty panel", () => {
    usePlanCoverageMock.mockReturnValue({
      data: response([], {
        coverage_detail:
          "not_computed_here: this rendering of the scan-root readings does " +
          "not compute plan coverage",
      }),
      fetchedAt: new Date(),
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<PlanCoveragePanel />);
    expect(screen.getByTestId("plan-coverage-none")).toHaveTextContent(
      "not_computed_here"
    );
  });

  it("MUTATION: a different reason renders different copy", () => {
    usePlanCoverageMock.mockReturnValue({
      data: response([], {
        coverage_detail:
          "no_observation: no device has reported a plan-scan-source reading",
      }),
      fetchedAt: new Date(),
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<PlanCoveragePanel />);
    const none = screen.getByTestId("plan-coverage-none");
    expect(none).toHaveTextContent("no_observation");
    expect(none).not.toHaveTextContent("not_computed_here");
  });

  it("refuses to read an empty answer with no reason as full coverage", () => {
    usePlanCoverageMock.mockReturnValue({
      data: response([], { coverage_detail: null }),
      fetchedAt: new Date(),
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<PlanCoveragePanel />);
    expect(screen.getByTestId("plan-coverage-none")).toHaveTextContent(
      "not established"
    );
  });
});

describe("PlanCoveragePanel — the missing sample", () => {
  it("is expandable, and closed by default", () => {
    mountWith([measured()]);
    const details = screen.getByTestId(`plan-coverage-sample:${KEY}`);
    expect(details.tagName).toBe("DETAILS");
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("2026-09-03-gamma")).toBeInTheDocument();
    expect(details).toHaveTextContent("Show the 2 missing stems");
  });

  it("says a truncated sample is a prefix, not the whole list", () => {
    mountWith([measured({ sample_truncated: true })]);
    expect(
      screen.getByTestId(`plan-coverage-sample-truncated:${KEY}`)
    ).toHaveTextContent("not therefore captured");
    expect(screen.getByTestId(`plan-coverage-sample:${KEY}`)).toHaveTextContent(
      "Show 2 of the missing stems"
    );
  });

  it("renders nothing when nothing is missing", () => {
    // Internally consistent: nothing missing means `both` EQUALS the authored
    // side. Leaving it at 3 of 5 renders "The corpus holds 3 of the 5 that
    // exist" beside "Every stem ... is in the corpus" — two sentences that
    // cannot both be true, in a fixture claiming to be the backend's shape.
    mountWith([
      measured({
        missing_sample: [],
        both: 5,
        captured: 6,
        captured_not_authored: 1,
        authored_not_captured: 0,
        authored_not_captured_but_invisible: 0,
      }),
    ]);
    expect(
      screen.queryByTestId(`plan-coverage-sample:${KEY}`)
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`plan-coverage-missing-sentence:${KEY}`)
    ).toHaveTextContent("Every stem that exists at that ref is in the corpus");
  });
});

describe("PlanCoveragePanel — the read itself", () => {
  it("shows a skeleton before the first answer", () => {
    mountWith(null, { loading: true, data: null });
    expect(screen.getByTestId("plan-coverage-loading")).toBeInTheDocument();
  });

  it("keeps the last numbers on a failed reload and calls them stale", () => {
    mountWith([measured()], { error: "boom" });
    expect(screen.getByTestId("plan-coverage-error")).toHaveTextContent(
      "may be stale"
    );
    expect(
      screen.getByTestId(`plan-coverage-counts:${KEY}`)
    ).toBeInTheDocument();
  });

  it("a read that never delivered is unknown, not full coverage", () => {
    mountWith(null, { error: "boom", data: null });
    expect(screen.getByTestId("plan-coverage-error")).toHaveTextContent(
      "unknown, not full"
    );
  });

  it("names the census device in full, and any device that may disagree", () => {
    mountWith([measured({ other_census_device_ids: [OTHER_DEVICE] })]);
    expect(
      screen.getByTestId(`plan-coverage-census-device:${KEY}`)
    ).toHaveTextContent(DEVICE);
    expect(
      screen.getByTestId(`plan-coverage-other-devices:${KEY}`)
    ).toHaveTextContent(OTHER_DEVICE);
  });
});

describe("the sentence builders", () => {
  it("attributes a gap the scanned tree could not have seen", () => {
    expect(missingSentence(measured())).toBe(
      "2 stems that exist at the ref are not in the corpus. 1 of them was not " +
        "in the tree the sync scans and could not have been captured — " +
        "checkout freshness, not a capture defect. That leaves 1 that was " +
        "visible and still missing."
    );
  });

  it("refuses the attribution when it was not served", () => {
    const sentence = missingSentence(
      measured({ authored_not_captured_but_invisible: null })
    );
    expect(sentence).toContain("was not served");
    expect(sentence).not.toContain("That leaves");
  });

  it("states no attribution at all when nothing is missing", () => {
    expect(missingSentence(measured({ authored_not_captured: 0 }))).toBe(
      "Every stem that exists at that ref is in the corpus."
    );
    expect(missingSentence(unknown())).toBeNull();
  });

  it("calls captured-not-authored a fact, not a defect", () => {
    const sentence = capturedNotAuthoredSentence(
      measured({ captured_not_authored: 2 })
    );
    expect(sentence).toContain("Not a coverage defect");
    expect(sentence).toContain("never subtracted");
    // Absent entirely when the two sides agree — a 0 here is not worth a line.
    expect(
      capturedNotAuthoredSentence(measured({ captured_not_authored: 0 }))
    ).toBeNull();
  });

  it("says every row is in scope when none is out of it", () => {
    expect(
      outOfScopeSentence(measured({ out_of_scope_artifact_count: 0 }))
    ).toBe("Every plan row in this organization sits under this scan source.");
    expect(outOfScopeSentence(unknown())).toBeNull();
  });

  it("never renders a null distance as 0", () => {
    expect(distanceSentence(measured({ min_behind: null }))).toContain(
      "not established"
    );
    expect(distanceSentence(measured({ min_behind: null }))).not.toContain("0");
    // A FLOOR of 0 is unreachable by construction: `rollup_source` nulls BOTH
    // `min_behind` and `min_behind_is_floor` on a zero floor, because "at
    // least 0 behind" establishes nothing. So the floor arm is pinned at a
    // distance the backend can actually report.
    expect(
      distanceSentence(measured({ min_behind: 7, min_behind_is_floor: true }))
    ).toContain("at least 7 behind");
    expect(
      distanceSentence(
        measured({ min_behind: null, min_behind_is_floor: null })
      )
    ).toContain("not established");
  });

  it("names BOTH shas when the census and the reading disagree", () => {
    const entry = measured({ ref_sha: "bbb2222" });
    expect(refSentence(entry, entry.authored_at_ref)).toContain(
      "Differenced against aaa1111"
    );
    expect(refSentence(entry, entry.authored_at_ref)).toContain(
      "reading itself reported ref bbb2222"
    );
  });

  it("falls back to the reading's sha when the census names none", () => {
    const entry = measured({
      authored_at_ref: side({ ref_sha: null }),
      ref_sha: "ccc3333",
    });
    expect(refSentence(entry, entry.authored_at_ref)).toContain(
      "Differenced against ccc3333"
    );
  });

  it("never claims a ref age it did not measure", () => {
    const entry = measured({
      authored_at_ref: side({ ref_age_secs: null }),
    });
    expect(refSentence(entry, entry.authored_at_ref)).toContain(
      "age at that reading was not measured"
    );
  });

  it("splits a detail into its grep-able reason and its prose", () => {
    expect(splitDetail("no_census: nothing was sent")).toEqual({
      reason: "no_census",
      prose: "nothing was sent",
    });
    expect(splitDetail("a detail in no known shape")).toEqual({
      reason: null,
      prose: "a detail in no known shape",
    });
  });

  it("labels a verdict without ever implying a quantity", () => {
    expect(coverageStateLabel("measured")).toBe("Measured");
    expect(coverageStateLabel("unknown")).toBe("Not established");
  });

  it("gives the null source its own key, disjoint from any named one", () => {
    expect(coverageKey(null)).toBe("null");
    expect(coverageKey("null")).toBe("repo=null");
    expect(coverageKey(SOURCE)).toBe(KEY);
  });
});

/**
 * The rounding hedge. A share is the panel's ONE permitted number, so the two
 * ends of its range are the two places it can still assert something false —
 * and `toFixed(1)` asserts both of them.
 */
describe("the share never rounds into a claim it cannot make", () => {
  function shareOf(both: number, authored: number): string {
    return (
      denominatorSentence(
        measured({
          both,
          authored_at_ref: side({ count: authored, listed_count: authored }),
          authored_not_captured: authored - both,
          authored_not_captured_but_invisible: 0,
          missing_sample: [],
        })
      ) ?? ""
    );
  }

  it("does not round an incomplete corpus up to 100%", () => {
    const sentence = shareOf(9999, 10000);
    // `toFixed(1)` gives "100.0%" here — full coverage, printed beside a
    // missing count of 1, inside a sentence asserting it cannot exceed 100%.
    expect(sentence).toContain(">99.9% of THAT side");
    expect(sentence).not.toContain("100.0%");
  });

  it("does not round a non-empty overlap down to 0%", () => {
    const sentence = shareOf(1, 10000);
    // `toFixed(1)` gives "0.0%" — the corpus holds some and this says none.
    expect(sentence).toContain("<0.1% of THAT side");
    expect(sentence).not.toContain("0.0%");
  });

  it("keeps 100% and 0% for the EXACT cases, so they stay load-bearing", () => {
    expect(shareOf(5, 5)).toContain("100% of THAT side");
    expect(shareOf(5, 5)).not.toContain(">99.9%");
    expect(shareOf(0, 5)).toContain("0% of THAT side");
    expect(shareOf(0, 5)).not.toContain("<0.1%");
  });
});

/**
 * A measured verdict is NECESSARY but not sufficient for printing a number.
 * Every count is independently nullable on the wire, so the counts have to be
 * gated on the denominators actually being there.
 */
describe("counts never render without a denominator named", () => {
  it("suppresses the counts when a census side is missing", () => {
    mountWith([measured({ visible_to_scanner: null })]);
    // Three integers with no denominator anywhere is the claim this panel
    // deletes; three "-" badges with no sentence is the empty-panel shape.
    expect(
      screen.queryByTestId(`plan-coverage-counts:${KEY}`)
    ).not.toBeInTheDocument();
    const line = screen.getByTestId(
      `plan-coverage-denominators-unserved:${KEY}`
    );
    expect(line).toHaveTextContent("no stem listing for one or both sides");
    expect(line).toHaveTextContent("not 0 captured and not full coverage");
  });

  it("suppresses them when the overlap itself was not served", () => {
    mountWith([measured({ both: null })]);
    expect(
      screen.queryByTestId(`plan-coverage-counts:${KEY}`)
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`plan-coverage-denominators-unserved:${KEY}`)
    ).toBeInTheDocument();
  });

  it("MUTATION: with both sides served, the counts come back", () => {
    mountWith([measured()]);
    expect(
      screen.getByTestId(`plan-coverage-counts:${KEY}`)
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`plan-coverage-denominators-unserved:${KEY}`)
    ).not.toBeInTheDocument();
  });
});

/** Every age here is a server-computed delta frozen at fetch time. */
describe("the ages are stamped with the moment they were read", () => {
  it("renders a read-at stamp beside the entries", () => {
    mountWith([measured()]);
    expect(screen.getByTestId("plan-coverage-read-at")).toHaveTextContent(
      "the ages above are as of then"
    );
  });

  it("renders one on the no-coverage branch too", () => {
    usePlanCoverageMock.mockReturnValue({
      data: response([]),
      fetchedAt: new Date(),
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<PlanCoveragePanel />);
    expect(screen.getByTestId("plan-coverage-read-at")).toBeInTheDocument();
  });

  it("renders none when the hook has no fetch time", () => {
    usePlanCoverageMock.mockReturnValue({
      data: response([measured()]),
      fetchedAt: null,
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<PlanCoveragePanel />);
    expect(
      screen.queryByTestId("plan-coverage-read-at")
    ).not.toBeInTheDocument();
  });

  it("never reads a null freshness as SILENT", () => {
    // `!null` is `false`, so a two-valued read asserts the device went quiet
    // off a field that established nothing.
    expect(ageLabel(measured({ observation_fresh: null }))).toBe(
      "reading 30s old; freshness not established"
    );
    expect(ageLabel(measured())).toBe("heard 30s ago");
    expect(ageLabel(measured({ observation_fresh: false }))).toBe("silent 30s");
    expect(ageLabel(measured({ observation_age_secs: null }))).toBeNull();
  });
});

/**
 * The distance is about the least-behind feeder; the numbers are about the
 * device with the freshest ref. With more than one device those are routinely
 * different boxes, and two figures side by side read as one.
 */
describe("the census device is not the device the distance is about", () => {
  it("says so when more than one device feeds the source", () => {
    const sentence = censusQualificationSentence(measured({ device_count: 3 }));
    expect(sentence).toContain("freshest ref");
    expect(sentence).toContain("not necessarily that feeder");
  });

  it("renders the census device's own floor qualification", () => {
    // `counts_are_floors` is otherwise the one served field nothing renders.
    expect(
      censusQualificationSentence(measured({ counts_are_floors: true }))
    ).toContain("lower bounds");
    expect(censusQualificationSentence(measured())).toBeNull();
  });

  it("puts it on the panel beside the distance", () => {
    mountWith([measured({ device_count: 2, counts_are_floors: true })]);
    expect(
      screen.getByTestId(`plan-coverage-distance:${KEY}`)
    ).toHaveTextContent("lower bounds");
  });
});

describe("a response with no coverage FIELD at all", () => {
  it("renders the unknown sentence rather than throwing", () => {
    // A backend predating Phase 3, or a front/back deploy skew. Reading
    // `.length` off `undefined` takes down the whole route segment.
    const full = response([]);
    const withoutCoverage = { ...full, coverage_detail: null } as Omit<
      ScanRootListResponse,
      "coverage"
    > &
      Partial<Pick<ScanRootListResponse, "coverage">>;
    delete withoutCoverage.coverage;
    usePlanCoverageMock.mockReturnValue({
      data: withoutCoverage,
      fetchedAt: new Date(),
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    expect(() => render(<PlanCoveragePanel />)).not.toThrow();
    expect(screen.getByTestId("plan-coverage-none")).toHaveTextContent(
      "no reason was given"
    );
  });
});

describe("refSentence attributes the age to the ref it belongs to", () => {
  it("does not hang the reading's age on the census sha", () => {
    // `_census_side` copies `ref_age_secs` from the READING, so in the one
    // branch where the two shas disagree the age is about the reported ref.
    const entry = measured({ ref_sha: "bbb2222" });
    const sentence = refSentence(entry, entry.authored_at_ref) ?? "";
    expect(sentence).toContain(
      "Differenced against aaa1111, whose own age at that reading was not reported"
    );
    expect(sentence).toContain(
      "reported ref bbb2222, which was 2m old at that reading"
    );
  });

  it("keeps the simple form when the two agree", () => {
    const entry = measured();
    expect(refSentence(entry, entry.authored_at_ref)).toBe(
      "Differenced against aaa1111. It was 2m old at that reading."
    );
  });
});

describe("notEstablishedSentence lower-cases prose and nothing else", () => {
  it("leaves an identifier, sha or acronym alone", () => {
    for (const opening of ["SHA aaa1111 was", "POST failed", "aaa1111 was"]) {
      const sentence = notEstablishedSentence(
        unknown({ detail: `future_reason: ${opening} unreadable` })
      );
      expect(sentence).toContain(`because ${opening} unreadable`);
    }
  });

  it("lower-cases an ordinary capitalised word", () => {
    expect(
      notEstablishedSentence(
        unknown({ detail: "future_reason: Nothing was sent" })
      )
    ).toContain("because nothing was sent");
  });
});

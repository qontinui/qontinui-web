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
  capturedNotAuthoredSentence,
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

/** A `measured` entry, in the shape `coverage_for_source` builds. */
function measured(overrides: Partial<PlanCoverage> = {}): PlanCoverage {
  return {
    source_repo: SOURCE,
    state: "measured",
    detail: null,
    device_count: 1,
    census_device_id: DEVICE,
    other_census_device_ids: [],
    authored_at_ref: side(),
    visible_to_scanner: side({
      source: "work_tree",
      ref_sha: null,
      count: 3,
      listed_count: 3,
      digest: "9ef6",
    }),
    captured: 2,
    both: 2,
    authored_not_captured: 2,
    captured_not_authored: 0,
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
    state: "measured",
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
    ).toHaveTextContent(/At the ref and captured\s*2/);
    expect(
      within(counts).getByTestId(`plan-coverage-missing:${KEY}`)
    ).toHaveTextContent(/At the ref, not captured\s*2/);
    expect(
      within(counts).getByTestId(`plan-coverage-extra:${KEY}`)
    ).toHaveTextContent(/Captured, not at the ref\s*0/);
  });

  it("names BOTH denominators, and says which side each is", () => {
    mountWith([measured()]);
    const line = screen.getByTestId(`plan-coverage-denominators:${KEY}`);
    expect(line).toHaveTextContent("4 stems exist at the ref");
    expect(line).toHaveTextContent(
      "3 stems were visible in the working tree the body sync scans"
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
    expect(denominators).toHaveTextContent("50.0% of THAT side");
    expect(denominators).toHaveTextContent("not a share of the 3");
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
    });
    expect(denominatorSentence(entry)).toContain("50.0%");
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
    mountWith([
      measured({
        missing_sample: [],
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
    expect(capturedNotAuthoredSentence(measured())).toBeNull();
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
    expect(
      distanceSentence(measured({ min_behind: 0, min_behind_is_floor: true }))
    ).toContain("at least 0 behind");
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

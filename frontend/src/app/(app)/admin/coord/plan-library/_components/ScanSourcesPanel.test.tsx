/**
 * ScanSourcesPanel — the absences it must not render as agreement.
 *
 * The backend spends three rules turning a reading that cannot support a claim
 * about NOW into `state: "unknown"` with a self-naming `detail`, and then
 * serves the counts verbatim anyway (its own row docstring: "served as
 * reported whatever the verdict — a reader keying on `state` does not trust
 * them when it is `unknown`"). A panel that keyed on `reported_state`,
 * defaulted a `null` count to `0`, rendered an empty list as "all current", or
 * — the one that shipped in review and is pinned hardest below — wrote a
 * present-tense sentence out of counts the verdict had disowned, would undo
 * every one of those on the way to the screen. The operator would then see a
 * confident, specific, wrong answer, which is worse than the silence this
 * feature replaced.
 *
 * So each test pins one rule, by MUTATION where a mutation exists: flip the
 * one bit the rule keys on and the copy must change. Fixtures are shapes the
 * ROUTE can actually emit — `render_row` makes every non-fresh row
 * `state: "unknown"` with an `observation_stale:` detail, so a fixture that
 * leaves a silent row `measured` teaches a shape that does not exist and
 * cannot catch the bug that does.
 *
 * The hook is mocked. Its own behaviour (leaving stale data in place on a
 * failed reload, and not letting a late response overwrite a newer one) is a
 * property of `useScanRoots`, covered in `../_hooks/usePlanLibrary.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useScanRootsMock = vi.fn();
vi.mock("../_hooks/usePlanLibrary", () => ({
  useScanRoots: () => useScanRootsMock(),
}));

import {
  ScanSourcesPanel,
  driftSummary,
  refAgeSummary,
  shortDuration,
} from "./ScanSourcesPanel";
import type { ScanRootListResponse, ScanRootRow } from "../types";

const DEVICE = "eb2155ed-4152-4a91-be82-5d4346f717fc";

function row(overrides: Partial<ScanRootRow> = {}): ScanRootRow {
  return {
    device_id: DEVICE,
    state: "measured",
    detail: null,
    reported_state: "measured",
    reported_detail: null,
    plans_dir: "/w/qontinui-dev-notes/plans",
    repo_root: "/w/qontinui-dev-notes",
    source_repo: "qontinui-dev-notes/plans",
    default_ref: "origin/main",
    ref_sha: "d455ad5cb",
    head_sha: "0d2390c07",
    behind: 254,
    ahead: 0,
    ref_age_secs: 120,
    counts_are_floors: false,
    observed_at: "2026-09-12T05:00:00Z",
    received_at: "2026-09-12T05:00:01Z",
    last_report_applied: true,
    last_report_observed_at: "2026-09-12T05:00:00Z",
    observed_skew_secs: 1,
    observation_age_secs: 30,
    observation_fresh: true,
    ...overrides,
  };
}

/**
 * A row the route emits for a device it has not heard from inside the window:
 * the VERDICT is `unknown` with an `observation_stale:` detail, while the
 * counts it last reported are served unchanged. `behind: 0` is deliberate —
 * it is the input on which a verdict-blind renderer says "In step with its
 * ref." about a feeder that has been silent for hours.
 */
function silentRow(overrides: Partial<ScanRootRow> = {}): ScanRootRow {
  return row({
    state: "unknown",
    detail:
      "observation_stale: last report received 9000 s ago, past the 2700 s " +
      "freshness window; it reported state 'measured', which says nothing " +
      "about now",
    reported_state: "measured",
    behind: 0,
    ahead: 0,
    observation_age_secs: 9000,
    observation_fresh: false,
    ...overrides,
  });
}

/** The route's second verdict: the device's latest report contradicts the
 *  stored reading, so the reading is kept and disowned. */
function supersededRow(overrides: Partial<ScanRootRow> = {}): ScanRootRow {
  return row({
    state: "unknown",
    detail:
      "reading_superseded: the device's latest report was observed ~21600 s " +
      "before the stored reading (a clock step-back or a late-delivered " +
      "report), so the stored reading may not be what it reports now",
    reported_state: "measured",
    behind: 0,
    ahead: 0,
    last_report_applied: false,
    last_report_observed_at: "2026-09-11T23:00:00Z",
    ...overrides,
  });
}

function listed(
  rows: ScanRootRow[],
  overrides: Partial<ScanRootListResponse> = {}
): ScanRootListResponse {
  return {
    state: "reported",
    detail: null,
    fresh_within_secs: 2700,
    count: rows.length,
    fresh_count: rows.filter((r) => r.observation_fresh).length,
    rows,
    ...overrides,
  };
}

interface HookState {
  data: ScanRootListResponse | null;
  fetchedAt: Date | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// Typed, so a key typo (`errors:` for `error:`) is a compile error rather than
// a test that passes green against a hook state it never built.
function hookState(
  data: ScanRootListResponse | null,
  overrides: Partial<HookState> = {}
): HookState {
  return {
    data,
    fetchedAt: data ? new Date("2026-09-12T05:00:00Z") : null,
    loading: false,
    error: null,
    reload: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ScanSourcesPanel — a disowned count is never a present-tense claim", () => {
  it("REGRESSION: a silent device last read 0/0 must not read 'In step'", () => {
    useScanRootsMock.mockReturnValue(hookState(listed([silentRow()])));
    render(<ScanSourcesPanel />);

    const drift = screen.getByTestId(`scan-root-drift-${DEVICE}`);
    // The whole finding: the badge said Unknown and this sentence said the
    // feeder agreed with its ref. It is the sentence an operator reads.
    expect(drift.textContent).not.toMatch(/in step/i);
    expect(drift.textContent).toContain("When last measured: 0 behind");
    expect(screen.getByTestId(`scan-root-state-${DEVICE}`).textContent).toBe(
      "Unknown"
    );
  });

  it("REGRESSION: the same leak on the superseded verdict", () => {
    useScanRootsMock.mockReturnValue(hookState(listed([supersededRow()])));
    render(<ScanSourcesPanel />);

    const drift = screen.getByTestId(`scan-root-drift-${DEVICE}`);
    expect(drift.textContent).not.toMatch(/in step/i);
    expect(drift.textContent).toContain("When last measured");
    expect(
      screen.getByTestId(`scan-root-detail-${DEVICE}`).textContent
    ).toContain("reading_superseded:");
  });

  it("MUTATION: the same row heard from again does read 'In step'", () => {
    // Literally one field apart from `silentRow()` — the freshness bit the
    // tense test keys on. Everything else, counts included, is identical.
    useScanRootsMock.mockReturnValue(
      hookState(listed([silentRow({ observation_fresh: true })]))
    );
    render(<ScanSourcesPanel />);

    // Still `state: "unknown"`, so no agreement claim…
    expect(
      screen.getByTestId(`scan-root-drift-${DEVICE}`).textContent
    ).not.toMatch(/in step/i);
    // …but no longer past tense either: the reading IS the device's latest.
    // (`silentRow`'s detail is `observation_stale:`, which is not a reason
    // compatible with currency, so this still reads as past — pinned below.)
    const plainMeasured = driftSummary(row({ behind: 0, ahead: 0 }));
    expect(plainMeasured).toBe("In step with its ref.");
  });

  it("does not present the ref age as if it were current", () => {
    useScanRootsMock.mockReturnValue(hookState(listed([silentRow()])));
    render(<ScanSourcesPanel />);

    const drift = screen.getByTestId(`scan-root-drift-${DEVICE}`);
    // `ref_age_secs` was measured at `observed_at`, 2.5h ago, so ANY
    // present-tense framing of it — "refreshed 2m ago", "the ref is 2m old" —
    // is a floor rendered as an exact fact about now. Pin the property, not
    // one historical phrasing: the sentence must be anchored to the reading.
    expect(drift.textContent).toContain("old at that reading");
    expect(drift.textContent).not.toMatch(/\bago\b/);
  });
});

describe("ScanSourcesPanel — no rows is UNKNOWN, never 'all current'", () => {
  it("renders the backend's own no-observation sentence", () => {
    const detail =
      "no_observation: no device has reported a plan-scan-source reading for " +
      "this organization, so whether the corpus's feeders are current is not " +
      "established.";
    useScanRootsMock.mockReturnValue(
      hookState(
        listed([], { state: "unknown", detail, count: 0, fresh_count: 0 })
      )
    );
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId("scan-sources-none").textContent).toContain(
      "not established"
    );
    expect(screen.queryByTestId("scan-sources-summary")).toBeNull();
  });

  it("still says so when the backend sends no detail to quote", () => {
    useScanRootsMock.mockReturnValue(
      hookState(
        listed([], { state: "unknown", detail: null, count: 0, fresh_count: 0 })
      )
    );
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId("scan-sources-none").textContent).toContain(
      "is not established"
    );
  });

  it("the empty branch is chosen by the ROWS, not the top-level state", () => {
    // A future backend that answered `unknown` WITH rows must not have those
    // rows replaced by "no device has reported" — that is a false absence.
    useScanRootsMock.mockReturnValue(
      hookState(
        listed([silentRow()], { state: "unknown", detail: "some roll-up" })
      )
    );
    render(<ScanSourcesPanel />);

    expect(screen.queryByTestId("scan-sources-none")).toBeNull();
    expect(screen.getByTestId(`scan-root-${DEVICE}`)).toBeTruthy();
  });
});

describe("ScanSourcesPanel — the verdict wins over what the device reported", () => {
  it("shows the stale verdict and labels the reported one as the device's", () => {
    useScanRootsMock.mockReturnValue(hookState(listed([silentRow()])));
    render(<ScanSourcesPanel />);

    expect(
      screen.getByTestId(`scan-root-detail-${DEVICE}`).textContent
    ).toContain("observation_stale:");
    expect(
      screen.getByTestId(`scan-root-reported-${DEVICE}`).textContent
    ).toContain("The device reported");
    expect(screen.getByTestId(`scan-root-age-${DEVICE}`).textContent).toContain(
      "silent"
    );
  });

  it("surfaces the reported pair when only the DETAIL differs", () => {
    // Both `unknown`, so a state-only comparison would hide what the device
    // said about its own unknown — the half a reader needs to act on it.
    useScanRootsMock.mockReturnValue(
      hookState(
        listed([
          silentRow({
            reported_state: "unknown",
            reported_detail: "unknown: the plans dir does not resolve",
          }),
        ])
      )
    );
    render(<ScanSourcesPanel />);

    expect(
      screen.getByTestId(`scan-root-reported-${DEVICE}`).textContent
    ).toContain("the plans dir does not resolve");
  });

  it("MUTATION: a fresh applied row shows no reported line at all", () => {
    useScanRootsMock.mockReturnValue(hookState(listed([row()])));
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId(`scan-root-state-${DEVICE}`).textContent).toBe(
      "Measured"
    );
    expect(screen.queryByTestId(`scan-root-reported-${DEVICE}`)).toBeNull();
    expect(screen.getByTestId(`scan-root-age-${DEVICE}`).textContent).toContain(
      "heard"
    );
  });

  it("names every feeder quiet when count > 0 and fresh_count === 0", () => {
    useScanRootsMock.mockReturnValue(hookState(listed([silentRow()])));
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId("scan-sources-summary").textContent).toContain(
      "Every feeder has gone quiet"
    );
  });

  it("MUTATION: one fresh feeder drops that sentence", () => {
    useScanRootsMock.mockReturnValue(hookState(listed([row()])));
    render(<ScanSourcesPanel />);

    const summary = screen.getByTestId("scan-sources-summary").textContent;
    expect(summary).not.toContain("gone quiet");
    expect(summary).toContain("1 of 1 device reported");
  });
});

describe("ScanSourcesPanel — row detail", () => {
  it("names a clock skew worth reporting, and stays quiet under a minute", () => {
    useScanRootsMock.mockReturnValue(
      hookState(listed([row({ observed_skew_secs: 600 })]))
    );
    const { unmount } = render(<ScanSourcesPanel />);
    expect(
      screen.getByTestId(`scan-root-skew-${DEVICE}`).textContent
    ).toContain("after the runner took it");
    unmount();

    useScanRootsMock.mockReturnValue(
      hookState(listed([row({ observed_skew_secs: 3 })]))
    );
    render(<ScanSourcesPanel />);
    expect(screen.queryByTestId(`scan-root-skew-${DEVICE}`)).toBeNull();
  });

  it("falls back through source_repo → plans_dir → an explicit absence", () => {
    useScanRootsMock.mockReturnValue(
      hookState(listed([row({ source_repo: null })]))
    );
    const { unmount } = render(<ScanSourcesPanel />);
    expect(screen.getByTestId(`scan-root-${DEVICE}`).textContent).toContain(
      "/w/qontinui-dev-notes/plans"
    );
    unmount();

    useScanRootsMock.mockReturnValue(
      hookState(listed([row({ source_repo: null, plans_dir: null })]))
    );
    render(<ScanSourcesPanel />);
    expect(screen.getByTestId(`scan-root-${DEVICE}`).textContent).toContain(
      "scan root not reported"
    );
  });

  it("carries the full device id even though the label is truncated", () => {
    useScanRootsMock.mockReturnValue(hookState(listed([row()])));
    render(<ScanSourcesPanel />);

    const code = screen
      .getByTestId(`scan-root-${DEVICE}`)
      .querySelector("code[title]");
    expect(code?.getAttribute("title")).toBe(DEVICE);
  });
});

describe("ScanSourcesPanel — a failed read is UNKNOWN, not zero", () => {
  it("says the readings are unknown when nothing was ever read", () => {
    useScanRootsMock.mockReturnValue(
      hookState(null, { error: "503 Service Unavailable" })
    );
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId("scan-sources-error").textContent).toContain(
      "unknown, not current"
    );
    expect(screen.queryByTestId("scan-sources-summary")).toBeNull();
    expect(screen.queryByTestId("scan-sources-none")).toBeNull();
  });

  it("keeps the last rows and flags them as possibly stale", () => {
    useScanRootsMock.mockReturnValue(
      hookState(listed([row()]), { error: "network error" })
    );
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId("scan-sources-error").textContent).toContain(
      "may be stale"
    );
    expect(screen.getByTestId(`scan-root-${DEVICE}`)).toBeTruthy();
  });

  it("shows a skeleton on the first load, not an empty state", () => {
    useScanRootsMock.mockReturnValue(hookState(null, { loading: true }));
    render(<ScanSourcesPanel />);

    // Positively: a skeleton is on screen. Asserting only the two absences
    // would pass just as happily against a component that rendered nothing.
    expect(screen.getByTestId("scan-sources-loading")).toBeTruthy();
    // "No device has reported" while the first read is still in flight would
    // be the same false absence in a different costume.
    expect(screen.queryByTestId("scan-sources-none")).toBeNull();
    expect(screen.queryByTestId("scan-sources-summary")).toBeNull();
  });
});

describe("driftSummary — a null count is not measured, and a floor is not exact", () => {
  it("never renders an unmeasured distance as 0", () => {
    expect(
      driftSummary(
        row({
          state: "not_scanning",
          behind: null,
          ahead: null,
          ref_age_secs: null,
        })
      )
    ).toBe("Distance not measured.");
  });

  it("does not default a null `ahead` to zero either", () => {
    // The asymmetry the review caught: `behind: null` was guarded, `ahead`
    // was truthiness-tested, so `null` and `0` read identically.
    expect(driftSummary(row({ behind: 0, ahead: null }))).toBe(
      "Not behind its ref; ahead not measured."
    );
    expect(driftSummary(row({ behind: 3, ahead: null }))).toBe(
      "3 behind, ahead not measured."
    );
    // MUTATION: a real zero says nothing about "not measured".
    expect(driftSummary(row({ behind: 3, ahead: 0 }))).toBe("3 behind.");
  });

  it("renders a floor as a lower bound", () => {
    const floor = driftSummary(row({ behind: 254, counts_are_floors: true }));
    expect(floor).toContain("At least 254 behind");
    expect(floor).toContain("lower bounds");
  });

  it("MUTATION: the same counts exact drop the hedge", () => {
    const exact = driftSummary(row({ behind: 254, counts_are_floors: false }));
    expect(exact).toBe("254 behind.");
    expect(exact.toLowerCase()).not.toContain("at least");
  });

  it("only an EXACT zero behind, on a current verdict, reads as in step", () => {
    expect(driftSummary(row({ behind: 0, ahead: 0 }))).toBe(
      "In step with its ref."
    );
    // A floor of the same numbers is the row the route already turned into
    // `unknown` / `ref_stale:`, so the agreement guard refuses it — while the
    // tense guard leaves it present, because the DEVICE is fresh.
    const floor = driftSummary(
      row({
        behind: 0,
        ahead: 0,
        counts_are_floors: true,
        state: "unknown",
        detail: "ref_stale: 0/0 counts against a stale ref are a lower bound",
      })
    );
    expect(floor).not.toMatch(/in step/i);
    expect(floor).toContain("At least 0 behind");
  });

  it("a ref_stale row is disowned but NOT past tense — it is fresh", () => {
    // The three `unknown` rules do not agree about the reading's age. This
    // device reported seconds ago; what is stale is the REF it measured
    // against. "When last measured" would invent a silence that is not there
    // and send an operator after the wrong device.
    const refStale = driftSummary(
      row({
        state: "unknown",
        detail: "ref_stale: 0/0 counts against a ref that is stale …",
        behind: 0,
        ahead: 0,
        counts_are_floors: true,
        ref_age_secs: null,
        observation_fresh: true,
        last_report_applied: true,
      })
    );
    expect(refStale).not.toContain("When last measured");
    expect(refStale).not.toMatch(/in step/i);
    expect(refStale).toContain("At least 0 behind");
  });

  it("MUTATION: the same row gone silent DOES switch to past tense", () => {
    const silent = driftSummary(
      row({
        state: "unknown",
        behind: 0,
        ahead: 0,
        counts_are_floors: true,
        observation_fresh: false,
        last_report_applied: true,
      })
    );
    expect(silent).toContain("When last measured");
  });

  it("MUTATION: so does a superseded reading, though it is fresh", () => {
    // Tense keys on BOTH clocks. A device reporting on time whose latest
    // report contradicts the stored reading is fresh and still not current.
    const superseded = driftSummary(
      row({
        state: "unknown",
        behind: 0,
        ahead: 0,
        observation_fresh: true,
        last_report_applied: false,
      })
    );
    expect(superseded).toContain("When last measured");
  });

  it("carries ahead alongside behind, hedged the same way", () => {
    expect(driftSummary(row({ behind: 3, ahead: 2 }))).toBe(
      "3 behind, 2 ahead."
    );
    expect(driftSummary(row({ behind: 0, ahead: 2 }))).toBe(
      "In step, 2 ahead."
    );
    expect(
      driftSummary(row({ behind: 3, ahead: 2, counts_are_floors: true }))
    ).toContain("At least 3 behind, at least 2 ahead");
  });
});

describe("refAgeSummary", () => {
  it("is always phrased as of the reading, never as of now", () => {
    expect(refAgeSummary(row({ ref_age_secs: 120 }))).toBe(
      "Ref was 2m old at that reading."
    );
  });

  it("is absent, not zero, when the age is unknown", () => {
    expect(refAgeSummary(row({ ref_age_secs: null }))).toBeNull();
  });
});

describe("shortDuration", () => {
  it("floors the unit and marks the remainder, so an age is never mis-stated", () => {
    // Flooring alone under-states (23h59m silent reading as "23h" looks more
    // current than it is); ceiling alone over-states by up to a whole unit
    // (1h0m1s reading as "2h"). Floor plus `+` is "at least", which is true
    // in both directions and is the same hedge a floor COUNT carries.
    expect(shortDuration(86_340)).toBe("23h+");
    expect(shortDuration(3601)).toBe("1h+");
    expect(shortDuration(169_200)).toBe("1d+");
    expect(shortDuration(90)).toBe("1m+");
  });

  it("leaves an exact value unmarked", () => {
    // The freshness window (2700 s) is exact and must read plainly, not as a
    // hedged "at least".
    expect(shortDuration(2700)).toBe("45m");
    expect(shortDuration(60)).toBe("1m");
    expect(shortDuration(3600)).toBe("1h");
    expect(shortDuration(86_400)).toBe("1d");
  });

  it("renders whole units and never a negative", () => {
    expect(shortDuration(0)).toBe("0s");
    expect(shortDuration(-5)).toBe("0s");
    expect(shortDuration(59)).toBe("59s");
  });
});

describe("ScanSourcesPanel — every age is stamped with when it was read", () => {
  it("stamps the populated summary, so a figure cannot silently age", () => {
    // `observation_age_secs` and `fresh_count` are server-computed deltas
    // frozen at fetch time, and the panel does not poll. Unstamped, a console
    // left open overnight keeps reading "heard 30s ago" — the feature's own
    // thesis failing at the panel instead of at the row.
    useScanRootsMock.mockReturnValue(hookState(listed([row()])));
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId("scan-sources-read-at").textContent).toContain(
      "the ages above are as of then"
    );
  });

  it("stamps the empty state too", () => {
    useScanRootsMock.mockReturnValue(
      hookState(listed([], { state: "unknown", detail: "no_observation: …" }))
    );
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId("scan-sources-read-at")).toBeTruthy();
  });

  it("renders no stamp when nothing has been read", () => {
    // A stamp with no reading behind it would be the confident default this
    // panel exists to refuse.
    useScanRootsMock.mockReturnValue(
      hookState(null, { error: "backend down" })
    );
    render(<ScanSourcesPanel />);

    expect(screen.queryByTestId("scan-sources-read-at")).toBeNull();
  });

  it("offers the refresh the stamp implies, disabled while a read is in flight", () => {
    const reload = vi.fn();
    useScanRootsMock.mockReturnValue(hookState(listed([row()]), { reload }));
    const { unmount } = render(<ScanSourcesPanel />);
    screen.getByTestId("scan-sources-refresh").click();
    expect(reload).toHaveBeenCalledTimes(1);
    unmount();

    useScanRootsMock.mockReturnValue(
      hookState(listed([row()]), { loading: true })
    );
    render(<ScanSourcesPanel />);
    expect(
      screen.getByTestId("scan-sources-refresh").hasAttribute("disabled")
    ).toBe(true);
  });
});

describe("skewSummary — a stored skew is never a claim about the clock now", () => {
  it("writes the negative branch in the past tense", () => {
    // Skew is stored per row and does not decay. On a device silent for days,
    // "the runner's clock IS 2m ahead" asserts a present fact from a row that
    // establishes nothing about the present; it may have been fixed since.
    useScanRootsMock.mockReturnValue(
      hookState(listed([silentRow({ observed_skew_secs: -120 })]))
    );
    render(<ScanSourcesPanel />);

    const skew = screen.getByTestId(`scan-root-skew-${DEVICE}`).textContent;
    expect(skew).toContain("was 2m ahead");
    expect(skew).toContain("when it reported");
    expect(skew).not.toMatch(/clock is /);
  });

  it("does not blame the clock for a SUPERSEDED row's bookkeeping skew", () => {
    // The backend names three causes for a positive skew; the third is "the
    // stored reading is older than the device's last contact", which is
    // exactly a superseded row. Offering the other two here would be two
    // explanations, both wrong, above a detail line saying so.
    useScanRootsMock.mockReturnValue(
      hookState(listed([supersededRow({ observed_skew_secs: 21_600 })]))
    );
    render(<ScanSourcesPanel />);

    const skew = screen.getByTestId(`scan-root-skew-${DEVICE}`).textContent;
    expect(skew).toContain("superseded reading looks like");
    expect(skew).not.toContain("late delivery");
  });

  it("MUTATION: the same skew on an APPLIED row does name the two clock causes", () => {
    useScanRootsMock.mockReturnValue(
      hookState(listed([row({ observed_skew_secs: 21_600 })]))
    );
    render(<ScanSourcesPanel />);

    expect(
      screen.getByTestId(`scan-root-skew-${DEVICE}`).textContent
    ).toContain("late delivery");
  });
});

describe("readingIsCurrent — the reason is read, not re-derived", () => {
  it("a fresh, applied `unknown` row with an UNRECOGNISED reason stays hedged", () => {
    // A fourth `unknown` rule implying neither silence, supersession nor a
    // floor would, under a field-inferred test, print its counts in the
    // present tense with no hedge — the round-1 defect coming back through
    // the door the round-1 fix left open. An unknown reason takes the
    // conservative arm.
    const exotic = driftSummary(
      row({
        state: "unknown",
        detail: "some_future_rule: a reason this build has never seen",
        behind: 0,
        ahead: 0,
        observation_fresh: true,
        last_report_applied: true,
      })
    );
    expect(exotic).not.toMatch(/in step/i);
    expect(exotic).toContain("When last measured");
  });

  it("MUTATION: the recognised `ref_stale:` reason does stay present tense", () => {
    const refStale = driftSummary(
      row({
        state: "unknown",
        detail: "ref_stale: 0/0 counts against a ref that is stale …",
        behind: 0,
        ahead: 0,
        counts_are_floors: true,
        ref_age_secs: null,
        observation_fresh: true,
        last_report_applied: true,
      })
    );
    expect(refStale).not.toContain("When last measured");
  });
});

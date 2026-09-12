/**
 * ScanSourcesPanel — the absences it must not render as agreement.
 *
 * The backend spends four rules turning a reading that cannot support a claim
 * about NOW into `state: "unknown"` with a self-naming `detail`. A panel that
 * keyed on `reported_state`, defaulted a `null` count to `0`, or rendered an
 * empty list as "all current" would undo every one of them on the way to the
 * screen — and the operator would see a confident, specific, wrong answer,
 * which is worse than the silence this feature replaced.
 *
 * So each test below pins one of those, by MUTATION where a mutation exists:
 * flip the bit the rule keys on and the copy must change.
 *
 * The hook is mocked. Its own behaviour (leaving stale data in place on a
 * failed reload) is a property of `useScanRoots`, not of this rendering.
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

function hookState(
  data: ScanRootListResponse | null,
  overrides: Record<string, unknown> = {}
) {
  return { data, loading: false, error: null, reload: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
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

    const none = screen.getByTestId("scan-sources-none");
    expect(none.textContent).toContain("not established");
    // The load-bearing half: nothing on screen claims the feeders are current.
    expect(screen.queryByTestId("scan-sources-summary")).toBeNull();
    expect(document.body.textContent).not.toMatch(/In step/i);
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
});

describe("ScanSourcesPanel — the verdict wins over what the device reported", () => {
  it("shows the stale verdict, not the `measured` the device last sent", () => {
    const stale = row({
      state: "unknown",
      detail:
        "observation_stale: last report received 9000 s ago, past the 2700 s " +
        "freshness window; it reported state 'measured', which says nothing " +
        "about now",
      reported_state: "measured",
      observation_age_secs: 9000,
      observation_fresh: false,
    });
    useScanRootsMock.mockReturnValue(hookState(listed([stale])));
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId(`scan-root-state-${DEVICE}`).textContent).toBe(
      "Unknown"
    );
    expect(
      screen.getByTestId(`scan-root-detail-${DEVICE}`).textContent
    ).toContain("observation_stale:");
    // The reported value is shown, and shown as the DEVICE's claim.
    expect(
      screen.getByTestId(`scan-root-reported-${DEVICE}`).textContent
    ).toContain("The device reported");
    expect(screen.getByTestId(`scan-root-age-${DEVICE}`).textContent).toContain(
      "silent"
    );
  });

  it("MUTATION: the same row fresh and applied renders the reported state", () => {
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
    const quiet = row({ observation_fresh: false, observation_age_secs: 9000 });
    useScanRootsMock.mockReturnValue(hookState(listed([quiet])));
    render(<ScanSourcesPanel />);

    expect(screen.getByTestId("scan-sources-summary").textContent).toContain(
      "Every feeder has gone quiet"
    );
  });

  it("MUTATION: one fresh feeder drops that sentence", () => {
    useScanRootsMock.mockReturnValue(hookState(listed([row()])));
    render(<ScanSourcesPanel />);

    expect(
      screen.getByTestId("scan-sources-summary").textContent
    ).not.toContain("gone quiet");
    expect(screen.getByTestId("scan-sources-summary").textContent).toContain(
      "1 of 1 device reported"
    );
  });
});

describe("ScanSourcesPanel — a failed read is UNKNOWN, not zero", () => {
  it("says the readings are unknown when nothing was ever read", () => {
    useScanRootsMock.mockReturnValue(
      hookState(null, { error: "503 Service Unavailable" })
    );
    render(<ScanSourcesPanel />);

    const err = screen.getByTestId("scan-sources-error");
    expect(err.textContent).toContain("unknown, not current");
    expect(screen.queryByTestId("scan-sources-summary")).toBeNull();
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
});

describe("driftSummary — a null count is not measured, and a floor is not exact", () => {
  it("never renders an unmeasured distance as 0", () => {
    const text = driftSummary(
      row({
        state: "not_scanning",
        behind: null,
        ahead: null,
        ref_age_secs: null,
      })
    );
    expect(text).toBe("Distance not measured.");
    expect(text).not.toMatch(/\b0\b/);
  });

  it("renders a floor as a lower bound", () => {
    expect(
      driftSummary(row({ behind: 254, counts_are_floors: true }))
    ).toContain("At least 254 behind");
    expect(
      driftSummary(row({ behind: 254, counts_are_floors: true }))
    ).toContain("lower bounds");
  });

  it("MUTATION: the same counts exact drop the hedge", () => {
    const exact = driftSummary(row({ behind: 254, counts_are_floors: false }));
    expect(exact).toBe("254 behind.");
    expect(exact.toLowerCase()).not.toContain("at least");
  });

  it("only an EXACT zero behind reads as in step", () => {
    expect(driftSummary(row({ behind: 0, ahead: 0 }))).toBe(
      "In step with its ref."
    );
    // The floor of the same numbers is the row the backend already turned into
    // `unknown` / `ref_stale:`. This must not print agreement beside it.
    const floor = driftSummary(
      row({ behind: 0, ahead: 0, counts_are_floors: true })
    );
    expect(floor).not.toMatch(/in step/i);
    expect(floor).toContain("At least 0 behind");
  });

  it("carries ahead alongside behind, hedged the same way", () => {
    expect(driftSummary(row({ behind: 3, ahead: 2 }))).toBe(
      "3 behind, 2 ahead."
    );
    expect(driftSummary(row({ behind: 0, ahead: 2 }))).toBe(
      "In step, 2 ahead."
    );
  });
});

describe("shortDuration", () => {
  it("renders whole units and never a negative", () => {
    expect(shortDuration(0)).toBe("0s");
    expect(shortDuration(-5)).toBe("0s");
    expect(shortDuration(59)).toBe("59s");
    expect(shortDuration(60)).toBe("1m");
    expect(shortDuration(2700)).toBe("45m");
    expect(shortDuration(3600)).toBe("1h");
    expect(shortDuration(86_400)).toBe("1d");
  });
});

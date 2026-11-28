/**
 * The runner's reports on a machine row, in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` Phase 7): an unknown report says
 * WHY in plain words. Coord's own reason is a token (`no_publisher`,
 * `build_nameable_key_absent`) and the runner's own error is free text; an
 * outsider reads neither, and a token this build does not know is said in
 * fixed words rather than shown.
 *
 * And the database row in both modes (plan
 * `2026-11-27-devops-runner-database-degraded-is-invisible-to-coord`
 * Phase 6): each verdict, plus a MISSING block, which renders UNKNOWN —
 * never nothing and never ok.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FixedPresentationMode } from "@/components/presentation";
import type {
  RunnerDatabaseServed,
  RunnerReportMeta,
  RunnerReportsMeta,
} from "@/lib/api/operations/coordFleet";
import { RunnerReportsSection } from "./RunnerReportsSection";
import {
  presentedUnknownReason,
  PRESENTED_REASON_FALLBACK,
  resolveRunnerReports,
} from "./runnerReportStatus";

const ABSENT: RunnerReportMeta = {
  absent_reason: null,
  received_at: null,
  stale: null,
  dropped_entries: 0,
  omitted_by_runner: 0,
  error: null,
};

function meta(
  wedge: Partial<RunnerReportMeta>,
  capability: Partial<RunnerReportMeta>
): RunnerReportsMeta {
  return {
    wedge_incidents: { ...ABSENT, ...wedge },
    capability: { ...ABSENT, ...capability },
    stale_after_secs: 900,
  };
}

function renderReports(presenting: boolean, runnerReports: RunnerReportsMeta) {
  return render(
    <FixedPresentationMode presenting={presenting}>
      <RunnerReportsSection
        reports={resolveRunnerReports({
          wedge_incidents: null,
          capability: null,
          runner_reports: runnerReports,
        })}
      />
    </FixedPresentationMode>
  );
}

describe("RunnerReportsSection?present=1 — an unknown report's reason", () => {
  it("says coord's absence reasons in plain words, without the token or the runner's own error text", () => {
    renderReports(
      true,
      meta(
        { absent_reason: "no_publisher" },
        {
          absent_reason: "publisher_error",
          error: "cannot read D:/work/private-repo/target",
        }
      )
    );
    expect(screen.getByTestId("devops-runner-wedges-presented")).toHaveTextContent(
      "unknown — nothing on this machine sends this report"
    );
    expect(
      screen.getByTestId("devops-runner-capability-presented")
    ).toHaveTextContent("unknown — the machine could not check, and said so");
    const text = screen.getByTestId("devops-runner-reports").textContent ?? "";
    expect(text).not.toMatch(/no_publisher|publisher_error|private-repo/);
  });

  it("says a reason it does not know in fixed words, never the token", () => {
    renderReports(
      true,
      meta(
        { absent_reason: "some_future_reason" },
        { absent_reason: "build_nameable_key_absent" }
      )
    );
    expect(screen.getByTestId("devops-runner-wedges-presented")).toHaveTextContent(
      `unknown — ${PRESENTED_REASON_FALLBACK}`
    );
    expect(
      screen.getByTestId("devops-runner-capability-presented")
    ).toHaveTextContent(
      "unknown — this machine's runner version does not send this report"
    );
    expect(screen.getByTestId("devops-runner-reports").textContent).not.toMatch(
      /_/
    );
  });

  it("(control) the operator reads coord's own token", () => {
    renderReports(
      false,
      meta({ absent_reason: "no_publisher" }, { absent_reason: "malformed" })
    );
    expect(screen.getByTestId("devops-runner-wedges-unknown")).toHaveTextContent(
      "unknown — no_publisher"
    );
  });
});

describe("presentedUnknownReason", () => {
  it.each([
    ["no_publisher", "nothing on this machine sends this report"],
    [
      "build_nameable_key_absent",
      "this machine's runner version does not send this report",
    ],
    ["malformed", "the machine sent this report in a form that could not be read"],
    ["publisher_error", "the machine could not check, and said so"],
    ["runner-report read failed", "the reports could not be read on the latest check"],
    [
      "coord does not serve runner reports",
      "the coordination service does not provide these reports yet",
    ],
    [
      "no runner-report provenance",
      "no report time came with this machine's reports",
    ],
    ["not served", PRESENTED_REASON_FALLBACK],
    ["anything_else", PRESENTED_REASON_FALLBACK],
  ])("%s", (reason, words) => {
    expect(presentedUnknownReason(reason)).toBe(words);
  });
});

// ----------------------------------------------------------------------------
// The database row
// ----------------------------------------------------------------------------

/** 2026-11-27T04:51:00Z — the plan's live read of nawa, as the page's clock. */
const NOW_MS = Date.parse("2026-11-27T04:51:00Z");
/** nawa's `breaker.lastError`, verbatim from the plan's evidence. */
const LAST_ERROR =
  "PostgreSQL connection failed: Error occurred while creating a new object: error connecting to server <- Connection refused (os error 111)";

/**
 * nawa's served block in coord's `RunnerDatabaseServed` shape (qontinui-coord, plan Phase 2).
 * `arm`, the breaker's `state` / `cause` / `since` / `failed_trials` / `trips`
 * / `last_error`, and `build_id` are verbatim from the plan's evidence;
 * `cause_class`, `reachable`, `schema_ok`, `observed_at`,
 * `embedded_data_root`, `reported_at` and the breaker's `open_for_ms` are
 * illustrative (the data root's username replaced).
 */
const DEGRADED: RunnerDatabaseServed = {
  verdict: "degraded",
  reason: "boot_without_database",
  since: "2026-11-24T16:03:53Z",
  reading: {
    arm: "degraded",
    reachable: false,
    schema_ok: null,
    breaker: {
      state: "open",
      cause: "boot",
      cause_class: "connect_refused",
      since: "2026-11-24T16:03:53Z",
      failed_trials: 14786,
      trips: 1,
      last_error: LAST_ERROR,
      open_for_ms: null,
    },
    embedded_data_root:
      "/home/operator/.local/share/com.qontinui.runner/embedded-pg",
    observed_at: "2026-11-27T04:50:30Z",
    stale: false,
    build_id: "4d524e71b",
    reported_at: "2026-11-27T04:50:30Z",
  },
};

/** A recovered runner: breaker closed, its old last_error still in the reading. */
const OK: RunnerDatabaseServed = {
  verdict: "ok",
  reason: null,
  since: null,
  reading: {
    ...DEGRADED.reading!,
    breaker: {
      state: "closed",
      cause: null,
      cause_class: null,
      since: null,
      failed_trials: 0,
      trips: 2,
      last_error: LAST_ERROR,
      open_for_ms: null,
    },
  },
};

/** A real-arm breaker that opened at runtime: coord's warning, amber. */
const REAL_ARM_OPEN: RunnerDatabaseServed = {
  verdict: "degraded",
  reason: "breaker_open",
  since: "2026-11-27T04:40:00Z",
  reading: {
    ...DEGRADED.reading!,
    arm: "external",
    breaker: { ...DEGRADED.reading!.breaker!, cause: "runtime" },
  },
};

/**
 * coord's `the_dated_onset_holds_for_the_whole_outage`: the breaker's `since`
 * (17:05:00) runs more than 60 s ahead of the onset `open_for_ms` dates
 * (17:04:30 - 4270 s = 15:53:20), so coord serves the dated onset.
 */
const DATED_ONSET: RunnerDatabaseServed = {
  ...DEGRADED,
  since: "2026-11-24T15:53:20Z",
  reading: {
    ...DEGRADED.reading!,
    breaker: {
      ...DEGRADED.reading!.breaker!,
      since: "2026-11-24T17:05:00Z",
      open_for_ms: 4_270_000,
    },
    observed_at: "2026-11-24T17:04:30Z",
    reported_at: "2026-11-24T17:04:30Z",
  },
};

const UNKNOWN: RunnerDatabaseServed = {
  verdict: "unknown",
  reason: "build_nameable_key_absent",
  since: null,
  reading: null,
};

/** `database` omitted = the row carries no `runner_database` key at all. */
function renderDatabase(
  presenting: boolean,
  database?: RunnerDatabaseServed | null,
  nowMs: number = NOW_MS
) {
  const runnerReports: RunnerReportsMeta = {
    ...meta(
      { absent_reason: "no_publisher" },
      { absent_reason: "no_publisher" }
    ),
    runner_database: {
      ...ABSENT,
      absent_reason: database?.reading ? null : "build_nameable_key_absent",
      received_at: "2026-11-27T04:50:31Z",
      stale: false,
    },
  };
  return render(
    <FixedPresentationMode presenting={presenting}>
      <RunnerReportsSection
        nowMs={nowMs}
        reports={resolveRunnerReports({
          wedge_incidents: null,
          capability: null,
          runner_reports: runnerReports,
          ...(database === undefined ? {} : { runner_database: database }),
        })}
      />
    </FixedPresentationMode>
  );
}

const row = () => screen.getByTestId("devops-runner-database");

describe("RunnerReportsSection — the database row", () => {
  it("degraded: shows the cause and the since-time, red, with the last error", () => {
    renderDatabase(false, DEGRADED);
    expect(row()).toHaveAttribute("data-runner-database-verdict", "degraded");
    const degraded = screen.getByTestId("devops-runner-database-degraded");
    expect(degraded).toHaveAttribute("data-status-kind", "no_database");
    expect(degraded).toHaveAttribute("data-attention", "author");
    expect(degraded).toHaveTextContent("✕ degraded");
    expect(
      screen.getByTestId("devops-runner-database-cause")
    ).toHaveTextContent(
      "booted without its database · connect_refused · 14786 failed retries"
    );
    expect(
      screen.getByTestId("devops-runner-database-since")
    ).toHaveTextContent("since 2d ago");
    expect(
      screen.getByTestId("devops-runner-database-last-error")
    ).toHaveTextContent(LAST_ERROR);
  });

  it("the dated onset: the since text follows coord's served since, never the runner's breaker.since", () => {
    // Read one second after the report: coord's onset is 71 minutes back,
    // while the runner's own breaker.since is still in the future.
    renderDatabase(false, DATED_ONSET, Date.parse("2026-11-24T17:04:31Z"));
    expect(
      screen.getByTestId("devops-runner-database-degraded")
    ).toHaveAttribute("data-status-kind", "no_database");
    expect(
      screen.getByTestId("devops-runner-database-since")
    ).toHaveTextContent(/^since 1h ago$/);
  });

  it("degraded with no onset says the since is unknown — never a time, never blank", () => {
    renderDatabase(false, { ...DEGRADED, since: null });
    expect(
      screen.getByTestId("devops-runner-database-since")
    ).toHaveTextContent("since unknown — the report named no onset");
  });

  it("unknown: shows coord's absence reason", () => {
    renderDatabase(false, UNKNOWN);
    expect(row()).toHaveAttribute("data-runner-database-verdict", "unknown");
    const line = screen.getByTestId("devops-runner-database-unknown");
    expect(line).toHaveTextContent("unknown — build_nameable_key_absent");
    expect(line.getAttribute("title")).toContain("predates the report");
  });

  it("ok: the badge and nothing else — never the closed breaker's last error", () => {
    renderDatabase(false, OK);
    expect(row()).toHaveAttribute("data-runner-database-verdict", "ok");
    expect(screen.getByTestId("devops-runner-database-ok")).toHaveTextContent(
      /^ok$/
    );
    expect(screen.queryByTestId("devops-runner-database-cause")).toBeNull();
    expect(screen.queryByTestId("devops-runner-database-since")).toBeNull();
    expect(
      screen.queryByTestId("devops-runner-database-last-error")
    ).toBeNull();
    expect(row().textContent).not.toContain("Connection refused");
    expect(row().innerHTML).not.toContain("Connection refused");
  });

  it("a MISSING block renders UNKNOWN — never nothing, never ok", () => {
    renderDatabase(false);
    expect(row()).toHaveAttribute("data-runner-database-verdict", "unknown");
    expect(
      screen.getByTestId("devops-runner-database-unknown")
    ).toHaveTextContent("unknown — coord does not serve the database verdict");
    expect(screen.queryByTestId("devops-runner-database-ok")).toBeNull();
  });

  it("a null block renders UNKNOWN too", () => {
    renderDatabase(false, null);
    expect(
      screen.getByTestId("devops-runner-database-unknown")
    ).toHaveTextContent("unknown — no database verdict");
  });
});

describe("RunnerReportsSection?present=1 — the database line", () => {
  it.each([
    ["degraded", DEGRADED, "Runner database: running without its database"],
    [
      "breaker open",
      REAL_ARM_OPEN,
      "Runner database: not answering — the runner is retrying",
    ],
    // Coord measured an open breaker but would not page on it: not working,
    // severity not known — never a bare "unknown".
    [
      "degraded with no onset",
      { ...DEGRADED, since: null },
      "Runner database: not working — how serious is not known",
    ],
    [
      "degraded with a reason this build cannot name",
      { ...DEGRADED, reason: "future_reason" },
      "Runner database: not working — how serious is not known",
    ],
    ["ok", OK, "Runner database: working"],
    [
      "unknown",
      UNKNOWN,
      "Runner database: unknown — this machine's runner version does not send this report",
    ],
    [
      "missing",
      undefined,
      "Runner database: unknown — the coordination service does not provide this check yet",
    ],
  ] as const)(
    "%s, in plain words with no token and no error text",
    (_, block, words) => {
      renderDatabase(true, block);
      expect(
        screen.getByTestId("devops-runner-database-presented")
      ).toHaveTextContent(words);
      const text =
        screen.getByTestId("devops-runner-reports").textContent ?? "";
      expect(text).not.toMatch(/_|Connection refused|embedded-pg/);
    }
  );
});

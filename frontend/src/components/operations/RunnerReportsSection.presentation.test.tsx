/**
 * The runner's reports on a machine row, in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` Phase 7): an unknown report says
 * WHY in plain words. Coord's own reason is a token (`no_publisher`,
 * `build_nameable_key_absent`) and the runner's own error is free text; an
 * outsider reads neither, and a token this build does not know is said in
 * fixed words rather than shown.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FixedPresentationMode } from "@/components/presentation";
import type {
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

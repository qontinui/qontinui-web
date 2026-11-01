/**
 * /admin/coord/verification — the drill-down renders the WHOLE metrics
 * object (12-week series with throughput and per-week n, unknowns by reason,
 * pre-land review beside coverage, sampling, lane), and a degraded answer
 * renders "could not look" with no number from it.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/services/service-factory", () => ({ httpClient: http }));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({ activeTenantId: "t-1", loading: false, error: null }),
}));

import {
  NOW,
  REFUTATION_FINDING,
  degraded,
  judgeAgreement,
  populated,
  refutationFinding,
} from "@/components/admin/coord/verificationMetrics.fixture";
import {
  isoWeekKey,
  sampleForOperatorLabel,
} from "@/components/admin/coord/verificationMetrics";
import CoordVerificationPage from "./page";

function serve(metrics: unknown) {
  http.fetch.mockImplementation((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          url.includes("/verification/metrics")
            ? metrics
            : { available: true, findings: [REFUTATION_FINDING] }
        )
      )
    )
  );
}

describe("CoordVerificationPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    http.fetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("renders every block of a populated answer", async () => {
    serve(populated());
    render(<CoordVerificationPage />);
    const series = await screen.findByTestId("coord-verification-series");
    expect(
      within(series).getAllByTestId("coord-verification-series-week")
    ).toHaveLength(12);
    expect(http.fetch.mock.calls[0][0]).toContain("window=28d");

    expect(
      screen
        .getByTestId("coord-verification-health")
        .getAttribute("data-health-level")
    ).toBe("green");
    expect(
      screen.getByTestId("coord-verification-unknowns").textContent
    ).toContain("no_stated_criteria: 9 · surface_unreachable: 3");
    // Pre-land review is its own block, beside coverage — never inside it.
    const coverage = screen.getByTestId("coord-verification-coverage");
    expect(coverage.textContent).toContain("38% — 20 of 52 landed units");
    expect(coverage.textContent).not.toContain("reviewed-head");
    expect(
      screen.getByTestId("coord-verification-pre-land").textContent
    ).toContain("30 of 52");
    expect(
      screen.getByTestId("coord-verification-sampling").textContent
    ).toContain("surge: a refutation 2 day(s) old");
    expect(screen.getByTestId("coord-verification-lane").textContent).toContain(
      "pass"
    );
    expect(
      await screen.findByRole("link", { name: "Widgets export to CSV" })
    ).toBeTruthy();
  });

  it("renders could-not-look for a degraded answer, and no numbers from it", async () => {
    serve(degraded());
    render(<CoordVerificationPage />);
    const msg = await screen.findByTestId("coord-verification-could-not-look");
    expect(msg.textContent).toContain("work_unit_verifications is absent");
    expect(msg.textContent).toContain("These are not zeros.");
    expect(screen.queryByTestId("coord-verification-stats")).toBeNull();
    expect(screen.queryByTestId("coord-verification-series")).toBeNull();
    expect(
      screen
        .getByTestId("coord-verification-health")
        .getAttribute("data-health-level")
    ).toBe("amber");
  });
});

/**
 * Plan `2026-10-11-reverify-verdicts-are-source-bound-tree-checked-and-judge-agreement-is-measured`,
 * Phase 4: the verifier-agreement line under calibration, and the operator's
 * "Did this hold up?" control on at most three sampled verdicts a week.
 */
describe("CoordVerificationPage — verifier agreement and the operator label", () => {
  const findings = Array.from({ length: 6 }, (_, i) => refutationFinding(i));
  const vids = findings.map((f) => f.artifact_refs.verification_id);

  function serveAll(
    metrics: unknown,
    label: () => Response = () => new Response("{}", { status: 500 })
  ) {
    http.fetch.mockImplementation((url: string) => {
      if (url.includes("/verification/labels")) return Promise.resolve(label());
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes("/verification/metrics")
              ? metrics
              : { available: true, findings }
          )
        )
      );
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    http.fetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("puts the control only on this week's sampled verdicts — at most three", async () => {
    serveAll(populated({ judge_agreement: judgeAgreement() }));
    render(<CoordVerificationPage />);
    const rows = await screen.findAllByTestId(
      "coord-verification-refuted-unit"
    );
    expect(rows).toHaveLength(6);
    const sampled = new Set(sampleForOperatorLabel(vids, isoWeekKey(NOW)));
    expect(sampled.size).toBe(3);
    rows.forEach((row, i) => {
      const control = within(row).queryByTestId(
        "coord-verification-label-control"
      );
      expect(control !== null).toBe(sampled.has(vids[i] as string));
    });
  });

  it("a Yes click records the label and shows the row coord wrote back", async () => {
    serveAll(
      populated({ judge_agreement: judgeAgreement() }),
      () =>
        new Response(
          JSON.stringify({
            id: "rec-1",
            label_source: "operator",
            verification_id: "x",
            seed_class: null,
            truth: "holds",
            verifier_verdict: "refuted",
            labelled_by: "operator:abc",
            created_at: new Date(NOW).toISOString(),
          }),
          { status: 201 }
        )
    );
    render(<CoordVerificationPage />);
    const [first] = await screen.findAllByTestId(
      "coord-verification-label-control"
    );
    fireEvent.click(
      within(first as HTMLElement).getByTestId("coord-verification-label-holds")
    );
    const outcome = await screen.findByTestId(
      "coord-verification-label-outcome"
    );
    expect(outcome.getAttribute("data-label-outcome")).toBe("recorded");
    expect(outcome.textContent).toContain("Recorded: held up");
    const post = http.fetch.mock.calls.find(([u]) =>
      String(u).includes("/verification/labels")
    );
    expect(JSON.parse(post?.[1].body)).toMatchObject({
      label_source: "operator",
      truth: "holds",
    });
  });

  it("a 409 shows 'already labelled', not an error", async () => {
    serveAll(
      populated({ judge_agreement: judgeAgreement() }),
      () =>
        new Response(
          JSON.stringify({ error: "duplicate_label", message: "m", id: "e" }),
          { status: 409 }
        )
    );
    render(<CoordVerificationPage />);
    const [first] = await screen.findAllByTestId(
      "coord-verification-label-control"
    );
    fireEvent.click(
      within(first as HTMLElement).getByTestId("coord-verification-label-fails")
    );
    const outcome = await screen.findByTestId(
      "coord-verification-label-outcome"
    );
    expect(outcome.getAttribute("data-label-outcome")).toBe("already_labelled");
    expect(outcome.textContent).toContain("Already labelled");
  });

  it("renders the agreement line: populated, not enough cases, and unreachable", async () => {
    serveAll(populated({ judge_agreement: judgeAgreement() }));
    const { unmount } = render(<CoordVerificationPage />);
    let line = await screen.findByTestId("coord-verification-agreement");
    expect(line.textContent).toBe(
      "verifier agreement κ 0.71 (seeded n=24) · operator n=6"
    );
    unmount();

    serveAll(
      populated({
        judge_agreement: judgeAgreement({
          n: 5,
          binary_n: 4,
          kappa: null,
          reason: "n<20",
        }),
      })
    );
    const second = render(<CoordVerificationPage />);
    line = await screen.findByTestId("coord-verification-agreement");
    expect(line.getAttribute("data-agreement-state")).toBe("insufficient");
    expect(line.textContent).toContain("not enough labelled cases yet");
    second.unmount();

    http.fetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/verification/metrics")
          ? new Response('{"detail":"coord is not reachable"}', { status: 502 })
          : new Response(JSON.stringify({ available: true, findings }))
      )
    );
    render(<CoordVerificationPage />);
    line = await screen.findByTestId("coord-verification-agreement");
    expect(line.getAttribute("data-agreement-state")).toBe("unknown");
    expect(line.textContent).toBe(
      "verifier agreement unknown — the metrics door did not answer"
    );
  });
});

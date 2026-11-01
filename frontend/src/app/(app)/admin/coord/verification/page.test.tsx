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
  labelSample,
  populated,
} from "@/components/admin/coord/verificationMetrics.fixture";
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
 * "Did this hold up?" control on the verdicts coord's label-sample door picked
 * for this week.
 */
describe("CoordVerificationPage — verifier agreement and the operator label", () => {
  /** The 201 coord writes back: the row for the verdict the POST named. */
  const recorded = (init: RequestInit) => {
    const sent = JSON.parse(String(init.body)) as {
      verification_id: string;
      truth: string;
    };
    return new Response(
      JSON.stringify({
        id: "rec-1",
        label_source: "operator",
        verification_id: sent.verification_id,
        seed_class: null,
        truth: sent.truth,
        verifier_verdict: "unverifiable",
        labelled_by: "operator:abc",
        created_at: new Date(NOW).toISOString(),
      }),
      { status: 201 }
    );
  };

  function serveAll(
    metrics: unknown,
    {
      label = () => new Response("{}", { status: 500 }),
      sample = () => new Response(JSON.stringify(labelSample())),
    }: {
      label?: (init: RequestInit) => Response;
      sample?: () => Response;
    } = {}
  ) {
    http.fetch.mockImplementation((url: string, init: RequestInit) => {
      if (url.includes("/verification/labels")) {
        return Promise.resolve(label(init));
      }
      if (url.includes("/verification/label-sample")) {
        return Promise.resolve(sample());
      }
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes("/verification/metrics")
              ? metrics
              : { available: true, findings: [REFUTATION_FINDING] }
          )
        )
      );
    });
  }

  const sampleRows = () =>
    screen.findAllByTestId("coord-verification-label-sample-row");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    http.fetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("renders each sampled verdict as its own row; a labelled one shows its label", async () => {
    serveAll(populated({ judge_agreement: judgeAgreement() }));
    render(<CoordVerificationPage />);
    const rows = await sampleRows();
    expect(rows).toHaveLength(3);
    const section = screen.getByTestId("coord-verification-label-sample");
    expect(section.textContent).toContain("2026-W44");
    expect(rows[0]?.textContent).toContain("2026-10-01-widget-import");
    expect(rows[0]?.textContent).toContain("survived");
    expect(
      within(rows[0] as HTMLElement).getByTestId(
        "coord-verification-label-control"
      )
    ).toBeTruthy();
    // Already labelled: the label, and no control to label it again.
    expect(rows[1]?.textContent).toContain("refuted");
    expect(
      within(rows[1] as HTMLElement).getByTestId(
        "coord-verification-label-already"
      ).textContent
    ).toBe("already labelled: No");
    expect(
      within(rows[1] as HTMLElement).queryByTestId(
        "coord-verification-label-control"
      )
    ).toBeNull();
    expect(rows[2]?.textContent).toContain("unverifiable");
    // No slug: named "unnamed verdict", the id only in a title.
    expect(rows[2]?.textContent).toContain("unnamed verdict");
    expect(rows[2]?.textContent).not.toContain(
      "9e000000-0000-4000-8000-000000000003"
    );
    expect(
      within(rows[2] as HTMLElement)
        .getByText("unnamed verdict")
        .getAttribute("title")
    ).toContain("9e000000-0000-4000-8000-000000000003");
    expect(
      screen.getAllByTestId("coord-verification-label-control")
    ).toHaveLength(2);
    // The refutation list carries no control of its own.
    const refuted = screen.getByTestId("coord-verification-refuted");
    expect(
      within(refuted).queryByTestId("coord-verification-label-control")
    ).toBeNull();
  });

  it("a Yes click labels THAT row's verdict and shows the row coord wrote back", async () => {
    serveAll(populated({ judge_agreement: judgeAgreement() }), {
      label: recorded,
    });
    render(<CoordVerificationPage />);
    const rows = await sampleRows();
    const third = rows[2] as HTMLElement;
    const clickedId = third.getAttribute("data-verification-id");
    expect(clickedId).toBe("9e000000-0000-4000-8000-000000000003");
    fireEvent.click(
      within(third).getByTestId("coord-verification-label-holds")
    );
    const outcome = await within(third).findByTestId(
      "coord-verification-label-outcome"
    );
    expect(outcome.getAttribute("data-label-outcome")).toBe("recorded");
    expect(outcome.textContent).toContain("Recorded: held up");
    const posts = http.fetch.mock.calls.filter(([u]) =>
      String(u).includes("/verification/labels")
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]?.[1].body)).toEqual({
      label_source: "operator",
      verification_id: clickedId,
      truth: "holds",
    });
  });

  it("a 409 shows 'already labelled', not an error", async () => {
    serveAll(populated({ judge_agreement: judgeAgreement() }), {
      label: () =>
        new Response(
          JSON.stringify({ error: "duplicate_label", message: "m", id: "e" }),
          { status: 409 }
        ),
    });
    render(<CoordVerificationPage />);
    const [first] = await sampleRows();
    fireEvent.click(
      within(first as HTMLElement).getByTestId("coord-verification-label-fails")
    );
    const outcome = await screen.findByTestId(
      "coord-verification-label-outcome"
    );
    expect(outcome.getAttribute("data-label-outcome")).toBe("already_labelled");
    expect(outcome.textContent).toContain("Already labelled");
  });

  it("a 422 is 'Not recorded' with no retry; a 504 is 'Not known' with one", async () => {
    serveAll(populated({ judge_agreement: judgeAgreement() }), {
      label: () =>
        new Response(JSON.stringify({ error: "invalid_truth", message: "m" }), {
          status: 422,
        }),
    });
    const { unmount } = render(<CoordVerificationPage />);
    let [first] = await sampleRows();
    fireEvent.click(
      within(first as HTMLElement).getByTestId("coord-verification-label-holds")
    );
    let outcome = await screen.findByTestId("coord-verification-label-outcome");
    expect(outcome.getAttribute("data-label-outcome")).toBe("rejected");
    expect(outcome.textContent).toMatch(/^Not recorded/);
    // Final and known: muted, not amber, and not offered again.
    expect(outcome.className).toContain("text-muted-foreground");
    expect(outcome.className).not.toContain("amber");
    expect(screen.queryByTestId("coord-verification-label-again")).toBeNull();
    unmount();

    serveAll(populated({ judge_agreement: judgeAgreement() }), {
      label: () =>
        new Response(JSON.stringify({ detail: "timed out" }), { status: 504 }),
    });
    render(<CoordVerificationPage />);
    [first] = await sampleRows();
    fireEvent.click(
      within(first as HTMLElement).getByTestId("coord-verification-label-holds")
    );
    outcome = await screen.findByTestId("coord-verification-label-outcome");
    expect(outcome.getAttribute("data-label-outcome")).toBe("unknown");
    expect(outcome.textContent).toMatch(/^Not known to be recorded/);
    expect(outcome.className).toContain("amber");
    expect(screen.getByTestId("coord-verification-label-again")).toBeTruthy();
  });

  it("a sample door that answers 404 or 503 is 'unavailable', never 'nothing to label'", async () => {
    for (const [status, body] of [
      [404, { detail: "Not Found" }],
      [503, { error: "label_sample_unreadable", message: "store down" }],
    ] as const) {
      serveAll(populated({ judge_agreement: judgeAgreement() }), {
        sample: () => new Response(JSON.stringify(body), { status }),
      });
      const { unmount } = render(<CoordVerificationPage />);
      const section = await screen.findByTestId(
        "coord-verification-label-sample"
      );
      await vi.waitFor(() =>
        expect(section.getAttribute("data-label-sample-state")).toBe(
          "unavailable"
        )
      );
      expect(section.textContent).toContain("Label sample unavailable");
      expect(section.textContent).not.toContain("sampled no verdict");
      expect(
        screen.queryByTestId("coord-verification-label-control")
      ).toBeNull();
      unmount();
    }
  });

  it("renders the agreement line: populated, not enough cases, coord's error, and unreachable", async () => {
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
    expect(line.textContent).toBe(
      "verifier agreement: not enough labelled cases yet"
    );
    second.unmount();

    serveAll(
      populated({
        judge_agreement: null,
        judge_agreement_error: "judge cases unreadable: timeout",
      })
    );
    const third = render(<CoordVerificationPage />);
    line = await screen.findByTestId("coord-verification-agreement");
    expect(line.textContent).toContain("judge cases unreadable: timeout");
    third.unmount();

    http.fetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/verification/metrics")
          ? new Response('{"detail":"coord is not reachable"}', { status: 502 })
          : new Response(
              JSON.stringify({
                available: true,
                findings: [REFUTATION_FINDING],
              })
            )
      )
    );
    render(<CoordVerificationPage />);
    line = await screen.findByTestId("coord-verification-agreement");
    expect(line.getAttribute("data-agreement-state")).toBe("unknown");
    expect(line.textContent).toMatch(
      /^verifier agreement unknown — the metrics could not be read \(.+\)$/
    );
  });
});

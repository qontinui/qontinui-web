/**
 * "Can I trust 'done'?" — the four states render DISTINCT text, through the
 * real hook, derivation and panel, with only the HTTP client stubbed.
 *
 * Plan `2026-09-20-trust-calibration-and-independent-verification-coverage-are-measured-continuously`,
 * Phase 5 acceptance: populated, n=0, degraded and door-unreachable must each
 * say something the others do not, and none of the unknown states may show a
 * percentage.
 */

import { render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/services/service-factory", () => ({ httpClient: http }));

import {
  NOW,
  REFUTATION_FINDING,
  degraded,
  noVerifications,
  populated,
} from "@/components/admin/coord/verificationMetrics.fixture";
import { TrustTile } from "./TrustTile";

type Answer = unknown | Error;

function serve(
  metrics: Answer,
  findings: Answer = { findings: [], available: true }
) {
  http.get.mockImplementation((url: string) => {
    const a = url.includes("/verification/metrics") ? metrics : findings;
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  });
}

function renderTile() {
  render(<TrustTile tenantId="t-1" hold={false} />);
}

function tile(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    '[data-ui-bridge-id="overview.summary.trust"]'
  );
  if (!el) throw new Error("tile not rendered");
  return el;
}

async function settled(state: string) {
  await vi.waitFor(() => {
    expect(tile().getAttribute("data-state")).toBe(state);
  });
  return tile();
}

describe("TrustTile", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    window.localStorage.clear();
    http.get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("populated: throughput beside calibration, coverage, unknowns, refuted by plan title, lane", async () => {
    serve(populated(), { available: true, findings: [REFUTATION_FINDING] });
    renderTile();
    const el = await settled("populated");
    expect(
      within(el).getByText("52 landed · 91% held up (84–95), n=20")
    ).toBeTruthy();
    expect(el.textContent).toContain(
      "38% of 52 landed units independently checked"
    );
    expect(el.textContent).toContain(
      "12 unverifiable · 3 author unknown · 9 waiting"
    );
    const link = await within(el).findByRole("link", {
      name: "Widgets export to CSV",
    });
    expect(link.getAttribute("href")).toBe(
      `/admin/coord/findings?id=${REFUTATION_FINDING.finding_id}`
    );
    expect(el.textContent).toContain(
      "Checker: last verdict 3h ago · last cycle ok · canary passed"
    );
    expect(el.textContent).not.toContain("Could not look");
  });

  it("n=0: says no verifications yet — never 0% or 100%", async () => {
    serve(noVerifications());
    renderTile();
    const el = await settled("no_verifications");
    expect(el.textContent).toContain("no verifications yet in this window");
    const calibration = el.querySelector(
      '[data-ui-bridge-id="overview.summary.trust.no-verifications"]'
    );
    expect(calibration?.textContent).not.toMatch(/\d+%/);
    expect(el.textContent).not.toContain("100%");
    expect(el.textContent).toContain("Checker: no verdict yet");
  });

  it("degraded: could not look, coord's reason, last good stamp — no numbers", async () => {
    window.localStorage.setItem(
      "qontinui.verification-metrics.last-good.t-1",
      new Date(NOW - 26 * 3600_000).toISOString()
    );
    serve(degraded());
    renderTile();
    const el = await settled("could_not_look");
    const msg = within(el).getByText(/Could not look/);
    expect(msg.textContent).toContain("work_unit_verifications is absent");
    expect(msg.textContent).toMatch(/last good .*1d ago|last good .*ago/);
    expect(el.textContent).not.toMatch(/\d+%/);
    expect(el.textContent).not.toContain("landed");
    expect(el.textContent).toContain("Checker:");
  });

  it("door unreachable: the same could-not-look shape, with the transport's reason", async () => {
    serve(
      new Error(
        'GET /api/v1/operations/coord/verification/metrics failed: 502 - {"detail":"coord is not reachable"}'
      ),
      new Error(
        'GET /api/v1/operations/coord/findings failed: 502 - {"detail":"coord is not reachable"}'
      )
    );
    renderTile();
    const el = await settled("could_not_look");
    expect(el.textContent).toContain(
      "Could not look — HTTP 502: coord is not reachable — last good never, in this browser"
    );
    expect(el.textContent).not.toMatch(/\d+%/);
    expect(el.textContent).toContain("Checker: unknown");
  });

  it("the four states' headline text is pairwise distinct", async () => {
    const texts: string[] = [];
    for (const answer of [
      populated(),
      noVerifications(),
      degraded(),
      new Error('GET /m failed: 502 - {"detail":"coord is not reachable"}'),
    ]) {
      serve(answer);
      const { unmount } = render(<TrustTile tenantId="t-2" hold={false} />);
      await vi.waitFor(() => {
        expect(tile().getAttribute("data-state")).not.toBeNull();
      });
      texts.push(
        (
          tile().querySelector(
            '[data-ui-bridge-id="overview.summary.trust.headline"]'
          ) ??
          tile().querySelector(
            '[data-ui-bridge-id="overview.summary.trust.could-not-look"]'
          )
        )?.textContent ?? ""
      );
      unmount();
    }
    expect(new Set(texts).size).toBe(4);
  });

  it("a failed refutation list does not blank the metrics", async () => {
    serve(
      populated(),
      new Error('GET /f failed: 503 - {"detail":"findings down"}')
    );
    renderTile();
    const el = await settled("populated");
    await vi.waitFor(() =>
      expect(el.textContent).toContain(
        "2 refuted in this window — the list couldn’t be read"
      )
    );
    expect(el.textContent).toContain("52 landed");
  });

  it("a failed project list renders could-not-look with that reason, not a skeleton", async () => {
    render(
      <TrustTile tenantId={null} hold={false} tenantError="HTTP 500: boom" />
    );
    const el = await settled("could_not_look");
    expect(el.textContent).toContain("the list of projects couldn’t be loaded");
    expect(el.textContent).toContain("HTTP 500: boom");
    expect(http.get).not.toHaveBeenCalled();
  });

  it("announces loading accessibly", () => {
    http.get.mockReturnValue(new Promise(() => {}));
    render(<TrustTile tenantId="t-1" hold={false} />);
    const loading = document.querySelector(
      '[data-ui-bridge-id="overview.summary.trust.loading"]'
    );
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.getAttribute("aria-hidden")).toBeNull();
    expect(loading?.textContent).toContain("Reading");
  });

  it("a full findings page says more may exist, and the list carries the superseded caveat", async () => {
    serve(populated(), {
      available: true,
      count: 1,
      limit: 1,
      findings: [REFUTATION_FINDING],
    });
    renderTile();
    const el = await settled("populated");
    const caveat = await vi.waitFor(() => {
      const c = el.querySelector(
        '[data-ui-bridge-id="overview.summary.trust.refuted.caveat"]'
      );
      if (!c) throw new Error("no caveat yet");
      return c;
    });
    expect(caveat.textContent).toContain("a later check");
    expect(caveat.textContent).toContain("more may exist");
  });
});

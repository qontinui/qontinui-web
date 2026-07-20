/**
 * Component test for /admin/coord/prs — coord-down retention + banner states.
 *
 * Plan 2026-07-16-coord-prs-retain-data-coord-down. The web proxy converts a
 * coord outage into a 200 `{prs: [], total: 0, coord_error}` envelope. The
 * page must RETAIN the last-good rows for the SAME tab (subtle reconnecting
 * hint over the still-rendered table) instead of blanking to "No PRs"; the
 * hard "unavailable" banner is reserved for cold-start outages with nothing
 * to retain. Tab switches during an outage must NOT leak one tab's rows under
 * the other tab's header, and a healthy tab switch shows the loading skeleton
 * rather than a flash of the previous tab's rows.
 *
 * The five states under test:
 *   1. degraded after healthy (same tab) → subtle hint + retained rows
 *   2. degraded on the very first fetch  → hard banner + empty state
 *   3. recovery                          → both banners gone, fresh rows
 *   4. tab switch into a degraded fetch  → hard banner, no cross-tab rows
 *   5. healthy tab switch                → skeleton, never stale rows
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PrListResponse, PrRow } from "@/services/admin-dev-service";

const getPrs = vi.fn();

vi.mock("@/services/admin-dev-service", () => ({
  adminDevService: {
    getPrs: (...args: unknown[]) => getPrs(...args),
  },
}));

// Heavyweight children are out of scope — the retention/banner wiring under
// test lives in the page itself. The table stub echoes which rows it received
// so tests can assert exactly what the page passed through.
vi.mock("./_components/PrsTable", () => ({
  PrsTable: ({ prs }: { prs: { pr_number: number }[] }) => (
    <div data-testid="prs-table-stub">
      {prs.map((p) => `#${p.pr_number}`).join(",")}
    </div>
  ),
  isMergeStateRecalibrating: () => false,
}));
vi.mock("./_components/DeployStatusStrip", () => ({
  DeployStatusStrip: () => null,
}));

import CoordPrsPage from "./page";

// Minimal row objects — the page only reads `prs.length` and passes rows
// through to the (stubbed) table, so the remaining PrRow fields are inert.
function row(n: number): PrRow {
  return { repo: "acme/widgets", pr_number: n } as unknown as PrRow;
}

function healthy(rows: PrRow[]): PrListResponse {
  return { prs: rows, total: rows.length };
}

function degraded(msg = "timeout waiting for coord"): PrListResponse {
  return { prs: [], total: 0, coord_error: msg };
}

describe("/admin/coord/prs coord-down retention", () => {
  beforeEach(() => {
    getPrs.mockReset();
  });

  it("retains last-good rows with the subtle hint when a refetch degrades (same tab)", async () => {
    getPrs.mockResolvedValueOnce(healthy([row(1), row(2)]));
    render(<CoordPrsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("prs-table-stub")).toHaveTextContent("#1,#2"),
    );

    getPrs.mockResolvedValue(degraded("timeout"));
    await userEvent.click(screen.getByTestId("prs-refresh"));

    await waitFor(() =>
      expect(
        screen.getByTestId("prs-coord-reconnecting"),
      ).toBeInTheDocument(),
    );
    // The last-good rows are still passed to the table — no blanking.
    expect(screen.getByTestId("prs-table-stub")).toHaveTextContent("#1,#2");
    expect(screen.queryByTestId("prs-empty")).toBeNull();
    // The hard banner is reserved for cold-start outages.
    expect(screen.queryByTestId("prs-coord-unavailable")).toBeNull();
    expect(
      screen.getByTestId("prs-coord-reconnecting").textContent,
    ).toMatch(/showing last data/i);
  });

  it("shows the hard banner + empty state when the very first fetch is degraded", async () => {
    getPrs.mockResolvedValue(degraded("boom"));
    render(<CoordPrsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("prs-coord-unavailable")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("prs-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("prs-coord-reconnecting")).toBeNull();
  });

  it("clears both banners and shows fresh rows on recovery", async () => {
    getPrs.mockResolvedValueOnce(degraded("boom"));
    render(<CoordPrsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("prs-coord-unavailable")).toBeInTheDocument(),
    );

    getPrs.mockResolvedValue(healthy([row(7)]));
    await userEvent.click(screen.getByTestId("prs-refresh"));

    await waitFor(() =>
      expect(screen.getByTestId("prs-table-stub")).toHaveTextContent("#7"),
    );
    expect(screen.queryByTestId("prs-coord-unavailable")).toBeNull();
    expect(screen.queryByTestId("prs-coord-reconnecting")).toBeNull();
  });

  it("never shows one tab's rows under the other tab's header during an outage", async () => {
    getPrs.mockResolvedValueOnce(healthy([row(1), row(2)]));
    render(<CoordPrsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("prs-table-stub")).toHaveTextContent("#1,#2"),
    );

    // The merged-tab fetch resolves degraded-empty: the Open rows must NOT be
    // retained across tabs — accept the empty envelope + hard banner instead.
    getPrs.mockResolvedValue(degraded("coord down"));
    await userEvent.click(screen.getByTestId("coord-prs-tab-merged"));

    await waitFor(() =>
      expect(screen.getByTestId("prs-coord-unavailable")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("prs-empty")).toHaveTextContent(
      "No PRs merged in the last 24h.",
    );
    expect(screen.queryByTestId("prs-table-stub")).toBeNull();
  });

  it("shows the skeleton (never stale rows or a premature empty state) during a healthy tab switch", async () => {
    getPrs.mockResolvedValueOnce(healthy([row(1)]));
    render(<CoordPrsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("prs-table-stub")).toHaveTextContent("#1"),
    );

    // Hold the merged-tab fetch open so the loading window is observable.
    let resolveFetch: (value: PrListResponse) => void = () => {};
    getPrs.mockImplementationOnce(
      () =>
        new Promise<PrListResponse>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    await userEvent.click(screen.getByTestId("coord-prs-tab-merged"));

    await waitFor(() =>
      expect(screen.getByTestId("prs-loading")).toBeInTheDocument(),
    );
    // Neither the previous tab's rows nor a premature empty state may show.
    expect(screen.queryByTestId("prs-table-stub")).toBeNull();
    expect(screen.queryByTestId("prs-empty")).toBeNull();

    resolveFetch(healthy([]));
    await waitFor(() =>
      expect(screen.getByTestId("prs-empty")).toHaveTextContent(
        "No PRs merged in the last 24h.",
      ),
    );
    expect(screen.queryByTestId("prs-loading")).toBeNull();
  });

  it("suppresses the reconnecting hint during a tab-switch loading window (no hint over skeleton)", async () => {
    // 1. Healthy Open tab with rows.
    getPrs.mockResolvedValueOnce(healthy([row(1), row(2)]));
    render(<CoordPrsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("prs-table-stub")).toHaveTextContent("#1,#2"),
    );

    // 2. Degrade in place (same tab) so the subtle hint shows over retained rows.
    getPrs.mockResolvedValue(degraded("timeout"));
    await userEvent.click(screen.getByTestId("prs-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("prs-coord-reconnecting")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("prs-table-stub")).toHaveTextContent("#1,#2");

    // 3. Switch tabs with the next fetch held PENDING: loading=true, but `data`
    //    (the Open rows) survives for retention. The hint keys on retained
    //    `data`, so without the `!loading` guard it would render OVER the
    //    skeleton. Assert only the skeleton shows — both banners suppressed.
    let resolveFetch: (value: PrListResponse) => void = () => {};
    getPrs.mockImplementationOnce(
      () =>
        new Promise<PrListResponse>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    await userEvent.click(screen.getByTestId("coord-prs-tab-merged"));

    await waitFor(() =>
      expect(screen.getByTestId("prs-loading")).toBeInTheDocument(),
    );
    // The whole point: no "showing last data" hint painted over the skeleton,
    // and the hard cold-start banner is likewise suppressed (data still has rows).
    expect(screen.queryByTestId("prs-coord-reconnecting")).toBeNull();
    expect(screen.queryByTestId("prs-coord-unavailable")).toBeNull();
    expect(screen.queryByTestId("prs-table-stub")).toBeNull();

    // 4. Land the fetch degraded-empty for the merged tab: the guard didn't
    //    over-suppress — the terminal state is the hard banner + merged empty,
    //    and the subtle hint stays absent (no rows to retain across tabs).
    resolveFetch(degraded("timeout"));
    await waitFor(() =>
      expect(screen.getByTestId("prs-coord-unavailable")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("prs-empty")).toHaveTextContent(
      "No PRs merged in the last 24h.",
    );
    expect(screen.queryByTestId("prs-coord-reconnecting")).toBeNull();
    expect(screen.queryByTestId("prs-loading")).toBeNull();
  });
});

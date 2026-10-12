/**
 * `PlanShippedBy` — the detail panel's "shipped by" line (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 7).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReconciliationRowData } from "@/components/admin/coord/planReconciliationStatus";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("../plan-library/_components/ArtifactDetailPanel", () => ({
  ArtifactDetailPanel: () => null,
}));

import { PlanShippedBy } from "./PlanRowDetail";

function row(
  axis: Partial<ReconciliationRowData["axis_a"]> = {}
): ReconciliationRowData {
  return {
    slug: "2026-09-05-a-plan",
    document_state: "present",
    document_axis_complete: true,
    axis_a: { readable: true, present: true, ...axis },
    axis_b: {
      readable: true,
      present: true,
      document_state: "present",
      complete: true,
    },
    axis_c: { readable: true, present: true },
    classification: "AGREE_OPEN",
    verdict: "agree",
    reason: "",
  };
}

beforeEach(() => fetchMock.mockReset());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("PlanShippedBy", () => {
  it("asks the operator attribution door for the stem and lists names with PRs", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        attribution_available: true,
        shipped_by: [
          {
            session_name: "plan-foo",
            pr_refs: [
              {
                repo: "o/r",
                pr_number: 12,
                merged: true,
                attribution_is_single_session: true,
              },
            ],
          },
        ],
        unnamed_session_count: 1,
        unverified_session_count: 0,
        unattributed_pr_count: 0,
      })
    );
    render(<PlanShippedBy row={row()} />);
    await screen.findByTestId("coord-plan-shipped-by-names");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/operations/plans/2026-09-05-a-plan/attribution"
    );
    const el = screen.getByTestId("coord-plan-shipped-by");
    expect(el.textContent).toMatch(/plan-foo/);
    expect(el.textContent).toMatch(/o\/r#12 \(merged\)/);
    expect(el.textContent).toMatch(
      /1 session of this tenant shipped work under no recorded name/
    );
  });

  it("a failed read is UNKNOWN, never an empty line", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "boom" }, 500));
    render(<PlanShippedBy row={row()} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-plan-shipped-by-summary").textContent
      ).toMatch(/UNKNOWN/)
    );
  });

  it("a stem with no work unit is not asked about", () => {
    render(<PlanShippedBy row={row({ present: false })} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("coord-plan-shipped-by").textContent).toMatch(
      /no work unit/
    );
  });

  it("an unreadable work-unit read is UNKNOWN and not asked about", () => {
    render(<PlanShippedBy row={row({ readable: false, present: false })} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("coord-plan-shipped-by").textContent).toMatch(
      /UNKNOWN/
    );
  });
});

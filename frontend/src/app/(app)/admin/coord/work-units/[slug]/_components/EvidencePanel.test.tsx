/**
 * The Evidence panel on `/admin/coord/work-units/[slug]`.
 *
 * Pinned (each can fail on its own): a read that fails is UNKNOWN, never "no
 * evidence"; who/when come from coord's `phases_attested_detail` and say so
 * when coord serves none; an admin attests with a closed request and retracts
 * only a live attestation; only a manual citation is removable; a non-admin
 * gets no controls.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const httpGet = vi.fn();
const httpPost = vi.fn();
const httpDelete = vi.fn();
vi.mock("@/services/service-factory", async () => {
  const { withVerbFetch } = await import("@/test/verbFetch");
  return {
    httpClient: withVerbFetch({
      get: (...a: unknown[]) => httpGet(...a),
      post: (...a: unknown[]) => httpPost(...a),
      delete: (...a: unknown[]) => httpDelete(...a),
    }),
  };
});

let mockIsAdmin = true;
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: mockIsAdmin }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { EvidencePanel } from "./EvidencePanel";

const SLUG = "2026-10-16-the-programme";
const FINDING = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd";

const UNIT = {
  work_unit: { slug: SLUG },
  citations: [
    { repo: "acme/widgets", pr_number: 7, merged: true, sources: ["manual_backfill"] },
    { repo: "acme/widgets", pr_number: 8, merged: false, sources: ["webhook"] },
  ],
  delivery: {
    phases_declared_indices: [1, 2, 3],
    phases_delivered: [1],
    phases_attested: [2],
    phase_attestations: [
      { phase_index: 2, evidence_kind: "finding", evidence_ref: FINDING, resolution: "resolved" },
      { phase_index: 3, evidence_kind: "finding", evidence_ref: FINDING, resolution: "retracted" },
    ],
    phases_attested_detail: [
      {
        phase_index: 2,
        evidence_kind: "finding",
        resolution: "resolved",
        attested_at: "2026-11-20T10:00:00Z",
        attested_by: "operator:ops@example.com",
      },
      {
        phase_index: 3,
        evidence_kind: "finding",
        resolution: "retracted",
        attested_at: "2026-11-19T10:00:00Z",
        attested_by: "operator:ops@example.com",
      },
    ],
  },
};

function open() {
  const root = screen.getByTestId("coord-plan-evidence");
  const toggle = root.querySelector("button");
  if (toggle) fireEvent.click(toggle);
}

describe("EvidencePanel", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPost.mockReset();
    httpDelete.mockReset();
    mockIsAdmin = true;
    window.localStorage.clear();
  });

  it("says unknown, not none, when the read fails", async () => {
    httpGet.mockRejectedValue(new Error("Failed to fetch"));
    render(<EvidencePanel slug={SLUG} phaseNames={{}} />);
    open();
    expect(await screen.findByTestId("coord-plan-evidence-unknown")).toHaveTextContent(
      /unknown, not none/
    );
    expect(screen.queryByTestId("coord-plan-evidence-attestations-empty")).toBeNull();
  });

  it("renders each declared phase's evidence, who and when, and manual citations", async () => {
    httpGet.mockResolvedValue(UNIT);
    render(<EvidencePanel slug={SLUG} phaseNames={{ 2: "Beta" }} />);
    open();
    const rows = await screen.findAllByTestId("coord-plan-evidence-phase-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      "1Delivered by a landed PR",
      "2 · BetaAttested done",
      "3Not confirmed",
    ]);
    const att = screen.getAllByTestId("coord-plan-evidence-attestation");
    expect(att[0]).toHaveTextContent("operator:ops@example.com");
    expect(att[0]).toHaveTextContent("confirmed 2026-11-20");
    expect(att[1]).toHaveTextContent("Retracted");
    // Only a live attestation is retractable; only a manual citation removable.
    expect(screen.getAllByTestId("coord-plan-evidence-retract")).toHaveLength(1);
    expect(screen.getAllByTestId("coord-plan-evidence-citation-remove")).toHaveLength(1);
    expect(httpGet.mock.calls[0][0]).toContain("with_citations=1");
  });

  it("does not show stale evidence as current when a re-read after a write fails", async () => {
    httpGet.mockResolvedValueOnce(UNIT);
    httpDelete.mockResolvedValue({ outcome: "retracted" });
    render(<EvidencePanel slug={SLUG} phaseNames={{}} />);
    open();
    const retract = await screen.findByTestId("coord-plan-evidence-retract");
    httpGet.mockRejectedValue(new Error("Failed to fetch"));
    fireEvent.click(retract);
    expect(await screen.findByTestId("coord-plan-evidence-stale")).toHaveTextContent(
      /may be out of date/
    );
  });

  it("says when coord serves no who/when", async () => {
    const { phases_attested_detail: _drop, ...delivery } = UNIT.delivery;
    httpGet.mockResolvedValue({ ...UNIT, delivery });
    render(<EvidencePanel slug={SLUG} phaseNames={{}} />);
    open();
    const att = await screen.findAllByTestId("coord-plan-evidence-attestation");
    expect(att[0]).toHaveTextContent(/does not serve it/);
  });

  it("attests with a closed request and re-reads", async () => {
    httpGet.mockResolvedValue(UNIT);
    httpPost.mockResolvedValue({ created: true });
    render(<EvidencePanel slug={SLUG} phaseNames={{}} />);
    open();
    fireEvent.change(await screen.findByTestId("coord-plan-evidence-attest-phase"), {
      target: { value: "3" },
    });
    const submit = screen.getByTestId("coord-plan-evidence-attest-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("coord-plan-evidence-attest-ref"), {
      target: { value: FINDING },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(httpPost).toHaveBeenCalled());
    const [url, body] = httpPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toContain(`/plans/${SLUG}/phase-attestations`);
    expect(body).toEqual({
      phase_index: 3,
      evidence_kind: "finding",
      evidence_ref: FINDING,
    });
    await waitFor(() => expect(httpGet.mock.calls.length).toBeGreaterThan(1));
  });

  it("retracts a live attestation", async () => {
    httpGet.mockResolvedValue(UNIT);
    httpDelete.mockResolvedValue({ outcome: "retracted" });
    render(<EvidencePanel slug={SLUG} phaseNames={{}} />);
    open();
    fireEvent.click(await screen.findByTestId("coord-plan-evidence-retract"));
    await waitFor(() => expect(httpDelete).toHaveBeenCalled());
    expect(httpDelete.mock.calls[0][0]).toContain(`/plans/${SLUG}/phase-attestations`);
  });

  it("gives a non-administrator no controls", async () => {
    mockIsAdmin = false;
    httpGet.mockResolvedValue(UNIT);
    render(<EvidencePanel slug={SLUG} phaseNames={{}} />);
    open();
    expect(await screen.findByTestId("coord-admin-only-notice")).toBeTruthy();
    expect(screen.queryByTestId("coord-plan-evidence-retract")).toBeNull();
    expect(screen.queryByTestId("coord-plan-evidence-attest-submit")).toBeNull();
  });
});

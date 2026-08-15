/**
 * ArtifactDetailDialog — the four coord-link states, and the both-directions
 * provenance render.
 *
 * The coord block is where this page can most easily lie. "No linked work
 * unit", "coord doesn't have that work unit", "we couldn't reach coord" and
 * "coord has no route to list citations" are four different facts, and three
 * of them are routinely rendered as an innocuous empty state by UIs that
 * treat absence as zero. Each gets its own assertion here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { ArtifactDetailDialog } from "./ArtifactDetailDialog";
import type { CandidateCoordLink, WorkArtifactDetail } from "../types";

const UNLINKED: CandidateCoordLink = {
  work_unit_slug: null,
  work_unit_state: "unlinked",
  work_unit_status: null,
  work_unit_title: null,
  linked_prs_state: "unlinked",
  linked_prs: [],
  unavailable_reason: null,
};

function detail(overrides: Partial<WorkArtifactDetail> = {}): WorkArtifactDetail {
  return {
    id: "art-1",
    organization_id: null,
    created_by_user_id: null,
    kind: "plan",
    kind_locked: false,
    slug: "2026-08-10-a-plan",
    title: "A plan",
    status: "VETTED",
    content_sha256: "abcdef0123",
    source_path: "plans/a.md",
    source_repo: "qontinui-web",
    work_unit_slug: null,
    repos: [],
    authored_at: null,
    captured_by: "runner_scan",
    current_version: 1,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    body: "# body",
    versions: [],
    edges: [],
    coord: UNLINKED,
    ...overrides,
  };
}

function renderDialog(d: WorkArtifactDetail) {
  return render(
    <ArtifactDetailDialog
      open
      onOpenChange={vi.fn()}
      artifactId={d.id}
      fetchDetail={vi.fn().mockResolvedValue(d)}
      correctKind={vi.fn().mockResolvedValue(true)}
      onOpenArtifact={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ArtifactDetailDialog — the coord link is four states, not two", () => {
  it("renders 'no linked work unit' as a normal state, not an error", async () => {
    renderDialog(detail());
    await waitFor(() =>
      expect(screen.getByTestId("coord-unlinked")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("coord-unavailable")).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-unlinked").textContent).toContain(
      "optional"
    );
  });

  it("renders a dangling slug as normal — the link has no foreign key", async () => {
    renderDialog(
      detail({
        work_unit_slug: "gone-unit",
        coord: {
          ...UNLINKED,
          work_unit_slug: "gone-unit",
          work_unit_state: "dangling",
          linked_prs_state: "unlinked",
        },
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("coord-dangling")).toBeInTheDocument()
    );
    expect(screen.getByTestId("coord-dangling").textContent).toContain(
      "allowed to dangle"
    );
  });

  it("renders an unreachable coord as UNKNOWN, never as 'no work unit'", async () => {
    renderDialog(
      detail({
        work_unit_slug: "u1",
        coord: {
          ...UNLINKED,
          work_unit_slug: "u1",
          work_unit_state: "unavailable",
          linked_prs_state: "unavailable",
          unavailable_reason: "coord returned 502",
        },
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("coord-unavailable")).toBeInTheDocument()
    );
    expect(screen.getByTestId("coord-unavailable").textContent).toContain(
      "unknown"
    );
  });

  it("renders 'PR citations unavailable' distinctly from 'no PRs'", async () => {
    // The real case today: the work unit resolves, but coord exposes no HTTP
    // route to list its citations (MCP-only), so an empty list would be a lie.
    renderDialog(
      detail({
        work_unit_slug: "u1",
        coord: {
          work_unit_slug: "u1",
          work_unit_state: "linked",
          work_unit_status: "in_progress",
          work_unit_title: "The unit",
          linked_prs_state: "unavailable",
          linked_prs: [],
          unavailable_reason: "coord returned 404 for citations",
        },
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("coord-prs-unavailable")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("coord-prs-none")).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-prs-unavailable").textContent).toContain(
      "not an empty list"
    );
  });

  it("renders a genuine empty citation list as such when coord ANSWERED", async () => {
    renderDialog(
      detail({
        work_unit_slug: "u1",
        coord: {
          work_unit_slug: "u1",
          work_unit_state: "linked",
          work_unit_status: "vetted",
          work_unit_title: "The unit",
          linked_prs_state: "available",
          linked_prs: [],
          unavailable_reason: null,
        },
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("coord-prs-none")).toBeInTheDocument()
    );
    expect(
      screen.queryByTestId("coord-prs-unavailable")
    ).not.toBeInTheDocument();
  });

  it("lists the PR citations with their merged state", async () => {
    renderDialog(
      detail({
        work_unit_slug: "u1",
        coord: {
          work_unit_slug: "u1",
          work_unit_state: "linked",
          work_unit_status: "shipped",
          work_unit_title: "The unit",
          linked_prs_state: "available",
          linked_prs: [
            {
              repo: "qontinui-web",
              pr_number: 1425,
              state: "merged",
              merged: true,
              branch: "feat/x",
              cited_at: null,
              sources: [],
            },
          ],
          unavailable_reason: null,
        },
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("coord-prs")).toBeInTheDocument()
    );
    expect(screen.getByTestId("coord-prs").textContent).toContain(
      "qontinui-web#1425"
    );
  });
});

describe("ArtifactDetailDialog — provenance renders BOTH directions", () => {
  it("shows an empty state per direction rather than hiding the half", async () => {
    renderDialog(
      detail({
        edges: [
          {
            id: "e1",
            from_id: "prompt-1",
            to_id: "art-1",
            relation: "authored_plan",
            note: null,
            created_by: "agent",
            created_at: "2026-08-10T00:00:00Z",
            direction: "incoming",
            peer_kind: "plan_authoring_prompt",
            peer_slug: "the-prompt",
            peer_title: "The prompt",
          },
        ],
      })
    );

    await waitFor(() =>
      expect(screen.getByTestId("edges-incoming")).toBeInTheDocument()
    );
    expect(screen.getByTestId("edges-incoming").textContent).toContain(
      "The prompt"
    );
    // The outgoing half is still rendered, saying it is empty — a direction
    // that silently disappears reads as "there is no such relationship".
    expect(screen.getByTestId("edges-outgoing").textContent).toContain(
      "Nothing recorded"
    );
  });
});

describe("ArtifactDetailDialog — the kind lock is visible", () => {
  it("says a guessed kind is unlocked and a corrected one is locked", async () => {
    const { unmount } = renderDialog(detail({ kind_locked: false }));
    await waitFor(() =>
      expect(screen.getByTestId("artifact-kind-unlocked")).toBeInTheDocument()
    );
    unmount();

    renderDialog(detail({ kind_locked: true }));
    await waitFor(() =>
      expect(screen.getByTestId("artifact-kind-locked")).toBeInTheDocument()
    );
  });
});

describe("ArtifactDetailDialog — a failed fetch is not a loading state", () => {
  it("shows an error with a retry instead of an eternal skeleton", async () => {
    // `fetchDetail` returns null on failure, which leaves `detail` null and
    // `loading` false — a `loading || !detail` guard would spin forever and
    // describe a dead dialog as one that is still working.
    render(
      <ArtifactDetailDialog
        open
        onOpenChange={vi.fn()}
        artifactId="art-1"
        fetchDetail={vi.fn().mockResolvedValue(null)}
        correctKind={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("artifact-detail-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("artifact-detail-retry")).toBeInTheDocument();
  });

  it("recovers when the retry succeeds", async () => {
    const fetchDetail = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detail());

    render(
      <ArtifactDetailDialog
        open
        onOpenChange={vi.fn()}
        artifactId="art-1"
        fetchDetail={fetchDetail}
        correctKind={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("artifact-detail-retry")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("artifact-detail-retry"));

    await waitFor(() =>
      expect(screen.getByTestId("artifact-body")).toBeInTheDocument()
    );
    expect(
      screen.queryByTestId("artifact-detail-error")
    ).not.toBeInTheDocument();
  });
});

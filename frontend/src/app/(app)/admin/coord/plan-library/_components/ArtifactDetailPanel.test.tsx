/**
 * ArtifactDetailPanel — the four coord-link states, and the both-directions
 * provenance render.
 *
 * The coord block is where this page can most easily lie. "No linked work
 * unit", "coord doesn't have that work unit", "we couldn't reach coord" and
 * "coord has no route to list citations" are four different facts, and three
 * of them are routinely rendered as an innocuous empty state by UIs that
 * treat absence as zero. Each gets its own assertion here.
 *
 * ## What Phase 3 Wave 5 changed here, and what it did NOT
 *
 * The component was a `<Dialog>` and is now an expand-in-place
 * `<RecordDetail>` (plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, R5). Nothing in
 * this file asserted dialog-ness — no `role="dialog"`, no focus trap, no
 * Escape, no `onOpenChange` — so every assertion survives. Two mechanical
 * edits: the `open` prop is gone (`artifactId === null` is now the closed
 * state, one flag instead of two that could disagree), and the tests still
 * render the component DIRECTLY rather than through `PlanLibraryList`.
 *
 * **That directness now matters more, not less.** In production the panel is
 * mounted under the expanded row, so switching artifacts UNMOUNTS it and the
 * `requestIdRef` guard cannot be exercised by a parent swap. The three
 * stale-resolution tests below drive `artifactId` with `rerender` on one
 * mounted instance, which is the only place that race is still reachable —
 * and it is still reachable for real, on the two paths that change
 * `artifactId` without unmounting: following a provenance edge from the pinned
 * panel, and the post-write refresh in `handleKind`. Deleting these because
 * "the list remounts anyway" would be trading a real guard for a vacuous
 * green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { ArtifactDetailPanel } from "./ArtifactDetailPanel";
import { KIND_LABELS } from "../types";
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
    <ArtifactDetailPanel
      artifactId={d.id}
      onClose={vi.fn()}
      fetchDetail={vi.fn().mockResolvedValue(d)}
      correctKind={vi.fn().mockResolvedValue(true)}
      onOpenArtifact={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ArtifactDetailPanel — the coord link is four states, not two", () => {
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

describe("ArtifactDetailPanel — provenance renders BOTH directions", () => {
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

describe("ArtifactDetailPanel — the kind lock is visible", () => {
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

describe("ArtifactDetailPanel — a failed fetch is not a loading state", () => {
  it("shows an error with a retry instead of an eternal skeleton", async () => {
    // `fetchDetail` returns null on failure, which leaves `detail` null and
    // `loading` false — a `loading || !detail` guard would spin forever and
    // describe a dead dialog as one that is still working.
    render(
      <ArtifactDetailPanel
        onClose={vi.fn()}
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
      <ArtifactDetailPanel
        onClose={vi.fn()}
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

describe("ArtifactDetailPanel — a stale resolution must not paint", () => {
  it("keeps the newer artifact when an older fetch lands last", async () => {
    // Following a provenance edge switches `artifactId` while the first read
    // is still in flight. That read makes up to two 5s coord round-trips, so
    // out-of-order resolution is ordinary, not exotic. If the late one wins,
    // the dialog shows artifact A under artifact B's request — and the old
    // post-hoc guard then nulled it out, leaving a permanent skeleton.
    let resolveA: (v: WorkArtifactDetail) => void = () => {};
    const slowA = new Promise<WorkArtifactDetail>((r) => {
      resolveA = r;
    });
    const artifactB = detail({ id: "art-2", title: "The newer artifact" });

    const fetchDetail = vi
      .fn()
      .mockImplementationOnce(() => slowA)
      .mockResolvedValueOnce(artifactB);

    const { rerender } = render(
      <ArtifactDetailPanel
        onClose={vi.fn()}
        artifactId="art-1"
        fetchDetail={fetchDetail}
        correctKind={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    );

    // Follow the edge before A resolves.
    rerender(
      <ArtifactDetailPanel
        onClose={vi.fn()}
        artifactId="art-2"
        fetchDetail={fetchDetail}
        correctKind={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("The newer artifact")).toBeInTheDocument()
    );

    // NOW let the superseded request land.
    await act(async () => {
      resolveA(detail({ id: "art-1", title: "The stale artifact" }));
      await slowA;
    });

    expect(screen.getByText("The newer artifact")).toBeInTheDocument();
    expect(screen.queryByText("The stale artifact")).not.toBeInTheDocument();
    // And it must not have been nulled into a permanent skeleton either.
    expect(screen.getByTestId("artifact-body")).toBeInTheDocument();
    expect(
      screen.queryByTestId("artifact-detail-error")
    ).not.toBeInTheDocument();
  });

  it("does not paint a late FAILURE from A over a healthy B", async () => {
    // The second variant, and a genuinely distinct code path: `load` writes
    // `setFailed(full === null)`, so a superseded request that FAILED does not
    // merely overwrite the detail — it flips `failed` on and renders "could
    // not be loaded" over an artifact that is sitting there fetched and fine.
    // Guarding only the success branch would leave exactly this hole, which is
    // why it gets its own test rather than a second assertion above.
    let resolveA: (v: WorkArtifactDetail | null) => void = () => {};
    const slowA = new Promise<WorkArtifactDetail | null>((r) => {
      resolveA = r;
    });
    const artifactB = detail({ id: "art-2", title: "The healthy artifact" });

    const fetchDetail = vi
      .fn()
      .mockImplementationOnce(() => slowA)
      .mockResolvedValueOnce(artifactB);

    const { rerender } = render(
      <ArtifactDetailPanel
        onClose={vi.fn()}
        artifactId="art-1"
        fetchDetail={fetchDetail}
        correctKind={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    );

    rerender(
      <ArtifactDetailPanel
        onClose={vi.fn()}
        artifactId="art-2"
        fetchDetail={fetchDetail}
        correctKind={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("The healthy artifact")).toBeInTheDocument()
    );

    // A resolves LAST, and resolves to a failure.
    await act(async () => {
      resolveA(null);
      await slowA;
    });

    expect(
      screen.queryByTestId("artifact-detail-error")
    ).not.toBeInTheDocument();
    expect(screen.getByText("The healthy artifact")).toBeInTheDocument();
    expect(screen.getByTestId("artifact-body")).toBeInTheDocument();
  });
});

/** Open the kind dropdown and pick `label`. Radix needs real pointer events. */
async function correctKindTo(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("artifact-kind-select"));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("ArtifactDetailPanel — the kind correction obeys the same guard", () => {
  it("does not let its refresh paint over an artifact opened since", async () => {
    // `handleKind` used to call `fetchDetail` RAW — no generation bump, no
    // generation check — so it drove straight past the guard `load` installs.
    // The refresh makes up to two 5s coord round-trips, which is ample time to
    // follow a provenance edge; the late refresh then repaints A over B. And
    // because `handleKind` keys off `detail.id`, the operator's NEXT
    // correction PATCHes A while the dialog reads B — locking the wrong row.
    let resolveRefresh: (v: WorkArtifactDetail | null) => void = () => {};
    const slowRefresh = new Promise<WorkArtifactDetail | null>((r) => {
      resolveRefresh = r;
    });

    const fetchDetail = vi
      .fn()
      // 1: the initial load of A.
      .mockResolvedValueOnce(detail({ id: "art-1", title: "Artifact A" }))
      // 2: the post-correction refresh of A — still in flight.
      .mockImplementationOnce(() => slowRefresh)
      // 3: B, opened by following an edge.
      .mockResolvedValueOnce(detail({ id: "art-2", title: "Artifact B" }));
    const correctKind = vi.fn().mockResolvedValue(true);

    const { rerender } = render(
      <ArtifactDetailPanel
        onClose={vi.fn()}
        artifactId="art-1"
        fetchDetail={fetchDetail}
        correctKind={correctKind}
        onOpenArtifact={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("Artifact A")).toBeInTheDocument()
    );

    await correctKindTo(KIND_LABELS.handoff);
    await waitFor(() =>
      expect(correctKind).toHaveBeenCalledWith("art-1", "handoff")
    );
    // The refresh must actually be out before we navigate, or the race the
    // test is about never happens.
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledTimes(2));

    rerender(
      <ArtifactDetailPanel
        onClose={vi.fn()}
        artifactId="art-2"
        fetchDetail={fetchDetail}
        correctKind={correctKind}
        onOpenArtifact={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("Artifact B")).toBeInTheDocument()
    );

    // NOW let the superseded refresh land.
    await act(async () => {
      resolveRefresh(detail({ id: "art-1", title: "Artifact A" }));
      await slowRefresh;
    });

    expect(screen.getByText("Artifact B")).toBeInTheDocument();
    expect(screen.queryByText("Artifact A")).not.toBeInTheDocument();
    expect(screen.getByTestId("artifact-body")).toBeInTheDocument();
  });

  it("surfaces a refresh that failed after the write succeeded", async () => {
    // `if (refreshed) setDetail(refreshed)` swallowed a null. The success
    // toast ("Kind set to … and locked") then sat next to a Select still
    // showing the OLD kind — a screen that asserts both that the write landed
    // and that it did not, with nothing telling the operator which is true.
    const fetchDetail = vi
      .fn()
      .mockResolvedValueOnce(detail({ id: "art-1", title: "Artifact A" }))
      .mockResolvedValueOnce(null);
    const correctKind = vi.fn().mockResolvedValue(true);

    render(
      <ArtifactDetailPanel
        onClose={vi.fn()}
        artifactId="art-1"
        fetchDetail={fetchDetail}
        correctKind={correctKind}
        onOpenArtifact={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("Artifact A")).toBeInTheDocument()
    );

    await correctKindTo(KIND_LABELS.handoff);

    await waitFor(() =>
      expect(screen.getByTestId("artifact-detail-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("artifact-detail-retry")).toBeInTheDocument();
    // The stale view is gone rather than lingering as an unlabelled lie.
    expect(screen.queryByTestId("artifact-kind-select")).not.toBeInTheDocument();
  });
});

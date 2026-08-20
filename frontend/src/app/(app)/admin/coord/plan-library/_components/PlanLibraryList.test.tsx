/**
 * The TWO ANCHORS of the artifact detail — the sharpest piece of logic in the
 * Wave 5 migration, and the one a mechanical check cannot defend.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 5 converted this route's detail from a modal to expand-in-place (R5).
 * The trap is that `openArtifact(id)` is **not** limited to rows on the current
 * page: `DivergencePanel`'s per-variant "Open" and every `edge-peer-*`
 * provenance click inside the panel pass an id that may be anywhere in the
 * corpus. A modal did not care. Expand-in-place does.
 *
 * The obvious refactor — hand `detailId` to `<RecordList expandedKey>` and let
 * it find the row — is ONE LINE, type-checks, keeps every other test in this
 * directory green, and silently makes both of those affordances **do nothing**
 * whenever the artifact is off-page. There is no error, no empty state, no
 * console warning: the click just stops working.
 *
 * So the invariant is asserted from both sides here:
 *
 *   on-page id  → the detail renders INSIDE that row, and the pinned anchor
 *                 is absent (otherwise it would render twice);
 *   off-page id → the pinned anchor renders, carrying the same panel.
 *
 * `ArtifactDetailPanel` is stubbed. This file is about WHERE the panel is
 * anchored and nothing else; the panel's own behaviour — the four coord-link
 * states, the stale-resolution guard, the kind correction — is covered
 * exhaustively in `ArtifactDetailPanel.test.tsx`, and mounting the real one
 * here would only couple this test to that one's fetch mocking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

/** The panel is stubbed — see the module doc for why. */
vi.mock("./ArtifactDetailPanel", () => ({
  ArtifactDetailPanel: ({ artifactId }: { artifactId: string | null }) => (
    <div data-testid="stub-panel" data-artifact-id={artifactId ?? ""} />
  ),
}));

import { PlanLibraryList } from "./PlanLibraryList";

const ON_PAGE = "art-on-page";
const OFF_PAGE = "art-somewhere-else";

function artifact(id: string) {
  return {
    id,
    kind: "plan",
    kind_locked: false,
    slug: `2026-08-10-${id}`,
    title: `Title of ${id}`,
    status: "VETTED",
    source_repo: "qontinui-web",
    current_version: 2,
    captured_by: "runner_scan",
    updated_at: "2026-08-19T12:00:00Z",
  };
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ items: [artifact(ON_PAGE)], total: 1 });
});

async function renderList(openRequest?: { id: string; nonce: number }) {
  const r = render(<PlanLibraryList openRequest={openRequest ?? null} />);
  await waitFor(() =>
    expect(screen.getByTestId(`artifact-row-${ON_PAGE}`)).toBeInTheDocument()
  );
  return r;
}

describe("the artifact detail is anchored in one of two places, never neither", () => {
  it("expands INSIDE the row when the artifact is on this page", async () => {
    await renderList();
    // Nothing open yet.
    expect(screen.queryByTestId("stub-panel")).toBeNull();

    const row = screen.getByTestId(`artifact-row-${ON_PAGE}`);
    fireEvent.click(row.querySelector("button")!);

    const panel = screen.getByTestId("stub-panel");
    expect(panel).toHaveAttribute("data-artifact-id", ON_PAGE);
    // Inside the row, not floating beside it — this is what "expand in place"
    // means and it is the half a `RecordList` refactor would keep working,
    // which is exactly why the other half needs its own assertion.
    expect(row).toContainElement(panel);
    // ...and the pinned anchor must NOT also fire, or the panel renders twice.
    expect(screen.queryByTestId("plan-library-pinned-detail")).toBeNull();
  });

  it("pins the panel above the list when the artifact is NOT on this page", async () => {
    // This is `DivergencePanel`'s "Open" and every `edge-peer-*` click: an id
    // from anywhere in the corpus, arriving through `openRequest`.
    await renderList({ id: OFF_PAGE, nonce: 1 });

    const pinned = await screen.findByTestId("plan-library-pinned-detail");
    const panel = screen.getByTestId("stub-panel");
    expect(panel).toHaveAttribute("data-artifact-id", OFF_PAGE);
    expect(pinned).toContainElement(panel);

    // The row on this page stays collapsed — it is a different artifact.
    const row = screen.getByTestId(`artifact-row-${ON_PAGE}`);
    expect(row).not.toContainElement(panel);
  });

  it("renders exactly ONE panel in both cases", async () => {
    const { rerender } = await renderList({ id: OFF_PAGE, nonce: 1 });
    expect(screen.getAllByTestId("stub-panel")).toHaveLength(1);

    // Ask for the on-page artifact instead; the anchor moves, it does not
    // duplicate.
    rerender(<PlanLibraryList openRequest={{ id: ON_PAGE, nonce: 2 }} />);
    await waitFor(() =>
      expect(screen.getByTestId("stub-panel")).toHaveAttribute(
        "data-artifact-id",
        ON_PAGE
      )
    );
    expect(screen.getAllByTestId("stub-panel")).toHaveLength(1);
    expect(screen.queryByTestId("plan-library-pinned-detail")).toBeNull();
  });

  it("re-opens the same off-page artifact when asked twice (the nonce)", async () => {
    const { rerender } = await renderList({ id: OFF_PAGE, nonce: 1 });
    expect(screen.getByTestId("plan-library-pinned-detail")).toBeInTheDocument();

    // Collapse it the way the operator would.
    fireEvent.click(screen.getByTestId(`artifact-row-${ON_PAGE}`).querySelector("button")!);
    fireEvent.click(screen.getByTestId(`artifact-row-${ON_PAGE}`).querySelector("button")!);
    expect(screen.queryByTestId("plan-library-pinned-detail")).toBeNull();

    // The SAME id again. Without the nonce in the effect's deps this is a
    // no-op, which is the bug the nonce exists for.
    rerender(<PlanLibraryList openRequest={{ id: OFF_PAGE, nonce: 2 }} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("plan-library-pinned-detail")
      ).toBeInTheDocument()
    );
  });
});

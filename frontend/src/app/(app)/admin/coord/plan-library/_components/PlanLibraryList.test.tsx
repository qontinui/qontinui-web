/**
 * The TWO ANCHORS of the artifact detail — the sharpest piece of logic in the
 * Wave 5 migration, and the one a mechanical check cannot defend.
 *
 * The list lives at `/admin/coord/plan-library/artifacts` (every kind; plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next`). Its detail
 * expands in place (R5). The trap is that `openArtifact(id)` is **not**
 * limited to rows on the current page: every `edge-peer-*` provenance click
 * inside the panel passes an id that may be anywhere in the corpus.
 *
 * The obvious refactor — hand `detailId` to `<RecordList expandedKey>` and let
 * it find the row — is ONE LINE, type-checks, and silently makes that
 * affordance **do nothing** whenever the artifact is off-page. There is no error, no empty state, no
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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const get = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

/**
 * The panel is stubbed — see the module doc for why. Its one button stands in
 * for an `edge-peer-*` click: it opens an artifact that is NOT on this page.
 */
vi.mock("./ArtifactDetailPanel", () => ({
  ArtifactDetailPanel: ({
    artifactId,
    onOpenArtifact,
  }: {
    artifactId: string | null;
    onOpenArtifact: (id: string) => void;
  }) => (
    <div data-testid="stub-panel" data-artifact-id={artifactId ?? ""}>
      <button
        type="button"
        data-testid="stub-follow-edge"
        onClick={() => onOpenArtifact("art-somewhere-else")}
      >
        peer
      </button>
    </div>
  ),
}));

import { PlanLibraryList } from "./PlanLibraryList";

const ON_PAGE = "art-on-page";
const OFF_PAGE = "art-somewhere-else";

function artifact(id: string, overrides: Record<string, unknown> = {}) {
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
    status_currency: {
      state: "fed_in_step",
      as_of: "2026-08-19T12:00:00Z",
      ref_sha: "c0ffee",
      ref_age_secs: 5,
      detail: "1 fresh reading(s) of 'qontinui-web' read a fresh ref",
    },
    ...overrides,
  };
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ items: [artifact(ON_PAGE)], total: 1 });
});

async function renderList() {
  const r = render(<PlanLibraryList />);
  await waitFor(() =>
    expect(screen.getByTestId(`artifact-row-${ON_PAGE}`)).toBeInTheDocument()
  );
  return r;
}

function openOnPageRow() {
  const row = screen.getByTestId(`artifact-row-${ON_PAGE}`);
  fireEvent.click(row.querySelector("button")!);
  return row;
}

describe("the artifact detail is anchored in one of two places, never neither", () => {
  it("expands INSIDE the row when the artifact is on this page", async () => {
    await renderList();
    // Nothing open yet.
    expect(screen.queryByTestId("stub-panel")).toBeNull();

    const row = openOnPageRow();
    const panel = screen.getByTestId("stub-panel");
    expect(panel).toHaveAttribute("data-artifact-id", ON_PAGE);
    // Inside the row, not floating beside it — this is what "expand in place"
    // means and it is the half a `RecordList` refactor would keep working,
    // which is exactly why the other half needs its own assertion.
    expect(row).toContainElement(panel);
    // ...and the pinned anchor must NOT also fire, or the panel renders twice.
    expect(screen.queryByTestId("plan-library-pinned-detail")).toBeNull();
  });

  it("pins the panel above the list when a provenance peer is NOT on this page", async () => {
    await renderList();
    openOnPageRow();
    fireEvent.click(screen.getByTestId("stub-follow-edge"));

    const pinned = await screen.findByTestId("plan-library-pinned-detail");
    const panel = screen.getByTestId("stub-panel");
    expect(panel).toHaveAttribute("data-artifact-id", OFF_PAGE);
    expect(pinned).toContainElement(panel);
    // Exactly ONE panel: the anchor moved, it did not duplicate.
    expect(screen.getAllByTestId("stub-panel")).toHaveLength(1);

    // The row on this page collapsed — it is a different artifact.
    const row = screen.getByTestId(`artifact-row-${ON_PAGE}`);
    expect(row).not.toContainElement(panel);
  });
});

describe("every kind is browsable", () => {
  it("asks for no kind by default and renders a non-plan artifact", async () => {
    get.mockResolvedValue({
      items: [artifact(ON_PAGE, { kind: "handoff" })],
      total: 1,
    });
    await renderList();
    // `/admin/coord/plans` reads kind=plan only; this list must not.
    expect(String(get.mock.calls[0]?.[0])).not.toContain("kind=");
    expect(screen.getByTestId(`artifact-row-${ON_PAGE}`)).toHaveTextContent(
      /handoff/i
    );
  });
});

describe("every row states the currency of its own status", () => {
  it("renders the served state, with its detail as the tooltip", async () => {
    await renderList();
    const badge = within(
      screen.getByTestId(`artifact-row-${ON_PAGE}`)
    ).getByTestId("artifact-row-currency");
    expect(badge).toHaveAttribute("data-state", "fed_in_step");
    expect(badge).toHaveTextContent("Fed, in step");
    expect(badge).toHaveAttribute(
      "title",
      "1 fresh reading(s) of 'qontinui-web' read a fresh ref"
    );
  });

  it("renders an unserved currency as UNKNOWN, never as nothing", async () => {
    get.mockResolvedValue({
      items: [artifact(ON_PAGE, { status_currency: undefined })],
      total: 1,
    });
    await renderList();
    const badge = within(
      screen.getByTestId(`artifact-row-${ON_PAGE}`)
    ).getByTestId("artifact-row-currency");
    expect(badge).toHaveAttribute("data-state", "unknown");
    expect(badge).toHaveTextContent("Currency unknown");
  });

  it("renders a state this console does not know as UNKNOWN, not blank", async () => {
    get.mockResolvedValue({
      items: [
        artifact(ON_PAGE, {
          status_currency: {
            state: "fed_from_the_future",
            as_of: null,
            ref_sha: null,
            ref_age_secs: null,
            detail: null,
          },
        }),
      ],
      total: 1,
    });
    await renderList();
    const badge = within(
      screen.getByTestId(`artifact-row-${ON_PAGE}`)
    ).getByTestId("artifact-row-currency");
    expect(badge).toHaveAttribute("data-state", "unknown");
    expect(badge).toHaveTextContent("Currency unknown");
    expect(badge.getAttribute("title")).toContain("fed_from_the_future");
  });
});

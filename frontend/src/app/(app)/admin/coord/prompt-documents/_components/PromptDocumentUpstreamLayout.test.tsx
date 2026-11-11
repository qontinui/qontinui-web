/**
 * The upstream dialog's LAYOUT contract — the defect that made `Adopt v1`
 * unreachable (2026-11-07).
 *
 * The release note sat outside the scrolling region as a `shrink-0` block in a
 * `max-h-[90vh] overflow-hidden` column. A release note is, by default, every
 * change note since the last publication, so it grows with a document's
 * history; the block pushed the footer out of the box and the clip hid it, and
 * zooming the browser out was the only way to reach Adopt.
 *
 * jsdom has no layout engine, so this cannot measure that a button is on
 * screen at 1366×768 — the visual check does that. It pins the STRUCTURE that
 * makes the footer impossible to clip, in every view:
 *
 * 1. Every decision control is inside the footer; the footer is a direct child
 *    of the dialog and NOT inside the scrolling body.
 * 2. Everything whose height grows with content — the release note, the pane
 *    selector, the diff, the clause list, the unwired notice — is inside the
 *    body, the body is the dialog's ONE scroll region, and NOTHING inside it
 *    carries an overflow class of any kind (the diff tables included).
 * 3. The release note is collapsed by default, so the panes and the diff are
 *    not below it.
 * 4. The width is set on the `sm:` variant at twice the 32rem it really
 *    rendered at, inside the viewport clamp — and the base `sm:max-w-lg` does
 *    not survive the class merge.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { PromptDocumentUpstreamDialog } from "./PromptDocumentUpstreamDialog";
import type {
  ClauseMergePreview,
  MergeClauseSide,
  Publication,
  PromptDocument,
} from "../types";

/** A release note the size of the real ones: one line per version. */
const LONG_NOTE = Array.from(
  { length: 32 },
  (_, i) =>
    `v${i + 1}: clause tightened after a live-router finding (operator@example.com)`
).join("\n");

function doc(extra: Partial<PromptDocument> = {}): PromptDocument {
  return {
    id: "doc-policy-coordination",
    kind: "policy",
    name: "coordination",
    description:
      "Coordination policy — declare_intent, gates, work units, and the transport cascade every session uses",
    format: "markdown",
    default_source: null,
    current_version: 32,
    updated_by: "operator@example.com",
    updated_at: "2026-11-07T10:00:00Z",
    upstream_publication_version: null,
    latest_publication_version: 1,
    local_modified: true,
    update_available: true,
    body: Array.from({ length: 400 }, (_, i) => `local line ${i}`).join("\n"),
    ...extra,
  } as PromptDocument;
}

function publication(version: number): Publication {
  return {
    publication_id: `p${version}`,
    kind: "policy",
    name: "coordination",
    publication_version: version,
    format: "markdown",
    description: null,
    release_note: LONG_NOTE,
    content_sha256: `sha-${version}`,
    source_version: 32,
    published_by: "operator@example.com",
    published_at: "2026-11-07T09:00:00Z",
    body: Array.from({ length: 400 }, (_, i) => `upstream line ${i}`).join(
      "\n"
    ),
  } as Publication;
}

function side(action: string): MergeClauseSide {
  return {
    clause_id: "x",
    category: "coordination",
    status: "active",
    tier: null,
    trigger: null,
    action,
    bounds: null,
    escalate_if: null,
    anti_triggers: [],
    depends_on: [],
    links: [],
  };
}

const PLAN: ClauseMergePreview = {
  mode: "clauses",
  kind: "policy",
  name: "coordination",
  current_version: 32,
  // No tracked publication: this document has never adopted one.
  tracked_publication_version: null,
  publication_version: 1,
  publication_release_note: LONG_NOTE,
  base_source: "tracked_publication",
  base_known: true,
  entries: [
    ...Array.from({ length: 30 }, (_, i) => ({
      clause: `clause-${i}`,
      decision: "take_upstream_edit" as const,
      requires_choice: false,
      base: side("old"),
      local: side("old"),
      upstream: side(`new ${i}`),
    })),
    // A conflicted row renders its own per-clause diff branch.
    {
      clause: "scope",
      decision: "conflict" as const,
      requires_choice: true,
      conflict_reason: "both_edited" as const,
      base: side("base"),
      local: side("ours"),
      upstream: side("theirs"),
    },
  ],
  conflicts: ["scope"],
  noop: false,
};

function renderDialog(wired = true) {
  return render(
    <PromptDocumentUpstreamDialog
      open
      onOpenChange={() => {}}
      doc={doc()}
      loadingBody={false}
      fetchPublication={async (_k, _n, v) => publication(v)}
      {...(wired
        ? {
            onAdoptUpstream: async () => true,
            onKeepMine: async () => true,
            fetchMergePreview: async () => PLAN,
            onMergeClauses: async () => true,
          }
        : {})}
    />
  );
}

/** The structural invariants every view must hold. */
function expectFixedFooterAndOneScrollRegion(controls: string[]) {
  const dialog = screen.getByTestId("prompt-document-upstream");
  const body = screen.getByTestId("upstream-body");
  const footer = screen.getByTestId("upstream-footer");

  for (const cls of ["flex", "flex-col", "max-h-[90vh]", "overflow-hidden"]) {
    expect(dialog).toHaveClass(cls);
  }
  for (const cls of ["min-h-0", "flex-1", "overflow-y-auto"]) {
    expect(body).toHaveClass(cls);
  }
  expect(footer).toHaveClass("shrink-0");
  expect(footer.parentElement).toBe(dialog);
  expect(body.contains(footer)).toBe(false);
  for (const id of controls) {
    expect(within(footer).getByTestId(id)).toBeInTheDocument();
  }
  // ONE scroll region: the body, and no scroll or clip container of ANY
  // overflow class inside it. A nested one inside a shrinkable region is how
  // a list gets squeezed to nothing by a block above it.
  expect(nestedScrollContainers(body)).toEqual([]);
  // Nothing content-sized may sit beside the body as a non-shrinking sibling:
  // the dialog's children are exactly header, body, footer (+ the close X).
  const rows = Array.from(dialog.children).filter(
    (el) => el.getAttribute("data-slot") !== "dialog-close"
  );
  expect(rows).toEqual([
    dialog.querySelector('[data-slot="dialog-header"]'),
    body,
    footer,
  ]);
}

/**
 * Every element inside `root` that a class makes a scroll or clip container,
 * or that cuts its own text short — any `overflow-*` value but `visible`,
 * `truncate`, `text-ellipsis`, `line-clamp-*` — under any variant prefix
 * (`sm:`, `hover:`, …).
 */
function nestedScrollContainers(root: HTMLElement): string[] {
  const OVERFLOW =
    /^(?:[a-z0-9-]+:)*(?:overflow-(?:[xy]-)?(?:auto|scroll|hidden|clip)|truncate|text-ellipsis|line-clamp-(?:\d+|\[.+\]))$/;
  return Array.from(root.querySelectorAll<HTMLElement>("*"))
    .filter((el) => Array.from(el.classList).some((c) => OVERFLOW.test(c)))
    .map(
      (el) =>
        `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? ""}] ${el.className}`
    );
}

describe("the upstream dialog's width", () => {
  it("is twice the 32rem it rendered at, on the sm variant, inside the viewport clamp", async () => {
    renderDialog();
    await screen.findByText("Adopt v1");
    const dialog = screen.getByTestId("prompt-document-upstream");
    expect(dialog).toHaveClass("sm:max-w-[min(64rem,calc(100%-2rem))]");
    expect(dialog).toHaveClass("max-w-[calc(100%-2rem)]");
    expect(dialog).not.toHaveClass("sm:max-w-lg");
    expect(dialog).not.toHaveClass("max-w-4xl");
  });
});

describe("the comparison view", () => {
  it("keeps Adopt, Keep mine and Merge clauses in a footer the body cannot push out", async () => {
    renderDialog();
    await screen.findByText("Adopt v1");

    expectFixedFooterAndOneScrollRegion([
      "upstream-adopt",
      "upstream-keep-mine",
      "upstream-merge-clauses",
    ]);
    const body = screen.getByTestId("upstream-body");
    // The release note — the block that did the pushing — is in the body now,
    // collapsed, its summary saying how much it holds.
    const note = within(body).getByTestId("upstream-release-note");
    expect(note.tagName).toBe("DETAILS");
    expect(note).not.toHaveAttribute("open");
    expect(note).toHaveTextContent("Release note for v1 (32 lines)");
    await userEvent
      .setup()
      .click(within(note).getByText(/Release note for v1/));
    expect(note).toHaveAttribute("open");
    expect(note).toHaveTextContent("v32: clause tightened");
    expect(within(body).getByRole("tablist")).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByTestId("upstream-pane-adopt_effect"));
    expect(within(body).getByTestId("upstream-diff")).toBeInTheDocument();
    // Re-checked now that a diff table is on screen: it must not be a scroll
    // container of its own inside the body.
    expect(nestedScrollContainers(body)).toEqual([]);
    // The title clears the close button instead of running under it.
    expect(
      screen
        .getByTestId("prompt-document-upstream")
        .querySelector('[data-slot="dialog-header"]')
    ).toHaveClass("shrink-0", "pr-6");
  });

  it("keeps the unwired notice in the body too", async () => {
    renderDialog(false);
    await screen.findByText("Adopt v1");
    expect(
      within(screen.getByTestId("upstream-body")).getByTestId(
        "upstream-decisions-unwired"
      )
    ).toBeInTheDocument();
    expectFixedFooterAndOneScrollRegion([
      "upstream-adopt",
      "upstream-keep-mine",
    ]);
  });
});

describe("the clause-merge view", () => {
  it("keeps Back and Merge in the footer while 30 clauses scroll in the body", async () => {
    renderDialog();
    await screen.findByText("Adopt v1");
    await userEvent.setup().click(screen.getByTestId("upstream-merge-clauses"));
    await screen.findByTestId("clause-merge-entries");

    expectFixedFooterAndOneScrollRegion([
      "upstream-merge-back",
      "upstream-merge-apply",
    ]);
    const body = screen.getByTestId("upstream-body");
    expect(
      within(body).getAllByRole("listitem", { hidden: false }).length
    ).toBeGreaterThanOrEqual(31);
    expect(
      within(body).getByTestId("upstream-release-note")
    ).toBeInTheDocument();
  });
});

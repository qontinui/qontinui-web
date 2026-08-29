/**
 * The proposal row, at the layer an operator actually sees.
 *
 * Phase 3 Wave 5 (qontinui-web#1036) made three consequential changes to this
 * card and pinned none of them above the derivation layer. `proposalStatus.ts`
 * has a thorough unit test, but it proves what `deriveProposalStatus` RETURNS —
 * not that the row renders it, and not that the affordances the wave moved
 * behind a click still work once they are there. This file covers that gap.
 *
 * What is pinned here, and why each one earns a test rather than a comment:
 *
 *  1. **The R3 correction reaches the badge.** `stale` is the red one;
 *     `loosening` and `unclassifiable` are calm. The wave's own argument is that
 *     `unclassifiable` was red *because the word is alarming*, so the
 *     derivation-level assertion is the easy half — the row is where the colour
 *     is actually spent.
 *
 *  2. **Staleness says ONE thing.** The badge and the warning panel render from
 *     the same predicate, and a review caught them disagreeing (red badge, amber
 *     panel). A row that is red above and amber below tells the operator both
 *     "act now" and "this will clear itself".
 *
 *  3. **The disclosed affordances survive disclosure.** `Approve & apply`
 *     WRITES A POLICY DOCUMENT and this wave moved it, the reject button, the
 *     decision-note textarea and the non-admin `ReadOnlyNotice` from
 *     always-visible into the expanded detail. Three things must hold after that
 *     move: they render when open, they are absent when closed, and the admin
 *     gate still gates them — asserted with the row OPEN, so a `null` means
 *     "gated" and never merely "collapsed" (the vacuous-green shape
 *     `ClearanceRuleList.test.tsx` documents).
 *
 *  4. **`data-direction` still reports the RAW direction when staleness
 *     overrides the badge.** The card's own comment claims this; nothing checked
 *     it. It is the only remaining machine-readable answer to "which way did the
 *     comparator judge this" once the badge starts reporting `stale` instead.
 *
 *  5. **A typed decision note survives a collapse.** The PR body asserts it
 *     ("`RecordList` keeps every item mounted, so `note` survives collapse") and
 *     it is a real regression risk created by the move: before the wave the
 *     composer was always mounted. The note lives in `ProposalCard`'s own
 *     `useState`, so the claim holds only while the CARD stays mounted — which
 *     is a property of the host, not of this component. Pinned through
 *     `<RecordList>` for that reason, not against a hand-rolled harness.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const authState = vi.hoisted(() => ({ isCoordAdmin: true }));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => authState,
}));

// Module-scoped and mutable, so it is reset rather than left to declaration
// order. The non-admin test below leaves it `false`; without this, every test
// after it passes only because it happens to reassign the flag first, and a
// reordering — or a new test inserted between them — turns green into a lie.
beforeEach(() => {
  authState.isCoordAdmin = true;
});

import { RecordList } from "@/components/console";
import type { PromptDocumentProposal } from "../types";
import { ProposalCard } from "./ProposalCard";

function proposal(
  over: Partial<PromptDocumentProposal> = {}
): PromptDocumentProposal {
  return {
    id: "p-1",
    doc_kind: "policy",
    doc_name: "escalation-bar",
    clause_id: "escalation-closed-list",
    proposed_content: "Agents may escalate on any ambiguity.",
    direction: "loosening",
    from_tier: "ask-first",
    to_tier: "proceed",
    rationale: "The closed list is too narrow in practice.",
    proposed_by: "merge-train-steward",
    base_version: 4,
    status: "pending",
    created_at: "2026-08-20T10:00:00Z",
    ...over,
  };
}

/**
 * One card, hosted by the same `<RecordList>` the page uses.
 *
 * Rendering through the real host rather than a stub is deliberate: half of what
 * this file asserts (what unmounts on collapse, what state survives it) is a
 * property of the host/child pair, and a hand-rolled harness would let those
 * tests pass while the page was broken.
 */
function renderCard(
  p: PromptDocumentProposal,
  opts: { liveVersion?: number | null; loading?: boolean } = {}
) {
  const onDecide = vi.fn().mockResolvedValue(true);
  function Host() {
    return (
      <RecordList
        items={[p]}
        itemKey={(x) => x.id}
        empty={null}
        renderRow={(x, ctx) => (
          <ProposalCard
            proposal={x}
            liveVersion={opts.liveVersion ?? null}
            loading={opts.loading ?? false}
            acting={false}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
            onDecide={onDecide}
          />
        )}
      />
    );
  }
  render(<Host />);
  return { onDecide };
}

/** The row line is one `<button>` — click it to expand or collapse. */
function toggleRow(id = "p-1") {
  fireEvent.click(screen.getByTestId(`proposal-${id}`).querySelector("button")!);
}

describe("ProposalCard — R3 reaches the badge", () => {
  it("paints a LOOSENING proposal calm, not amber", () => {
    // The queue's own module doc: "no agent, session, or merge waits on it".
    // Amber promises something else clears this; nothing clears an unreviewed
    // proposal.
    renderCard(proposal({ direction: "loosening" }));
    const badge = screen.getByTestId("proposal-direction");
    expect(badge.textContent ?? "").toMatch(/loosening/i);
    expect(badge.innerHTML).not.toMatch(/\bbg-(red|amber)-/);
  });

  it("paints an UNCLASSIFIABLE proposal calm too", () => {
    // The word is alarming; the state is not. Coord already refused to apply
    // it, which is the safe outcome — colour encodes who must act, not how
    // alarming the word sounds.
    renderCard(proposal({ direction: "unclassifiable" }));
    const badge = screen.getByTestId("proposal-direction");
    expect(badge.textContent ?? "").toMatch(/unclassifiable/i);
    expect(badge.innerHTML).not.toMatch(/\bbg-(red|amber)-/);
  });

  it("paints a STALE proposal red — the one state that genuinely decays", () => {
    renderCard(proposal({ base_version: 3 }), { liveVersion: 7 });
    const badge = screen.getByTestId("proposal-direction");
    expect(badge.textContent ?? "").toMatch(/stale/i);
    expect(badge.innerHTML).toMatch(/\bbg-red-/);
    // Red ⇔ the colourblind-safe glyph. The palette derives the glyph set from
    // the attention table, so this is the rendered end of that derivation.
    expect(badge.textContent ?? "").toContain("✕");
  });

  it("keeps the RAW direction machine-readable when staleness overrides the badge", () => {
    // Once the badge reports `stale`, `data-direction` is the only remaining
    // answer to "which way did the comparator judge this".
    renderCard(proposal({ direction: "unclassifiable", base_version: 3 }), {
      liveVersion: 7,
    });
    const badge = screen.getByTestId("proposal-direction");
    expect(badge).toHaveAttribute("data-direction", "unclassifiable");
    expect(badge.textContent ?? "").toMatch(/stale/i);
  });
});

describe("ProposalCard — staleness makes exactly one claim", () => {
  it("renders the warning panel RED, matching the badge", async () => {
    // Badge and panel come from the same predicate. An amber panel under a red
    // badge said "act now" and "it will clear itself" at once.
    renderCard(proposal({ base_version: 3 }), { liveVersion: 7 });
    toggleRow();
    const panel = await screen.findByTestId("proposal-stale");
    expect(panel.className).toMatch(/\bborder-red-/);
    expect(panel.className).not.toMatch(/\bborder-amber-/);
    expect(panel.textContent ?? "").toContain("now v7");
    expect(panel.textContent ?? "").toContain("authored against v3");
  });

  it("shows no staleness warning while the live version is UNKNOWN", async () => {
    // `liveVersion === null` cannot prove a proposal is fresh OR stale, and
    // asserting staleness from an unread version would be a claim we have not
    // earned.
    renderCard(proposal({ base_version: 3 }), { liveVersion: null });
    toggleRow();
    await screen.findByTestId("proposal-content");
    expect(screen.queryByTestId("proposal-stale")).toBeNull();
    expect(screen.getByTestId("proposal-direction").innerHTML).not.toMatch(
      /\bbg-red-/
    );
  });

  it("stays silent about the live version WHILE the load is in flight", async () => {
    // A load in flight is not a failed lookup — flashing "could not be read"
    // mid-fetch is the same false claim in prose form.
    renderCard(proposal(), { liveVersion: null, loading: true });
    toggleRow();
    await screen.findByTestId("proposal-content");
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it("says the version could not be read once the load has SETTLED", async () => {
    // The other half: silence must be the loading state, not the permanent
    // one. A version we failed to read is a fact the operator needs before
    // approving — it is why the staleness warning above is absent.
    renderCard(proposal(), { liveVersion: null, loading: false });
    toggleRow();
    await screen.findByTestId("proposal-content");
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
  });
});

describe("ProposalCard — the disclosed decision affordances", () => {
  it("hides the composer until the row is expanded", () => {
    // R2/R5: a one-line row cannot carry an inline textarea. This is the cost
    // of the density, and it should be a deliberate one.
    authState.isCoordAdmin = true;
    renderCard(proposal());
    expect(screen.queryByTestId("proposal-decision-note")).toBeNull();
    expect(screen.queryByTestId("proposal-approve")).toBeNull();
    expect(screen.queryByTestId("proposal-reject")).toBeNull();
  });

  it("renders the whole composer once expanded, for an admin", async () => {
    authState.isCoordAdmin = true;
    renderCard(proposal());
    toggleRow();
    expect(await screen.findByTestId("proposal-decision-note")).toBeTruthy();
    expect(screen.getByTestId("proposal-approve")).toHaveTextContent(
      "Approve & apply"
    );
    expect(screen.getByTestId("proposal-reject")).toBeTruthy();
  });

  it("gates the composer from a non-admin, and says why — with the row OPEN", async () => {
    // Asserted expanded on purpose: collapsed, these are null for everyone, so
    // a collapsed assertion would pass for the wrong reason.
    authState.isCoordAdmin = false;
    renderCard(proposal());
    toggleRow();
    expect(await screen.findByTestId("coord-admin-only-notice")).toHaveTextContent(
      "Only administrators can decide proposals"
    );
    expect(screen.queryByTestId("proposal-approve")).toBeNull();
    expect(screen.queryByTestId("proposal-reject")).toBeNull();
    expect(screen.queryByTestId("proposal-decision-note")).toBeNull();
    // The proposal itself stays readable — reviewing what an agent wanted to
    // change is diagnostic even for someone who cannot decide it.
    expect(screen.getByTestId("proposal-content")).toHaveTextContent(
      "Agents may escalate on any ambiguity."
    );
  });

  it("forwards the typed note with the decision, verbatim", async () => {
    authState.isCoordAdmin = true;
    const user = userEvent.setup();
    const { onDecide } = renderCard(proposal());
    toggleRow();

    await user.type(
      await screen.findByTestId("proposal-decision-note"),
      "superseded by the served clause"
    );
    await user.click(screen.getByTestId("proposal-approve"));

    expect(onDecide).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-1" }),
      "approve",
      "superseded by the served clause"
    );
  });

  it("distinguishes reject from approve on the same composer", async () => {
    authState.isCoordAdmin = true;
    const user = userEvent.setup();
    const { onDecide } = renderCard(proposal());
    toggleRow();

    await user.click(await screen.findByTestId("proposal-reject"));
    expect(onDecide).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-1" }),
      "reject",
      ""
    );
  });
});

describe("ProposalCard — a typed note is not lost on collapse", () => {
  it("keeps the note across a collapse and re-expand", async () => {
    // The claim the wave shipped on: `RecordList` keeps every item mounted, so
    // the card's `note` state outlives the detail that displays it. If the host
    // ever starts unmounting collapsed rows, an operator loses a typed
    // justification by clicking the row they typed it on — silently.
    authState.isCoordAdmin = true;
    const user = userEvent.setup();
    renderCard(proposal());

    toggleRow();
    await user.type(
      await screen.findByTestId("proposal-decision-note"),
      "checked against v7"
    );

    toggleRow();
    expect(screen.queryByTestId("proposal-decision-note")).toBeNull();

    toggleRow();
    expect(await screen.findByTestId("proposal-decision-note")).toHaveValue(
      "checked against v7"
    );
  });
});

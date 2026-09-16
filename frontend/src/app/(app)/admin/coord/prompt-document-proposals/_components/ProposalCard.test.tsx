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

/**
 * Plan `2026-09-13-policy-proposals-agent-decidable-dial-driven-self-retiring`,
 * Phase 4 — the two things that changed under this card.
 *
 * Both are the same class of failure if they regress: the row keeps rendering,
 * and says something untrue quietly. A retired proposal that still shows an
 * "approve before it moves" warning invites an action that cannot happen; an
 * author-decided row painted as a caution re-asserts an ownership rule the
 * fleet deliberately removed.
 */
describe("ProposalCard — coord's terminal `stale`", () => {
  it("badges a retired proposal calm, and drops the pre-approval warning", () => {
    renderCard(proposal({ status: "stale", base_version: 4 }), {
      liveVersion: 9,
    });
    const badge = screen.getByTestId("proposal-direction");
    expect(badge.textContent ?? "").toMatch(/retired/i);
    expect(badge.innerHTML).not.toMatch(/\bbg-(red|amber)-/);

    toggleRow();
    // The panel's text is "read the current wording BEFORE approving". Nobody
    // can approve this one — coord closed it — so repeating the instruction
    // would be noise attached to an action that no longer exists.
    expect(screen.queryByTestId("proposal-stale")).toBeNull();
    // The raw comparator verdict stays machine-readable either way.
    expect(badge.getAttribute("data-direction")).toBe("loosening");
  });

  it("still warns on a PENDING row the document has moved past", () => {
    // The race window the derived kind exists for — the same fixture minus
    // coord's verdict. Without this, "retired drops the warning" could be
    // satisfied by dropping the warning entirely.
    renderCard(proposal({ status: "pending", base_version: 4 }), {
      liveVersion: 9,
    });
    toggleRow();
    expect(screen.getByTestId("proposal-stale")).toBeTruthy();
  });
});

/**
 * coord's OTHER two terminal statuses — `approved` and `rejected` — and the
 * regression that reached production because no fixture in this file combined
 * one of them with a readable live version.
 */
describe("ProposalCard — a row coord already decided", () => {
  it("badges an APPROVED row calm too, with the live version actually supplied", () => {
    /*
     * The fixture that was missing, and the reason every "Recently proposed &
     * approved" row rendered a red act-now alarm while this file stayed green.
     *
     * Approving a proposal APPLIES the edit as a new document version, so
     * `liveVersion > base_version` is true of an approved row BY CONSTRUCTION —
     * it is the receipt for the approval, not a decayed premise. Every
     * `status: "approved"` fixture in this file took `renderCard`'s
     * `liveVersion` default of `null`, which short-circuits the comparison, so
     * no test in the suite combined the two. This one does: v4 authored, v9
     * live.
     */
    renderCard(proposal({ status: "approved", base_version: 4 }), {
      liveVersion: 9,
    });
    const badge = screen.getByTestId("proposal-direction");
    expect(badge.textContent ?? "").toMatch(/approved/i);
    expect(badge.innerHTML).not.toMatch(/\bbg-red-/);
    // Red ⇔ the `✕` glyph, so its absence is the second half of "not an alarm".
    expect(badge.textContent ?? "").not.toContain("✕");

    toggleRow();
    // "Read the current wording before approving" — addressed to a reader who
    // already approved it.
    expect(screen.queryByTestId("proposal-stale")).toBeNull();
    // The row IS reached and expanded, so the null above is a real absence.
    expect(screen.getByTestId("proposal-content")).toBeTruthy();
  });

  it("badges a REJECTED row calm on the same evidence", () => {
    // Same closed-status arm, the other outcome. Without it, "approved is calm"
    // could be satisfied by special-casing one word.
    renderCard(proposal({ status: "rejected", base_version: 4 }), {
      liveVersion: 9,
    });
    const badge = screen.getByTestId("proposal-direction");
    expect(badge.textContent ?? "").toMatch(/rejected/i);
    expect(badge.innerHTML).not.toMatch(/\bbg-red-/);
    toggleRow();
    expect(screen.queryByTestId("proposal-stale")).toBeNull();
  });
});

describe("ProposalCard — a proposal decided by its own author", () => {
  it("says so plainly, as information rather than a caution", () => {
    renderCard(
      proposal({
        status: "approved",
        decided_by: "merge-train-steward",
        decided_at: "2026-09-14T09:00:00Z",
        decision_note: "second opinion from a fresh-context subagent",
      })
    );
    toggleRow();
    const line = screen.getByTestId("proposal-decided-by");
    expect(line.textContent ?? "").toMatch(/decided by its author/i);
    expect(line.getAttribute("data-self-decided")).toBe("true");
    // Ownership is no longer a criterion for deciding a proposal, so this is a
    // permitted outcome stated in the provenance line — no alarm chrome, no
    // icon, no colour.
    expect(line.className).not.toMatch(/\b(text|bg|border)-(red|amber)-/);
    expect(line.innerHTML).not.toMatch(/\b(bg|text)-(red|amber)-/);
    expect(line.querySelector("svg")).toBeNull();
    // coord's note travels with the decision rather than being dropped.
    expect(line.textContent ?? "").toMatch(/fresh-context subagent/);
  });

  it("does not claim self-decision when a DIFFERENT actor decided", () => {
    renderCard(
      proposal({
        status: "approved",
        decided_by: "operator:josh@qontinui.io",
        decided_at: "2026-09-14T09:00:00Z",
      })
    );
    toggleRow();
    const line = screen.getByTestId("proposal-decided-by");
    expect(line.getAttribute("data-self-decided")).toBe("false");
    expect(line.textContent ?? "").not.toMatch(/its author/i);
  });

  it("prefers coord's `self_decided` over comparing the two strings", () => {
    // The fixture is DELIBERATELY SYNTHETIC — coord cannot emit it. It derives
    // `self_decided` as exactly `decided_by == proposed_by` with no
    // normalization (`with_derived_self_decided()`), so against today's coord
    // the flag and the comparison can never disagree, and this row's
    // `session:aaaa` / `agent:aaaa` pair carrying `self_decided: true` is a
    // shape no server produces. It is constructed that way on purpose: it is
    // the only way to make the precedence OBSERVABLE, and precedence is what
    // matters — coord's answer is the SERVER's, so a coord that later starts
    // normalizing changes what this page says with no web deploy, while a
    // client-side comparison quietly overruling the flag would not.
    // See `../_lib/authorship.ts` on `selfDecidedOrUnknown`.
    renderCard(
      proposal({
        status: "approved",
        proposed_by: "session:aaaa",
        decided_by: "agent:aaaa",
        self_decided: true,
      })
    );
    toggleRow();
    expect(
      screen.getByTestId("proposal-decided-by").getAttribute("data-self-decided")
    ).toBe("true");
  });

  it("shows no decided line at all while the proposal is pending", () => {
    renderCard(proposal({ status: "pending" }));
    toggleRow();
    expect(screen.queryByTestId("proposal-decided-by")).toBeNull();
  });
});

/**
 * The machine-readable half of the provenance line, and the affordance that
 * must not outlive the decision.
 *
 * Both are the same class of defect as the four above: the page keeps rendering
 * and quietly says something it does not know, or offers something that cannot
 * happen.
 */
describe("ProposalCard — `data-self-decided` keeps UNKNOWN out of `false`", () => {
  it("reports `unknown` when the question is unanswerable", () => {
    // No `self_decided` from coord, and one of the two identities blank — so
    // there is no answer to give. `"false"` here would be an assertion ("coord
    // answered, and somebody else decided it"), which is precisely the
    // absence-is-not-zero conflation the rest of this page works to avoid, left
    // open in the one channel a UI-Bridge or spec-CI check actually reads.
    renderCard(
      proposal({
        status: "approved",
        proposed_by: "   ",
        decided_by: "operator:josh@qontinui.io",
        decided_at: "2026-09-14T09:00:00Z",
      })
    );
    toggleRow();
    const line = screen.getByTestId("proposal-decided-by");
    expect(line.getAttribute("data-self-decided")).toBe("unknown");
    // The rendered TEXT is unchanged by this: it only ever spoke for `true`.
    expect(line.textContent ?? "").not.toMatch(/its author/i);
    expect(screen.queryByTestId("proposal-self-decided")).toBeNull();
  });

  it("still reports a plain `false` when coord answered no", () => {
    // The other side of the distinction — without this, "unknown" could be
    // satisfied by never emitting `false` at all.
    renderCard(
      proposal({
        status: "approved",
        proposed_by: "session:aaaa",
        decided_by: "operator:josh@qontinui.io",
        decided_at: "2026-09-14T09:00:00Z",
      })
    );
    toggleRow();
    expect(
      screen.getByTestId("proposal-decided-by").getAttribute("data-self-decided")
    ).toBe("false");
  });
});

describe("ProposalCard — the decision composer is offered only where a decision is possible", () => {
  it("replaces it with a one-line explanation on a closed row", () => {
    // Defence in depth — coord refuses a decision on a closed proposal
    // server-side and is the authority. But this card already drops the
    // pre-approval staleness warning on a retired row because the action no
    // longer exists; leaving two enabled buttons under that same argument
    // offers the action while the text says it is impossible.
    renderCard(proposal({ status: "stale" }));
    toggleRow();
    // Asserted with the row OPEN — a null means gated, never merely collapsed.
    expect(screen.getByTestId("proposal-closed").textContent ?? "").toMatch(
      /no decision is possible/i
    );
    expect(screen.queryByTestId("proposal-approve")).toBeNull();
    expect(screen.queryByTestId("proposal-reject")).toBeNull();
    expect(screen.queryByTestId("proposal-decision-note")).toBeNull();
  });

  it("still offers it on a pending row", () => {
    // Without this, "gated on closed" could be satisfied by gating everything.
    renderCard(proposal({ status: "pending" }));
    toggleRow();
    expect(screen.getByTestId("proposal-approve")).toBeTruthy();
    expect(screen.getByTestId("proposal-reject")).toBeTruthy();
    expect(screen.queryByTestId("proposal-closed")).toBeNull();
  });
});

/**
 * proposalStatus — the derived state of one pending policy-edit proposal, and
 * R3's audited severity table for it.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 5. `/prompt-document-proposals` landed after that plan was authored and
 * was missing from its census; the §4 correction files it as a Family-B
 * VARIANT — its record wrapper (`ProposalCard`) was a hand-rolled fat card
 * (`space-y-3 rounded-lg border border-border bg-card px-4 py-3.5`), not a
 * shadcn `<Card>`, which is why a `<Card>`-keyed audit missed it.
 *
 * Status derivation lives here, in a pure unit-tested module, rather than
 * inline in JSX (R8) — the same shape `alertStatus.ts` established.
 *
 * ## The R3 correction this module makes, stated plainly
 *
 * The card painted `loosening` amber (`variant="warning"`) and
 * `unclassifiable` RED (`variant="destructive"`). Both are mis-filings by the
 * style guide's own test, and the page's own module doc is the evidence:
 *
 * > ASYNC BY DESIGN. It is a review QUEUE, not a gate: no agent, session, or
 * > merge waits on it. A proposal sitting here means the edit did not happen,
 * > which is the safe state — so an unread queue costs correctness nothing.
 *
 * Amber promises *something else will clear this*; nothing clears an
 * unreviewed proposal. Red claims *act now*; nobody is blocked and the held
 * state is the SAFE one. That is exactly the guide's third case — *a real
 * decision that is not blocking anyone* — whose rule is: **it is calm, and the
 * ask goes in the row detail, in words.** The words are already there: every
 * direction carries a full `explanation` sentence, which the detail renders
 * verbatim.
 *
 * `unclassifiable` in particular was red because the WORD is alarming, which
 * is the precise failure `statusRow.tsx` opens by naming: *colour encodes who
 * has to do something, not how alarming the word sounds*.
 *
 * ## What IS loud, and why it earns it
 *
 * **Staleness.** A proposal decays: the target document can move underneath
 * it, and then the wording the edit assumed is no longer deployed. That is a
 * waiting promise whose premise expired — the same shape the merge pipeline
 * files as `conflict-stranded` / `needs-rebase-stale`, and it files the same
 * way. Nothing but a human re-reading the current document resolves it, and
 * approving a stale proposal applies an edit against wording that is gone.
 *
 * Staleness is a KIND here rather than a per-row escalation on top of the
 * direction, deliberately: `escalateAttention` would leave a red left edge
 * beside a calm badge, so the row would say two things at once. One badge, one
 * claim.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
} from "@/components/console/statusRow";
import { DIRECTION_META } from "./types";
import type { PromptDocumentProposal } from "./types";

/**
 * The vocabulary the ROW renders. Not the same as coord's `direction` union:
 * it adds `stale` (a state of the proposal, not of the edit) and
 * `unrecognised` (a direction token this build predates).
 */
export type ProposalKind =
  | "loosening"
  | "unclassifiable"
  | "stale"
  | "unrecognised";

/**
 * The audited kind → attention table. TOTAL over {@link ProposalKind}, one
 * documented row each:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `loosening` | `none` | The edit did NOT land; held is the safe state, nothing is blocked, nothing decays. A real decision that is not blocking anyone — calm, with the ask in words (the guide's third case). |
 * | `unclassifiable` | `none` | Same. It reads more alarming and is not: coord already refused to apply it. Colour encodes who must act, not how alarming the word sounds. |
 * | `stale` | `author` | The target document moved, so the wording this edit assumed is not what is deployed. Nothing but a human re-reading the current document resolves that, and approving it anyway applies an edit against text that is gone. |
 * | `unrecognised` | `waiting` | A `direction` token this build has no meaning for. R3's ignorance floor — only a human extending the vocabulary clears it, and painting ignorance calm is `silent-empty-is-unknown` with a badge attached. |
 */
export const PROPOSAL_ATTENTION_BY_KIND: Record<ProposalKind, Attention> = {
  loosening: "none",
  unclassifiable: "none",
  stale: "author",
  unrecognised: "waiting",
};

export const PROPOSAL_KIND_CLASS: Record<ProposalKind, string> = {
  loosening: INERT,
  // Calm, but visibly provisional — the same dashed "we could not settle this"
  // treatment `draft` uses. It is not the ignorance floor: coord DID reach a
  // verdict ("cannot be classified") and acted on it by holding the edit.
  unclassifiable: "bg-transparent text-muted-foreground border-border border-dashed",
  stale: AUTHOR_RED,
  unrecognised: UNKNOWN_AMBER,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds, derived. */
export const PROPOSAL_AUTHOR_GLYPH_KINDS: ReadonlySet<ProposalKind> = new Set(
  (Object.keys(PROPOSAL_ATTENTION_BY_KIND) as ProposalKind[]).filter(
    (k) => PROPOSAL_ATTENTION_BY_KIND[k] === "author"
  )
);

export const PROPOSAL_STATUS_PALETTE: StatusPalette<ProposalKind> = {
  badgeClass: PROPOSAL_KIND_CLASS,
  authorGlyphKinds: PROPOSAL_AUTHOR_GLYPH_KINDS,
};

/**
 * The row's status.
 *
 * `stale` DOMINATES the direction: once the document has moved, what the
 * comparator decided about the old wording is no longer the operative fact —
 * the direction is still shown in the detail, where it can be read alongside
 * the staleness warning.
 *
 * `liveVersion === null` is UNKNOWN, never "up to date": a document version we
 * could not read cannot prove a proposal is fresh, so staleness is only
 * asserted when we actually have the live number.
 */
export function deriveProposalStatus(
  proposal: Pick<PromptDocumentProposal, "direction" | "base_version">,
  liveVersion: number | null
): RowStatus<ProposalKind> {
  if (liveVersion !== null && liveVersion > proposal.base_version) {
    return {
      kind: "stale",
      label: "stale",
      reason: `the document moved to v${liveVersion} since this was written against v${proposal.base_version}`,
      attention: PROPOSAL_ATTENTION_BY_KIND.stale,
    };
  }
  const meta = DIRECTION_META[proposal.direction];
  if (!meta) {
    return {
      kind: "unrecognised",
      label: proposal.direction,
      reason:
        "a direction this build does not recognise — treat it as at least as serious as a loosening edit",
      attention: PROPOSAL_ATTENTION_BY_KIND.unrecognised,
    };
  }
  const kind: ProposalKind =
    proposal.direction === "unclassifiable" ? "unclassifiable" : "loosening";
  return {
    kind,
    label: meta.label.toLowerCase(),
    reason: "held rather than applied — nothing is waiting on this",
    attention: PROPOSAL_ATTENTION_BY_KIND[kind],
  };
}

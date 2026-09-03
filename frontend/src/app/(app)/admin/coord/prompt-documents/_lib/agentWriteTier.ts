/**
 * The agent authorship TIER vocabulary, in the operator's words — one copy,
 * shared by the two controls on this page that set it.
 *
 * ## Why this is a module and not two local helpers
 *
 * The page carries two tier controls: `KindAuthorshipTierControl` sets the tier
 * on a KIND, `AgentWriteAccessControl` sets it on a document ROW. They resolve
 * through the same coord vocabulary (`AGENT_WRITE_TIERS` in `../types`, a wire
 * contract with coord's `AgentWriteTier::as_str`) and they have to describe it
 * the same way — an operator who reads "allow" as one thing on one control and
 * another thing three inches below it cannot predict either.
 *
 * Two spellings of these semantics is not a hypothetical: it is exactly how the
 * per-document BADGE came to read coord's three-state tier while the per-
 * document TOGGLE went on writing a boolean, so an operator who selected the
 * notification tier on `initiative` and `success_metric` got plain `allow` and
 * agent writes landed unannounced (measured on the Portofino tenant
 * 2026-09-03). The fix put the third state on the control; this module is what
 * stops the prose forking again.
 *
 * ## Why the help text takes a SUBJECT rather than being generic
 *
 * The two surfaces are not describing the same act. A kind tier reaches names
 * that do not exist yet — that reach is the whole reason the control exists,
 * and it is the sentence an operator most needs before opening a kind. A
 * document tier reaches one row that already exists, and saying "including
 * names that do not exist yet" there would be false. So the wording branches on
 * the subject, and both branches live here: changing what a tier MEANS is one
 * edit to one file, which is the property that matters, without pretending one
 * paragraph fits two different acts.
 */

import type { AgentWriteTier } from "../types";

/**
 * The display spelling of a tier.
 *
 * The underscores are coord's, not a label choice — `types.ts` records that
 * these strings are a wire contract and renaming one here does not rename it
 * there. So the tier is shown under its own name with the underscores relaxed,
 * never translated into a friendlier word that would stop matching what coord's
 * errors, logs and API responses call it.
 */
export function tierLabel(tier: AgentWriteTier): string {
  return tier.replace(/_/g, " ");
}

/** Which control is asking — the two acts a tier can describe. */
export type TierSubject = "kind" | "document";

/**
 * Is the `allow_with_notification` precondition ENFORCED by the coord that
 * answered?
 *
 * `null` is a first-class answer and the common one on the document surface:
 * coord ships `notification_enforced` on the per-KIND response and nowhere on
 * the document one, so a control on a document row has no source for the claim
 * and must not make it in either direction. It points at the control that does
 * report it instead.
 */
export type NotifyEnforcement = boolean | null;

/**
 * What choosing this tier does, in the operator's terms.
 *
 * `allow_with_notification` is a FUNCTION of what coord reports, not a
 * constant: its meaning changed under this console when coord#1702 shipped the
 * precondition, and a hardcoded "NOT YET ENFORCED" went on asserting the old
 * world against a notice that no longer rendered. A local constant describing a
 * server behaviour is a copy that cannot follow the server; taking the flag as
 * an argument is what makes it follow — and admitting `null` is what keeps the
 * surface that cannot read the flag from inventing an answer.
 */
export function tierHelp(
  tier: AgentWriteTier,
  {
    subject,
    notifyEnforced,
  }: { subject: TierSubject; notifyEnforced: NotifyEnforcement }
): string {
  if (subject === "kind") {
    switch (tier) {
      case "deny":
        return "Agents may not author documents of this kind. Coord refuses the write and names the remedy.";
      case "allow":
        return "Agents may author documents of this kind, including names that do not exist yet. Every write is versioned and attributed.";
      case "allow_with_notification":
        return notifyEnforced === true
          ? "Agents may author documents of this kind, but only with a notification reference: coord refuses the write unless it names a recent finding the same session posted about the document."
          : "Intended: agents may author, but only with a notification reference. NOT ENFORCED by the coord this console is talking to — it behaves as `allow`.";
    }
  }
  switch (tier) {
    case "deny":
      return "Protect this document from agent writes. Coord refuses the write and names the remedy.";
    case "allow":
      return "Allow agents to write this document. Every write is versioned and attributed.";
    case "allow_with_notification":
      // Three arms, because the document surface genuinely has three states of
      // knowledge about the precondition and only one of them is a claim it may
      // make on its own authority.
      if (notifyEnforced === true) {
        return "Allow agents to write this document, but only with a notification reference: coord refuses the write unless it names a recent finding the same session posted about the document.";
      }
      if (notifyEnforced === false) {
        return "Intended: agents may write it, but only with a notification reference. NOT ENFORCED by the coord this console is talking to — it behaves as `allow`.";
      }
      return "Allow agents to write this document, with the write intended to carry a notification reference. Whether the deployed coord enforces that precondition is stated by the “Agent authorship by kind” control below — this control does not claim it either way.";
  }
}

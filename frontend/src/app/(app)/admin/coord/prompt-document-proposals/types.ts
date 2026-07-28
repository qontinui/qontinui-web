/**
 * Policy-edit proposals + the landed-write feed (plan
 * `2026-07-28-migrate-claude-md-into-qontinui.md`, Phase 5) — shared types.
 *
 * ## What a proposal is
 *
 * coord's `coord_write_prompt_document` MCP tool lets agents edit the policy
 * documents coord serves the fleet. Phase 5 adds a *direction* comparator on the
 * write path. Autonomy tiers are ordered strictest → loosest:
 *
 *   `never` > `ask-first` > `proceed+notify` > `proceed+log` > `proceed`
 *
 * Additive clauses and tier-RAISING edits land immediately (they appear in the
 * landed-write feed). An edit that LOWERS a clause's tier or widens authority —
 * and, fail-closed, any edit the comparator cannot classify — does NOT land: it
 * is re-routed into `coord.prompt_document_proposals` (web migration
 * `prompt_doc_proposals_01`) as a PENDING proposal for operator review.
 *
 * So `direction` only ever takes two values here. `tightening` proposals do not
 * exist by construction — a tightening edit is already in the document.
 *
 * ## Review queue, not gate
 *
 * Nothing in the fleet blocks on an operator reading this. A pending proposal
 * means "this edit did not land"; leaving it pending is a safe steady state, not
 * an outage. That is the whole point — the bottleneck this page exists to
 * remove.
 */

/** The two verdicts that produce a proposal (coord-side Rust vocabulary). */
export type ProposalDirection = "loosening" | "unclassifiable";

/** Lifecycle of a proposal (`coord.prompt_document_proposals.status`). */
export type ProposalStatus = "pending" | "approved" | "rejected";

/**
 * Autonomy tier, strictest → loosest. Mirrors `ClauseTier` in the sibling
 * prompt-documents page; re-declared rather than imported so this route stays
 * independent of that one's module graph.
 */
export type ProposalTier =
  | "never"
  | "ask-first"
  | "proceed+notify"
  | "proceed+log"
  | "proceed";

/** Plain-language gloss per tier, shown beside the from → to arrow. */
export const TIER_DESCRIPTIONS: Record<ProposalTier, string> = {
  never: "Agents never do this — it's left entirely to you.",
  "ask-first": "Agents check with you first, and act only once you approve.",
  "proceed+notify": "Agents act on their own, then tell you.",
  "proceed+log": "Agents act on their own, and record what they did.",
  proceed: "Agents act on their own.",
};

/** What each direction means, in the operator's words. */
export const DIRECTION_META: Record<
  ProposalDirection,
  { label: string; variant: "warning" | "destructive"; explanation: string }
> = {
  loosening: {
    label: "Loosening",
    variant: "warning",
    explanation:
      "This edit would give agents more latitude than the clause allows today, so it was held for you instead of landing.",
  },
  unclassifiable: {
    label: "Unclassifiable",
    variant: "destructive",
    explanation:
      "The comparator could not tell whether this edit tightens or loosens the clause. Unknown counts as loosening — it was held rather than guessed.",
  },
};

/** One `coord.prompt_document_proposals` row, as the coord route returns it. */
export interface PromptDocumentProposal {
  id: string;
  /** Target document address — `(doc_kind, doc_name)`. */
  doc_kind: string;
  doc_name: string;
  /** The clause being altered; `null` when the edit targets the whole document. */
  clause_id: string | null;
  proposed_content: string;
  direction: ProposalDirection;
  from_tier: ProposalTier | null;
  to_tier: ProposalTier | null;
  /** The change note the authoring agent supplied. */
  rationale: string;
  /** Authenticated author identity — stamped by coord, never client-supplied. */
  proposed_by: string;
  /**
   * The document `current_version` this edit was authored against. When it
   * trails the document's live version, the document moved underneath the
   * proposal and the diff it assumed no longer holds — the page warns rather
   * than letting a stale edit be approved unknowingly.
   */
  base_version: number;
  status: ProposalStatus;
  created_at: string;
}

/**
 * `GET /api/v1/operations/coord/prompt-document-proposals` response.
 *
 * `unavailable` is the web tier's honest note that coord could not be asked —
 * chiefly the deploy window before coord's Phase 5 half ships, when the route
 * 404s. Present ⇒ the empty list means "cannot see", NOT "no proposals", and the
 * page says exactly that instead of rendering a reassuring empty queue.
 */
export interface ListProposalsResponse {
  proposals: PromptDocumentProposal[];
  total: number;
  unavailable?: string;
  /**
   * Why it could not be read. `not_deployed` is the expected, benign window
   * before coord's Phase 5 half ships; `unreachable` means coord is actually
   * failing and must not be shown in the calmest style on the page.
   */
  unavailable_kind?: UnavailableKind;
}

/** Severity axis for an unreadable coord surface. */
export type UnavailableKind = "not_deployed" | "unreachable";

/**
 * Whether an unreadable surface should be shown as alarming (amber) or merely
 * informational (muted).
 *
 * The default matters and differs PER SURFACE, so it is an explicit argument
 * rather than an accident of comparison direction:
 *
 * * The proposals queue defaults to NOT severe. Its whole reason for existing
 *   is coord's pre-deploy 404 window, and Vercel + ECS deploy independently —
 *   "new frontend, older backend that does not send `unavailable_kind` yet" is
 *   a routine window, and shouting in it is the exact false alarm this field
 *   was added to prevent.
 * * The write feed defaults to severe. Its underlying document-list route ships
 *   in today's coord, so any failure there means coord genuinely is not
 *   answering.
 */
export function isUnavailableSevere(
  kind: UnavailableKind | null | undefined,
  fallback: boolean
): boolean {
  if (kind === "not_deployed") return false;
  if (kind === "unreachable") return true;
  return fallback;
}

/** One landed write — a version snapshot, addressed back to its document. */
export interface PromptDocumentWrite {
  kind: string;
  name: string;
  /** The document's description, falling back to its slug. */
  label: string;
  version_number: number;
  /** The change note recorded at edit time. */
  change_note: string | null;
  edited_by: string | null;
  created_at: string;
  /** The document's live version — `version_number === current_version` ⇒ head. */
  current_version: number;
}

/**
 * `GET /api/v1/operations/coord/prompt-document-writes` response.
 *
 * Five INDEPENDENT caveats, never flattened into one and never mutually
 * exclusive — `degraded` and `partial` routinely co-occur, so the page shows
 * every one that is set rather than picking a winner:
 *
 * * `unavailable` — coord could not be asked at all.
 * * `degraded`    — coord answered, but its document store is unprovisioned.
 * * `partial`     — some documents did not return their history.
 * * `truncated`   — more documents exist than the fan-out ceiling reads.
 * * `limited`     — more writes were collected than `limit` returned.
 *
 * Each one means something is missing from the feed. Every path that drops a
 * write sets one of them; none drops quietly.
 */
export interface ListWritesResponse {
  writes: PromptDocumentWrite[];
  total: number;
  unavailable?: string;
  unavailable_kind?: UnavailableKind;
  degraded?: string;
  partial?: string;
  truncated?: string;
  /** More writes exist than `limit` returned — the slice, said out loud. */
  limited?: string;
}

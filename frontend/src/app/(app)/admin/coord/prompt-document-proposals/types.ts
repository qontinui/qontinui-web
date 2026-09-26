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
 * and, fail-closed, any edit the comparator cannot classify — is re-routed into
 * `coord.prompt_document_proposals` (web migration `prompt_doc_proposals_01`)
 * as a PENDING proposal for operator review.
 *
 * **Which of those actually get held is the tenant's `policy_write` dial, not a
 * constant.** At the shipped default a classified loosening becomes a proposal;
 * at `full` it LANDS instead, announced rather than held (plan
 * `2026-08-27-tenant-level-agent-authorable-stores.md`). So the landed-write
 * feed must not describe itself as "only the safe direction" — it describes
 * what landed, and `PromptDocumentWrite.loosening` is where the direction of a
 * landed write is said out loud.
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
export type PolicyProposalDirection = "loosening" | "unclassifiable";

/**
 * Lifecycle of a proposal (`coord.prompt_document_proposals.status`).
 *
 * `stale` is TERMINAL and is coord's, not this page's. coord retires a pending
 * proposal inside the same transaction that bumps its target document's version
 * (plan
 * `2026-09-13-policy-proposals-agent-decidable-dial-driven-self-retiring`,
 * Phase 1): the row is stamped `status='stale'`,
 * `decided_by='system:proposal-staleness'`, and a `decision_note` saying which
 * version it moved to. Nothing can approve it afterwards.
 *
 * Distinguish it from the CLIENT-side `stale` kind in `./policyProposalStatus.ts`,
 * which covers the race window — a pending row this page has not re-read since
 * the document moved. Same word, two layers: that one is a warning on a live
 * row, this one is a closed record.
 *
 * A coord build predating Phase 1 never emits it, and rejects `?status=stale`
 * with `400 invalid status` — which the hook treats as "section unavailable",
 * never as an error or as an empty section.
 */
export type PolicyProposalStatus = "pending" | "approved" | "rejected" | "stale";

/**
 * Autonomy tier, strictest → loosest. Mirrors `ClauseTier` in the sibling
 * prompt-documents page; re-declared rather than imported so this route stays
 * independent of that one's module graph.
 */
export type PolicyProposalTier =
  | "never"
  | "ask-first"
  | "proceed+notify"
  | "proceed+log"
  | "proceed";

/** Plain-language gloss per tier, shown beside the from → to arrow. */
export const TIER_DESCRIPTIONS: Record<PolicyProposalTier, string> = {
  never: "Agents never do this — it's left entirely to you.",
  "ask-first": "Agents check with you first, and act only once you approve.",
  "proceed+notify": "Agents act on their own, then tell you.",
  "proceed+log": "Agents act on their own, and record what they did.",
  proceed: "Agents act on their own.",
};

/** What each direction means, in the operator's words. */
export const DIRECTION_META: Record<
  PolicyProposalDirection,
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
  direction: PolicyProposalDirection;
  from_tier: PolicyProposalTier | null;
  to_tier: PolicyProposalTier | null;
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
  status: PolicyProposalStatus;
  created_at: string;
  /**
   * **OPTIONAL — absent means "this coord build does not report it", never
   * "nobody decided it".** Coord's actor label for whoever decided the
   * proposal, stamped server-side. Three producers matter here:
   * `operator:<email>` (the console), an agent spelling
   * (`session:`/`agent:`/`device:`) now that ownership is no longer a criterion
   * for deciding, and `system:proposal-staleness` for a self-retirement.
   * `_lib/authorship.ts` is the only place that decides what one means — and it
   * already files the `system:` spelling as `system`, not as an agent.
   */
  decided_by?: string | null;
  /** When the decision was recorded. Absent on a pending row. */
  decided_at?: string | null;
  /**
   * The note recorded with the decision. For a self-retirement coord writes the
   * explanation of the move here, which is what the retired section shows
   * instead of leaving a row that merely vanished from the queue.
   */
  decision_note?: string | null;
  /**
   * **OPTIONAL, and PREFERRED over comparing strings when present.** Coord's
   * own answer to "did the proposer decide this?" — true once ownership stopped
   * being a criterion for deciding and an agent could approve or reject its own
   * proposal. A build that predates the flag omits it, and the page then falls
   * back to `decided_by === proposed_by` (`_lib/authorship.ts`
   * `isSelfDecided`).
   *
   * The preference is NOT because the server knows something the comparison
   * cannot see: coord derives this field as exactly `decided_by == proposed_by`
   * with no normalization (`with_derived_self_decided()`), so on today's builds
   * the two agree by construction. It is preferred because it is coord's
   * ANSWER: the console should report the server's verdict rather than compute
   * a second one that drifts independently, and a future coord that does start
   * normalizing (one principal reaching it under two spellings) changes what
   * this page says without a web deploy.
   *
   * This is INFORMATION, not a warning: the fleet removed ownership as a
   * decision criterion deliberately, so the page states the fact plainly and
   * never paints it as a caution.
   */
  self_decided?: boolean | null;
}

/**
 * `GET /api/v1/operations/coord/prompt-document-proposals` response.
 *
 * `unavailable` is the web tier's honest note that coord could not be asked —
 * chiefly the deploy window before coord's Phase 5 half ships, when the route
 * 404s. Present ⇒ the empty list means "cannot see", NOT "no proposals", and the
 * page says exactly that instead of rendering a reassuring empty queue.
 */
export interface ListPolicyProposalsResponse {
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
  /**
   * Coord's actor label for whoever wrote this version, stamped server-side.
   * Several producers, several shapes — see `_lib/authorship.ts`, which is the
   * only place that decides what one means.
   */
  edited_by: string | null;
  created_at: string;
  /** The document's live version — `version_number === current_version` ⇒ head. */
  current_version: number;
  /**
   * **OPTIONAL — may be absent, and absent is not `false`.** Coord's direction
   * verdict for a write that LANDED: `true` when the edit granted or widened
   * authority (plan `2026-08-27-tenant-level-agent-authorable-stores.md`,
   * Phase 3, reachable once the tenant's `policy_write` dial is `full`).
   *
   * A coord build that predates that classification omits the field entirely.
   * The page must therefore treat `undefined` as "this server does not
   * classify landed writes" — an unmarked ordinary row — and never as an
   * authoritative "not a loosening". Only `true` marks and promotes a row; see
   * `_lib/writes.ts`.
   */
  loosening?: boolean | null;
  /**
   * **OPTIONAL — absent means no link, not a broken one.** The reference coord
   * carries from the write call into the emitted notification's payload, so a
   * row reaches the author's stated reasoning in one click instead of the
   * operator correlating two surfaces by timestamp (Phase 2).
   *
   * Served by the same not-yet-landed coord change as `loosening`.
   */
  notification_ref?: string | null;
  /**
   * **OPTIONAL — DOCUMENT state, not this version's.** `true` when the
   * document this write belongs to is currently withdrawn — a
   * `decision_record` whose frontmatter `status` is `withdrawn` (plan
   * `2026-09-13-decision-records-are-agent-writable-but-policy-says-they-are-not`,
   * §7 3.1). Carried from coord's document row as `withdrawn`, renamed by the
   * web proxy so a v1 row does not read as "this version was withdrawn" when a
   * later version is what withdrew it.
   *
   * A coord build that predates withdrawal omits it. Absent is UNKNOWN, never
   * "live": the page marks only an explicit `true` and asserts nothing
   * otherwise.
   */
  document_withdrawn?: boolean | null;
  /** The reason recorded with the withdrawal, when coord served one. */
  document_withdrawn_reason?: string | null;
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

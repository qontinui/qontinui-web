/**
 * Who wrote a landed prompt-document version — the predicate behind the
 * "agent-authored" filter (plan
 * `2026-08-27-tenant-level-agent-authorable-stores.md`, Phase 4).
 *
 * ## Why this is an ALLOWLIST and not "anything that isn't an operator"
 *
 * `edited_by` is coord's actor label, stamped server-side and never
 * client-supplied. It has several producers and they do NOT share a shape:
 *
 * | producer | spelling | class |
 * |---|---|---|
 * | `mcp::tools::authorship_actor` (the agent write tool) | `session:<uuid>`, `agent:<uuid>`, `device:<uuid>`, `agent:unattributed` | agent |
 * | `session_compliance::operator_actor` (every operator PATCH/restore) | `operator:<uuid>:<email>` | operator |
 * | `policy_proposals::decide` | `operator:<email>` — TWO segments | operator |
 * | the shipped seed | `system:seed` | neither |
 * | pre-`operator_actor` history | a bare email, e.g. `josh@qontinui.io` | UNKNOWN |
 *
 * That last row is the one that decides the design. It is not hypothetical:
 * `policy/escalation-bar` on this tenant carries `updated_by:
 * "josh@qontinui.io"` — an operator edit written before coord prefixed its
 * actor labels at all. A predicate spelled "agent-authored = does not start
 * with `operator:`" files that row under AGENTS, which is precisely the
 * misattribution this feed exists to prevent.
 *
 * So the rule is a positive allowlist over the three agent prefixes, matching
 * coord's own `notifications::human_identity` (`notifications.rs:504-517`),
 * which maps `operator:` → "an operator" and `device:` / `agent:` / `session:`
 * → a device / an agent / a session. Everything the allowlist does not name is
 * `system` (the seed) or `unknown` — never silently folded into either side.
 *
 * The web proxy that serves this feed states the same caution from the other
 * direction: it returns writes unfiltered "deliberately no 'agent writes only'
 * filter … filtering on a guessed prefix would silently hide writes"
 * (`backend/app/api/v1/endpoints/operations.py`, `list_prompt_document_writes`).
 * That reasoning is honoured rather than overridden: the filter lives on the
 * CLIENT over rows already on screen, it is off by default, and when it is on
 * the feed says how many rows it is hiding and in which class — so a hidden
 * write is always a counted write.
 */

import type { PromptDocumentWrite } from "../types";

/**
 * What kind of actor wrote a version.
 *
 * `unknown` is a real answer, not an error: an unrecognised label means coord
 * stamped a spelling this predicate has not been taught, and saying so beats
 * guessing a side.
 */
export type WriteAuthorClass = "agent" | "operator" | "system" | "unknown";

/**
 * The agent prefixes, most- to least-specific, exactly as
 * `mcp::tools::authorship_actor` emits them. `agent:unattributed` is covered by
 * `agent:` — an agent write coord could not attribute to a session or device is
 * still an agent write.
 */
const AGENT_PREFIXES = ["session:", "agent:", "device:"] as const;

/** Operator spellings — both the three-segment and the two-segment producer. */
const OPERATOR_PREFIX = "operator:";

/** The shipped defaults coord seeds a tenant with. Nobody authored these. */
const SYSTEM_PREFIX = "system:";

/** Classify one actor label. Absent/blank ⇒ `unknown`, never `agent`. */
export function classifyWriteAuthor(
  editedBy: string | null | undefined
): WriteAuthorClass {
  const actor = (editedBy ?? "").trim();
  if (!actor) return "unknown";
  if (AGENT_PREFIXES.some((p) => actor.startsWith(p))) return "agent";
  if (actor.startsWith(OPERATOR_PREFIX)) return "operator";
  if (actor.startsWith(SYSTEM_PREFIX)) return "system";
  return "unknown";
}

/** True only for a label the allowlist positively recognises as an agent. */
export function isAgentAuthored(
  write: Pick<PromptDocumentWrite, "edited_by">
): boolean {
  return classifyWriteAuthor(write.edited_by) === "agent";
}

/** How many rows fall in each class — the numbers the hidden-rows note quotes. */
export interface AuthorTally {
  agent: number;
  operator: number;
  system: number;
  unknown: number;
}

export function tallyAuthors(
  writes: ReadonlyArray<Pick<PromptDocumentWrite, "edited_by">>
): AuthorTally {
  const tally: AuthorTally = { agent: 0, operator: 0, system: 0, unknown: 0 };
  for (const write of writes) tally[classifyWriteAuthor(write.edited_by)] += 1;
  return tally;
}

/**
 * A short human label for one actor, for the row's author line.
 *
 * The raw label is kept alongside rather than replaced — the UUID in it is what
 * an operator pastes into a coord query, and the collapsed row is the only
 * place this feed shows an author at all.
 */
export const AUTHOR_CLASS_LABEL: Record<WriteAuthorClass, string> = {
  agent: "agent",
  operator: "you",
  system: "coord's shipped default",
  unknown: "unrecognised author",
};

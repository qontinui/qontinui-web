/**
 * POLICY_GAP envelope parsing for the Gaps review surface.
 *
 * Plan `2026-07-18-policy-clause-schema-web-data-model.md` Phase 3.
 *
 * When an agent reports a policy gap via `coord_ask_question(policy_gap=…)`,
 * coord stores the gap on the EXISTING `agent_questions.context` TEXT column
 * (no new `coord.*` column — coord authors zero coord.* DDL). The column is
 * prefixed with the marker below, followed by a JSON envelope:
 *
 *   POLICY_GAP {"policy_gap":{category,proposed_clause,tier_applied},"context":<orig|null>}
 *
 * Blocking gaps land in the pending inbox (unanswered); non-blocking gaps
 * (a category-default tier was applied) are written PRE-ANSWERED, so they land
 * in the answered inbox. The Gaps tab unions both and filters on this marker.
 *
 * Kept in lockstep with coord's `POLICY_GAP_CONTEXT_MARKER` /
 * `encode_gap_context` in `qontinui-coord/src/agent_questions.rs`.
 */

import type { AgentQuestionRow } from "@/components/admin/coord/QuestionCard";

/** Must match coord's `POLICY_GAP_CONTEXT_MARKER` (trailing space included). */
export const POLICY_GAP_CONTEXT_MARKER = "POLICY_GAP ";

/**
 * The proposed clause an agent attaches to a gap. Mirrors coord's
 * `CreateClauseRequest` (all fields optional except the caller must supply a
 * kebab-case `clause_id` for coord to accept the insert). Extra keys are
 * tolerated and forwarded verbatim.
 */
export interface ProposedClause {
  clause_id?: string;
  category?: string;
  status?: string;
  tier?: string | null;
  trigger?: string | null;
  action?: string | null;
  bounds?: string | null;
  escalate_if?: string | null;
  anti_triggers?: string[];
  depends_on?: string[];
  links?: string[];
  position?: number;
  [key: string]: unknown;
}

/** The `policy_gap` payload carried on a gap-marked question. */
export interface PolicyGap {
  category?: string;
  proposed_clause?: ProposedClause;
  tier_applied?: string | null;
}

/** Decoded gap envelope: the gap payload + any original free-text context. */
export interface ParsedGap {
  gap: PolicyGap;
  originalContext: string | null;
}

/** True when a question row carries a POLICY_GAP marker on its `context`. */
export function isGapQuestion(q: Pick<AgentQuestionRow, "context">): boolean {
  return (
    typeof q.context === "string" &&
    q.context.startsWith(POLICY_GAP_CONTEXT_MARKER)
  );
}

/**
 * Decode a gap-marked `context` into `{ gap, originalContext }`, or `null` when
 * the column is absent / lacks the marker / holds malformed JSON. Never throws.
 */
export function parseGapContext(
  context?: string | null
): ParsedGap | null {
  if (!context || !context.startsWith(POLICY_GAP_CONTEXT_MARKER)) return null;
  const raw = context.slice(POLICY_GAP_CONTEXT_MARKER.length);
  try {
    const env = JSON.parse(raw) as {
      policy_gap?: PolicyGap;
      context?: string | null;
    };
    return {
      gap: env.policy_gap ?? {},
      originalContext: env.context ?? null,
    };
  } catch {
    return null;
  }
}

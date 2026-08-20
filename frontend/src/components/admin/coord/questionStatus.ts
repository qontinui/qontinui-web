/**
 * questionStatus — pure status derivation for `coord.agent_questions` rows.
 *
 * Extracted from `QuestionCard.tsx` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 1,
 * following the shape `alertStatus.ts` established: **status derivation lives
 * in a pure, unit-tested module** (R8), never inline in JSX.
 *
 * One kind union covers BOTH lists on `/admin/coord/questions` — the inbox and
 * the policy-gap queue — because they are the same coord table read two ways,
 * and giving each its own vocabulary is how two surfaces that must agree start
 * disagreeing. `questionStatus.test.ts` audits the palette against
 * {@link QUESTION_ATTENTION_BY_KIND} with the shared `paletteDisagreements`.
 *
 * ## Why `pending` is red
 *
 * An unanswered agent question is an agent that has STOPPED. Nothing
 * downstream clears it — no retry, no timeout, no other process — only the
 * operator reading this page. That is the definition of `author` under R3, and
 * it is why the inbox is the one coord list where a non-empty page is itself
 * the alarm.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  WAITING_AMBER,
} from "@/components/console/statusRow";

export interface AgentQuestionOption {
  value?: string;
  label?: string;
  description?: string;
}

export interface AgentQuestionRow {
  question_id: string;
  agent_id?: string | null;
  agent_session_id?: string | null;
  device_id?: string | null;
  plan_phase?: string | null;
  question: string;
  // `options` is JSONB on the coord side — tolerate both shapes
  // (array of objects with {value,label} OR array of bare strings).
  options?: AgentQuestionOption[] | string[] | null;
  context?: string | null;
  created_at?: string;
  responded_at?: string | null;
  response?: string | null;
  responded_by_operator?: string | null;
}

/**
 * The derived vocabulary for both lists on the route.
 *
 * `gap-blocking` / `gap-handled` are the policy-gap queue's two states: a
 * blocking gap is an unanswered question (the agent is stopped on it), while a
 * non-blocking one arrives PRE-ANSWERED because coord recorded the
 * category-default inline. The second still wants a human eye — accepting or
 * dismissing the proposed clause is a real decision — it just is not blocking
 * anyone right now.
 */
export type QuestionKind =
  | "pending"
  | "answered"
  | "gap-blocking"
  | "gap-handled";

/** The audited kind → attention table. TOTAL over {@link QuestionKind}. */
export const QUESTION_ATTENTION_BY_KIND: Record<QuestionKind, Attention> = {
  pending: "author",
  "gap-blocking": "author",
  "gap-handled": "waiting",
  answered: "none",
};

export const QUESTION_BADGE_CLASS: Record<QuestionKind, string> = {
  pending: AUTHOR_RED,
  "gap-blocking": AUTHOR_RED,
  "gap-handled": WAITING_AMBER,
  answered: "bg-green-500/5 text-green-300 border-green-500/25",
};

/** Red ⇔ ✕: exactly the kinds whose declared attention is `author`. */
export const QUESTION_AUTHOR_GLYPH_KINDS: ReadonlySet<QuestionKind> = new Set(
  (Object.keys(QUESTION_ATTENTION_BY_KIND) as QuestionKind[]).filter(
    (k) => QUESTION_ATTENTION_BY_KIND[k] === "author"
  )
);

export const QUESTION_STATUS_PALETTE: StatusPalette<QuestionKind> = {
  badgeClass: QUESTION_BADGE_CLASS,
  authorGlyphKinds: QUESTION_AUTHOR_GLYPH_KINDS,
  doneGlyphKinds: new Set<QuestionKind>(["answered"]),
};

const LABEL_BY_KIND: Record<QuestionKind, string> = {
  pending: "pending",
  answered: "answered",
  "gap-blocking": "blocking gap",
  "gap-handled": "pre-answered gap",
};

/** The inbox row's status: answered iff coord recorded a response time. */
export function deriveQuestionStatus(
  q: Pick<AgentQuestionRow, "responded_at" | "response" | "plan_phase">
): RowStatus<QuestionKind> {
  const kind: QuestionKind = q.responded_at ? "answered" : "pending";
  return {
    kind,
    label: LABEL_BY_KIND[kind],
    reason:
      kind === "answered"
        ? q.response
          ? truncate(q.response, 90)
          : "answered, no text recorded"
        : q.plan_phase
          ? `blocked at ${q.plan_phase}`
          : "an agent is waiting on this",
    attention: QUESTION_ATTENTION_BY_KIND[kind],
  };
}

/** The policy-gap row's status. Same table, the gap half of it. */
export function deriveGapStatus(
  q: Pick<AgentQuestionRow, "responded_at">,
  category?: string | null
): RowStatus<QuestionKind> {
  const kind: QuestionKind = q.responded_at ? "gap-handled" : "gap-blocking";
  return {
    kind,
    label: LABEL_BY_KIND[kind],
    reason:
      kind === "gap-blocking"
        ? `no policy clause covers this${category ? ` in ${category}` : ""}`
        : "coord applied the category default; the clause still wants a review",
    attention: QUESTION_ATTENTION_BY_KIND[kind],
  };
}

/**
 * Format a timestamp as a short relative span (e.g. "3m", "2h", "5d").
 * Falls back to the raw ISO if parsing fails — never throws.
 *
 * Lives here rather than in a card component (its previous home) so the four
 * modules that import it do not depend on a rendering.
 */
export function formatRelative(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const m = Math.round(deltaSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function truncate(s: string, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

/** The mono identity chip: the agent's short id, or an explicit unknown. */
export function questionIdentity(q: AgentQuestionRow): string {
  return q.agent_id ? q.agent_id.slice(0, 8) : "(unknown)";
}

/** Normalise coord's two `options` shapes into one list of labels. */
export function optionLabels(q: AgentQuestionRow): string[] {
  const raw = q.options;
  if (!raw || !Array.isArray(raw)) return [];
  return (raw as (AgentQuestionOption | string)[])
    .map((o) =>
      typeof o === "string" ? o : (o.label ?? o.value ?? "")
    )
    .filter((s) => s.length > 0);
}

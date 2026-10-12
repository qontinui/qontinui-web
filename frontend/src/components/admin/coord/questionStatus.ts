/**
 * questionStatus — pure status derivation for `coord.agent_questions` rows.
 *
 * Extracted from `QuestionCard.tsx` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 1,
 * following the shape `planStatus.ts` carries (first established by the
 * since-retired `alertStatus.ts`): **status derivation lives
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
import { AUTHOR_RED, INERT } from "@/components/console/statusRow";

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
  // The withdrawal record, added to `coord.agent_questions` by alembic
  // revision `coord_agent_questions_withdrawn` (plan
  // `2026-09-20-a-pending-operator-question-outlives-the-condition-that-motivated-it`
  // Phase 0). All five are NULL on every row that predates it, and stay NULL
  // until coord's own PR ships the withdrawal door — so every one is optional
  // and the page renders identically against a coord build that omits them.
  withdrawn_at?: string | null;
  withdrawn_by?: string | null;
  withdrawal_reason?: string | null;
  // JSONB on the coord side: `{pr?: {repo, number}, gate_id?,
  // work_unit_slug?}`. Typed `unknown` here rather than narrowed, because this
  // module renders no field of it — `QuestionRow` shows the reason, and the
  // shape is coord's contract to change.
  withdrawal_evidence?: unknown;
  /** The ask-time reference, same shape as `withdrawal_evidence`. */
  asked_about?: unknown;
  // The decision this row MIRRORS, added by alembic revision
  // `coord_agent_questions_effect` (plan
  // `2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy`
  // Phase 1). `'none'` for an ordinary question; `gate` / `proposal` /
  // `clause` for a mirror row. Both are omitted by a coord build that predates
  // the columns, so both are optional — `questionEffect.ts` reads them.
  effect_kind?: string | null;
  // JSONB: always a flat string `id` plus kind-specific keys
  // (`{gate_id, work_unit_id, phase_name}` | `{proposal_id, …}` |
  // `{kind, name, clause_id}`). `unknown` here; narrowed in `questionEffect.ts`.
  effect_ref?: unknown;
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
 *
 * `withdrawn` is the third terminal state, and it is terminal for a DIFFERENT
 * reason than `answered`: nobody decided anything, the question's premise
 * died. The condition that motivated the escalation resolved on its own — the
 * PR landed on its merits, the gate cleared — so the ask is moot rather than
 * settled.
 */
export type QuestionKind =
  | "pending"
  | "answered"
  | "withdrawn"
  | "gap-blocking"
  | "gap-handled";

/**
 * Every {@link QuestionKind}, enumerated once — and pinned TOTAL at compile
 * time.
 *
 * ## Why this lives in the module and not in the test that consumes it
 *
 * The obvious home is `questionStatus.test.ts`, which is what needs a list of
 * every kind to check the tables against. It cannot go there: this repo's
 * `tsconfig.json` `exclude` lists `**\/*.test.ts` and `**\/*.test.tsx`, and
 * `tsconfig.typecheck.json` overrides only `paths` — so `npm run type-check`,
 * which is the ONLY typecheck CI runs (`.github/workflows/frontend-ci.yml`,
 * three call sites), never reads a test file. Measured rather than assumed: a
 * `--listFiles` run matches zero `questionStatus.test` entries, and a
 * deliberate `const x: number = "…"` appended to that file is reported by
 * nothing. vitest transforms with esbuild and does not typecheck either, so a
 * type-level pin written in a test file fails nowhere at all.
 *
 * ## What the two halves pin
 *
 * - `as const satisfies readonly QuestionKind[]` rejects a member that is not
 *   a kind, while keeping the literal element type (a plain
 *   `readonly QuestionKind[]` annotation would widen it and, worse, happily
 *   accept a strict SUBSET — which is the whole hazard: add a sixth kind,
 *   forget this list, and a runtime `Object.keys(TABLE)` vs `ALL` comparison
 *   passes with both sides equally short).
 * - {@link ALL_QUESTION_KINDS_IS_TOTAL} rejects the reverse omission. Its
 *   annotation resolves to `true` only while nothing is missing; otherwise it
 *   is a tuple type that `= true` cannot satisfy, and the error text names the
 *   kinds left behind.
 */
export const ALL_QUESTION_KINDS = [
  "pending",
  "answered",
  "withdrawn",
  "gap-blocking",
  "gap-handled",
] as const satisfies readonly QuestionKind[];

/** The kinds {@link ALL_QUESTION_KINDS} forgot — `never` while it is total. */
export type QuestionKindsMissingFromAll = Exclude<
  QuestionKind,
  (typeof ALL_QUESTION_KINDS)[number]
>;

/**
 * The totality pin. A compile error the moment {@link QuestionKind} gains a
 * member {@link ALL_QUESTION_KINDS} does not list.
 *
 * Exported deliberately: `noUnusedLocals` is on, so a module-private pin would
 * have to be silenced, and a silenced pin is the next thing to be deleted.
 */
export const ALL_QUESTION_KINDS_IS_TOTAL: [
  QuestionKindsMissingFromAll,
] extends [never]
  ? true
  : ["kinds missing from ALL_QUESTION_KINDS", QuestionKindsMissingFromAll] =
  true;

/**
 * The audited kind → attention table. TOTAL over {@link QuestionKind}, one
 * documented line per kind — this is the table a reviewer of a NEW kind has to
 * audit, and an undefended row is how a kind ends up mis-coloured.
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `pending` | `author` | An agent has STOPPED on this. No retry, no timeout, no other process resolves it — only the operator reading this page. |
 * | `gap-blocking` | `author` | Same, narrower: the agent hit a decision no policy clause covers and is waiting on a clause or a dismissal. |
 * | `gap-handled` | `none` | See below — calm, with the ask in the detail. |
 * | `answered` | `none` | The operator already answered; the row is kept visible as a record, not as a task. Nobody is waiting on it and nothing about it can rot. |
 * | `withdrawn` | `none` | The premise died: coord's own land record shows the PR landed or the gate cleared, so no agent is waiting and no decision is owed. Attention `none` is the POINT of the plan that added this kind — a withdrawn row that still contributed to the attention total would debit the operator exactly as the pending row it replaced. |
 *
 * ## Why `gap-handled` is CALM and specifically not amber
 *
 * A pre-answered gap still wants a human eye: coord applied the category
 * default inline, and accepting or dismissing the proposed clause is a real
 * decision. The instinct is to paint that amber. **It is not amber**, because
 * R3's amber carries a promise — *waiting on something else, it WILL CLEAR
 * ITSELF* — and nothing clears an unreviewed clause. Amber here would be the
 * same false promise the trees surface's 24h stale band used to make.
 *
 * Nor is it red: unlike idle WIP, **nothing is lost if it goes unreviewed**.
 * The category default is already applied and the agent is not blocked, so no
 * operator must act *now*.
 *
 * So it is calm, and the review-owed state is carried by the row's `reason`
 * and by an explicit line in `<GapRow>`'s detail rather than by the hue. That
 * third case — *a real decision that is not blocking anyone* — is written into
 * `frontend/docs/console-ui-style-guide.md` §2 R3, because a vocabulary hole
 * that is only patched in one file gets rediscovered as amber by the next
 * surface.
 */
export const QUESTION_ATTENTION_BY_KIND: Record<QuestionKind, Attention> = {
  pending: "author",
  "gap-blocking": "author",
  "gap-handled": "none",
  answered: "none",
  withdrawn: "none",
};

export const QUESTION_BADGE_CLASS: Record<QuestionKind, string> = {
  pending: AUTHOR_RED,
  "gap-blocking": AUTHOR_RED,
  // Calm, and visibly distinct from the green `answered` finish: this row is
  // not finished, it is simply not urgent.
  "gap-handled": INERT,
  answered: "bg-green-500/5 text-green-300 border-green-500/25",
  // Terminal, but NOT a finish anybody earned — the question was retired
  // because its premise died. Muted rather than green, so the eye reads
  // "nothing here" and not "resolved"; never red or amber, since nobody is
  // waiting and nothing will clear.
  withdrawn: INERT,
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
  // ✓ ⇔ a decision was reached — so `answered` alone, and `withdrawn`
  // DELIBERATELY not.
  //
  // `withdrawn` is terminal, which is what first argued for including it. But
  // ✓ does not say "terminal", it says RESOLVED — and that is the exact
  // reading `QUESTION_BADGE_CLASS` chose `INERT` over green to avoid. A
  // withdrawn question was not resolved: nobody decided anything and its
  // premise died. A success glyph on it would tell the operator a decision
  // exists to go and read, and none does — the muted badge and the empty glyph
  // slot together are what say "retired, nothing here".
  //
  // A kind in NEITHER set renders no glyph at all (`StatusBadge`,
  // `components/console/statusRow.tsx`: each glyph is a `Set.has` guard, and
  // the label follows unconditionally), so `withdrawn` reads as a plain muted
  // "withdrawn" — neutral, which is the intent.
  //
  // Unlike `authorGlyphKinds`, this set is under NO structural audit:
  // `AuditablePalette` (`components/console/attention.ts`) declares only
  // `badgeClass` and `authorGlyphKinds`, so `paletteDisagreements` cannot see
  // it and `tsc` enforces no coverage over a `Set`. `questionStatus.test.ts`
  // pins its membership by equality instead, as `prs/prStatus.test.ts` and
  // `gates/continuationStatus.test.ts` already do for theirs.
  doneGlyphKinds: new Set<QuestionKind>(["answered"]),
};

/**
 * The TERMINAL kinds: no decision is owed and nobody is waiting.
 *
 * "Terminal" here is a statement about the ROW's lifecycle, not about how it
 * looks. A terminal question dims, shows no response composer, and disables
 * its option cards — the two surfaces that render a question
 * (`QuestionRow.tsx` and the `questions/[id]` detail route) both branch on
 * exactly this.
 *
 * The two members are terminal for DIFFERENT reasons, and the difference is
 * the whole point of the vocabulary:
 *
 * - `answered` — a decision WAS made. The operator responded; the row is kept
 *   as the record of that response.
 * - `withdrawn` — the premise DIED. Nobody decided anything; the condition
 *   that motivated the escalation resolved on its own, so the ask is moot
 *   rather than settled. (Which is why it is muted rather than green, and
 *   carries no ✓ — see {@link QUESTION_STATUS_PALETTE}.)
 *
 * ## Why this is a table and not two booleans over columns
 *
 * Both call sites used to re-derive it from the raw row —
 * `Boolean(q.withdrawn_at)` / `!withdrawn && Boolean(q.responded_at)` — beside
 * a `deriveQuestionStatus` call that had already classified the same row. That
 * is precisely the coupling whose failure this plan's review caught once
 * already: the derivation went three-valued while a sibling predicate stayed
 * two-valued, and a withdrawn question rendered a live composer. A boolean over
 * a column is invisible to `tsc`, to {@link ALL_QUESTION_KINDS_IS_TOTAL} and to
 * `paletteDisagreements` alike; a membership test against this set is not.
 *
 * So a SIXTH kind's terminality becomes a recorded decision here — one line to
 * add or deliberately not add, in the same place a reviewer already audits
 * attention, badge class and glyphs — instead of an inference re-made
 * independently in every consumer. `questionStatus.test.ts` pins the membership
 * by sorted equality, the way `doneGlyphKinds` is pinned, because `tsc`
 * enforces no coverage over a `Set`.
 *
 * `gap-blocking` and `gap-handled` are both NON-terminal: a blocking gap is an
 * agent stopped on it, and a pre-answered gap still owes a human the accept-or-
 * dismiss review of the clause coord applied inline.
 */
export const QUESTION_TERMINAL_KINDS: ReadonlySet<QuestionKind> =
  new Set<QuestionKind>(["answered", "withdrawn"]);

const LABEL_BY_KIND: Record<QuestionKind, string> = {
  pending: "pending",
  answered: "answered",
  withdrawn: "withdrawn",
  "gap-blocking": "blocking gap",
  "gap-handled": "pre-answered gap",
};

/**
 * The inbox row's status.
 *
 * Three-valued, in this order: **withdrawn first**, then answered, then
 * pending. Until plan
 * `2026-09-20-a-pending-operator-question-outlives-the-condition-that-motivated-it`
 * this was the two-valued `q.responded_at ? "answered" : "pending"`, which
 * rendered a withdrawn row — whose `responded_at` is still NULL — in the
 * pending list, red, as *"an agent is waiting on this"*: strictly worse than
 * leaving it pending, since the retirement would have been invisible.
 *
 * Why `withdrawn_at` is tested BEFORE `responded_at` rather than after: coord's
 * withdrawal door will refuse a question that already carries a response (an
 * operator's decision is never erasable by an agent), and its answer door will
 * likewise refuse a withdrawn row, so the two stamps should never coexist.
 * Both doors are future tense on purpose — nothing named `withdraw` exists on
 * the agent-question PATH in `qontinui-coord` today: `agent_questions.rs`
 * carries no such symbol. The word itself is common elsewhere in coord and a
 * bare grep is misleading — there are two unrelated withdrawal domains, gate
 * withdrawal (`gates.rs` `withdraw_gate_core`, `api/gate_routes.rs`, the
 * `coord_withdraw_gate` MCP tool) and decision-record withdrawal
 * (`prompt_documents.rs`) — and none of it touches this table. The doors this
 * comment means ship in this plan's sibling PR, after this migration lands.
 *
 * The ordering therefore only matters DEFENSIVELY — and if a row somehow
 * arrives with both stamps, the discriminating reason is that the withdrawal
 * record is the one the console can EXPLAIN. Silently preferring `answered`
 * would show an operator a response they can no longer reconcile with the
 * reason the row was retired. ("Nobody is waiting" does not discriminate:
 * that is equally true of `answered`.)
 */
export function deriveQuestionStatus(
  q: Pick<
    AgentQuestionRow,
    | "responded_at"
    | "response"
    | "plan_phase"
    | "withdrawn_at"
    | "withdrawal_reason"
  >
): RowStatus<QuestionKind> {
  const kind: QuestionKind = q.withdrawn_at
    ? "withdrawn"
    : q.responded_at
      ? "answered"
      : "pending";
  return {
    kind,
    label: LABEL_BY_KIND[kind],
    reason: reasonFor(kind, q),
    attention: QUESTION_ATTENTION_BY_KIND[kind],
  };
}

function reasonFor(
  kind: QuestionKind,
  q: Pick<AgentQuestionRow, "response" | "plan_phase" | "withdrawal_reason">
): string | undefined {
  if (kind === "withdrawn") {
    return q.withdrawal_reason
      ? truncate(q.withdrawal_reason, 90)
      : // Never "withdrawn" alone: coord requires a reason on the door, so an
        // absent one is a claim about OUR read, not about the withdrawal.
        "withdrawn, no reason recorded";
  }
  if (kind === "answered") {
    return q.response ? truncate(q.response, 90) : "answered, no text recorded";
  }
  return q.plan_phase
    ? `blocked at ${q.plan_phase}`
    : "an agent is waiting on this";
}

/**
 * The policy-gap row's status. Same table, the gap half of it.
 *
 * Deliberately still two-valued: the gaps tab is assembled from the pending
 * and answered reads, and a withdrawn row is in neither — coord's pending
 * predicate excludes it and it carries no `responded_at` — so this derivation
 * is never handed one. It is not an omission; a `withdrawn` arm here would be
 * unreachable code asserting a contract this function does not own.
 */
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
        : "not blocking — coord applied the category default; the clause is still owed a review",
    attention: QUESTION_ATTENTION_BY_KIND[kind],
  };
}

/**
 * Format a timestamp as a short relative span (e.g. "3m", "2h", "5d").
 * Falls back to the raw ISO if parsing fails — never throws.
 *
 * Lives here rather than in a card component (its previous home) so the module
 * that still imports it — the question detail route — does not depend on a
 * rendering. (`GapRow` and `QuestionRow` render times through `RowTime`
 * instead and import nothing from here for it; `PlanCard`, its other caller,
 * was deleted in Phase 3 Wave 2.)
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

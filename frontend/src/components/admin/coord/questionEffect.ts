/**
 * questionEffect — which decision a `coord.agent_questions` row MIRRORS.
 *
 * Plan `2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy`
 * (D2, Phases 1–3). The operator's one inbox is the question row, generalised
 * with an **effect**: alembic revision `coord_agent_questions_effect` adds
 * `effect_kind` (`none | clause | proposal | gate`) and `effect_ref` (JSONB,
 * always carrying a flat string `id` beside kind-specific keys). A row whose
 * `effect_kind` is not `none` mirrors a decision another table owns — an
 * `operator_approval` gate, a policy proposal, or (reserved, Phase 1b) a
 * proposed clause — and coord routes an answer to it through that effect's own
 * core. The web side adds no endpoint: an effect row is answered through the
 * same `/agent-questions/:id/respond` door with the effect's canonical option
 * values, listed here in {@link QuestionEffect.decisions}.
 *
 * Pure, and tolerant by construction: a coord build that predates the columns
 * omits both fields, and that row must render exactly as it did before — so
 * absence, `null`, `'none'` and a malformed `effect_ref` all degrade rather
 * than throw. An `effect_kind` this build does not know is surfaced as
 * `unknown` with its raw token, never silently as "no effect": it is coord
 * vocabulary this build predates, and the operator should see that the row is
 * a mirror even when the console cannot route it.
 */

import type { AgentQuestionRow } from "@/components/admin/coord/questionStatus";

/** The effect kinds this build can render. `none` is "no effect" → `null`. */
export type QuestionEffectKind = "gate" | "proposal" | "clause" | "unknown";

/** One canonical answer an effect row accepts. `value` is what is POSTed. */
export interface QuestionEffectDecision {
  value: string;
  label: string;
}

export interface QuestionEffect {
  kind: QuestionEffectKind;
  /** The raw `effect_kind` coord sent — equal to `kind` except for `unknown`. */
  rawKind: string;
  /** `effect_ref.id` — the effect's primary key as text — or null if absent. */
  id: string | null;
  /** Chip text, e.g. "gate". */
  label: string;
  /** Secondary text beside the chip (gate: work unit · phase), if any. */
  detail: string | null;
  /** Hover text explaining what answering the row does. */
  title: string;
  /** Where the effect lives in the console, if it has a page. */
  href: string | null;
  /**
   * The answers coord routes through the effect's core, or `null` when this
   * build knows no fixed vocabulary (clause, unknown) — those rows keep the
   * free-text composer. Answer values are coord's contract: `met`/`not_met`
   * map onto the gate approve/reject cores, `approve`/`reject` onto the
   * proposal `decide_core`.
   */
  decisions: readonly QuestionEffectDecision[] | null;
}

export const GATE_DECISIONS: readonly QuestionEffectDecision[] = [
  { value: "met", label: "Met — clear the gate" },
  { value: "not_met", label: "Not met — reject" },
];

export const PROPOSAL_DECISIONS: readonly QuestionEffectDecision[] = [
  { value: "approve", label: "Approve — apply the edit" },
  { value: "reject", label: "Reject" },
];

/** A string field of `effect_ref`, or null when absent / not a non-empty string. */
function refString(ref: unknown, key: string): string | null {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
  const v = (ref as Record<string, unknown>)[key];
  if (typeof v === "string" && v.trim() !== "") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * The row's effect, or `null` for an ordinary question.
 *
 * `null` for: `effect_kind` absent (older coord), `null`, empty, or `'none'`.
 */
export function deriveQuestionEffect(
  q: Pick<AgentQuestionRow, "effect_kind" | "effect_ref">
): QuestionEffect | null {
  const raw = typeof q.effect_kind === "string" ? q.effect_kind.trim() : "";
  if (raw === "" || raw === "none") return null;
  const ref = q.effect_ref;

  if (raw === "gate") {
    const id = refString(ref, "id") ?? refString(ref, "gate_id");
    const workUnit = refString(ref, "work_unit_id");
    const phase = refString(ref, "phase_name");
    const detail = [workUnit, phase].filter(Boolean).join(" · ") || null;
    return {
      kind: "gate",
      rawKind: raw,
      id,
      label: "gate",
      detail,
      title:
        "Mirrors an operator_approval gate. Answering met / not met clears or rejects the gate through its own core, which fires its continuation.",
      href: id
        ? `/admin/coord/gates?gate=${encodeURIComponent(id)}`
        : "/admin/coord/gates",
      decisions: GATE_DECISIONS,
    };
  }

  if (raw === "proposal") {
    const id = refString(ref, "id") ?? refString(ref, "proposal_id");
    return {
      kind: "proposal",
      rawKind: raw,
      id,
      label: "proposal",
      detail: null,
      title:
        "Mirrors a policy proposal. Approving applies the edit through the proposal's own decision core; a stale proposal is still refused there.",
      href: id
        ? `/admin/coord/prompt-document-proposals?proposal=${encodeURIComponent(id)}`
        : "/admin/coord/prompt-document-proposals",
      decisions: PROPOSAL_DECISIONS,
    };
  }

  if (raw === "clause") {
    const kind = refString(ref, "kind");
    const name = refString(ref, "name");
    return {
      kind: "clause",
      rawKind: raw,
      id: refString(ref, "id") ?? refString(ref, "clause_id"),
      label: "clause",
      detail: kind && name ? `${kind}/${name}` : name,
      title: "Mirrors a proposed policy clause.",
      href: null,
      decisions: null,
    };
  }

  return {
    kind: "unknown",
    rawKind: raw,
    id: refString(ref, "id"),
    label: `effect: ${raw}`,
    detail: null,
    title: `coord marked this row as mirroring a "${raw}" decision, which this console build does not recognise.`,
    href: null,
    decisions: null,
  };
}

/** The option VALUES a row carries — plain strings or `{value}` objects. */
function optionValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") out.push(entry);
    else if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as { value?: unknown }).value === "string"
    ) {
      out.push((entry as { value: string }).value);
    }
  }
  return out;
}

/**
 * What the detail page can offer as one-click decisions for this row.
 *
 * The decision VOCABULARY above is this build's belief about coord's contract;
 * the row's own `options` are what coord actually wrote on it. A button is
 * therefore rendered only for a value the row itself lists, and when the two
 * sets DISAGREE at all — a renamed value, an extra option, a row with no
 * options — nothing is offered as a button: the page falls back to the
 * free-text composer and says why (`mismatch: true`). Posting a hard-coded
 * value coord does not accept would be refused at best and misrouted at worst.
 *
 * `decisions` is null for a row with no effect or no fixed vocabulary
 * (`mismatch` false: the composer is simply the normal control there).
 */
export function effectDecisionsFor(
  effect: QuestionEffect | null,
  rawOptions: unknown
): { decisions: readonly QuestionEffectDecision[] | null; mismatch: boolean } {
  if (!effect?.decisions) return { decisions: null, mismatch: false };
  const offered = new Set(optionValues(rawOptions));
  const known = effect.decisions.filter((d) => offered.has(d.value));
  const agree =
    known.length === effect.decisions.length &&
    offered.size === effect.decisions.length;
  return agree
    ? { decisions: known, mismatch: false }
    : { decisions: null, mismatch: true };
}

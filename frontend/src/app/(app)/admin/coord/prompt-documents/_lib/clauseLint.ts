/**
 * Authoring-lint for policy clauses (plan
 * `2026-07-18-policy-clause-schema-web-data-model.md`, Phase 2).
 *
 * These are the debrief-derived authoring standards, surfaced as NON-BLOCKING
 * warnings in the clause editor — a clause that trips a lint still saves. The
 * intent is to steer authors toward crisp, actionable clauses:
 *   - `action` should read as an imperative instruction, not a hedge
 *     ("should"/"consider"/"try to" …).
 *   - `escalate_if` should enumerate a CLOSED list of discrete conditions, not an
 *     open-ended "any"/"etc"/"as needed" catch-all (or nothing at all).
 *   - `bounds` should be stated rather than left empty.
 */

import type { ClauseCreate } from "../types";

export interface ClauseLintWarning {
  /** Which field the warning is about (for inline placement). */
  field: "action" | "escalate_if" | "bounds";
  message: string;
}

/** Hedge openers that make an `action` non-imperative. */
const HEDGE_OPENERS = [
  "should",
  "consider",
  "try to",
  "try and",
  "maybe",
  "might",
  "could",
  "would",
  "may want to",
  "it is recommended",
  "we recommend",
];

/**
 * Open-ended phrases that break the CLOSED-list `escalate_if` contract. Matched
 * on word boundaries so a legitimate word like "company" or "many" doesn't
 * false-trip the "any" catch-all check; the literal ellipsis is checked
 * separately since `\b` doesn't apply to punctuation.
 */
const OPEN_ENDED_RE = /\b(etc|anything|any|as needed|and so on)\b/;

/**
 * Lint one clause's authoring against the standards. Returns zero or more
 * non-blocking warnings; an empty array means the clause reads clean.
 */
export function lintClause(clause: {
  action: string;
  escalate_if: string;
  bounds: string;
}): ClauseLintWarning[] {
  const warnings: ClauseLintWarning[] = [];

  const action = clause.action.trim();
  if (action.length > 0) {
    const lower = action.toLowerCase();
    const opener = HEDGE_OPENERS.find(
      (h) => lower === h || lower.startsWith(`${h} `)
    );
    if (opener) {
      warnings.push({
        field: "action",
        message: `Action reads as a suggestion ("${opener}…"). Prefer an imperative verb — say what to do, e.g. "Delete the stale rows".`,
      });
    }
  }

  const escalate = clause.escalate_if.trim();
  if (escalate.length === 0) {
    warnings.push({
      field: "escalate_if",
      message:
        "No escalation conditions. Escalate-if is a CLOSED list — enumerate the discrete conditions that force an escalation, or state there are none.",
    });
  } else {
    const lower = escalate.toLowerCase();
    const match = OPEN_ENDED_RE.exec(lower);
    const token = match ? match[1] : lower.includes("...") ? "..." : null;
    if (token) {
      warnings.push({
        field: "escalate_if",
        message: `Escalate-if looks open-ended ("${token}"). Keep it a CLOSED list of discrete conditions rather than a catch-all.`,
      });
    }
  }

  if (clause.bounds.trim().length === 0) {
    warnings.push({
      field: "bounds",
      message:
        "No bounds set. State the scope limits of this clause so it can't be over-applied.",
    });
  }

  return warnings;
}

/**
 * Parse a pasted `POLICY_CANDIDATES` YAML block into draft clause bodies.
 *
 * Accepts either a top-level `POLICY_CANDIDATES:` list or a bare list of clause
 * maps. Every parsed clause is normalized to the `ClauseCreate` shape, stamped
 * with `category` (= the document name) and `status: "proposed"`, and given safe
 * defaults for any field the YAML omits. Throws on malformed YAML or a
 * non-list payload so the caller can surface the parse error.
 */
export function parsePolicyCandidatesYaml(
  text: string,
  parsed: unknown,
  category: string
): ClauseCreate[] {
  // `parsed` is the already-YAML-parsed value (the caller owns the `yaml` dep so
  // this module stays dependency-free and unit-testable). `text` is unused here
  // beyond documentation of the source; kept for a clearer call site.
  void text;

  const list = extractCandidateList(parsed);
  return list.map((raw, i) => normalizeCandidate(raw, category, i));
}

function extractCandidateList(parsed: unknown): Record<string, unknown>[] {
  let list: unknown = parsed;
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "POLICY_CANDIDATES" in parsed
  ) {
    list = (parsed as Record<string, unknown>).POLICY_CANDIDATES;
  }
  if (!Array.isArray(list)) {
    throw new Error(
      "Expected a POLICY_CANDIDATES list (or a bare list of clause entries)."
    );
  }
  return list.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Clause entry ${i + 1} is not a mapping.`);
    }
    return item as Record<string, unknown>;
  });
}

function asString(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function asStringList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.map((x) => asString(x).trim()).filter((x) => x.length > 0);
  }
  // A scalar/newline string degrades to a one-or-more entry list.
  return asString(v)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

const VALID_TIERS = new Set([
  "proceed",
  "proceed+log",
  "proceed+notify",
  "ask-first",
  "never",
]);

function normalizeCandidate(
  raw: Record<string, unknown>,
  category: string,
  index: number
): ClauseCreate {
  const clauseId =
    asString(raw.clause_id ?? raw.id ?? raw.name).trim() ||
    `candidate-${index + 1}`;
  const rawTier = asString(raw.tier).trim();
  const tier = VALID_TIERS.has(rawTier)
    ? (rawTier as ClauseCreate["tier"])
    : null;
  return {
    clause_id: clauseId,
    category,
    // Imported candidates always land as `proposed` regardless of any status
    // in the YAML — they are drafts awaiting confirmation.
    status: "proposed",
    tier,
    trigger: asString(raw.trigger),
    action: asString(raw.action),
    bounds: asString(raw.bounds),
    escalate_if: asString(raw.escalate_if ?? raw.escalate),
    anti_triggers: asStringList(raw.anti_triggers),
    depends_on: asStringList(raw.depends_on),
    links: asStringList(raw.links),
  };
}

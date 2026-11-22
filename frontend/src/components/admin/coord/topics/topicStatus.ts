/**
 * topicStatus — every word, hue and count the topics console renders, in one
 * pure module (style guide R8: no derivation inline in JSX; R3/§4.2: an
 * authored kind→attention table, registered in `console/consoleSurfaces.ts`
 * `CONSOLE_PALETTES` and audited by `console/attention.test.ts`).
 *
 * Plan `2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator`
 * Phase 8 (D9). coord rolls a topic's headline up from its CONFIRMED members'
 * cached subproject verdicts (D7 as amended B9: `needs_you > stalled > working
 * > waiting > done`, `unknown` only when it rests on unread members) and
 * caches it with `last_rollup_as_of`. This module only words it, decides its
 * hue, and says what is NOT known — a topic never rolled up, a count coord did
 * not take, a basis family it could not read, a read that never answered (R6).
 *
 * The headline vocabulary is the subprojects' own, so a topic and its member
 * subprojects carry the same badge for the same word; the table is declared
 * here, not imported, so the topics surface is audited as its own row.
 */

import type { Attention } from "@/components/console/attention";
import { attentionOf } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  CI_YELLOW,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";
import {
  SUBPROJECT_HEADLINE_LABEL,
  countText,
  headlineKindOf,
  type SubprojectHeadlineKind,
  type SubprojectReadFailure,
} from "@/components/admin/coord/subprojects/subprojectStatus";
import type {
  TopicBasisEntry,
  TopicMember,
  TopicSummary,
} from "@/lib/api/operations/coordTopics";

export { countText };

// ─────────────────────────────── headline ───────────────────────────────

export type TopicHeadlineKind = SubprojectHeadlineKind;

/**
 * Who must act, per rolled-up headline — the audit table (§4.2 part 1):
 *
 * - `needs_you` → **author**: a confirmed member needs the operator.
 * - `stalled` → **author**: a confirmed member has nothing alive moving it,
 *   and nothing but a person restarts it.
 * - `waiting` → **waiting**: every member that is not done names a live mover.
 * - `unknown` → **waiting**: the ignorance floor — never rolled up, or the
 *   rollup rests on members whose verdict could not be read.
 * - `working` → **none**: a member is live and making progress.
 * - `done` → **none**: every confirmed member is done.
 */
export const TOPIC_ATTENTION_BY_HEADLINE: Record<TopicHeadlineKind, Attention> =
  {
    needs_you: "author",
    stalled: "author",
    waiting: "waiting",
    unknown: "waiting",
    working: "none",
    done: "none",
  };

export const TOPIC_HEADLINE_CLASS: Record<TopicHeadlineKind, string> = {
  needs_you: AUTHOR_RED,
  stalled: AUTHOR_RED,
  waiting: WAITING_AMBER,
  unknown: UNKNOWN_AMBER,
  working: CI_YELLOW,
  done: INERT,
};

/** red ⇔ `✕`, exactly. */
export const TOPIC_AUTHOR_GLYPH_HEADLINES: ReadonlySet<TopicHeadlineKind> =
  new Set<TopicHeadlineKind>(["needs_you", "stalled"]);

export const TOPIC_HEADLINE_PALETTE: StatusPalette<TopicHeadlineKind> = {
  badgeClass: TOPIC_HEADLINE_CLASS,
  authorGlyphKinds: TOPIC_AUTHOR_GLYPH_HEADLINES,
  doneGlyphKinds: new Set<TopicHeadlineKind>(["done"]),
};

function unknownStatus(reason: string): RowStatus<TopicHeadlineKind> {
  return {
    kind: "unknown",
    label: SUBPROJECT_HEADLINE_LABEL.unknown,
    reason,
    attention: TOPIC_ATTENTION_BY_HEADLINE.unknown,
  };
}

/** A topic row's status: coord's CACHED rollup, never a guess. */
export function deriveTopicStatus(
  t: Pick<
    TopicSummary,
    "headline" | "top_reason" | "last_rollup_as_of" | "unknown_members"
  >
): RowStatus<TopicHeadlineKind> {
  if (t.headline === null || t.headline === undefined) {
    return unknownStatus("coord has not rolled this topic up yet");
  }
  const kind = headlineKindOf(t.headline);
  if (kind === null) {
    return {
      ...unknownStatus(
        `coord sent a headline this page does not know ("${t.headline}")`
      ),
      attention: attentionOf(TOPIC_ATTENTION_BY_HEADLINE, t.headline),
    };
  }
  const reason =
    t.top_reason ??
    (kind === "unknown" && (t.unknown_members ?? 0) > 0
      ? `${t.unknown_members} member${t.unknown_members === 1 ? "" : "s"} could not be read`
      : kind === "needs_you" || kind === "stalled" || kind === "unknown"
        ? "coord gave no reason"
        : undefined);
  return {
    kind,
    label: SUBPROJECT_HEADLINE_LABEL[kind],
    reason,
    attention: attentionOf(TOPIC_ATTENTION_BY_HEADLINE, kind),
  };
}

/** A member subproject's cached headline, for its badge on the detail page. */
export function deriveMemberHeadline(
  m: Pick<TopicMember, "headline">
): RowStatus<TopicHeadlineKind> {
  if (m.headline === null || m.headline === undefined)
    return unknownStatus("coord did not send this subproject's verdict");
  const kind = headlineKindOf(m.headline);
  if (kind === null)
    return unknownStatus(
      `coord sent a headline this page does not know ("${m.headline}")`
    );
  return {
    kind,
    label: SUBPROJECT_HEADLINE_LABEL[kind],
    attention: attentionOf(TOPIC_ATTENTION_BY_HEADLINE, kind),
  };
}

// ─────────────────────────────── tabs ───────────────────────────────

export type TopicTab =
  | "needs_you"
  | "stalled"
  | "working"
  | "waiting"
  | "done"
  | "all";

export const TOPIC_TABS: readonly TopicTab[] = [
  "needs_you",
  "stalled",
  "working",
  "waiting",
  "done",
  "all",
];

export const TOPIC_TAB_LABEL: Record<TopicTab, string> = {
  needs_you: "Needs you",
  stalled: "Stalled",
  working: "Working",
  waiting: "Waiting",
  done: "Done",
  all: "All",
};

/** The tab in the URL, or All (the default) for anything else. */
export function topicTabOf(raw: string | null | undefined): TopicTab {
  return (TOPIC_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as TopicTab)
    : "all";
}

/** Does this topic belong in this tab? A topic never rolled up (or with a
 *  headline this build does not know) is listed under All only. */
export function inTopicTab(t: Pick<TopicSummary, "headline">, tab: TopicTab) {
  if (tab === "all") return true;
  return headlineKindOf(t.headline) === tab;
}

/**
 * Each tab's count, from the topics coord served. coord lists every topic in
 * one read (no pagination), so a count of the loaded list is the count — but
 * only once a read answered: before that every count is `null`, which renders
 * `–`, never 0 (R6).
 */
export function topicTabCounts(
  topics: readonly Pick<TopicSummary, "headline">[] | null
): Record<TopicTab, number | null> {
  const out = {} as Record<TopicTab, number | null>;
  for (const tab of TOPIC_TABS)
    out[tab] =
      topics === null ? null : topics.filter((t) => inTopicTab(t, tab)).length;
  return out;
}

/** `working/total` for a row; either half may be unknown. */
export function workingText(
  t: Pick<TopicSummary, "subprojects_working" | "subprojects_total">
): string {
  return `${countText(t.subprojects_working)}/${countText(t.subprojects_total)}`;
}

export function workingTitle(
  t: Pick<TopicSummary, "subprojects_working" | "subprojects_total">
): string {
  if (t.subprojects_working === null || t.subprojects_total === null)
    return "coord did not report how many member subprojects are working — a dash is unknown, not zero";
  return `${t.subprojects_working} of ${t.subprojects_total} subproject${t.subprojects_total === 1 ? "" : "s"} working`;
}

/**
 * Which lifecycle states the list holds. The page sends no `status`, so
 * coord's default decides which topics are listed; this sentence says so and
 * names what it served, so a filtered-out state is not mistaken for none.
 */
export function lifecycleWords(
  topics: readonly Pick<TopicSummary, "status">[]
): string {
  const by = new Map<string, number>();
  for (const t of topics) by.set(t.status, (by.get(t.status) ?? 0) + 1);
  const parts = [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, n]) => `${status} ${n}`);
  return `Listed under coord's default lifecycle filter${parts.length > 0 ? ` (${parts.join(", ")})` : ""}; topics in other states may not be shown.`;
}

const EMPTY_VIEW: Record<TopicTab, string> = {
  needs_you: "No topic needs you",
  stalled: "No topic is stalled",
  working: "No topic is working",
  waiting: "No topic is waiting",
  done: "No topic is done",
  all: "No topic yet",
};

export function describeEmptyTopics(i: {
  tab: TopicTab;
  loaded: boolean;
  failure: SubprojectReadFailure | null;
  query: string;
  loadedRows: number;
  /** `false` when coord answered `tables_ready: false`; absent is ready. */
  tablesReady?: boolean;
}): string {
  if (i.failure && !i.loaded)
    return `Whether any topic is in this view is unknown: ${topicReadFailureWords(i.failure)}.`;
  if (i.tablesReady === false)
    return "Whether any topic is in this view is unknown: coord's topic tables are not ready.";
  if (i.query && i.loadedRows > 0)
    return `No topic in this view matches "${i.query}".`;
  return `${EMPTY_VIEW[i.tab]}.`;
}

// ─────────────────────────────── intent anchor ─────────────────────────────

/** A topic's `intent_ref` (`{kind, name, claim?}`, D1) as one phrase, e.g.
 *  `product_intent/roadmap, claim "…"`. Returns `null` when coord sent no
 *  anchor (`null`/`{}`) — the page then says nothing, since an unanchored topic
 *  is a normal state, not an unknown one. Only `kind`, `name` and a string
 *  `claim` are named; an anchor carrying neither `kind` nor `name` is rendered
 *  as its JSON rather than dropped, so a reshaped anchor stays visible. */
export function intentRefWords(
  ref: Record<string, unknown> | null | undefined
): string | null {
  if (!ref || typeof ref !== "object" || Object.keys(ref).length === 0)
    return null;
  const kind = typeof ref.kind === "string" ? ref.kind : null;
  const name = typeof ref.name === "string" ? ref.name : null;
  const claim = typeof ref.claim === "string" ? ref.claim : null;
  if (!kind && !name) return JSON.stringify(ref);
  const doc = [kind, name].filter(Boolean).join("/");
  return claim ? `${doc}, claim "${claim}"` : doc;
}

// ─────────────────────────────── read failures ─────────────────────────────

/** The failure as one sentence for the page (classified by the subprojects
 *  module's `classifySubprojectReadFailure`, which reads only the status and
 *  coord's structured body — the same doors, the same refusals). */
export function topicReadFailureWords(f: SubprojectReadFailure): string {
  switch (f.kind) {
    case "migration_pending":
      return "topics not available yet (migration pending)";
    case "not_served":
      return `this deployment does not serve topics yet (HTTP ${f.status})`;
    case "unreachable":
      return f.status === null
        ? `coord did not answer${f.detail ? ` (${f.detail})` : ""}`
        : `coord did not answer (HTTP ${f.status}${f.detail ? `: ${f.detail}` : ""})`;
    case "refused":
      return `coord refused the read (HTTP ${f.status}${f.code ? `, ${f.code}` : ""}${f.detail ? `: ${f.detail}` : ""})`;
  }
}

// ─────────────────────────────── members ───────────────────────────────

const SIGNAL_WORDS: Record<string, string> = {
  plan_family: "plan family",
  pr_edge: "PR links",
  gate_chain: "gate chain",
  files: "files touched",
  semantic: "similar wording",
  declared: "an agent's tag",
  intent: "a declared intent",
};

/** A basis signal's family, in words. */
export function signalWords(signal: string): string {
  return SIGNAL_WORDS[signal] ?? signal.replace(/_/g, " ");
}

/**
 * One basis entry as a plain sentence — why coord (or an agent) put this
 * subproject in this topic. A family coord could not read says so, never
 * "no evidence".
 */
export function basisSentence(b: TopicBasisEntry): string {
  if (b.ref === "could_not_read")
    return `could not read ${signalWords(b.signal)}`;
  switch (b.signal) {
    case "plan_family":
      return `shares plan \`${b.ref}\``;
    case "pr_edge":
      return `linked by PR ${b.ref}`;
    case "gate_chain":
      return `in the same gate chain (${b.ref})`;
    case "files":
      return `touches the same files (${b.ref})`;
    case "semantic":
      return `reads like the topic (${b.ref})`;
    case "declared":
      return `tagged by session ${b.ref}`;
    case "intent":
      return `serves intent ${b.ref}`;
    default:
      return `${signalWords(b.signal)}: ${b.ref}`;
  }
}

/** The basis entry's score and note, for the sentence's hover title. */
export function basisTitle(b: TopicBasisEntry): string {
  const score =
    typeof b.score === "number" ? `score ${b.score.toFixed(2)}` : "no score";
  return b.note ? `${score} — ${b.note}` : score;
}

const MEMBER_STATE_WORDS: Record<string, string> = {
  proposed: "proposed",
  confirmed: "confirmed",
  rejected: "rejected",
};

export function memberStateWords(state: string): string {
  return MEMBER_STATE_WORDS[state] ?? state;
}

const DECIDED_BY_WORDS: Record<string, string> = {
  coord: "coord",
  agent: "an agent",
  steward: "the topic steward",
  operator: "an operator",
};

export function decidedByWords(by: string): string {
  return DECIDED_BY_WORDS[by] ?? by;
}

/** A weight as a percent, or `–` when coord sent none. */
export function weightText(w: number | null | undefined): string {
  return typeof w === "number" ? `${Math.round(w * 100)}%` : "–";
}

/** Confirmed first, then proposed, then rejected; heaviest first within. */
export function sortMembers<T extends Pick<TopicMember, "state" | "weight">>(
  members: readonly T[]
): T[] {
  const rank = (s: string) =>
    s === "confirmed" ? 0 : s === "proposed" ? 1 : s === "rejected" ? 3 : 2;
  return [...members].sort(
    (a, b) =>
      rank(a.state) - rank(b.state) || (b.weight ?? -1) - (a.weight ?? -1)
  );
}

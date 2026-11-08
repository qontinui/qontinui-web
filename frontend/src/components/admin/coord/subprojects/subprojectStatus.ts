/**
 * subprojectStatus — every word, link and attention decision the subprojects
 * console renders, in one pure module (style guide R8: no derivation inline in
 * JSX; R3/§4.2: an authored kind→attention table per palette, each audited).
 *
 * Plan `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * Phase 6 (D12). coord computes a subproject's headline and reasons (D1, D6);
 * this module only words them, decides their hue, and says honestly what is
 * NOT known — a verdict the reconciler has not reached, a source coord could
 * not read, a count it did not take, a read that never answered (R6). It reads
 * nothing and renders nothing.
 *
 * Three attention tables, each registered in `console/consoleSurfaces.ts`
 * `CONSOLE_PALETTES` and audited by `console/attention.test.ts`:
 *
 * - {@link SUBPROJECT_ATTENTION_BY_HEADLINE} — the subproject's headline;
 * - {@link SUBPROJECT_SESSION_ATTENTION_BY_KIND} — a member session's liveness;
 * - {@link SUBPROJECT_GATE_ATTENTION_BY_KIND} — a member gate's mover.
 *
 * Every hue comes from `console/statusRow.tsx`'s exported families; nothing
 * here spells a red or an amber.
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
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { extractCoordRefusal } from "@/components/admin/coord/spawnPlacement";
import { isTerminalGateVerdict } from "@/app/(app)/admin/coord/gates/gateStatus";
import type {
  SubprojectMemberGate,
  SubprojectMemberPr,
  SubprojectMemberSession,
  SubprojectMemberUnit,
  SubprojectNextStep,
  SubprojectReason,
  SubprojectRef,
  SubprojectSource,
  SubprojectSummary,
  SubprojectVerdict,
} from "@/lib/api/operations/coordSubprojects";

// ─────────────────────────────── headline ───────────────────────────────

/** coord's headline vocabulary (the contract's exact strings). */
export type SubprojectHeadlineKind =
  | "needs_you"
  | "stalled"
  | "working"
  | "waiting"
  | "done"
  | "unknown";

export const SUBPROJECT_HEADLINES: readonly SubprojectHeadlineKind[] = [
  "needs_you",
  "stalled",
  "working",
  "waiting",
  "done",
  "unknown",
];

/**
 * Who must act, per headline — the audit table (§4.2 part 1), one line each:
 *
 * - `needs_you` → **author**: an operator-audience question or an
 *   `operator_approval` gate is among the members; only the operator clears it.
 * - `stalled` → **author**: nothing alive is moving what the subproject waits
 *   on (D6), and the plan deliberately does not auto-continue it (F2) — so
 *   nothing but a person restarts it (R3's red: "nothing else will resolve
 *   this").
 * - `waiting` → **waiting**: every open gate names a live mover; it clears
 *   itself (amber's contract).
 * - `unknown` → **waiting**: R3's ignorance floor — the verdict is not
 *   computed, or a source it depends on could not be read. Amber here is a
 *   statement about our knowledge, never calm.
 * - `working` → **none**: a member session is live and has made progress.
 * - `done` → **none**: terminal; nothing is owed.
 */
export const SUBPROJECT_ATTENTION_BY_HEADLINE: Record<
  SubprojectHeadlineKind,
  Attention
> = {
  needs_you: "author",
  stalled: "author",
  waiting: "waiting",
  unknown: "waiting",
  working: "none",
  done: "none",
};

/** The palette, keyed off the same table: red for the two author kinds, the
 *  two ambers for the two waiting ones, yellow for running work, inert for
 *  done. */
export const SUBPROJECT_HEADLINE_CLASS: Record<SubprojectHeadlineKind, string> =
  {
    needs_you: AUTHOR_RED,
    stalled: AUTHOR_RED,
    waiting: WAITING_AMBER,
    unknown: UNKNOWN_AMBER,
    working: CI_YELLOW,
    done: INERT,
  };

/** red ⇔ `✕`, exactly. */
export const SUBPROJECT_AUTHOR_GLYPH_HEADLINES: ReadonlySet<SubprojectHeadlineKind> =
  new Set<SubprojectHeadlineKind>(["needs_you", "stalled"]);

export const SUBPROJECT_HEADLINE_PALETTE: StatusPalette<SubprojectHeadlineKind> =
  {
    badgeClass: SUBPROJECT_HEADLINE_CLASS,
    authorGlyphKinds: SUBPROJECT_AUTHOR_GLYPH_HEADLINES,
    doneGlyphKinds: new Set<SubprojectHeadlineKind>(["done"]),
  };

export const SUBPROJECT_HEADLINE_LABEL: Record<SubprojectHeadlineKind, string> =
  {
    needs_you: "Needs you",
    stalled: "Stalled",
    working: "Working",
    waiting: "Waiting",
    done: "Done",
    unknown: "Unknown",
  };

/** The headline as this build knows it, or `null` for a word it does not. */
export function headlineKindOf(raw: unknown): SubprojectHeadlineKind | null {
  return typeof raw === "string" &&
    (SUBPROJECT_HEADLINES as readonly string[]).includes(raw)
    ? (raw as SubprojectHeadlineKind)
    : null;
}

/** The sentence the strip and the empty states use for a headline, by count. */
const HEADLINE_PHRASE: Record<SubprojectHeadlineKind, [string, string]> = {
  needs_you: ["needs you", "need you"],
  stalled: ["stalled", "stalled"],
  working: ["working", "working"],
  waiting: ["waiting", "waiting"],
  done: ["done", "done"],
  unknown: ["unknown", "unknown"],
};

function headlineStatus(
  raw: string | null | undefined,
  verdictAsOf: string | null | undefined,
  topReason: Pick<SubprojectReason, "kind" | "summary"> | null | undefined
): RowStatus<SubprojectHeadlineKind> {
  if (verdictAsOf === null) {
    return {
      kind: "unknown",
      label: SUBPROJECT_HEADLINE_LABEL.unknown,
      reason:
        "coord's reconciler has not computed a verdict for this subproject yet",
      attention: SUBPROJECT_ATTENTION_BY_HEADLINE.unknown,
    };
  }
  const kind = headlineKindOf(raw);
  if (kind === null) {
    return {
      kind: "unknown",
      label: SUBPROJECT_HEADLINE_LABEL.unknown,
      reason: `coord sent a headline this page does not know ("${String(raw)}")`,
      attention: attentionOf(SUBPROJECT_ATTENTION_BY_HEADLINE, String(raw)),
    };
  }
  return {
    kind,
    label: SUBPROJECT_HEADLINE_LABEL[kind],
    reason: topReason
      ? topReason.summary || reasonWords(topReason.kind).label
      : kind === "needs_you" || kind === "stalled" || kind === "unknown"
        ? "coord gave no reason"
        : undefined,
    attention: attentionOf(SUBPROJECT_ATTENTION_BY_HEADLINE, kind),
  };
}

/** A list row's status: the CACHED verdict, with its `as_of` (D1). */
export function deriveSubprojectStatus(
  s: Pick<SubprojectSummary, "headline" | "verdict_as_of" | "top_reason">
): RowStatus<SubprojectHeadlineKind> {
  return headlineStatus(s.headline, s.verdict_as_of, s.top_reason);
}

/** The detail page's status: the verdict computed LIVE on this read. */
export function deriveVerdictStatus(
  v: Pick<SubprojectVerdict, "headline" | "reasons" | "as_of"> | null
): RowStatus<SubprojectHeadlineKind> {
  if (v === null) return headlineStatus(null, null, null);
  return headlineStatus(v.headline, v.as_of, v.reasons[0] ?? null);
}

// ─────────────────────────────── reasons ───────────────────────────────

const REASON_LABEL: Readonly<Record<string, string>> = {
  gate_dependency_unowned: "Waiting on work nobody is doing",
  gate_unsatisfiable: "A gate can never clear",
  gate_failed_unreplaced: "A gate failed and nothing replaced it",
  gate_should_have_fired: "A gate should have fired and has not",
  continuation_not_running: "A gate's follow-up session never ran",
  abandoned: "Unfinished work with no live session",
  session_stuck: "A session is stuck",
  needs_operator: "Waiting on your answer",
  source_unreadable: "coord could not read part of the evidence",
};

/** A reason kind in the operator's words. An unrecognised kind keeps coord's
 *  own token (spaced) and says it is unrecognised, rather than inventing a
 *  meaning for it. */
export function reasonWords(kind: string): {
  label: string;
  recognised: boolean;
} {
  const label = Object.prototype.hasOwnProperty.call(REASON_LABEL, kind)
    ? REASON_LABEL[kind]
    : undefined;
  return label
    ? { label, recognised: true }
    : { label: `coord reason: ${kind.replace(/_/g, " ")}`, recognised: false };
}

// ─────────────────────────────── refs and links ───────────────────────────

/** Where a reference can be opened. `none` carries why it cannot. */
export type RefTarget =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string }
  | { kind: "none"; why: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** GitHub's owner and repository grammar, then `#<number>`. */
const PR_ID = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/;

/** Only an `https:` URL is ever rendered as a link coord handed us. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** `owner/repo#N` → the PR's GitHub page, or `null` when it is not that. */
export function githubPrUrl(prId: string): string | null {
  const m = PR_ID.exec(prId.trim());
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
}

/** What the detail page knows that a bare ref does not: the member units'
 *  slugs (the work-unit page is slug-keyed) and coord's own PR urls. */
export interface RefContext {
  units?: ReadonlyArray<Pick<SubprojectMemberUnit, "work_unit_id" | "slug">>;
  prs?: ReadonlyArray<Pick<SubprojectMemberPr, "repo" | "number" | "url">>;
}

export function refTarget(ref: SubprojectRef, ctx: RefContext = {}): RefTarget {
  const id = ref.id.trim();
  if (id === "")
    return { kind: "none", why: "coord sent this reference without an id" };
  switch (ref.type) {
    case "session":
      // `/sessions/[key]` resolves a harness session id (D3), a coord session
      // id or a name, so the id coord sends opens as it is.
      return { kind: "internal", href: `/sessions/${encodeURIComponent(id)}` };
    case "gate":
      return {
        kind: "internal",
        href: `/admin/coord/gates?gate=${encodeURIComponent(id)}`,
      };
    case "subproject":
      return {
        kind: "internal",
        href: `/admin/coord/subprojects/${encodeURIComponent(id)}`,
      };
    case "question":
      return {
        kind: "internal",
        href: `/admin/coord/questions/${encodeURIComponent(id)}`,
      };
    case "work_unit": {
      // The work-unit page is keyed by SLUG (coord's door reads `WHERE slug`),
      // so a uuid opens only when a member unit names its slug.
      const member = ctx.units?.find((u) => u.work_unit_id === id);
      const slug = member ? member.slug : UUID.test(id) ? null : id;
      return slug
        ? {
            kind: "internal",
            href: `/admin/coord/work-units/${encodeURIComponent(slug)}`,
          }
        : {
            kind: "none",
            why: "this work unit is not a member here, so its slug — what its page is keyed by — is not known",
          };
    }
    case "pr": {
      const known = ctx.prs?.find((p) => `${p.repo}#${p.number}` === id);
      const href = safeExternalUrl(known?.url) ?? githubPrUrl(id);
      return href
        ? { kind: "external", href }
        : {
            kind: "none",
            why: `coord's pull request id "${id}" is not owner/repo#N`,
          };
    }
    default:
      return {
        kind: "none",
        why: `a reference of kind "${ref.type}" that this page cannot open`,
      };
  }
}

/** A member PR's page: coord's url when it is an https one, else GitHub's. */
export function prHref(
  pr: Pick<SubprojectMemberPr, "repo" | "number" | "url">
): string | null {
  return safeExternalUrl(pr.url) ?? githubPrUrl(`${pr.repo}#${pr.number}`);
}

// ─────────────────────────────── next steps ───────────────────────────────

const NEXT_STEP_SOURCE: Readonly<Record<string, string>> = {
  note: "Note",
  gate: "When a gate clears",
  unit_phase: "Plan phases left",
  remedy: "To restart it",
};

const REMEDY_LABEL: Readonly<Record<string, string>> = {
  spawn_to_adopt_pr: "Spawn a session to adopt the pull request",
  spawn_to_resume_unit: "Spawn a session to resume the work unit",
  rearm_gate: "Re-arm the gate",
  answer_question: "Answer the question",
};

function own(
  table: Readonly<Record<string, string>>,
  key: string
): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;
}

/** A next step's provenance (D7) and, for a remedy, what kind it is. */
export function nextStepWords(
  step: Pick<SubprojectNextStep, "source" | "remedy_kind">
): {
  source: string;
  remedy: string | null;
} {
  return {
    source:
      own(NEXT_STEP_SOURCE, step.source) ?? step.source.replace(/_/g, " "),
    remedy:
      step.remedy_kind === null
        ? null
        : (own(REMEDY_LABEL, step.remedy_kind) ??
          step.remedy_kind.replace(/_/g, " ")),
  };
}

/** The phases a member unit has left (D7 c). `null` is UNKNOWN, never none. */
export function phasesRemainingWords(phases: number[] | null): string {
  if (phases === null) return "phases left unknown";
  if (phases.length === 0) return "no phases left";
  return `${phases.length === 1 ? "phase" : "phases"} ${phases.join(", ")} left`;
}

// ─────────────────────────────── member sessions ───────────────────────────

/** A member session's state, as this console words it. */
export type SubprojectSessionKind =
  | "live"
  | "pending"
  | "stale"
  | "closed"
  | "unknown";

/**
 * Who must act, per member-session state — the audit table:
 *
 * - `live` → **none**: running; nobody is blocked on it.
 * - `pending` → **waiting**: an allocation Continue spawned whose harness
 *   session has not reported yet; it clears when the runner reports (D8).
 * - `stale` → **waiting**: it stopped heartbeating without closing, so
 *   whether it is alive is not known — the ignorance floor.
 * - `closed` → **none**: it ended. Whether its work FINISHED is said in words
 *   beside it (`session_status`), never in the hue: a closed-unfinished
 *   session's consequence is the subproject's `abandoned` reason, which the
 *   headline already paints.
 * - `unknown` → **waiting**: coord could not read its liveness.
 */
export const SUBPROJECT_SESSION_ATTENTION_BY_KIND: Record<
  SubprojectSessionKind,
  Attention
> = {
  live: "none",
  pending: "waiting",
  stale: "waiting",
  closed: "none",
  unknown: "waiting",
};

export const SUBPROJECT_SESSION_CLASS: Record<SubprojectSessionKind, string> = {
  live: CI_YELLOW,
  pending: WAITING_AMBER,
  stale: UNKNOWN_AMBER,
  closed: INERT,
  unknown: UNKNOWN_AMBER,
};

export const SUBPROJECT_SESSION_AUTHOR_GLYPH_KINDS: ReadonlySet<SubprojectSessionKind> =
  new Set<SubprojectSessionKind>();

export const SUBPROJECT_SESSION_PALETTE: StatusPalette<SubprojectSessionKind> =
  {
    badgeClass: SUBPROJECT_SESSION_CLASS,
    authorGlyphKinds: SUBPROJECT_SESSION_AUTHOR_GLYPH_KINDS,
  };

const SESSION_LABEL: Record<SubprojectSessionKind, string> = {
  live: "Live",
  pending: "Pending",
  stale: "Stale",
  closed: "Closed",
  unknown: "Unknown",
};

const SESSION_WORK_WORDS: Readonly<Record<string, string>> = {
  finished: "finished",
  working: "working",
  blocked: "blocked",
  stalled: "stalled",
  waiting_human: "waiting on a person",
};

/** coord's `session_status` in words. NULL is UNKNOWN — never "unfinished"
 *  (the plan's "Unknown is first-class"). */
export function sessionWorkWords(status: string | null): string {
  if (status === null) return "work status not recorded";
  return own(SESSION_WORK_WORDS, status) ?? status.replace(/_/g, " ");
}

const JOINED_VIA_WORDS: Readonly<Record<string, string>> = {
  root: "started this subproject",
  parent: "a member session's child (handoff or respawn)",
  gate_continuation: "a member gate's continuation",
  work_unit_dispatch: "dispatched for a member work unit",
  spawn: "spawned by Continue",
  declared: "declared by the session",
  operator_move: "moved here by an operator",
  auto_attach: "attached automatically",
  followup_edge: "a follow-up plan's work unit",
  split: "split from another subproject",
  backfill: "found by the backfill",
  merge: "merged in from another subproject",
};

/** How a member joined (the ledger's `joined_via`), in words. */
export function joinedViaWords(joinedVia: string): string {
  return own(JOINED_VIA_WORDS, joinedVia) ?? joinedVia.replace(/_/g, " ");
}

function sessionKindOf(
  s: Pick<SubprojectMemberSession, "pending" | "liveness">
): SubprojectSessionKind {
  if (s.pending) return "pending";
  switch (s.liveness) {
    case "live":
      return "live";
    case "stale":
      return "stale";
    case "closed":
      return "closed";
    default:
      return "unknown";
  }
}

/** A member session's row status: liveness in the hue, work in the words. */
export function deriveMemberSessionStatus(
  s: Pick<
    SubprojectMemberSession,
    | "pending"
    | "liveness"
    | "session_status"
    | "finish_reason"
    | "allocation_agent_id"
  >
): RowStatus<SubprojectSessionKind> {
  const kind = sessionKindOf(s);
  let reason: string;
  if (kind === "pending") {
    reason = "spawned; waiting for the runner to report its session";
  } else if (kind === "unknown" && s.liveness !== "unknown") {
    reason = `coord sent a liveness this page does not know ("${s.liveness}")`;
  } else {
    reason = sessionWorkWords(s.session_status);
    if (s.finish_reason) reason += ` — ${s.finish_reason}`;
  }
  return {
    kind,
    label: SESSION_LABEL[kind],
    reason,
    attention: SUBPROJECT_SESSION_ATTENTION_BY_KIND[kind],
  };
}

const SESSION_ORDER: Record<SubprojectSessionKind, number> = {
  live: 0,
  pending: 1,
  stale: 2,
  unknown: 3,
  closed: 4,
};

/** Open sessions first (live, pending, stale, unknown), closed last; newest
 *  activity first within each. A copy — the input is not reordered. */
export function sortMemberSessions<T extends SubprojectMemberSession>(
  sessions: readonly T[]
): T[] {
  const t = (s: T) => Date.parse(s.last_seen ?? s.added_at) || 0;
  return [...sessions].sort(
    (a, b) =>
      SESSION_ORDER[sessionKindOf(a)] - SESSION_ORDER[sessionKindOf(b)] ||
      t(b) - t(a)
  );
}

/** The id `/sessions/[key]` resolves, when the member has one yet. */
export function memberSessionKey(
  s: Pick<SubprojectMemberSession, "agent_session_id" | "coord_session_id">
): string | null {
  return s.agent_session_id ?? s.coord_session_id ?? null;
}

// ─────────────────────────────── member gates ─────────────────────────────

/** A member gate as this console words it: its mover while open, its verdict
 *  once its story is over. */
export type SubprojectGateKind =
  | "not_watched"
  | "unknown"
  | "watched"
  | "landed"
  | "retired"
  | "closed";

/**
 * Who must act, per member-gate state — the audit table:
 *
 * - `not_watched` → **author**: the gate waits on something nothing alive is
 *   moving; it is the dead dependency the headline's reason names, and only a
 *   person restarts it.
 * - `unknown` → **waiting**: whether anything is moving it could not be read —
 *   the ignorance floor.
 * - `watched` → **waiting**: a live mover holds what it waits on; it clears
 *   itself.
 * - `landed` → **none**: what it waited on landed; coord's evaluator clears
 *   it on its next pass.
 * - `retired` → **none**: its mover was retired deliberately.
 * - `closed` → **none**: the gate is terminal (cleared, failed, withdrawn).
 *   A failed gate nothing replaced is the subproject's own reason
 *   (`gate_failed_unreplaced`), which the headline paints.
 */
export const SUBPROJECT_GATE_ATTENTION_BY_KIND: Record<
  SubprojectGateKind,
  Attention
> = {
  not_watched: "author",
  unknown: "waiting",
  watched: "waiting",
  landed: "none",
  retired: "none",
  closed: "none",
};

export const SUBPROJECT_GATE_CLASS: Record<SubprojectGateKind, string> = {
  not_watched: AUTHOR_RED,
  unknown: UNKNOWN_AMBER,
  watched: WAITING_AMBER,
  landed: CI_YELLOW,
  retired: INERT,
  closed: INERT,
};

export const SUBPROJECT_GATE_AUTHOR_GLYPH_KINDS: ReadonlySet<SubprojectGateKind> =
  new Set<SubprojectGateKind>(["not_watched"]);

export const SUBPROJECT_GATE_PALETTE: StatusPalette<SubprojectGateKind> = {
  badgeClass: SUBPROJECT_GATE_CLASS,
  authorGlyphKinds: SUBPROJECT_GATE_AUTHOR_GLYPH_KINDS,
};

const GATE_LABEL: Record<Exclude<SubprojectGateKind, "closed">, string> = {
  not_watched: "Nothing moving it",
  unknown: "Mover unknown",
  watched: "Has a mover",
  landed: "Dependency landed",
  retired: "Mover retired",
};

function gateKindOf(
  g: Pick<SubprojectMemberGate, "verdict" | "mover">
): SubprojectGateKind {
  if (isTerminalGateVerdict(g.verdict)) return "closed";
  switch (g.mover.state) {
    case "not_watched":
      return "not_watched";
    case "watched":
      return "watched";
    case "landed":
      return "landed";
    case "retired":
      return "retired";
    default:
      return "unknown";
  }
}

/** A member gate's row status. */
export function deriveMemberGateStatus(
  g: Pick<SubprojectMemberGate, "verdict" | "mover">
): RowStatus<SubprojectGateKind> {
  const kind = gateKindOf(g);
  // `unknown` is either coord saying so, or a mover state this build has no
  // word for — only the second is worth naming as such.
  const recognised = kind !== "unknown" || g.mover.state === "unknown";
  return {
    kind,
    label:
      kind === "closed"
        ? g.verdict.charAt(0).toUpperCase() + g.verdict.slice(1).toLowerCase()
        : GATE_LABEL[kind],
    reason: recognised
      ? g.mover.summary || undefined
      : `coord sent a mover state this page does not know ("${g.mover.state}")`,
    attention: SUBPROJECT_GATE_ATTENTION_BY_KIND[kind],
  };
}

const GATE_ORDER: Record<SubprojectGateKind, number> = {
  not_watched: 0,
  unknown: 1,
  watched: 2,
  landed: 3,
  retired: 4,
  closed: 5,
};

/** Open gates first — the one with nothing moving it at the top — terminal
 *  ones last (D12: "open first, mover"). A copy. */
export function sortMemberGates<T extends SubprojectMemberGate>(
  gates: readonly T[]
): T[] {
  return [...gates].sort(
    (a, b) => GATE_ORDER[gateKindOf(a)] - GATE_ORDER[gateKindOf(b)]
  );
}

/** Proven or uncertain attribution (D2), in words. */
export function gateAttributionWords(attribution: string): string {
  if (attribution === "proven") return "registered by a member session";
  if (attribution === "uncertain")
    return "attribution uncertain: registered with no session id, by a member session's device while that session was alive";
  return `attribution: ${attribution.replace(/_/g, " ")}`;
}

// ─────────────────────────────── units and PRs ───────────────────────────

const PROJECT_STATE_WORDS: Readonly<Record<string, string>> = {
  waiting_on_gate: "waiting on a gate",
  not_started: "not started",
  in_progress: "in progress",
};

/** coord's project-state class for a unit, in words; `null` is unknown. */
export function projectStateWords(cls: string | null): string {
  if (cls === null) return "project state unknown";
  return own(PROJECT_STATE_WORDS, cls) ?? cls.replace(/_/g, " ");
}

/** A PR's state in words; `null` is unknown. */
export function prStateWords(state: string | null): string {
  if (state === null) return "state unknown";
  return state.replace(/_/g, " ").toLowerCase();
}

/** The repos a Continue starts with, from the detail's PRs (`owner/repo` →
 *  `repo`), first appearance first. The contract's member units and sessions
 *  carry no repo, so this is what the page knows; an empty list lets coord
 *  derive them from the members' work units and worktrees (D8). */
export function defaultContinueRepos(
  prs: ReadonlyArray<Pick<SubprojectMemberPr, "repo">>
): string[] {
  const out: string[] = [];
  for (const pr of prs) {
    const name = pr.repo.split("/").filter(Boolean).pop()?.trim() ?? "";
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// ─────────────────────────────── sources ───────────────────────────────

/** The sources the live verdict could not read — each one a block of the
 *  headline that rests on missing evidence (D6, "Unknown is first-class"). */
export function unreadSources(
  sources: readonly SubprojectSource[]
): SubprojectSource[] {
  return sources.filter((s) => s.state !== "read");
}

export function sourceStateWords(state: string): string {
  if (state === "could_not_read") return "could not be read";
  if (state === "stale") return "read from a stale copy";
  if (state === "unknown") return "state unknown";
  if (state === "read") return "read";
  return state.replace(/_/g, " ");
}

// ─────────────────────────────── list views ───────────────────────────────

/** The list's tabs (D12). `all` is the only view one-offs, scheduled and
 *  merged subprojects are listed under. */
export type SubprojectTab =
  | "needs_you"
  | "stalled"
  | "working"
  | "waiting"
  | "done"
  | "all";

export const SUBPROJECT_TABS: readonly SubprojectTab[] = [
  "needs_you",
  "stalled",
  "working",
  "waiting",
  "done",
  "all",
];

export const SUBPROJECT_TAB_LABEL: Record<SubprojectTab, string> = {
  needs_you: "Needs you",
  stalled: "Stalled",
  working: "Working",
  waiting: "Waiting",
  done: "Done",
  all: "All",
};

/** A tab from a URL's `?tab=`, defaulting to All. */
export function tabOf(raw: string | null | undefined): SubprojectTab {
  return (SUBPROJECT_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as SubprojectTab)
    : "all";
}

/**
 * The query a view reads. The active headlines read `status=open`: a
 * subproject declared done or archived is not stalled, whatever its last
 * cached headline was. Done reads every status, so a subproject the operator
 * marked done is still found under Done; All reads every status, so nothing is
 * hidden from it.
 */
export function viewQuery(
  view: SubprojectTab | "unknown",
  limit: number,
  cursor?: string | null
): URLSearchParams {
  const q = new URLSearchParams();
  if (view === "done" || view === "all") q.set("status", "all");
  else q.set("status", "open");
  if (view !== "all") q.set("headline", view);
  q.set("limit", String(limit));
  if (cursor) q.set("cursor", cursor);
  return q;
}

/** Why a row is listed only under All (D12), or `null` when it is not. */
export function foldedReason(
  s: Pick<
    SubprojectSummary,
    "origin" | "merged_into" | "headline" | "sessions" | "work_units"
  >
): string | null {
  if (s.merged_into) return "merged into another subproject";
  if (s.origin === "scheduled") return "a scheduled task's standing subproject";
  if (
    s.headline === "done" &&
    s.sessions.total === 1 &&
    s.work_units.total === 0
  )
    return "a one-off: a single finished session and no work units";
  return null;
}

/** A count for a badge or a tab: `null` is a dash, never a zero (R6). */
export function countText(n: number | null | undefined): string {
  return typeof n === "number" ? String(n) : "–";
}

/** `live/total` for a row; either half may be unknown. */
export function sessionsText(
  c: Pick<SubprojectSummary["sessions"], "live" | "total">
): string {
  return `${countText(c.live)}/${countText(c.total)}`;
}

export function sessionsTitle(
  c: Pick<SubprojectSummary["sessions"], "live" | "total">
): string {
  if (c.live === null || c.total === null)
    return "coord did not report how many member sessions are live — a dash is unknown, not zero";
  return `${c.live} of ${c.total} member session${c.total === 1 ? "" : "s"} live`;
}

// ─────────────────────────────── read failures ─────────────────────────────

/** Why a subprojects read did not answer, as the page must say it. */
export type SubprojectReadFailure =
  /** coord's 503 before the alembic revision applies. */
  | { kind: "migration_pending" }
  /** No door serves the route yet: coord's router fallback, or a web backend
   *  that does not mount the proxy. */
  | { kind: "not_served"; status: number }
  /** Nothing answered: the web backend's own 502/504, or the network. */
  | { kind: "unreachable"; status: number | null; detail: string }
  /** An answer that refused the read. */
  | { kind: "refused"; status: number; code: string; detail: string };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Is this a 404 from a door that is not there, rather than coord answering
 *  "no such subproject"? coord's router fallback answers `no_such_route`; a
 *  web backend without the proxy answers its generic `Not Found`. */
export function isRouteMissing(err: unknown): boolean {
  const status = httpStatusOf(err);
  if (status === 405 || status === 501) return true;
  if (status !== 404) return false;
  const body = extractCoordRefusal(httpBodyOf(err) ?? "");
  const code = str(body?.error);
  return (
    code === "no_such_route" ||
    (code === "NOT_FOUND" && str(body?.message) === "Not Found")
  );
}

/** Classify a rejected subprojects read by its STATUS and its structured
 *  body — never by sniffing prose. */
export function classifySubprojectReadFailure(
  err: unknown
): SubprojectReadFailure {
  const status = httpStatusOf(err);
  if (status === null) {
    return {
      kind: "unreachable",
      status: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  const body = extractCoordRefusal(httpBodyOf(err) ?? "");
  const code = str(body?.error);
  if (code === "schema_migration_pending") return { kind: "migration_pending" };
  if (isRouteMissing(err)) return { kind: "not_served", status };
  const detail = str(body?.detail) || str(body?.message) || str(body?.hint);
  if (status === 502 || status === 504) {
    return { kind: "unreachable", status, detail };
  }
  return { kind: "refused", status, code, detail };
}

/** The failure as one sentence for the page. */
export function readFailureWords(f: SubprojectReadFailure): string {
  switch (f.kind) {
    case "migration_pending":
      return "coord's subproject tables are not migrated yet (schema_migration_pending)";
    case "not_served":
      return `this deployment does not serve subprojects yet (HTTP ${f.status})`;
    case "unreachable":
      return f.status === null
        ? `coord did not answer${f.detail ? ` (${f.detail})` : ""}`
        : `coord did not answer (HTTP ${f.status}${f.detail ? `: ${f.detail}` : ""})`;
    case "refused":
      return `coord refused the read (HTTP ${f.status}${f.code ? `, ${f.code}` : ""}${f.detail ? `: ${f.detail}` : ""})`;
  }
}

// ─────────────────────────────── the list's health strip ───────────────────

/** One count per view, as coord counted it: `null` is unread or uncounted. */
export type SubprojectCounts = Record<SubprojectTab | "unknown", number | null>;

export const NO_COUNTS: SubprojectCounts = {
  needs_you: null,
  stalled: null,
  working: null,
  waiting: null,
  done: null,
  all: null,
  unknown: null,
};

export interface SubprojectsHealthInput {
  counts: SubprojectCounts;
  unattached: number | null;
  /** Has any count read ever answered? */
  loaded: boolean;
  /** The latest poll's failure, when it failed. */
  failure: SubprojectReadFailure | null;
}

export interface SubprojectsHealth {
  level: "green" | "amber" | "red";
  headline: string;
  detail: string;
  /** Whether the counts on screen are this poll's: a consumer that quotes a
   *  count asks this, then the count itself. */
  readIsCurrent: boolean;
}

function plural(n: number, kind: SubprojectHeadlineKind): string {
  const [one, many] = HEADLINE_PHRASE[kind];
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The strip's verdict over the counts on the page (R1: derived, never a
 * second fetch; R6: three arms, the failure first).
 *
 * - **Unknown** — no count read has ever answered: amber, every count a dash,
 *   and the failure's own reason (a pending migration and an undeployed door
 *   are said as what they are).
 * - **Stale** — counts answered earlier and the latest read failed: the
 *   counts stay (they were measured), the level is amber whatever they say,
 *   and the headline is dated as the last good read, never an all-clear.
 * - **Current** — red when anything needs the operator or is stalled; amber
 *   when a verdict is unknown or a count did not come back; green only on a
 *   MEASURED zero of all three. Waiting and working never move the level:
 *   they are the healthy states.
 */
export function deriveSubprojectsHealth(
  input: SubprojectsHealthInput
): SubprojectsHealth {
  const { counts, failure, loaded } = input;
  if (failure && !loaded) {
    return {
      level: "amber",
      headline:
        failure.kind === "migration_pending"
          ? "Subprojects cannot be read yet — coord's tables are not migrated"
          : failure.kind === "not_served"
            ? "This deployment does not serve subprojects yet"
            : "Subprojects could not be read",
      detail: `${readFailureWords(failure)}. Every count is a dash, not a zero.`,
      readIsCurrent: false,
    };
  }
  if (!loaded) {
    return {
      level: "amber",
      headline: "Reading coord's subprojects…",
      detail: "No count has come back yet; a dash is unknown, not zero.",
      readIsCurrent: false,
    };
  }
  const needs = counts.needs_you;
  const stalled = counts.stalled;
  const unknown = counts.unknown;
  const loud: string[] = [];
  if (needs !== null && needs > 0) loud.push(plural(needs, "needs_you"));
  if (stalled !== null && stalled > 0) loud.push(plural(stalled, "stalled"));
  if (failure) {
    return {
      level: "amber",
      headline:
        loud.length > 0
          ? `At the last good read: ${loud.join(" · ")}`
          : "Nothing was stalled or waiting on you at the last good read",
      detail: `The latest read failed — ${readFailureWords(failure)}. These counts are from the last read that answered.`,
      readIsCurrent: false,
    };
  }
  if (loud.length > 0) {
    return {
      level: "red",
      headline: loud.join(" · "),
      detail:
        "A stalled subproject has nothing alive moving it, and nothing will restart it unless someone does.",
      readIsCurrent: true,
    };
  }
  if (needs === null || stalled === null) {
    return {
      level: "amber",
      headline: "Some counts did not come back",
      detail:
        "coord answered without counting every view, so whether anything is stalled or waiting on you is unknown.",
      readIsCurrent: true,
    };
  }
  if (unknown === null || unknown > 0) {
    return {
      level: "amber",
      headline:
        unknown === null
          ? "Nothing is stalled or waiting on you; whether any verdict is unknown was not counted"
          : `${plural(unknown, "unknown")} — coord could not say whether ${unknown === 1 ? "it is" : "they are"} moving`,
      detail:
        "An unknown verdict is one coord has not computed, or one resting on evidence it could not read.",
      readIsCurrent: true,
    };
  }
  return {
    level: "green",
    headline: "Nothing is stalled or waiting on you",
    detail:
      "Every open subproject is working, waiting on a named mover, or done.",
    readIsCurrent: true,
  };
}

// ─────────────────────────────── the home count line ─────────────────────

export interface StalledLineInput {
  /** coord's `total` for `headline=stalled`, or `null` when not counted. */
  count: number | null;
  loaded: boolean;
  stale: boolean;
  failure: SubprojectReadFailure | null;
}

/**
 * `/admin/coord/home`'s one line (F3): how many subprojects have nothing
 * moving them. A dash until a read answers (R6); the latest failure named
 * beside a kept count; a pending migration or an undeployed door said as
 * what it is.
 */
export function describeStalledLine(input: StalledLineInput): {
  value: string;
  note: string | null;
} {
  if (!input.loaded) {
    return {
      value: "–",
      note: input.failure
        ? `${readFailureWords(input.failure)} — unknown, not zero`
        : null,
    };
  }
  const value = countText(input.count);
  if (input.stale && input.failure) {
    return {
      value,
      note: `as of the last good read; the latest failed — ${readFailureWords(input.failure)}`,
    };
  }
  if (input.count === null) {
    return {
      value,
      note: "coord answered without counting them — unknown, not zero",
    };
  }
  return { value, note: null };
}

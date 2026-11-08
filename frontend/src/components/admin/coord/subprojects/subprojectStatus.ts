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
import {
  gateVerdictGroupOf,
  isTerminalGateVerdict,
  type GateVerdictGroup,
} from "@/app/(app)/admin/coord/gates/gateStatus";
import type {
  SubprojectCountsFacet,
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

/**
 * A reason whose cause lies in ANOTHER subproject (D6: "reported with the
 * OTHER subproject's id and headline, so the page links straight to where
 * the stall actually is"). coord names that subproject in
 * `detail.other_subproject`, its headline in `detail.other_headline`, and
 * puts a `subproject` ref to it in `refs`; the page shows the headline beside
 * that ref. `null` unless both are there and the headline is one this build
 * knows — an absent or unknown headline shows nothing extra, never a guessed
 * one.
 */
export function otherSubprojectOf(
  reason: Pick<SubprojectReason, "detail">
): { id: string; status: RowStatus<SubprojectHeadlineKind> } | null {
  const detail = reason.detail;
  if (typeof detail !== "object" || detail === null) return null;
  const id = detail.other_subproject;
  const kind = headlineKindOf(detail.other_headline);
  if (typeof id !== "string" || id === "" || kind === null) return null;
  return {
    id,
    status: {
      kind,
      label: SUBPROJECT_HEADLINE_LABEL[kind],
      reason: `That subproject's own headline: ${HEADLINE_PHRASE[kind][0]}`,
      attention: SUBPROJECT_ATTENTION_BY_HEADLINE[kind],
    },
  };
}

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

/**
 * Words for each group the gates console reads a verdict into
 * (`gateStatus.ts` `gateVerdictGroupOf`, which that console's row, progress
 * bar and terminal test also read through) — so a member gate's verdict falls
 * in the group the gates console gives it. That console colours by the group;
 * here a member gate's badge is its mover, and a terminal gate is `closed`
 * (calm). Coord's own word is on the raw line.
 */
const GATE_VERDICT_GROUP_WORDS: Record<GateVerdictGroup, string> = {
  cleared: "cleared",
  failed: "failed",
  withdrawn: "withdrawn",
  evaluating: "being evaluated",
  pending: "not cleared yet",
};

/**
 * A member gate's verdict in words (R8); coord's own word is on the raw line.
 * A failure says which failure when coord's word says more than "failed" — a
 * `misconfigured` gate is fixed in its registration, not by waiting — and a
 * word this console has no reading for is said to be one.
 */
export function gateVerdictWords(verdict: string | null | undefined): string {
  const v = (verdict ?? "").trim().toLowerCase();
  if (v === "") return "not reported";
  const group = gateVerdictGroupOf(v);
  if (group === null)
    return `"${v.replace(/_/g, " ")}", a verdict this console has no reading for`;
  const words = GATE_VERDICT_GROUP_WORDS[group];
  return group === "failed" && v !== "failed"
    ? `${words} — ${v.replace(/_/g, " ")}`
    : words;
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

const PREDICATE_WORDS: Readonly<Record<string, string>> = {
  pr_merged: "PR merged",
  gate_cleared: "another gate cleared",
  unit_status: "work unit status",
  claim_terminal: "claim ended",
  operator_approval: "your approval",
  time_elapsed: "time elapsed",
  deploy_healthy: "deploy healthy",
  commit_live: "commit live",
  ci_green: "CI green",
  ref_exists: "ref exists",
  metric_threshold: "metric threshold",
  plan_ready: "plan ready",
  schema_object_exists: "schema object exists",
};

/** What a gate waits for, in words (R8). A predicate this build has no word
 *  for reads as coord's own token with its underscores spaced — a closed
 *  vocabulary that names no machine or person (style guide §3.11); the raw
 *  token itself stays on the raw-ids line. */
export function predicateKindWords(kind: string): string {
  return own(PREDICATE_WORDS, kind) ?? kind.replace(/_/g, " ");
}

/** Proven or uncertain attribution (D2), in words. */
export function gateAttributionWords(attribution: string): string {
  if (attribution === "proven") return "registered by a member session";
  if (attribution === "uncertain")
    return "attribution uncertain: registered with no session id, by a member session's device while that session was alive";
  return `attribution: ${attribution.replace(/_/g, " ")}`;
}

// ─────────────────────────────── history ───────────────────────────────

const HISTORY_EVENT_WORDS: Readonly<Record<string, string>> = {
  created: "founded",
  founded: "founded",
  renamed: "renamed",
  title_set: "renamed",
  goal_set: "goal set",
  next_steps_note_set: "next-steps note written",
  note_written: "next-steps note written",
  status_changed: "status changed",
  marked_done: "marked done",
  reopened: "reopened",
  merged: "merged",
  merged_into: "merged into another subproject",
  member_attached: "member attached",
  member_added: "member added",
  member_moved: "member moved",
  member_removed: "member removed",
  split: "split off",
  spawned: "a session spawned by Continue",
  continued: "a session spawned by Continue",
  verdict_changed: "verdict changed",
};

/** A history event in words (R8); an event this build has no word for reads
 *  as coord's own token, spaced, and the raw token is on the raw-ids line. */
export function historyEventWords(event: string): string {
  return own(HISTORY_EVENT_WORDS, event) ?? event.replace(/_/g, " ");
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

/** A member list as the detail served it: an absent list is UNKNOWN, never
 *  an empty one (the plan's "Unknown is first-class"). */
export function memberList<T>(value: readonly T[] | null | undefined): {
  items: T[];
  known: boolean;
} {
  return Array.isArray(value)
    ? { items: [...value], known: true }
    : { items: [], known: false };
}

/** A member list's empty slot. coord's list is only as complete as the
 *  sources the verdict read, so "none" is qualified when any went unread. */
export function memberEmptyText(
  noun: string,
  known: boolean,
  unread: readonly SubprojectSource[],
  plural = `${noun}s`
): string {
  if (!known)
    return `coord did not send this subproject's ${plural} with this read — unknown, not none.`;
  if (unread.length === 0) return `coord lists no ${noun}.`;
  const names = unread.map((u) => u.source.replace(/_/g, " ")).join(", ");
  return `coord lists no ${noun}, but this verdict could not read ${names}, so the list may be incomplete.`;
}

export function sourceStateWords(state: string): string {
  if (state === "could_not_read") return "could not be read";
  if (state === "stale") return "read from a stale copy";
  if (state === "unknown") return "state unknown";
  if (state === "read") return "read";
  return state.replace(/_/g, " ");
}

// ─────────────────────────────── list views ───────────────────────────────

/**
 * The list's tabs (D12). **Open** is the default: every open subproject that
 * is not done — the plan has one-offs and scheduled subprojects "hidden by
 * default" as its answer to one subproject per root session. One-offs,
 * scheduled and merged subprojects are listed under **All** only.
 */
export type SubprojectTab =
  | "open"
  | "needs_you"
  | "stalled"
  | "working"
  | "waiting"
  | "done"
  | "all";

export const SUBPROJECT_TABS: readonly SubprojectTab[] = [
  "open",
  "needs_you",
  "stalled",
  "working",
  "waiting",
  "done",
  "all",
];

export const SUBPROJECT_TAB_LABEL: Record<SubprojectTab, string> = {
  open: "Open",
  needs_you: "Needs you",
  stalled: "Stalled",
  working: "Working",
  waiting: "Waiting",
  done: "Done",
  all: "All",
};

/** The headlines the Open view is made of: every one but done. */
export const OPEN_HEADLINES: readonly SubprojectHeadlineKind[] = [
  "needs_you",
  "stalled",
  "working",
  "waiting",
  "unknown",
];

/** A tab from a URL's `?tab=`, defaulting to Open. */
export function tabOf(raw: string | null | undefined): SubprojectTab {
  return (SUBPROJECT_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as SubprojectTab)
    : "open";
}

/** Every view a count is kept for: each tab, and `unknown` for the strip. */
export type CountView = SubprojectTab | "unknown";

/** A view that is one filter — one stream of rows. */
export type StreamView = CountView;

/**
 * The query one stream reads. Open is ONE read — every open subproject whose
 * headline is not done (`exclude_headline=done`). The not-done headlines read
 * `status=open`: a subproject declared done or archived is not stalled,
 * whatever its last cached headline was. Done reads every status, so a
 * subproject the operator marked done is still found under Done; All reads
 * every status, so nothing is hidden from it.
 */
export function viewQuery(
  view: StreamView,
  limit: number,
  cursor?: string | null
): URLSearchParams {
  const q = new URLSearchParams();
  if (view === "done" || view === "all") q.set("status", "all");
  else q.set("status", "open");
  if (view === "open") q.set("exclude_headline", "done");
  else if (view !== "all") q.set("headline", view);
  q.set("limit", String(limit));
  if (cursor) q.set("cursor", cursor);
  return q;
}

/**
 * The streams a tab reads: one each. Open's `perHeadline` arm is the fallback
 * for a coord that predates `exclude_headline` — one that refuses it or
 * ignores it — and then Open is the union of the five not-done headlines, one
 * read each, merged.
 */
export function viewStreams(
  tab: SubprojectTab,
  perHeadline = false
): StreamView[] {
  return tab === "open" && perHeadline ? [...OPEN_HEADLINES] : [tab];
}

/** Rows from several streams as one list: each subproject once, the most
 *  recently active first (an unknown time last). */
export function mergeStreamRows(
  pages: ReadonlyArray<readonly SubprojectSummary[]>
): SubprojectSummary[] {
  const seen = new Set<string>();
  const out: SubprojectSummary[] = [];
  for (const page of pages) {
    for (const s of page) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  if (pages.length < 2) return out;
  const t = (s: SubprojectSummary) =>
    Date.parse(s.last_activity_at ?? s.updated_at) || 0;
  return out.sort((a, b) => t(b) - t(a));
}

/**
 * Is this row a one-off? coord's own answer when it sent one (`one_off`, the
 * rule its `counts.folded.one_off` counts by: exactly one member session
 * whose work is `finished`, no work unit, and a `done` headline). `null` is
 * coord saying it could not tell — unknown, so the row stays in its view. A
 * row from a coord that predates the field (it is absent) is judged by the
 * same rule as far as a row can show it: a done headline, one member session
 * no longer live, no work unit. An uncounted half is not evidence of a
 * one-off.
 */
function isOneOff(
  s: Pick<SubprojectSummary, "headline" | "sessions" | "work_units" | "one_off">
): boolean {
  if (typeof s.one_off === "boolean") return s.one_off;
  if (s.one_off === null) return false;
  return (
    s.headline === "done" &&
    s.sessions.total === 1 &&
    s.sessions.live === 0 &&
    s.work_units.total === 0
  );
}

/**
 * Why a row is listed only under All (D12), or `null` when it is not.
 *
 * A row whose headline asks for the operator — needs you, stalled — is NEVER
 * folded out of a view, whatever else is true of it (merged, scheduled, or a
 * flag that calls it a one-off): hiding a stall is the one mistake this page
 * exists not to make.
 */
export function foldedReason(
  s: Pick<
    SubprojectSummary,
    | "origin"
    | "merged_into"
    | "sessions"
    | "work_units"
    | "headline"
    | "one_off"
  >
): string | null {
  const kind = headlineKindOf(s.headline);
  if (kind !== null && SUBPROJECT_ATTENTION_BY_HEADLINE[kind] === "author")
    return null;
  if (s.merged_into) return "merged into another subproject";
  if (s.origin === "scheduled") return "a scheduled task's standing subproject";
  if (isOneOff(s))
    return "a one-off: a single session, now finished, and no work units";
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

const EMPTY_VIEW: Record<SubprojectTab, string> = {
  open: "No open subproject is working, waiting, stalled or waiting on you",
  needs_you: "No open subproject needs you",
  stalled: "No open subproject is stalled",
  working: "No open subproject is working",
  waiting: "No open subproject is waiting",
  done: "No subproject is done",
  all: "No subproject",
};

export interface EmptyViewInput {
  tab: SubprojectTab;
  /** A read for this view has answered. */
  loaded: boolean;
  /** The latest read of this view failed with this. */
  failure: SubprojectReadFailure | null;
  /** Rows are kept from an earlier read, and the latest failed. */
  stale: boolean;
  /** The page's search text, trimmed. */
  query: string;
  /** Rows loaded for this view, before the search and the fold. */
  loadedRows: number;
  /** Of those, how many match the search. */
  matched: number;
  /** Of the matching rows, how many are listed under All only. */
  folded: number;
  /** coord holds more rows for this view than are loaded. */
  more: boolean;
}

/**
 * The empty slot's sentence (R6: the claim is made in words, so every arm
 * that is not a confirmed absence says what it is instead). In order: a view
 * nothing answered for is UNKNOWN; rows that are all folded into All are
 * said to be there; a search that matched nothing says it is about this page;
 * a kept read is dated as the last good one; only then the plain absence.
 */
export function describeEmptyView(i: EmptyViewInput): string {
  const next = i.more ? " More may be on the next page: Load more." : "";
  if (i.failure && !i.loaded)
    return `Whether any subproject is in this view is unknown: ${readFailureWords(i.failure)}.`;
  if (i.folded > 0) {
    const what = i.query
      ? `${i.folded === 1 ? "subproject" : "subprojects"} matching "${i.query}"`
      : i.folded === 1
        ? "subproject"
        : "subprojects";
    return `The ${i.folded} ${what} on this page in this view ${i.folded === 1 ? "is" : "are"} one-off, scheduled or merged, listed under All.${next}`;
  }
  if (i.query && i.loadedRows > 0 && i.matched === 0)
    return `No subproject on this page matches "${i.query}".${next}`;
  if (i.stale && i.failure)
    return `${EMPTY_VIEW[i.tab]} at the last good read; the latest read failed — ${readFailureWords(i.failure)}.`;
  return `${EMPTY_VIEW[i.tab]}.${next}`;
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

// ─────────────────────────────── counts ───────────────────────────────

/**
 * What the page knows about one view's count. Four states, kept apart (R6):
 *
 * - **unread** — nothing has answered (`answered: false`, no failure);
 * - **failed** — this view's read failed and nothing ever answered for it;
 * - **not taken** — coord answered without the number (`value: null`);
 * - **a value** — and, when the latest read of it failed, the value is the
 *   last good one (`failure` set): kept, because it was measured, and said to
 *   be stale.
 */
export interface CountReading {
  value: number | null;
  answered: boolean;
  failure: SubprojectReadFailure | null;
}

export const UNREAD_COUNT: CountReading = {
  value: null,
  answered: false,
  failure: null,
};

export type SubprojectCounts = Record<CountView, CountReading>;

export const NO_COUNTS: SubprojectCounts = {
  open: UNREAD_COUNT,
  needs_you: UNREAD_COUNT,
  stalled: UNREAD_COUNT,
  working: UNREAD_COUNT,
  waiting: UNREAD_COUNT,
  done: UNREAD_COUNT,
  all: UNREAD_COUNT,
  unknown: UNREAD_COUNT,
};

/** A reading after an answer: the number, or `null` for "not taken". */
export function answeredCount(value: number | null): CountReading {
  return { value, answered: true, failure: null };
}

/** A reading after a failed read: the last good number stays, said stale. */
export function failedCount(
  previous: CountReading,
  failure: SubprojectReadFailure
): CountReading {
  return { ...previous, failure };
}

/** The list's `counts` facet, when an answer carries a well-formed one;
 *  `null` for an absent, null or malformed facet — never zeros. */
export function readCountsFacet(body: unknown): SubprojectCountsFacet | null {
  if (typeof body !== "object" || body === null) return null;
  const facet = (body as { counts?: unknown }).counts;
  if (typeof facet !== "object" || facet === null) return null;
  const by = (facet as { by_headline?: unknown }).by_headline;
  const folded = (facet as { folded?: unknown }).folded;
  const asOf = (facet as { as_of?: unknown }).as_of;
  if (typeof by !== "object" || by === null) return null;
  if (typeof folded !== "object" || folded === null) return null;
  const n = (o: object, k: string) => (o as Record<string, unknown>)[k];
  const allNumbers = (o: object, keys: readonly string[]) =>
    keys.every((k) => typeof n(o, k) === "number");
  if (!allNumbers(by, SUBPROJECT_HEADLINES)) return null;
  if (!allNumbers(folded, ["one_off", "scheduled", "merged"])) return null;
  return {
    by_headline: by as SubprojectCountsFacet["by_headline"],
    folded: folded as SubprojectCountsFacet["folded"],
    as_of: typeof asOf === "string" ? asOf : "",
  };
}

/** The two facet reads: the not-done views count over `status=open`, Done and
 *  All over `status=all` — the same filters their rows are read under. */
export type FacetScope = "open" | "all";

export function facetQuery(scope: FacetScope): URLSearchParams {
  return new URLSearchParams({ status: scope, limit: "1" });
}

/** The views each facet answers. */
export const FACET_VIEWS: Record<FacetScope, readonly CountView[]> = {
  open: ["open", ...OPEN_HEADLINES],
  all: ["done", "all"],
};

/** The counts a facet answer gives: `open` → the five not-done headlines and
 *  Open (their sum); `all` → Done and All (the read's own `total`). */
export function countsFromFacet(
  scope: FacetScope,
  facet: SubprojectCountsFacet,
  total: number | null
): Partial<Record<CountView, number | null>> {
  const by = facet.by_headline;
  if (scope === "all") return { done: by.done, all: total };
  return {
    needs_you: by.needs_you,
    stalled: by.stalled,
    working: by.working,
    waiting: by.waiting,
    unknown: by.unknown,
    open: OPEN_HEADLINES.reduce((sum, h) => sum + by[h], 0),
  };
}

/** Open's count from per-view readings (the fallback path): the sum when all
 *  five not-done headlines were counted, else not taken; stale or failed when
 *  any of them is. */
export function openFromParts(parts: readonly CountReading[]): CountReading {
  const failure = parts.find((p) => p.failure !== null)?.failure ?? null;
  const answered = parts.length > 0 && parts.every((p) => p.answered);
  const values = parts.map((p) => p.value);
  const value =
    answered && values.every((v): v is number => v !== null)
      ? values.reduce((sum, v) => sum + v, 0)
      : null;
  return { value, answered, failure };
}

/** Each count view's name, as a tab and the strip say it. */
const COUNT_VIEW_NAME: Record<CountView, string> = {
  ...SUBPROJECT_TAB_LABEL,
  unknown: "Unknown verdicts",
};

/** The order views are named in. */
const COUNT_VIEW_ORDER: readonly CountView[] = [
  "open",
  "needs_you",
  "stalled",
  "working",
  "waiting",
  "unknown",
  "done",
  "all",
];

/**
 * The qualification a tab carries beside a count that is NOT current (R6), or
 * `null` for a current one: a number kept from the last good read, a read
 * that failed with no number to keep, or an answer that did not take the
 * count. The tab renders it as a `*` beside a kept number, as its title, and
 * as screen-reader text, so a stale number never reads as a current one.
 */
export function countNoteOf(r: CountReading): string | null {
  if (r.failure)
    return r.value !== null
      ? `the last good count; the latest read failed (${readFailureWords(r.failure)})`
      : `could not be read (${readFailureWords(r.failure)})`;
  if (r.answered && r.value === null) return "coord did not take this count";
  return null;
}

/** "of M" for the loaded-rows line, qualified when M is not current; empty
 *  when there is no number to quote. */
export function ofCountWords(r: CountReading): string {
  if (r.value === null) return "";
  return r.failure
    ? ` of ${r.value} (the last good count; its latest read failed)`
    : ` of ${r.value}`;
}

function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Every view whose count is not current — named, grouped by why — for the
 * strip's detail line, or `null` when every count is current. `skip` names
 * the views the strip's own sentence already accounts for.
 */
export function staleViewsDetail(
  counts: SubprojectCounts,
  skip: readonly CountView[] = []
): string | null {
  const groups = new Map<string, { kept: string[]; lost: string[] }>();
  for (const view of COUNT_VIEW_ORDER) {
    if (skip.includes(view)) continue;
    const r = counts[view];
    if (!r.failure) continue;
    const why = readFailureWords(r.failure);
    const group = groups.get(why) ?? { kept: [], lost: [] };
    (r.value !== null ? group.kept : group.lost).push(COUNT_VIEW_NAME[view]);
    groups.set(why, group);
  }
  if (groups.size === 0) return null;
  return [...groups]
    .map(([why, g]) => {
      const parts: string[] = [];
      if (g.kept.length > 0)
        parts.push(
          `${listWords(g.kept)} ${g.kept.length === 1 ? "is the last good count" : "are the last good counts"}`
        );
      if (g.lost.length > 0)
        parts.push(`${listWords(g.lost)} could not be read`);
      return `${parts.join("; ")} — the latest read failed (${why})`;
    })
    .join(". ");
}

// ─────────────────────────────── the list's health strip ───────────────────

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

/** Why one of the strip's counts is not a current number, or `null`. */
function countGap(name: string, r: CountReading): string | null {
  if (r.failure)
    return r.value !== null
      ? `the ${name} count is from the last good read; its latest read failed (${readFailureWords(r.failure)})`
      : `the ${name} count could not be read (${readFailureWords(r.failure)})`;
  if (r.value === null)
    return r.answered
      ? `coord did not take the ${name} count`
      : `the ${name} count has not been read`;
  return null;
}

/**
 * The strip's verdict over the counts on the page (R1: derived, never a
 * second fetch; R6: the failure arms first).
 *
 * - **Unknown** — nothing has answered: amber, every count a dash, and the
 *   failure's own reason (a pending migration and an undeployed door are said
 *   as what they are).
 * - **Stale or failed** — the needs-you or stalled count's latest read failed:
 *   amber whatever the numbers say; a kept number is "at the last good read",
 *   a count never read or not taken is said to be unknown — never an
 *   all-clear.
 * - **Current** — red when anything needs you or is stalled; amber when either
 *   count was not taken, or a verdict is unknown; green only on a MEASURED
 *   zero of all three. Waiting and working never move the level.
 *
 * Every arm's detail also names each OTHER view whose count is not current —
 * a Done or All kept from the last good read, say — so the strip and the tabs
 * never disagree about which numbers are old.
 */
export function deriveSubprojectsHealth(
  counts: SubprojectCounts
): SubprojectsHealth {
  const health = deriveHealthArm(counts);
  // Name every other view whose count is not current, so a stale Done or All
  // is said on the strip as well as on its tab (R6).
  const others = staleViewsDetail(counts, health.covers);
  return {
    level: health.level,
    headline: health.headline,
    detail: others ? `${health.detail} ${others}.` : health.detail,
    readIsCurrent: health.readIsCurrent && others === null,
  };
}

/** One arm of the strip, and the views its own sentence already names. */
function deriveHealthArm(
  counts: SubprojectCounts
): SubprojectsHealth & { covers: CountView[] } {
  const needs = counts.needs_you;
  const stalled = counts.stalled;
  const unknown = counts.unknown;
  const readings = Object.values(counts);
  if (!readings.some((r) => r.answered)) {
    const failure = readings.find((r) => r.failure !== null)?.failure ?? null;
    if (failure) {
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
        covers: [...COUNT_VIEW_ORDER],
      };
    }
    return {
      level: "amber",
      headline: "Reading coord's subprojects…",
      detail: "No count has come back yet; a dash is unknown, not zero.",
      readIsCurrent: false,
      covers: [...COUNT_VIEW_ORDER],
    };
  }
  const loud: string[] = [];
  if (needs.value !== null && needs.value > 0)
    loud.push(plural(needs.value, "needs_you"));
  if (stalled.value !== null && stalled.value > 0)
    loud.push(plural(stalled.value, "stalled"));
  const gaps = [
    countGap("needs-you", needs),
    countGap("stalled", stalled),
  ].filter((g): g is string => g !== null);
  if (needs.failure || stalled.failure) {
    return {
      level: "amber",
      headline:
        loud.length > 0
          ? `At the last good read: ${loud.join(" · ")}`
          : needs.value === null || stalled.value === null
            ? "Whether anything is stalled or waiting on you is unknown"
            : "Nothing was stalled or waiting on you at the last good read",
      detail: `${gaps.join("; ")}.`,
      readIsCurrent: false,
      covers: ["needs_you", "stalled"],
    };
  }
  if (loud.length > 0) {
    return {
      level: "red",
      headline: loud.join(" · "),
      detail:
        gaps.length > 0
          ? `${gaps.join("; ")}.`
          : "A stalled subproject has nothing alive moving it, and nothing will restart it unless someone does.",
      readIsCurrent: true,
      covers: ["needs_you", "stalled"],
    };
  }
  if (gaps.length > 0) {
    return {
      level: "amber",
      headline: "Whether anything is stalled or waiting on you is unknown",
      detail: `${gaps.join("; ")}.`,
      readIsCurrent: true,
      covers: ["needs_you", "stalled"],
    };
  }
  const unknownGap = countGap("unknown-verdict", unknown);
  if (unknownGap !== null) {
    return {
      level: "amber",
      headline:
        "Nothing is stalled or waiting on you; whether any verdict is unknown was not counted",
      detail: `${unknownGap}.`,
      readIsCurrent: true,
      covers: ["needs_you", "stalled", "unknown"],
    };
  }
  if (unknown.value !== null && unknown.value > 0) {
    return {
      level: "amber",
      headline: `${plural(unknown.value, "unknown")} — coord could not say whether ${unknown.value === 1 ? "it is" : "they are"} moving`,
      detail:
        "An unknown verdict is one coord has not computed, or one resting on evidence it could not read.",
      readIsCurrent: true,
      covers: ["needs_you", "stalled", "unknown"],
    };
  }
  return {
    level: "green",
    headline: "Nothing is stalled or waiting on you",
    detail:
      "Every open subproject is working, waiting on a named mover, or done.",
    readIsCurrent: true,
    covers: ["needs_you", "stalled", "unknown"],
  };
}

// ─────────────────────────────── the session chip ───────────────────────────

/**
 * A session's subproject, as the sessions console and the session detail page
 * show it beside the session (plan Phase 6). Only a MEMBER links; every other
 * state is a dash whose title says which — a guess is never rendered.
 */
export type SubprojectChip =
  /** No Claude Code session id, so no membership can apply. */
  | { kind: "not_applicable" }
  /** The row's agent half did not answer, so whether it HAS a Claude Code
   *  session id — and so a subproject — is not known. */
  | { kind: "agent_unknown" }
  /** The lookup has not answered for this session yet. */
  | { kind: "looking_up" }
  /** The latest lookup for this session failed. */
  | { kind: "failed"; failure: SubprojectReadFailure }
  /** coord lists no live membership (a pending one included). `stale`:
   *  the latest re-ask failed, so this is the last answer, not a current one. */
  | { kind: "none"; stale?: SubprojectReadFailure | null }
  /** coord answered without naming this session either way. */
  | { kind: "unanswered"; stale?: SubprojectReadFailure | null }
  | {
      kind: "member";
      id: string;
      title: string;
      headline: string;
      stale?: SubprojectReadFailure | null;
    };

export interface SubprojectChipWords {
  /** What the cell shows: the subproject's title, or a dash. */
  text: string;
  /** The full sentence, for a hover. */
  title: string;
  /** Where a member links; `null` for every other state. */
  href: string | null;
  /** The SHORT accessible name, read in place of `text` (a dash says
   *  nothing to a screen reader, and the title is too long to hear per row). */
  label: string;
  /** A kept answer whose re-ask failed: the cell marks it with a visible `*`
   *  (the title and `label` already say why). */
  stale: boolean;
}

export function subprojectChipWords(chip: SubprojectChip): SubprojectChipWords {
  const words = currentChipWords(chip);
  const stale =
    chip.kind === "member" || chip.kind === "none" || chip.kind === "unanswered"
      ? (chip.stale ?? null)
      : null;
  if (stale === null) return words;
  // A kept answer whose re-ask failed: still shown, said to be not current.
  return {
    ...words,
    title: `${words.title} — as of the last lookup that answered; the latest failed (${readFailureWords(stale)})`,
    label: `${words.label}, not current`,
    stale: true,
  };
}

function currentChipWords(chip: SubprojectChip): SubprojectChipWords {
  return { ...chipWordsOf(chip), stale: false };
}

function chipWordsOf(chip: SubprojectChip): Omit<SubprojectChipWords, "stale"> {
  switch (chip.kind) {
    case "member": {
      const kind = headlineKindOf(chip.headline);
      const headline = kind
        ? SUBPROJECT_HEADLINE_LABEL[kind]
        : "verdict unknown";
      return {
        text: chip.title,
        title: `Subproject: ${chip.title} — ${headline}`,
        href: `/admin/coord/subprojects/${encodeURIComponent(chip.id)}`,
        label: `subproject: ${chip.title}, ${headline.toLowerCase()}`,
      };
    }
    case "none":
      return {
        text: "–",
        title:
          "coord lists no subproject for this session (a membership still pending counts as none yet)",
        href: null,
        label: "subproject: none",
      };
    case "not_applicable":
      return {
        text: "–",
        title:
          "No Claude Code session id, so no subproject applies to this row",
        href: null,
        label: "subproject: not applicable",
      };
    case "agent_unknown":
      return {
        text: "–",
        title:
          "Unknown — the agent half did not answer for this row, so its Claude Code session id, and so its subproject, is not known",
        href: null,
        label: "subproject: unknown",
      };
    case "looking_up":
      return {
        text: "–",
        title: "Looking up the subproject…",
        href: null,
        label: "subproject: looking up",
      };
    case "failed":
      return {
        text: "–",
        title: `The subproject lookup failed — ${readFailureWords(chip.failure)}; unknown, not none`,
        href: null,
        label: "subproject: lookup failed",
      };
    case "unanswered":
      return {
        text: "–",
        title:
          "coord's lookup answered without naming this session — unknown, not none",
        href: null,
        label: "subproject: unknown",
      };
  }
}

// ─────────────────────────────── the home count line ─────────────────────

export interface StalledLineInput {
  /** coord's `total` for `headline=stalled`, or `null` when not counted. */
  count: number | null;
  loaded: boolean;
  /** A newer read finished without replacing the count. */
  stale: boolean;
  /** The latest failure, when the latest read failed. */
  failure: SubprojectReadFailure | null;
}

/**
 * `/admin/coord/home`'s one line (F3): how many subprojects have nothing
 * moving them. A dash until a read answers (R6); a kept count after a failed
 * read says it is the last good one — with the reason when there is one, and
 * still as stale when there is none (a newer read that delivered nothing is a
 * read that did not refresh it); a pending migration or an undeployed door is
 * said as what it is.
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
  if (input.stale || input.failure) {
    return {
      value,
      note: input.failure
        ? `as of the last good read; the latest failed — ${readFailureWords(input.failure)}`
        : "as of the last good read; the latest read did not refresh it",
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

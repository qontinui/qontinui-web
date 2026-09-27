/**
 * operatorTouchStatus — everything `/admin/coord/operator-touches` DERIVES, as
 * pure functions, plus R3's audited severity table for the surface.
 *
 * Plan `2026-08-27-operator-touch-read-and-surface` Phase C3 (the web half of
 * C3-operator). Named `*Status.ts` so `consoleSurfaces.test.ts` discovers the
 * attention table (`findingStatus.ts` is the shape this follows).
 *
 * ## What the page is for — and what it deliberately is not
 *
 * The operator's question is STRATEGIC: *which classes of interruption are
 * worth making policy about?* So the page leads with coord's constraint
 * verdict and the reason classes ranked by share, and its record feed is
 * evidence behind those numbers — not a to-do list. Nothing on a touch row is
 * red: the item a touch names (a question, a gate) already carries its own
 * attention on its own surface, and painting it again here would build the
 * second queue the plan forbids (C3-agent, V5).
 *
 * ## R8 is why the derivation lives here
 *
 * `reason_code`, `policy_authorized`, `disposition`, `unclassified` and the
 * touch `kind` are coord's vocabulary. The row and the aggregate carry human
 * labels; the wire words appear only in the expanded detail's raw line (R5),
 * and in a `title` where the operator can hover for them.
 *
 * ## An empty store is "not yet measured", never a healthy zero
 *
 * `coord.operator_touches` shipped empty and stays empty until Plan B's
 * emitter runs. coord answers that as `measurement: "not_yet_measured"` with
 * null rates, and every arm below renders it as such — never `0 touches`, never
 * green. An UNREADABLE store is coord's typed 503, which is unknown, not empty.
 */

import type { Attention } from "@/components/console/attention";
import { attentionOf } from "@/components/console/attention";
import type {
  HealthBadge,
  HealthStripLevel,
} from "@/components/console/HealthStrip";
import {
  UNKNOWN_COUNTS_DETAIL,
  staleDetail,
} from "@/components/console/readFailure";
import { shareOfFraction } from "@/components/console/share";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import { relativeTime } from "@/components/console/time";

// ---------------------------------------------------------------------------
// Wire shapes — coord's `GET /coord/operator-touches`, passed through verbatim
// ---------------------------------------------------------------------------

export type TouchDisposition =
  | "operator_reaching"
  | "agent_dispatchable"
  | "unknown";

export type TouchWindowDays = 7 | 30;

export interface AnswerVia {
  /** `question` | `gate`. */
  kind: string;
  /** `null` exactly when `state` is `missing`. */
  id: string | null;
  /**
   * question: `pending` | `answered`; gate: `open` | `cleared` | `failed` |
   * `misconfigured` | `withdrawn` | `archived`; `missing` = the item the touch
   * names was not found in this tenant.
   */
  state: string | null;
}

export interface OperatorTouch {
  touch_id: string;
  kind?: string | null;
  source?: string | null;
  reason_code?: string | null;
  policy_authorized?: string | null;
  disposition?: string | null;
  emitted_at?: string | null;
  resolved_at?: string | null;
  resolution?: string | null;
  work_unit_id?: string | null;
  gate_id?: string | null;
  /** `null` = the touch names no item to answer. */
  answer_via?: AnswerVia | null;
}

export interface TouchTotals {
  touches: number;
  operator_reaching: number;
  agent_dispatchable: number;
  unknown: number;
}

export interface PolicyAuthorizedSplit {
  yes: number;
  no: number;
  unknown: number;
}

export interface ReasonClass {
  reason_code: string;
  count: number;
  share: number;
  operator_reaching: number;
  agent_dispatchable: number;
  unknown: number;
}

export interface ConstraintVerdict {
  /** `operator` | `machines` | `tokens` | `unknown`. */
  verdict: string;
  reason?: string | null;
  inputs?: Record<string, unknown> | null;
  unknown_inputs?: string[] | null;
  computed_at?: string | null;
}

export interface OperatorTouchesResponse {
  /** `false` on a `before` page: every aggregate field below is then null. */
  aggregate_included?: boolean | null;
  measurement?: "measured" | "not_yet_measured" | string | null;
  window_days?: number | null;
  measured_since?: string | null;
  covered_days?: number | null;
  totals?: TouchTotals | null;
  agent_absorbed_rate?: number | null;
  unknown_share?: number | null;
  policy_authorized_split?: PolicyAuthorizedSplit | null;
  reason_classes?: ReasonClass[] | null;
  touches?: OperatorTouch[] | null;
  next_cursor?: string | null;
  constraint_verdict?: ConstraintVerdict | null;
}

/** The envelope, defensively: coord's shape, and nothing assumed present. */
export function readTouchesBody(body: unknown): OperatorTouchesResponse {
  return body && typeof body === "object"
    ? (body as OperatorTouchesResponse)
    : {};
}

export function touchesOf(body: OperatorTouchesResponse): OperatorTouch[] {
  const raw = body.touches;
  return Array.isArray(raw)
    ? raw.filter((t): t is OperatorTouch => Boolean(t && t.touch_id))
    : [];
}

// ---------------------------------------------------------------------------
// Read failure — coord's typed 400/503, recovered from the thrown message
// ---------------------------------------------------------------------------

/** Why a read failed, as far as the page can tell. */
export interface TouchReadFailure {
  /** HTTP status, or `null` when the read never got an answer. */
  status: number | null;
  /** coord's `error` code (`schema_migration_pending`, `db_unavailable`, `bad_request`). */
  code: string | null;
  /** coord's `detail`, when it sent one. */
  detail: string | null;
}

/**
 * Parse `httpClient`'s `GET <url> failed: <status> - <body>` message.
 *
 * The web proxy forwards coord's error body verbatim (`_proxy_coord_passthrough`),
 * so the body IS coord's `{error, detail}`. The status is anchored on the
 * separator the template emits (same reasoning as `readFailure.isNotFoundError`).
 */
export function parseTouchReadFailure(err: unknown): TouchReadFailure {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const match = /\sfailed:\s(\d{3})\s-\s([\s\S]*)$/.exec(message);
  if (!match) return { status: null, code: null, detail: null };
  const status = Number(match[1]);
  let code: string | null = null;
  let detail: string | null = null;
  try {
    const parsed: unknown = JSON.parse(match[2] ?? "");
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      if (typeof o.error === "string") code = o.error;
      if (typeof o.detail === "string") detail = o.detail;
    }
  } catch {
    // A non-JSON error body (a proxy page): the status is all we know.
  }
  return { status, code, detail };
}

/** A failure, in the operator's words. Never a code on its own. */
export function failureSentence(f: TouchReadFailure): string {
  switch (f.code) {
    case "schema_migration_pending":
      return "coord's touch store is not provisioned in this database yet (a migration is pending)";
    case "db_unavailable":
      return "coord's database did not answer the touch read";
    case "bad_request":
      return `coord refused the query${f.detail ? `: ${f.detail}` : ""}`;
    default:
      return f.status === null
        ? "coord could not be reached"
        : `coord answered HTTP ${f.status}`;
  }
}

// ---------------------------------------------------------------------------
// Human labels (R8)
// ---------------------------------------------------------------------------

/**
 * `map[key]` for an OWN key only. A wire word is untrusted input: a plain
 * index would answer `"constructor"` with `Object`'s constructor.
 */
function own<V>(map: Record<string, V>, key: string | null | undefined): V | undefined {
  return key != null && Object.prototype.hasOwnProperty.call(map, key)
    ? map[key]
    : undefined;
}

const REASON_LABEL: Record<string, string> = {
  unclassified: "Reason not yet recorded",
  operator_held_resource: "Needed something only you hold",
  closed_list_escalation: "A decision policy reserves for you",
  design_fork: "A choice between design directions",
  question_policy_already_answers: "Asked what policy already answers",
  handback_incomplete: "Handed work back unfinished",
  self_narrowed_scope: "Stopped short by narrowing its own scope",
  permission_prompt_on_granted_ground: "Asked permission it already had",
};

/** A reason code, in words. An unknown code is named as such, never shown raw. */
export function reasonLabel(code: string | null | undefined): string {
  if (!code) return "Reason not yet recorded";
  return own(REASON_LABEL, code) ?? "A reason this page does not know yet";
}

const KIND_LABEL: Record<string, string> = {
  question: "question",
  gate: "gate",
  permission_prompt: "permission",
  idle_at_prompt: "idle",
  session_exit: "exit",
  merge_escalation: "merge",
};

/** The short identity chip for a touch's kind. */
export function touchKindChip(kind: string | null | undefined): string {
  return own(KIND_LABEL, kind) ?? "touch";
}

const KIND_SENTENCE: Record<string, string> = {
  question: "An agent asked a question",
  gate: "A gate waited on clearance",
  permission_prompt: "A session stopped at a permission prompt",
  idle_at_prompt: "A session sat idle at its prompt",
  session_exit: "A session ended waiting on a person",
  merge_escalation: "A merge was escalated",
};

export function touchKindSentence(kind: string | null | undefined): string {
  return own(KIND_SENTENCE, kind) ?? "Something reached for a person";
}

const POLICY_NOT_JUDGED = "not yet judged against policy";

const POLICY_WORDS: Record<string, string> = {
  yes: "policy allowed stopping here",
  no: "policy did not call for stopping here",
  unknown: POLICY_NOT_JUDGED,
};

export function policySentence(value: string | null | undefined): string {
  return own(POLICY_WORDS, value) ?? POLICY_NOT_JUDGED;
}

/** Where the item a touch names stands, in words. */
export function answerViaSentence(via: AnswerVia | null | undefined): string {
  if (!via) return "Names no item that could be answered";
  if (via.state === "missing" || via.id === null) {
    return `The ${via.kind === "gate" ? "gate" : "question"} it names is gone or belongs elsewhere`;
  }
  if (via.kind === "question") {
    if (via.state === "pending") return "The question is still waiting for an answer";
    if (via.state === "answered") return "The question has been answered";
    return "The question's state is unknown";
  }
  if (via.kind === "gate") {
    switch (via.state) {
      case "open":
        return "The gate is still open";
      case "cleared":
        return "The gate cleared";
      case "failed":
        return "The gate failed";
      case "misconfigured":
        return "The gate is misconfigured";
      case "withdrawn":
        return "The gate was withdrawn";
      case "archived":
        return "The gate was archived";
      default:
        return "The gate's state is unknown";
    }
  }
  return "Names an item this page cannot read";
}

// ---------------------------------------------------------------------------
// R3 — the row's status, and its audited attention table
// ---------------------------------------------------------------------------

/** What a touch row's badge says — never the wire `disposition` word. */
export type TouchRowKind =
  | "reached_you"
  | "agent_can_handle"
  | "routing_unknown"
  | "unrecognised";

/**
 * The audited kind → attention table (R3). TOTAL over {@link TouchRowKind}:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `reached_you` | `none` | The item it names (a question, a gate) carries its OWN attention on the Questions / Gates surface, where it is answered. Painting it again here would make this page a second queue — the thing plan C3 (V5) forbids. This page is the aggregate; the row is evidence. |
 * | `agent_can_handle` | `none` | An agent's work: the touch is evidence of a missing policy or capability, and an agent answers it through its own door. Nothing is owed to the operator by this row. |
 * | `routing_unknown` | `waiting` | coord's rule table fired no arm, so nobody can say whose move it is — R3's floor for not knowing is amber, never calm. |
 * | `unrecognised` | `waiting` | A disposition word this build has no label for. Same floor. |
 *
 * There is deliberately no `author` row, so nothing on this page is red.
 */
export const TOUCH_ATTENTION_BY_KIND: Record<TouchRowKind, Attention> = {
  reached_you: "none",
  agent_can_handle: "none",
  routing_unknown: "waiting",
  unrecognised: "waiting",
};

export const TOUCH_KIND_CLASS: Record<TouchRowKind, string> = {
  reached_you: "bg-purple-500/10 text-purple-200 border-purple-500/30",
  agent_can_handle: "bg-blue-500/10 text-blue-200 border-blue-500/30",
  routing_unknown: UNKNOWN_AMBER,
  unrecognised: UNKNOWN_AMBER,
};

/** Red ⇔ `✕`: exactly the `author` kinds. There are none. */
export const TOUCH_AUTHOR_GLYPH_KINDS: ReadonlySet<TouchRowKind> = new Set(
  (Object.keys(TOUCH_ATTENTION_BY_KIND) as TouchRowKind[]).filter(
    (k) => TOUCH_ATTENTION_BY_KIND[k] === "author"
  )
);

export const TOUCH_STATUS_PALETTE: StatusPalette<TouchRowKind> = {
  badgeClass: TOUCH_KIND_CLASS,
  authorGlyphKinds: TOUCH_AUTHOR_GLYPH_KINDS,
};

const DISPOSITION_TO_KIND: Record<TouchDisposition, TouchRowKind> = {
  operator_reaching: "reached_you",
  agent_dispatchable: "agent_can_handle",
  unknown: "routing_unknown",
};

const KIND_LABEL_TEXT: Record<TouchRowKind, string> = {
  reached_you: "Reached you",
  agent_can_handle: "Agent can handle",
  routing_unknown: "Routing unknown",
  unrecognised: "Unrecognised routing",
};

const KIND_REASON: Record<TouchRowKind, string> = {
  reached_you:
    "A person had to act — a decision policy reserves, a design choice, or a gate a person cleared.",
  agent_can_handle:
    "An agent could have handled this — it points at a missing policy or capability, not at steering.",
  routing_unknown:
    "coord's routing rules did not decide who this was for, so it is shown as unknown rather than guessed.",
  unrecognised:
    "coord sent a routing word this page does not know, so it is shown as unknown rather than guessed.",
};

export function touchRowKind(
  disposition: string | null | undefined
): TouchRowKind {
  return own(DISPOSITION_TO_KIND, disposition) ?? "unrecognised";
}

export function deriveTouchStatus(
  touch: Pick<OperatorTouch, "disposition">
): RowStatus<TouchRowKind> {
  const kind = touchRowKind(touch.disposition);
  return {
    kind,
    label: KIND_LABEL_TEXT[kind],
    reason: KIND_REASON[kind],
    attention: attentionOf(TOUCH_ATTENTION_BY_KIND, kind),
  };
}

// ---------------------------------------------------------------------------
// The constraint verdict, in words
// ---------------------------------------------------------------------------

export type VerdictKind = "operator" | "machines" | "tokens" | "unknown";

const VERDICT_HEADLINE: Record<VerdictKind, string> = {
  operator: "You are the constraint",
  machines: "Machines are the constraint",
  tokens: "Model tokens are the constraint",
  unknown: "The constraint is unknown",
};

export function verdictKind(
  verdict: ConstraintVerdict | null | undefined
): VerdictKind | null {
  const v = verdict?.verdict;
  if (v === "operator" || v === "machines" || v === "tokens" || v === "unknown") {
    return v;
  }
  return null;
}

/** The verdict as a headline. An unrecognised or absent verdict is unknown. */
export function verdictHeadline(
  verdict: ConstraintVerdict | null | undefined
): string {
  const kind = verdictKind(verdict);
  if (kind === null) {
    return verdict
      ? "The constraint is unknown — coord sent a verdict this page does not know"
      : "The constraint is unknown";
  }
  return VERDICT_HEADLINE[kind];
}

// ---------------------------------------------------------------------------
// R1 — the health strip, derived from the payload already on the page
// ---------------------------------------------------------------------------

export interface TouchesHealth {
  level: HealthStripLevel;
  headline: string;
  /** coord's own sentence behind the verdict — the headline's tooltip. */
  headlineTitle: string | null;
  detail: string;
  badges: HealthBadge[];
  /** True only when the numbers on screen are a current, measured read. */
  measured: boolean;
}

function dashBadges(): HealthBadge[] {
  // R6: counts nobody read are DASHES — the strip's label is rendered
  // verbatim, so the dash has to be spelled here.
  return [
    { key: "touches", label: "touches –", tone: "muted", "data-testid": "touches-health-total" },
    { key: "reached", label: "reached you –", tone: "muted" },
    { key: "absorbed", label: "agent-absorbable –", tone: "muted" },
  ];
}

function windowWords(days: number | null | undefined): string {
  return days === 30 ? "the last 30 days" : "the last 7 days";
}

/**
 * The page's health strip.
 *
 * `head` is the FIRST page's payload — the one carrying the aggregate and the
 * verdict (a `before` page carries neither). This function cannot fetch.
 *
 * Levels, by R3's test (whose move is it, and do we know?):
 * - every shape of not-knowing — unread, failed, not yet measured, an
 *   aggregate the payload did not include, an `unknown` verdict — is AMBER;
 * - `machines` / `tokens` is AMBER: capacity frees itself;
 * - `operator` is GREEN with the ask in words. Nothing is blocked and nothing
 *   decays while it waits, so it is R3's "real decision that is not blocking
 *   anyone" — calm, and the headline says what is owed.
 * It is never red: this page is a strategic reader, and the items that need a
 * person now are red on their own surfaces.
 */
export function deriveTouchesHealth(input: {
  head: OperatorTouchesResponse | null;
  loaded: boolean;
  failed: boolean;
  failure: TouchReadFailure | null;
  windowDays: TouchWindowDays;
  now?: number;
}): TouchesHealth {
  const { head, loaded, failed, failure, windowDays } = input;
  const window = windowWords(windowDays);

  if (!loaded) {
    if (failed) {
      return {
        level: "amber",
        headline: "Operator touches could not be read",
        detail: failure
          ? `${failureSentence(failure)} — the counts are a dash, not a zero`
          : UNKNOWN_COUNTS_DETAIL,
        badges: dashBadges(),
        headlineTitle: null,
        measured: false,
      };
    }
    return {
      level: "amber",
      headline: "Reading operator touches…",
      detail: "nothing has answered yet, so the counts are a dash rather than a zero",
      badges: dashBadges(),
      headlineTitle: null,
      measured: false,
    };
  }

  if (!head || head.aggregate_included === false) {
    return {
      level: "amber",
      headline: "The constraint is unknown",
      detail:
        "this read carried no window aggregate, so no count or verdict can be stated",
      badges: dashBadges(),
      headlineTitle: null,
      measured: false,
    };
  }

  const verdict = head.constraint_verdict ?? null;
  const unknownInputs = verdict?.unknown_inputs ?? [];
  const verdictBadge: HealthBadge = {
    key: "unknown-inputs",
    label: `unknown inputs ${unknownInputs.length}`,
    tone: "muted",
    title:
      unknownInputs.length > 0
        ? `What the verdict could not see:\n${unknownInputs.join("\n")}`
        : "every input to the verdict was read",
  };
  const stale = failed ? staleDetail("") + " " : "";

  if (head.measurement !== "measured") {
    return {
      level: "amber",
      headline: "Not yet measured — the touch emitter has not run",
      detail:
        stale +
        "no operator touch has ever been recorded for this tenant, so every count is absent evidence, not a zero",
      badges: [...dashBadges(), verdictBadge],
      headlineTitle: verdict?.reason ?? null,
      measured: false,
    };
  }

  const totals = head.totals ?? null;
  const vKind = verdictKind(verdict);
  const since = head.measured_since
    ? `measured since ${relativeTime(head.measured_since, { now: input.now })}`
    : "measurement start unknown";
  const coverage =
    typeof head.covered_days === "number"
      ? ` (covers ${head.covered_days.toFixed(1)} of ${windowDays} days)`
      : "";

  let level: HealthStripLevel;
  let headline: string;
  if (failed) {
    level = "amber";
    headline = "These numbers stopped updating";
  } else if (vKind === "operator") {
    level = "green";
    headline = `${VERDICT_HEADLINE.operator} — ${totals?.operator_reaching ?? "–"} touches reached you in ${window}; the classes below are where a policy would absorb them`;
  } else {
    level = "amber";
    headline = verdictHeadline(verdict);
  }

  return {
    level,
    headline,
    detail: `${stale}${since}${coverage}`,
    badges: [
      {
        key: "touches",
        label: `touches ${totals ? totals.touches : "–"}`,
        tone: "default",
        "data-testid": "touches-health-total",
      },
      {
        key: "reached",
        label: `reached you ${totals ? totals.operator_reaching : "–"}`,
        tone: "default",
        title: "touches where a person had to act",
      },
      {
        key: "absorbed",
        label: `agent-absorbable ${shareOfFraction(head.agent_absorbed_rate)}`,
        tone: "default",
        title:
          "share of touches an agent could have handled — evidence of a missing policy or capability",
      },
      {
        key: "routing-unknown",
        label: `routing unknown ${shareOfFraction(head.unknown_share)}`,
        tone: "muted",
        title:
          "share of touches coord's routing rules could not place — a finding about the instrumentation, not about you",
      },
      verdictBadge,
    ],
    headlineTitle: verdict?.reason ?? null,
    measured: !failed,
  };
}

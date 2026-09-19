/**
 * The Dev Ops Overview's Conditions verdict — derived, pure, and unit-tested.
 *
 * Plan `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 8. The operator used to be handed the raw `coord.alerts` list (27,604
 * open rows on 2026-09-18, none resolved) and a critical/warning/info severity
 * count over it. Neither answers the question `audience_profile/human-operator`
 * says he has: **is anything degraded that no agent is handling, and is
 * anything waiting on me?** Coord now answers it directly, as the `conditions`
 * block on `/coord/fleet/health` (Phase 7), and this module turns that block
 * into what the Conditions panel says.
 *
 * R1 of `frontend/docs/console-ui-style-guide.md`: derived from data already
 * on the page (the fleet-health poll the page makes anyway), never a second
 * fetch. R8: the derivation is a pure module, not a chain of ternaries in JSX.
 *
 * ## The rules it encodes
 *
 * - **"Nothing unhandled" is said only when coord measured it**: `scrape_up`
 *   is `true`, `unclaimed` is exactly `0`, and the operator side is settled
 *   (no question waiting, both exact operator-alert counts served and `0`). It is the one sentence this
 *   panel must never say falsely — a green report over a degraded fleet is
 *   exactly what the operator profile forbids.
 * - **An absent block is UNKNOWN, never zero.** A coord that predates Phase 7
 *   serves no `conditions` at all, and that says nothing about the fleet:
 *   "Unknown — coord does not report conditions yet"
 *   (`verification-and-evidence` `unknown-must-not-render-as-a-default`).
 * - **`scrape_up: false` is UNKNOWN.** Coord admitted its query failed, and
 *   every count beside it is `null`: "Unknown — health query failed".
 * - **A `null` count is UNKNOWN**, and renders `–`, never `0` — per count, so
 *   one missing number does not blank the ones coord did measure.
 * - **Something waiting on the operator is the only red.** R3: colour says
 *   who must act. An unclaimed condition is agents' work that no agent has
 *   picked up — degraded, so amber — while an awaiting-operator question is
 *   the one thing on this panel only a human can clear.
 * - **Operator alerts are read from coord's EXACT counts, never derived.**
 *   `awaiting_operator_unasked` is open operator alerts with no question at
 *   all; `awaiting_operator_answered_uncleared` is alerts whose question was
 *   answered but which coord has not yet seen clear (an answered alert is
 *   never re-asked, so subtracting questions from alerts miscounts exactly
 *   these). Unasked alerts are never green; answered-uncleared ones are
 *   amber. A coord that sends neither count gets NEUTRAL wording that names
 *   no cause ("open beyond the questions waiting on you") and is never
 *   green. While any such alert exists the headline is never
 *   "Nothing unhandled".
 * - **A failed latest read is amber, whatever the retained answer said.** The
 *   numbers stay on screen, labelled as the last answer, but a verdict that
 *   is not being re-confirmed may not look like one that is — not green, and
 *   not red either.
 * - **Settings in effect are context, never a fault.** A drain, a kill switch
 *   or a removed runner is a deliberate operator setting coord is reflecting
 *   back (D2); it is listed so the operator sees what he turned on, and it
 *   never moves the level.
 */

import { relativeTime } from "@/components/console/time";
import type {
  FleetHealthConditions,
  FleetHealthPayload,
} from "./useFleetHealth";

/** Traffic-light level, same vocabulary as `console/HealthStrip`. */
export type FleetConditionsLevel = "green" | "amber" | "red";

/**
 * Which of the panel's distinct states the verdict is in. `unknown` carries
 * its cause, because each cause is a different sentence and a different next
 * step (wait for a deploy, look at coord, look at the network).
 */
export type FleetConditionsState =
  | "loading"
  | "unknown-not-reported"
  | "unknown-scrape-failed"
  | "unknown-read-failed"
  | "unknown-count-missing"
  | "clear"
  | "unhandled";

/** The operator's question queue — the Work ▸ Questions page. */
export const QUESTION_QUEUE_HREF = "/admin/coord/questions";

/**
 * The order the per-domain breakdown renders in, and the operator-facing name
 * of each domain (R8 — the wire string is never the label). Coord's
 * `AgentDomain` enum is closed today, but a domain this build does not know
 * still renders, after these, under a humanised name: dropping a count coord
 * served would make the breakdown sum to less than the unclaimed total.
 */
export const DOMAIN_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["merge_train", "merge train"],
  ["red_main_fix", "red-main fix"],
  ["pr_fix", "PR fix"],
  ["dev_ops", "dev ops"],
  ["cleanup", "cleanup"],
  ["return_to_main", "return to main"],
  ["gate_owner", "gate owner"],
  ["plan_owner", "plan owner"],
];

/** Operator-facing names for the D1 `Responder::Setting` kinds. */
export const SETTING_LABELS: Readonly<Record<string, string>> = {
  fleet_device_drained: "machine drained",
  kill_switch_fired: "merge kill switch on",
  ci_runner_removed: "CI runner removed",
  ci_runner_label_disabled: "CI runner label disabled",
  spawn_vetoed: "session spawn vetoed",
  spawn_drain_refused: "session spawn refused by a drain",
};

export interface ConditionsDomainCount {
  domain: string;
  label: string;
  count: number;
}

export interface ConditionsSetting {
  /** The alert row's id — the setting's identity (two drains are two rows). */
  alertId: number | null;
  /** Coord's raw kind — for a `title`, never for the label. */
  kind: string;
  /** Coord's own one-line description of the row, for the `title`. */
  summary?: string;
  label: string;
  /** Raw ISO stamp, when coord served one. */
  since?: string;
  /** `"3h ago"`-style age of `since`, or `"since an unknown time"`. */
  sinceLabel: string;
}

export interface FleetConditionsSummary {
  state: FleetConditionsState;
  level: FleetConditionsLevel;
  headline: string;
  /** The signals behind the verdict, in plain language. */
  detail: string;
  /** `null` = not measured; render `–`, never `0`. */
  open: number | null;
  claimed: number | null;
  unclaimed: number | null;
  unclaimedOldestAgeSecs: number | null;
  /** Only the domains with a non-zero count, in {@link DOMAIN_LABELS} order. */
  byDomain: ConditionsDomainCount[];
  awaitingOperator: number | null;
  awaitingOperatorQuestionIds: string[];
  /** Open operator-responder alerts coord counts; `null` = not measured. */
  awaitingOperatorAlerts: number | null;
  /**
   * Whether coord served BOTH exact operator-alert counts below. When it did
   * not (an older coord), only {@link operatorAlertsBeyondQuestions} is
   * available, and it states no cause.
   */
  operatorCountsExact: boolean;
  /** Open operator alerts with no question at all (coord's exact count). */
  operatorAlertsUnasked: number | null;
  /** Answered, but coord has not yet seen the condition clear (exact). */
  operatorAlertsAnsweredUncleared: number | null;
  /**
   * FALLBACK ONLY (an older coord): open operator alerts beyond the open
   * questions — a difference, so it names no cause. `null` whenever the exact
   * counts are served, or either side of the difference is unmeasured.
   */
  operatorAlertsBeyondQuestions: number | null;
  /** Where "waiting on you" leads: the one question, or the queue. */
  questionsHref: string;
  /** `null` = not measured (unknown), `[]` = measured and none in effect. */
  settings: ConditionsSetting[] | null;
  /**
   * Settings coord counted but did not list (its list is capped). `0` when
   * the list is complete or the count is unknown — see
   * {@link settingsCountUnknown} for the latter.
   */
  settingsNotListed: number;
  /**
   * A listed, non-empty settings list whose exact total coord did not serve:
   * the list may be capped, and the panel says the count is unknown rather
   * than hiding that.
   */
  settingsCountUnknown: boolean;
  /** With a failed scrape: which read coord says failed. */
  unavailableReason: string | null;
}

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function humanise(raw: string): string {
  return raw.replace(/[_-]+/g, " ").trim();
}

/** Compact age from seconds: `45s`, `12m`, `3h 5m`, `2d 4h`. */
export function formatAgeSecs(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Order a served per-domain map by {@link DOMAIN_LABELS}, unknown domains last. */
function domainBreakdown(
  raw: FleetHealthConditions["unclaimed_by_domain"]
): ConditionsDomainCount[] {
  if (!raw || typeof raw !== "object") return [];
  const known = new Map(DOMAIN_LABELS);
  const out: ConditionsDomainCount[] = [];
  for (const [domain, label] of DOMAIN_LABELS) {
    const n = count((raw as Record<string, unknown>)[domain]);
    if (n !== null && n > 0) out.push({ domain, label, count: n });
  }
  for (const [domain, value] of Object.entries(raw)) {
    if (known.has(domain)) continue;
    const n = count(value);
    if (n !== null && n > 0) {
      out.push({ domain, label: humanise(domain), count: n });
    }
  }
  return out;
}

function settingsList(
  raw: FleetHealthConditions["settings_in_effect"],
  nowMs: number
): ConditionsSetting[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ConditionsSetting[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry.kind !== "string" || entry.kind.length === 0) {
      continue;
    }
    const since =
      typeof entry.since === "string" && entry.since.length > 0
        ? entry.since
        : undefined;
    const summary =
      typeof entry.summary === "string" && entry.summary.trim() !== ""
        ? entry.summary.trim()
        : undefined;
    out.push({
      alertId:
        typeof entry.alert_id === "number" && Number.isFinite(entry.alert_id)
          ? entry.alert_id
          : null,
      kind: entry.kind,
      ...(summary ? { summary } : {}),
      label: SETTING_LABELS[entry.kind] ?? humanise(entry.kind),
      since,
      sinceLabel: relativeTime(since, {
        now: nowMs,
        absent: "since an unknown time",
      }),
    });
  }
  return out;
}

function questionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id !== "");
}

/**
 * Where "N waiting on you" leads. Exactly one question → that question's own
 * page, where it can be answered; otherwise the queue, whose default view is
 * the pending list.
 */
export function questionsHrefFor(ids: string[]): string {
  const [only] = ids;
  return ids.length === 1 && only !== undefined
    ? `${QUESTION_QUEUE_HREF}/${encodeURIComponent(only)}`
    : QUESTION_QUEUE_HREF;
}

const EMPTY: Omit<FleetConditionsSummary, "state" | "level" | "headline" | "detail"> = {
  open: null,
  claimed: null,
  unclaimed: null,
  unclaimedOldestAgeSecs: null,
  byDomain: [],
  awaitingOperator: null,
  awaitingOperatorQuestionIds: [],
  awaitingOperatorAlerts: null,
  operatorCountsExact: false,
  operatorAlertsUnasked: null,
  operatorAlertsAnsweredUncleared: null,
  operatorAlertsBeyondQuestions: null,
  questionsHref: QUESTION_QUEUE_HREF,
  settings: null,
  settingsNotListed: 0,
  settingsCountUnknown: false,
  unavailableReason: null,
};

export interface SummarizeFleetConditionsInput {
  data: FleetHealthPayload | null;
  loading: boolean;
  /** The fleet-health READ's own failure (transport), not coord's scrape. */
  error: string | null;
  nowMs?: number;
}

export function summarizeFleetConditions({
  data,
  loading,
  error,
  nowMs = Date.now(),
}: SummarizeFleetConditionsInput): FleetConditionsSummary {
  // No body at all yet: either still loading, or the read itself failed.
  // Neither is a statement about the fleet.
  if (!data) {
    if (error) {
      return {
        ...EMPTY,
        state: "unknown-read-failed",
        level: "amber",
        headline: "Unknown — fleet health read failed",
        detail: `The fleet-health read did not answer (${error}). This is not "nothing unhandled" — it is no measurement.`,
      };
    }
    return {
      ...EMPTY,
      state: loading ? "loading" : "unknown-read-failed",
      level: "amber",
      headline: loading ? "Loading conditions…" : "Unknown — no fleet health read yet",
      detail: "",
    };
  }

  // A retained body behind a failed LATEST read still describes the fleet as
  // of the last answer; the detail line says so rather than passing it off as
  // current.
  const staleNote = error
    ? ` The latest fleet-health read failed (${error}); this is the last answer coord gave.`
    : "";

  const c = data.conditions;
  if (!c || typeof c !== "object") {
    return {
      ...EMPTY,
      state: "unknown-not-reported",
      level: "amber",
      headline: "Unknown — coord does not report conditions yet",
      detail:
        "This coord build serves no conditions rollup, so whether anything is unhandled, or waiting on you, is unknown — not zero." +
        staleNote,
    };
  }

  if (c.scrape_up === false) {
    const reason =
      typeof c.unavailable_reason === "string" && c.unavailable_reason !== ""
        ? c.unavailable_reason
        : null;
    return {
      ...EMPTY,
      state: "unknown-scrape-failed",
      level: "amber",
      headline: "Unknown — health query failed",
      unavailableReason: reason,
      detail:
        "Coord could not run its conditions query on this poll" +
        (reason ? ` (coord says: ${reason})` : "") +
        ". Every count is unknown — this is not zero conditions." +
        staleNote,
    };
  }

  const ids = questionIds(c.awaiting_operator_question_ids);
  const settings = settingsList(c.settings_in_effect, nowMs);
  const settingsTotal = count(c.settings_in_effect_count);
  const awaitingOperator = count(c.awaiting_operator);
  const awaitingOperatorAlerts = count(c.awaiting_operator_alerts);
  const operatorAlertsUnasked = count(c.awaiting_operator_unasked);
  const operatorAlertsAnsweredUncleared = count(
    c.awaiting_operator_answered_uncleared
  );
  const operatorCountsExact =
    operatorAlertsUnasked !== null && operatorAlertsAnsweredUncleared !== null;
  // Fallback only. A difference cannot say WHY an alert has no open question
  // (never asked, or answered and not yet clear), so its wording names none.
  const operatorAlertsBeyondQuestions =
    operatorCountsExact ||
    awaitingOperator === null ||
    awaitingOperatorAlerts === null
      ? null
      : Math.max(0, awaitingOperatorAlerts - awaitingOperator);
  const base = {
    open: count(c.open),
    claimed: count(c.claimed),
    unclaimed: count(c.unclaimed),
    unclaimedOldestAgeSecs: count(c.unclaimed_oldest_age_secs),
    byDomain: domainBreakdown(c.unclaimed_by_domain),
    awaitingOperator,
    awaitingOperatorQuestionIds: ids,
    awaitingOperatorAlerts,
    operatorCountsExact,
    operatorAlertsUnasked: operatorCountsExact ? operatorAlertsUnasked : null,
    operatorAlertsAnsweredUncleared: operatorCountsExact
      ? operatorAlertsAnsweredUncleared
      : null,
    operatorAlertsBeyondQuestions,
    questionsHref: questionsHrefFor(ids),
    settings,
    settingsNotListed:
      settings !== null && settingsTotal !== null
        ? Math.max(0, settingsTotal - settings.length)
        : 0,
    settingsCountUnknown:
      settings !== null && settings.length > 0 && settingsTotal === null,
    unavailableReason: null,
  };

  const waiting = awaitingOperator;
  const unasked = base.operatorAlertsUnasked;
  const answeredUncleared = base.operatorAlertsAnsweredUncleared;
  const beyond = operatorAlertsBeyondQuestions;

  const operatorSentence = operatorCountsExact
    ? [
        unasked !== null && unasked > 0
          ? `${plural(unasked, "operator alert", "operator alerts")} not yet asked.`
          : null,
        answeredUncleared !== null && answeredUncleared > 0
          ? `${answeredUncleared} answered, waiting for coord to see ${answeredUncleared === 1 ? "it" : "them"} clear.`
          : null,
      ]
        .filter(Boolean)
        .join(" ")
    : beyond === null
      ? "Whether any operator alert is open without a question is unknown."
      : beyond > 0
        ? `${plural(beyond, "operator alert", "operator alerts")} open beyond the questions waiting on you.`
        : "This coord does not say whether any operator alert is still unasked.";

  const waitingSentence =
    (waiting === null
      ? "Whether anything is waiting on you is unknown."
      : waiting > 0
        ? `${plural(waiting, "question is", "questions are")} waiting on you.`
        : "No question is waiting on you.") +
    (operatorSentence ? ` ${operatorSentence}` : "");

  /**
   * The operator-alert side, settled: every count exact and zero. Only then
   * may the panel go green or say "Nothing unhandled".
   */
  const operatorSettled =
    waiting === 0 &&
    operatorCountsExact &&
    unasked === 0 &&
    answeredUncleared === 0;

  /**
   * One place decides the colour, so no branch can forget a clause:
   * red iff a question waits on the operator; green only on a measured
   * all-clear with the operator side settled; a failed latest read is amber
   * whatever the retained answer says.
   */
  const levelFor = (allClear: boolean): FleetConditionsLevel => {
    if (error) return "amber";
    if (waiting !== null && waiting > 0) return "red";
    return allClear && operatorSettled ? "green" : "amber";
  };

  /**
   * The agent-clear headline. "Nothing unhandled" is withheld while any open
   * operator alert has no open question — the exact counts name why, the
   * fallback does not.
   */
  const clearHeadline = (): string => {
    if (operatorCountsExact) {
      if (unasked !== null && unasked > 0) {
        return `${plural(unasked, "operator alert", "operator alerts")} not yet asked`;
      }
      if (answeredUncleared !== null && answeredUncleared > 0) {
        return `${plural(answeredUncleared, "answered operator alert", "answered operator alerts")} not yet clear`;
      }
      return "Nothing unhandled";
    }
    if (beyond !== null && beyond > 0) {
      return `${plural(beyond, "operator alert", "operator alerts")} open beyond your questions`;
    }
    // Agent work is all claimed; whether an operator alert sits without a
    // question is not established, so the sentence is scoped to what is.
    return "No agent work unhandled";
  };

  // `scrape_up` absent on a block that is otherwise present is a coord that
  // did not say whether its query ran. The counts may be real, but the one
  // sentence that needs a measurement — "nothing unhandled" — is withheld.
  const measured = c.scrape_up === true;

  if (base.unclaimed === null || (!measured && base.unclaimed === 0)) {
    return {
      ...base,
      state: "unknown-count-missing",
      level: levelFor(false),
      headline:
        base.unclaimed === null
          ? "Unknown — coord served no unclaimed count"
          : "Unknown — coord did not say its query ran",
      detail:
        (base.unclaimed === null
          ? "Coord's conditions rollup carried no count of unclaimed conditions, so whether any are unhandled is unknown."
          : "Coord did not say whether its conditions query ran, so a zero here is not a measured all-clear.") +
        ` ${waitingSentence}` +
        staleNote,
    };
  }

  if (base.unclaimed === 0) {
    const openClause =
      base.open === null
        ? "Every open condition is claimed by an agent."
        : base.open === 0
          ? "No open conditions."
          : `${plural(base.open, "open condition is", "open conditions are")} all claimed by agents.`;
    return {
      ...base,
      state: "clear",
      level: levelFor(true),
      headline: clearHeadline(),
      detail: `${openClause} ${waitingSentence}${staleNote}`,
    };
  }

  const age =
    base.unclaimedOldestAgeSecs === null
      ? "the oldest one's age is unknown"
      : `the oldest has waited ${formatAgeSecs(base.unclaimedOldestAgeSecs)}`;
  return {
    ...base,
    state: "unhandled",
    level: levelFor(false),
    headline: `${plural(base.unclaimed, "condition", "conditions")} no agent is handling`,
    detail: `No agent has claimed ${base.unclaimed === 1 ? "it" : "them"} yet; ${age}. ${waitingSentence}${staleNote}`,
  };
}

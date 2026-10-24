"use client";

/**
 * RedMainBanner — persistent, repo-scoped "main is RED" banner.
 *
 * Plan `2026-07-06-coord-red-main-auto-remediation-and-dashboard-alert.md`
 * Phase 1 (D2). A red main is a whole-repo condition: PRs evaluated while it
 * holds read `block_reason_code: main-red`, and candidates rebased onto the
 * red base generally fail CI until the fix lands. It is NOT a land freeze —
 * coord still enqueues a main-red PR, and a candidate whose own CI is green
 * still lands (plan
 * 2026-09-12-red-main-fix-pr-opened-after-the-red-never-gets-a-probe-candidate
 * D4). This banner is the loud surface for that state on every coord console
 * page.
 *
 * Driven SOLELY by the coord `red_main:<repo>` alert rows (single source
 * of truth): coord's `stuck_pr_watcher` detector 6 upserts one live
 * `coord.alerts` row per (repo, red-episode) and self-resolves it when
 * main goes green, so the banner can never disagree with coord. Fetched
 * over `/api/v1/operations/alerts?kind=red_main`, a raw pass-through of
 * coord's `/coord/alerts` read API.
 *
 * Deliberately NOT dismissable and NOT a toast — it clears only when the
 * alert row resolves.
 *
 * ## It reports who is fixing it; it does not offer to fix it
 *
 * Plan `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 8 deleted the "Spawn fix session" button this banner used to carry:
 * spawning a fix is operational work, and operational work is agents' work
 * (`decision_record/operational-work-is-autonomous`). What the operator needs
 * from a red main is to SEE it and to see whether an agent has it, so each
 * row shows the alert's claim — coord's `claimed` / `claim` fields — as one
 * of three states:
 *
 *   - **claimed** — `claimed: true`: an agent holds a LIVE lease, and the row
 *     names which one (in presentation mode, which KIND — see below);
 *   - **unclaimed** — `claimed: false`: coord read the lease columns and found
 *     no live lease (an expired lease reads as unclaimed, coord's own rule);
 *   - **unknown** — anything else, for two different reasons the chip's
 *     tooltip names: coord sent `claimed: null` (or `claims_scrape_up: false`
 *     on the body) because it could not READ the lease columns or decode a
 *     row's claim (`fleet_health.rs` `alert_row_claim`), or the coord build
 *     predates alert claims and sends no `claimed` at all. Neither is
 *     "unclaimed": a claim nobody could read says nothing about who is
 *     working on it
 *     (`verification-and-evidence` `unknown-must-not-render-as-a-default`).
 *
 * Coord's own remediation state (`detail.fix_session`) is still shown, read
 * only, when one is active — an auto-rerun or a spawned fix session is a fact
 * about the episode an operator should not have to go looking for.
 *
 * ## In presentation mode the row is rebuilt, field by field
 *
 * The banner is layout chrome, so it renders on every console page — every
 * lens surface — in presentation mode too (plan
 * `2026-10-23-console-presentation-spaces`). A red main is a true fact an
 * evaluator may see; WHOSE repository it is may not be, when it is not the
 * tenant's own, and neither may a machine's or an agent's internal id (D3.3,
 * "no foreign identity").
 *
 * So a presentation-mode row is not the parsed row with a few fields blanked —
 * a blocklist leaks every field it forgets — but a view rebuilt from an
 * allowlist by {@link redMainRowView}, deciding each rendered field on its own:
 *
 * - the repository, the failing workflows and the stale-baseline workflows
 *   render only when `redactionVerdict` clears ALL of them against the
 *   tenant's presentation scope; otherwise the row says
 *   {@link WITHHELD_REPOSITORY}, lists no workflow, and COUNTS its stale
 *   baselines instead of naming them. The verdict fails closed while the
 *   scope is unknown;
 * - a claimant is named by its kind, and a machine by its session alias
 *   ("Machine A") — never by a device, agent or session id, in the text or in
 *   the tooltip;
 * - coord's remediation is its state alone, without the run reference or the
 *   fix session's agent id.
 *
 * A field added to the parsed row later renders nothing in presentation mode
 * until someone decides here how it may.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchOpenAlertsOfKind } from "@/lib/api/operations/alerts";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  redactionVerdict,
  useMachineAliaser,
  usePresentationMode,
  usePresentationScopeState,
  type PresentationScopeState,
} from "@/components/presentation";

/**
 * An agent's lease on one alert, as coord serves it on `/coord/alerts` rows
 * (plan `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 2). `claimed_by` is the claimant's principal label: `agent:<id>`,
 * `device:<id>`, `device:<id>:session:<id>` or `operator:<id>`
 * (qontinui-coord `alert_queue.rs`); older builds also sent `session:<id>`.
 */
export interface CoordAlertClaim {
  claimed_by?: string | null;
  claimed_at?: string | null;
  claim_expires_at?: string | null;
}

/**
 * The shape of one `coord.alerts` row as the web proxy serves it. Lives here
 * because this banner is the operator UI's one remaining reader of the raw
 * alert rows — the alerts page that used to own it is deleted.
 *
 * `alert_key` is present because it is the row's DEDUP IDENTITY (the React key,
 * the thing coord upserts on) — it is deliberately NOT a display string.
 *
 * `claimed` and `claim` are OPTIONAL and NULLABLE on purpose: a coord build
 * that predates alert claims sends neither, and a current one sends
 * `claimed: null, claim: null` when it could not read the lease. Both must
 * read as "claim state unknown", never as "unclaimed".
 */
export interface CoordAlertRow {
  id?: number | string;
  alert_key: string;
  severity?: string;
  /** Coord's raw `coord.alerts.kind` — a machine vocabulary, never displayed. */
  kind?: string;
  device_id?: string | null;
  summary?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  occurrences?: number;
  resolved_at?: string | null;
  detail?: Record<string, unknown>;
  /**
   * Whether a live (unexpired) lease is held. `null` = coord could not read or
   * decode the lease (UNKNOWN); absent = an older coord (UNKNOWN too).
   */
  claimed?: boolean | null;
  /** The live lease while `claimed` is `true`; `null` otherwise. */
  claim?: CoordAlertClaim | null;
}

/** The banner's poll cadence. */
const POLL_INTERVAL_MS = 10_000;

const RED_MAIN_KEY_PREFIX = "red_main:";
/** The `coord.alerts.kind` value the server-side filter narrows on. */
const RED_MAIN_KIND = "red_main";

/**
 * How many CONSECUTIVE empty polls it takes to clear the banner.
 *
 * 3 × 10s ≈ 30s of sustained emptiness. Low enough that a genuinely-fixed main
 * clears the banner promptly, high enough that a single evicted row (or an
 * un-upgraded coord dropping the `kind` filter on a churning 500-row window)
 * cannot. Measured 2026-08-14: the row survived 1 of 5 samples, so a
 * clear-on-first-empty banner was blind ~80% of the time.
 */
const EMPTY_POLLS_BEFORE_CLEAR = 3;

/**
 * How long a banner may go unconfirmed before it says so.
 *
 * Two intervals: one missed poll is ordinary jitter, two is a read path that
 * is not answering. Keeping the banner up is still right (a failed read is not
 * evidence main went green) — but an operator reading "main is RED" deserves
 * to know the claim is not being re-confirmed.
 */
const STALE_AFTER_MS = 2 * POLL_INTERVAL_MS;

const RUNNING_LABEL = "fix session running";
const SELF_HEAL_LABEL = "auto-rerun in flight";

/** A row's repository in presentation mode when the scope does not clear it. */
export const WITHHELD_REPOSITORY = "A repository";

/**
 * Normalized view of a red-main episode's remediation, parsed from the
 * alert row's `detail.fix_session`. That field is one of:
 *   - the string `"none"` — no remediation active;
 *   - an object `{state:"running"|"stalled"|"failed", agent_id, spawned_at}`
 *     — a spawned fix session in that state;
 *   - a self-heal string like `"auto-rerun-failed-jobs:<run_id>"` — coord's
 *     own infra-cancel re-run is in flight (any non-`"none"` string).
 * Anything missing or malformed normalizes to `{kind:"none"}`: the banner
 * then shows no remediation note, which is the absence of a claim about
 * remediation rather than a claim that none is running.
 */
export interface FixSessionState {
  kind: "none" | "self_heal" | "running" | "stalled" | "failed";
  /** Spawned-session agent id (object form only). */
  agentId?: string;
  /** Spawn timestamp (object form only). */
  spawnedAt?: string;
  /** Raw self-heal reference, e.g. `auto-rerun-failed-jobs:<run_id>`. */
  raw?: string;
}

/**
 * Who holds an agent's claim on a red-main episode — see the module doc for
 * why `unknown` is its own state.
 */
export type AlertClaimState =
  | {
      kind: "unknown";
      /**
       * `unreadable` — coord answered but could not read the lease
       * (`claimed: null`, or `claims_scrape_up: false` on the body);
       * `not-reported` — the coord build sends no claim fields at all.
       */
      cause: "unreadable" | "not-reported";
    }
  | { kind: "unclaimed" }
  | {
      kind: "claimed";
      /** Claimant principal label; absent when coord said `claimed` without naming one. */
      claimedBy?: string;
      claimedAt?: string;
      expiresAt?: string;
    };

/** One red-main episode, parsed from its `coord.alerts` row. */
export interface RedMainAlert {
  alertKey: string;
  repo: string;
  /** Failing workflow names (alert `detail.workflows`). */
  workflows: string[];
  /** Open PRs whose latest predicate evaluation read `main-red`. */
  blockedPrCount: number;
  /**
   * The repo's in-flight merge proposals (alert `detail.queued_proposal_count`).
   * `null` = UNREAD: coord could not count them, or it predates the field.
   * Never defaulted to 0 — an unread queue must not render as an empty one.
   */
  queuedProposalCount: number | null;
  /** Episode start — the alert row's own `first_seen_at`. */
  since?: string;
  /** Remediation state (alert `detail.fix_session`). */
  fixSession: FixSessionState;
  /** Whether an agent holds the alert's claim, and who. */
  claim: AlertClaimState;
  /** Whether newer main runs contradict the red push baseline — see {@link parseBaselineFreshness}. */
  baselineFreshness: BaselineFreshness;
  /** Failing workflows whose red push baseline a newer passing main run contradicts. */
  staleWorkflows: string[];
}

/**
 * Normalize `detail.fix_session` into a {@link FixSessionState}. Pure —
 * exported for the vitest suite.
 */
export function parseFixSession(raw: unknown): FixSessionState {
  if (typeof raw === "string") {
    // Any non-"none" string is an active self-heal (auto-rerun reference).
    return raw === "none" ? { kind: "none" } : { kind: "self_heal", raw };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (
      o.state === "running" ||
      o.state === "stalled" ||
      o.state === "failed"
    ) {
      return {
        kind: o.state,
        agentId: typeof o.agent_id === "string" ? o.agent_id : undefined,
        spawnedAt: typeof o.spawned_at === "string" ? o.spawned_at : undefined,
      };
    }
  }
  // Missing / malformed → no active remediation to report.
  return { kind: "none" };
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Read an alert row's claim. Pure — exported for the vitest suite.
 *
 * `claimed` is coord's own verdict — it compares `claim_expires_at` with its
 * clock — so it is the ONLY thing that decides claimed vs unclaimed:
 * `true` → claimed, `false` → unclaimed. `null` is coord saying it could not
 * read the lease, and `claimsScrapeUp === false` (the response body's flag)
 * is the same statement for every row at once; both are UNKNOWN. A row with
 * no `claimed` at all comes from a coord that predates claims: UNKNOWN too.
 * Nothing here infers a verdict from `claim` alone — no coord build produces
 * a lease without a verdict, and guessing at one would be the default this
 * banner is not allowed to render.
 */
export function parseAlertClaim(
  row: Pick<CoordAlertRow, "claimed" | "claim">,
  claimsScrapeUp?: boolean | null
): AlertClaimState {
  if (claimsScrapeUp === false || row.claimed === null) {
    return { kind: "unknown", cause: "unreadable" };
  }
  if (row.claimed === true) {
    const claim =
      row.claim && typeof row.claim === "object" ? row.claim : undefined;
    return {
      kind: "claimed",
      claimedBy: nonEmptyString(claim?.claimed_by),
      claimedAt: nonEmptyString(claim?.claimed_at),
      expiresAt: nonEmptyString(claim?.claim_expires_at),
    };
  }
  if (row.claimed === false) return { kind: "unclaimed" };
  return { kind: "unknown", cause: "not-reported" };
}

/** Compact display form of a fix-session agent id. */
export function truncateAgentId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

/**
 * Compact display form of a principal label: the `agent:` / `session:` /
 * `device:` prefix is kept, since it says what KIND of claimant this is, and
 * only the id after it is shortened. Pure — exported for the vitest suite.
 */
export function compactPrincipal(label: string): string {
  const colon = label.indexOf(":");
  if (colon < 0) return truncateAgentId(label);
  return `${label.slice(0, colon + 1)}${truncateAgentId(label.slice(colon + 1))}`;
}

/**
 * Extract the live red-main episodes from a `coord.alerts` slice: rows
 * whose `alert_key` starts with `red_main:` and are unresolved. Repo
 * falls back to the alert-key suffix when the detail is missing, so a
 * malformed detail payload can never hide an episode. Pure — exported
 * for the vitest suite.
 */
export function parseRedMainAlerts(
  alerts: unknown,
  /** The response body's `claims_scrape_up`; `false` makes every claim UNKNOWN. */
  claimsScrapeUp?: boolean | null
): RedMainAlert[] {
  if (!Array.isArray(alerts)) return [];
  const out: RedMainAlert[] = [];
  for (const a of alerts as CoordAlertRow[]) {
    if (!a || typeof a.alert_key !== "string") continue;
    if (!a.alert_key.startsWith(RED_MAIN_KEY_PREFIX)) continue;
    if (a.resolved_at) continue;
    const detail = (a.detail ?? {}) as Record<string, unknown>;
    const repo =
      typeof detail.repo === "string" && detail.repo.length > 0
        ? detail.repo
        : a.alert_key.slice(RED_MAIN_KEY_PREFIX.length);
    const workflows = Array.isArray(detail.workflows)
      ? detail.workflows.filter((w): w is string => typeof w === "string")
      : [];
    const rawCount = detail.blocked_pr_count;
    const blockedPrCount =
      typeof rawCount === "number" && Number.isFinite(rawCount) ? rawCount : 0;
    // Deliberately NOT the `0` default above: absent or malformed means UNREAD.
    const rawQueued = detail.queued_proposal_count;
    const queuedProposalCount =
      typeof rawQueued === "number" &&
      Number.isInteger(rawQueued) &&
      rawQueued >= 0
        ? rawQueued
        : null;
    out.push({
      alertKey: a.alert_key,
      repo,
      workflows,
      blockedPrCount,
      queuedProposalCount,
      since: a.first_seen_at,
      fixSession: parseFixSession(detail.fix_session),
      claim: parseAlertClaim(a, claimsScrapeUp),
      ...parseBaselineFreshness(detail.baseline_freshness),
    });
  }
  // Stable per-repo order so the banner stack never reshuffles between polls.
  out.sort((x, y) => x.repo.localeCompare(y.repo));
  return out;
}

/**
 * Compact "how long has this been red" label from the row's
 * `first_seen_at`. Pure (injectable `nowMs`) — exported for the vitest
 * suite. Unparseable input echoes back verbatim rather than hiding the
 * episode start entirely.
 */
export function sinceLabel(iso: string | undefined, nowMs: number): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const mins = Math.max(0, Math.floor((nowMs - t) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Coord's verdict on whether the red push baseline is still current
 * (`detail.baseline_freshness`, qontinui-coord `stuck_pr_watcher.rs`
 * `baseline_freshness_detail`):
 *
 * - `all_contradicted` — every failing workflow's newest main run PASSED, so
 *   the red rests only on stale push baselines and main's status is UNKNOWN.
 * - `partial` — some, not all, are contradicted: main is still red on the rest.
 * - `not_contradicted` — the evidence was read and contradicts none of them.
 * - `unread` — coord could not read the evidence, predates the field, or sent
 *   something malformed. Never rendered as contradicted.
 */
export type BaselineFreshness =
  | "all_contradicted"
  | "partial"
  | "not_contradicted"
  | "unread";

/**
 * Parse `detail.baseline_freshness` —
 * `{"read":"unread"}` or `{"read":"ok","all_contradicted":bool,"workflows":[{workflow,verdict,…}]}`.
 * Contradiction must be POSITIVELY evidenced: an absent, unread or malformed
 * payload (including any malformed workflow row, or an `all_contradicted` flag
 * the rows do not bear out) is `unread`, never contradicted. Pure — exported
 * for the vitest suite.
 */
export function parseBaselineFreshness(raw: unknown): {
  baselineFreshness: BaselineFreshness;
  staleWorkflows: string[];
} {
  const unread = { baselineFreshness: "unread" as const, staleWorkflows: [] };
  if (!raw || typeof raw !== "object") return unread;
  const o = raw as Record<string, unknown>;
  if (o.read !== "ok" || !Array.isArray(o.workflows)) return unread;
  const stale: string[] = [];
  for (const row of o.workflows as unknown[]) {
    if (!row || typeof row !== "object") return unread;
    const r = row as Record<string, unknown>;
    if (typeof r.workflow !== "string" || r.workflow.length === 0)
      return unread;
    if (r.verdict === "contradicted") stale.push(r.workflow);
    else if (r.verdict !== "corroborated" && r.verdict !== "unobserved") {
      return unread;
    }
  }
  const all = stale.length > 0 && stale.length === o.workflows.length;
  // Coord's own flag and its rows must agree; a disagreement is malformed.
  if (o.all_contradicted !== all) return unread;
  if (all)
    return { baselineFreshness: "all_contradicted", staleWorkflows: stale };
  if (stale.length > 0)
    return { baselineFreshness: "partial", staleWorkflows: stale };
  return { baselineFreshness: "not_contradicted", staleWorkflows: [] };
}

/**
 * Everything the headline states, with the repository and the stale-baseline
 * note already decided — so the operator headline and the presentation one
 * are one sentence with different inputs, not two sentences to keep in step.
 */
interface HeadlineFacts {
  readonly repo: string;
  readonly since?: string;
  readonly blockedPrCount: number;
  readonly queuedProposalCount: number | null;
  readonly baselineFreshness: BaselineFreshness;
  /** The partial-baseline note, or `""` when there is none. */
  readonly staleNote: string;
}

function headlineFrom(f: HeadlineFacts, nowMs: number): string {
  const prs = f.blockedPrCount === 1 ? "PR" : "PRs";
  const label = sinceLabel(f.since, nowMs);
  const since = f.since && label !== f.since ? ` since ${label} ago` : "";
  const queue =
    f.queuedProposalCount === null
      ? "merge-queue depth unknown"
      : `${f.queuedProposalCount} ${f.queuedProposalCount === 1 ? "proposal" : "proposals"} queued`;
  const tail =
    `${f.blockedPrCount} ${prs} read main-red, ${queue}; ` +
    `a candidate lands only if its own rebased CI is green`;
  if (f.baselineFreshness === "all_contradicted") {
    // Plan 2026-10-03 D3: never "main is RED", and never "main is green" —
    // a newer run's job set may differ from the push run's.
    return (
      `⚠️ ${f.repo} main status UNKNOWN — red push baseline contradicted by ` +
      `newer passing runs, awaiting a push run — ${tail}` +
      (since ? ` (alert open${since})` : "")
    );
  }
  return `🔴 ${f.repo} main is RED${since} — ${tail}${f.staleNote}`;
}

/** The partial-baseline note, naming the stale workflows. */
function namedStaleNote(a: RedMainAlert): string {
  return a.baselineFreshness === "partial"
    ? ` (stale push baseline, contradicted by newer passing runs: ${a.staleWorkflows.join(", ")})`
    : "";
}

/** The partial-baseline note for a withheld row: how many, never which. */
function countedStaleNote(a: RedMainAlert): string {
  if (a.baselineFreshness !== "partial") return "";
  const n = a.staleWorkflows.length;
  return ` (stale push baseline on ${n} ${n === 1 ? "workflow" : "workflows"}, contradicted by newer passing runs)`;
}

/**
 * The banner headline (D2 wording), as the operator reads it. Pure — exported
 * for the vitest suite.
 */
export function redMainHeadline(a: RedMainAlert, nowMs: number): string {
  return headlineFrom(
    {
      repo: a.repo,
      since: a.since,
      blockedPrCount: a.blockedPrCount,
      queuedProposalCount: a.queuedProposalCount,
      baselineFreshness: a.baselineFreshness,
      staleNote: namedStaleNote(a),
    },
    nowMs
  );
}

/** The claim chip as it renders. */
export interface ClaimChip {
  readonly state: AlertClaimState["kind"];
  readonly text: string;
  readonly title: string;
  /** Set when `state` is `unknown`. */
  readonly unknownCause?: "unreadable" | "not-reported";
}

/**
 * How presentation mode names a claimant: by its KIND, never by its id (D3.3).
 * A device is its session machine alias, so it reads the same here as on every
 * other lens panel; agent, session and operator ids are internal identifiers
 * and are dropped. A label of no kind this knows returns `null` — the caller
 * then says the claimant is withheld rather than guessing what it is. Pure —
 * exported for the vitest suite.
 *
 * Coord's labels (`alert_queue.rs`): `agent:<id>`, `device:<id>`,
 * `device:<id>:session:<id>` and `operator:<id>`; older builds also sent
 * `session:<id>`.
 */
export function presentableClaimant(
  label: string,
  aliasDevice: (deviceId: string) => string
): string | null {
  const parts = label.split(":").map((part) => part.trim());
  const kind = (parts[0] ?? "").toLowerCase();
  const id = parts[1] ?? "";
  switch (kind) {
    case "device": {
      if (!id) return "a machine";
      const machine = aliasDevice(id);
      return (parts[2] ?? "").toLowerCase() === "session"
        ? `an agent on ${machine}`
        : machine;
    }
    case "agent":
      return "an agent";
    case "session":
      return "an agent session";
    case "operator":
      return "the operator";
    default:
      return null;
  }
}

/**
 * The claim chip for one row. `presentation` is `null` in operator mode, which
 * names the claimant in full; in presentation mode the claimant is
 * {@link presentableClaimant}'s phrase, in the text and in the tooltip alike.
 * Pure — exported for the vitest suite.
 */
export function claimChip(
  claim: AlertClaimState,
  presentation: { readonly aliasDevice: (deviceId: string) => string } | null
): ClaimChip {
  if (claim.kind === "claimed") {
    const by = claim.claimedBy;
    const when = [
      claim.claimedAt ? `since ${claim.claimedAt}` : null,
      claim.expiresAt ? `lease expires ${claim.expiresAt}` : null,
    ];
    if (presentation === null) {
      return {
        state: "claimed",
        text: by
          ? `claimed by ${compactPrincipal(by)}`
          : "claimed (claimant not named)",
        title: [
          by ? `Claimed by ${by}` : "Claimed — coord did not name the claimant",
          ...when,
        ]
          .filter(Boolean)
          .join(", "),
      };
    }
    const phrase = by
      ? presentableClaimant(by, presentation.aliasDevice)
      : null;
    return {
      state: "claimed",
      text: phrase
        ? `claimed by ${phrase}`
        : by
          ? "claimed (claimant withheld)"
          : "claimed (claimant not named)",
      title: [
        phrase
          ? `Claimed by ${phrase}`
          : by
            ? "Claimed — who holds it is withheld in presentation mode"
            : "Claimed — coord did not name the claimant",
        ...when,
      ]
        .filter(Boolean)
        .join(", "),
    };
  }
  if (claim.kind === "unclaimed") {
    return {
      state: "unclaimed",
      text: "no agent has claimed it",
      title: "No agent holds a claim on this red main yet.",
    };
  }
  return {
    state: "unknown",
    unknownCause: claim.cause,
    text: "claim unknown",
    title:
      claim.cause === "unreadable"
        ? "Coord could not read this alert's claim state (the lease could not be read or decoded), so whether an agent is working on it is unknown — not that nobody is."
        : "This coord build does not report alert claims, so whether an agent is working on it is unknown — not that nobody is.",
  };
}

/** Coord's own remediation as it renders, or `null` when none is active. */
export interface RemediationText {
  readonly text: string;
  readonly title?: string;
}

/**
 * Coord's own remediation for one row. In presentation mode it is the state
 * alone: the self-heal run reference and the fix session's agent id are
 * internal identifiers. Pure — exported for the vitest suite.
 */
export function remediationText(
  fixSession: FixSessionState,
  presenting: boolean
): RemediationText | null {
  const agent =
    !presenting && fixSession.agentId
      ? ` · ${truncateAgentId(fixSession.agentId)}`
      : "";
  switch (fixSession.kind) {
    case "none":
      return null;
    case "self_heal":
      return presenting
        ? { text: SELF_HEAL_LABEL }
        : { text: SELF_HEAL_LABEL, title: fixSession.raw };
    case "running":
      return { text: `${RUNNING_LABEL}${agent}` };
    case "stalled":
    case "failed":
      return { text: `fix session ${fixSession.kind}${agent}` };
  }
}

/** The workflows line, or `null` when there is no workflow to name. */
function workflowsLine(
  freshness: BaselineFreshness,
  workflows: readonly string[]
): string | null {
  if (workflows.length === 0) return null;
  // When newer passing runs contradict every red push baseline, coord's
  // evidence says these workflows are NOT currently failing — label them as
  // the stale baseline, never "failing".
  const label =
    freshness === "all_contradicted" ? "red push baseline" : "failing";
  return `${label}: ${workflows.join(", ")}`;
}

/** One banner row as it renders — every field already decided for the mode. */
export interface RedMainRowView {
  readonly alertKey: string;
  /** Whether the presentation lens withheld the row; `null` in operator mode. */
  readonly withheld: boolean | null;
  readonly baselineFreshness: BaselineFreshness;
  readonly headline: string;
  /** `"failing: CI, release"`, or `null` when there is none to name. */
  readonly workflows: string | null;
  readonly remediation: RemediationText | null;
  readonly claim: ClaimChip;
}

/** Which rendering a row is for: the operator's, or the presentation lens's. */
export type RedMainLens =
  | { readonly presenting: false }
  | {
      readonly presenting: true;
      readonly scope: PresentationScopeState;
      /** The session machine alias of a coord device id. */
      readonly aliasDevice: (deviceId: string) => string;
    };

/**
 * One row as the banner renders it (see the module doc). The operator view is
 * the parsed row verbatim; the presentation view is built field by field, so
 * nothing reaches it that was not decided here. Pure — exported for the vitest
 * suite.
 */
export function redMainRowView(
  a: RedMainAlert,
  nowMs: number,
  lens: RedMainLens
): RedMainRowView {
  if (!lens.presenting) {
    return {
      alertKey: a.alertKey,
      withheld: null,
      baselineFreshness: a.baselineFreshness,
      headline: redMainHeadline(a, nowMs),
      workflows: workflowsLine(a.baselineFreshness, a.workflows),
      remediation: remediationText(a.fixSession, false),
      claim: claimChip(a.claim, null),
    };
  }
  // Every name the row could print is in the verdict's text — the stale
  // workflows too, though coord sends them as a subset of `workflows`: the
  // parser does not enforce that, and the verdict must not rest on it.
  const named = redactionVerdict(
    {
      text: [a.repo, ...a.workflows, ...a.staleWorkflows].join(" "),
      repo: a.repo,
    },
    lens.scope
  ).show;
  return {
    alertKey: a.alertKey,
    withheld: !named,
    baselineFreshness: a.baselineFreshness,
    headline: headlineFrom(
      {
        repo: named ? a.repo : WITHHELD_REPOSITORY,
        since: a.since,
        blockedPrCount: a.blockedPrCount,
        queuedProposalCount: a.queuedProposalCount,
        baselineFreshness: a.baselineFreshness,
        staleNote: named ? namedStaleNote(a) : countedStaleNote(a),
      },
      nowMs
    ),
    workflows: named ? workflowsLine(a.baselineFreshness, a.workflows) : null,
    remediation: remediationText(a.fixSession, true),
    claim: claimChip(a.claim, { aliasDevice: lens.aliasDevice }),
  };
}

/** The claim chip on one banner row. Pure render of {@link ClaimChip}. */
function ClaimBadge({ chip }: { chip: ClaimChip }) {
  const variant =
    chip.state === "claimed"
      ? "badge-info"
      : chip.state === "unclaimed"
        ? "badge-warning"
        : "badge-secondary";
  return (
    <span
      className={`badge ${variant}`}
      data-testid="red-main-claim"
      data-claim-state={chip.state}
      data-claim-unknown-cause={chip.unknownCause}
      title={chip.title}
    >
      {chip.text}
    </span>
  );
}

/** Coord's own remediation, when one is active. Read only. */
function RemediationNote({ note }: { note: RemediationText | null }) {
  if (note === null) return null;
  return (
    <span
      className="text-xs text-red-100"
      data-testid="red-main-remediation"
      title={note.title}
    >
      {note.text}
    </span>
  );
}

export function RedMainBanner() {
  const { presenting } = usePresentationMode();
  const presentationScope = usePresentationScopeState();
  const aliasMachine = useMachineAliaser();
  const [reds, setReds] = useState<RedMainAlert[]>([]);
  /**
   * Consecutive polls that came back with no `red_main` row. See
   * {@link EMPTY_POLLS_BEFORE_CLEAR} — the banner clears only once this
   * crosses the threshold, so one evicted or dropped answer cannot blank it.
   */
  const emptyPolls = useRef(0);
  /**
   * Guards against overlapping polls. A read that outlives the 10s interval
   * would otherwise have a second one launched on top of it, and two answers
   * landing out of order double-count (or reset) the empty streak — the state
   * the streak protects would then turn on request latency.
   */
  const inFlight = useRef(false);
  /**
   * When coord last CONFIRMED the banner's content, and the clock that ages
   * it. A failed poll deliberately does not advance the streak (a read outage
   * is not evidence main went green), which is right — but it also means the
   * banner can keep asserting "main is RED" off an hour-old answer with
   * nothing on screen saying so. `nowMs` ticks only while the banner is up.
   */
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const fetchData = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // TARGETED, not the whole rollup. Measured 2026-08-14: coord orders the
      // unfiltered rollup by `last_seen_at DESC` under a hard 500-row cap, and
      // every watcher re-stamps `last_seen_at` on its own tick — so the served
      // window spanned as little as 7.2s and the single `red_main` row
      // survived only 1 of 5 consecutive samples. A `kind`-filtered query
      // cannot be evicted by another watcher's tick. An un-upgraded coord
      // ignores the unknown param and returns the old unfiltered rollup, which
      // `parseRedMainAlerts` already filters — so this degrades to exactly the
      // previous behaviour rather than to an empty banner.
      // No client retries (plan
      // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5):
      // this banner is mounted by the coord layout on every page, and the
      // next tick is the retry. `inFlight` above is its single-flight.
      const body = await fetchOpenAlertsOfKind(
        RED_MAIN_KIND,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      // Tolerate both `{alerts: [...]}` and bare-list shapes (two coord
      // vintages).
      const envelope = Array.isArray(body)
        ? undefined
        : (body as {
            alerts?: CoordAlertRow[];
            claims_scrape_up?: boolean | null;
          });
      const alerts = Array.isArray(body) ? body : (envelope?.alerts ?? []);
      // The answer arrived, so what the banner shows is confirmed as of NOW —
      // whether it confirmed a red main or an empty result.
      const at = Date.now();
      const parsed = parseRedMainAlerts(alerts, envelope?.claims_scrape_up);
      setLastSuccessAt(at);
      setNowMs(at);
      if (parsed.length > 0) {
        emptyPolls.current = 0;
        setReds(parsed);
        return;
      }
      // KEEP-LAST-KNOWN. An empty answer is ambiguous: main went green, OR the
      // row was evicted / the filter was dropped by an older coord. Clearing a
      // red-main banner on that ambiguity is the M2 defect —
      // require the emptiness to persist before believing it.
      emptyPolls.current += 1;
      if (emptyPolls.current >= EMPTY_POLLS_BEFORE_CLEAR) setReds([]);
    } catch {
      // Best-effort: keep the last known state on a transient fetch error
      // — a flaky poll must neither flash the banner away during a real
      // outage nor surface its own error UI here (the staleness note below
      // is how a failing read shows). The next poll retries. A failed poll is NOT an empty one, so
      // the streak is left untouched — and `lastSuccessAt` is NOT advanced,
      // which is what makes the staleness note appear.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(() => {
      // Skip the tick while nobody is looking; catch up on the way back.
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      fetchData();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchData]);

  // Age the "as of" clock while the banner is up, so a stalled read path shows
  // as stale instead of quietly freezing at its last confirmed value.
  const banner = reds.length > 0;
  useEffect(() => {
    if (!banner) return;
    const id = setInterval(() => setNowMs(Date.now()), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [banner]);

  if (reds.length === 0) return null;

  const staleMs =
    lastSuccessAt === null ? 0 : Math.max(0, nowMs - lastSuccessAt);
  const stale = staleMs > STALE_AFTER_MS;
  const lens: RedMainLens = presenting
    ? {
        presenting: true,
        scope: presentationScope,
        aliasDevice: (deviceId) => aliasMachine({ deviceId }),
      }
    : { presenting: false };

  return (
    <div data-testid="red-main-banner" className="shrink-0">
      {reds.map((episode) => {
        const a = redMainRowView(episode, nowMs, lens);
        return (
          <div
            key={a.alertKey}
            role="alert"
            data-testid="red-main-banner-row"
            data-baseline-freshness={a.baselineFreshness}
            data-redacted={a.withheld === null ? undefined : String(a.withheld)}
            // Deep-red bar + white text (~10:1, passes WCAG AAA), NOT
            // `bg-destructive text-destructive-foreground`: this app's theme
            // has no `--destructive-foreground` token (see globals.css — the
            // design system dropped it, which is why shadcn's own Badge
            // destructive variant hardcodes `text-white`), so that class
            // resolved to nothing and the headline fell back to whatever it
            // inherited — unreadable against the red fill. White on the raw
            // `--destructive` (#e5534b) is only 3.7:1 and fails AA for 14px
            // text anyway, so the surface is darkened rather than just
            // re-colouring the text. The bright border + icon keep it loud.
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-6 py-2 bg-red-900 text-white border-b-2 border-red-500"
          >
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-red-300"
              aria-hidden
            />
            <span className="text-sm font-semibold">{a.headline}</span>
            {a.workflows !== null && (
              <span
                className="text-xs font-mono text-red-100"
                data-testid="red-main-workflows"
              >
                {a.workflows}
              </span>
            )}
            {stale && lastSuccessAt !== null && (
              // The banner stays up on a read outage BY DESIGN, but it must not
              // pass an unconfirmed claim off as a live one.
              <span
                className="text-xs text-red-200 italic"
                data-testid="red-main-stale"
                title="coord has not confirmed this alert since then — the read path is failing, so the banner is showing its last known state"
              >
                (as of{" "}
                {sinceLabel(new Date(lastSuccessAt).toISOString(), nowMs)} ago)
              </span>
            )}
            <RemediationNote note={a.remediation} />
            <span className="ml-auto">
              <ClaimBadge chip={a.claim} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default RedMainBanner;

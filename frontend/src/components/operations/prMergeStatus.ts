/**
 * prMergeStatus — the two readings of coord's PR verdict that BOTH PR surfaces
 * share: the per-token attention table, and what coord's `freshen` block means
 * for a BEHIND row. `/operations` (`prPipeline`) and `/admin/coord/prs`
 * (`prStatus`) each render from here, so they cannot grade the same PR
 * differently.
 *
 * Plan
 * `2026-10-27-behind-main-no-action-needed-is-promised-without-reading-whether-coord-will-act`,
 * D2. The table lived in the `/admin/coord/prs` route directory until Phase 3;
 * `prPipeline` importing a component's data out of a route is why it moved.
 * Pure: no React, no clock.
 */

import type { Attention } from "@/components/console/attention";
import type { PrMergeStatus } from "@/services/admin-dev-service";
import { redactSecrets, type FreshenState, type PrFreshen } from "./mergeTypes";

/**
 * The audited kind → attention table. TOTAL over `PrMergeStatus`, one
 * documented row each, with its `prPipeline` counterpart named:
 *
 * | merge_status | attention | `prPipeline` counterpart | why |
 * |---|---|---|---|
 * | `ready` | `none` | `ready` | CLEAN; coord will pick it up. |
 * | `queued` | `none` | `queued` | In coord's queue. |
 * | `ci-pending` | `none` | `checks-pending` | CI is still running. **The original bug was painting this red**; it needs nobody. |
 * | `draft` | `none` | `draft` | Intentionally parked by its author. |
 * | `behind-base` | `waiting` | `needs-rebase` | BEHIND, and no other block coord knows of — which includes a verdict coord never evaluated (any other known block gets its own token, and `prPipeline` renders that as `behind-held-*`). This row is the token ALONE: UNKNOWN, not a promise, and amber because no author move is known to be owed. What coord serves in `freshen` then decides the row through `readBehindFreshen`, which may raise it. |
 * | `awaiting-specialist-review` | `waiting` | (escalation arm) | The specialist review is dispatched; a verdict is coming back. That is a nameable clearer, which is what amber requires. |
 * | `conflicts` | `author` | `conflict` / `not-mergeable` | A real merge conflict. Only a human resolves it. |
 * | `ci-failed` | `author` | `checks-failing` | A check reported failure. **The other half of the original bug** — this is the state that genuinely needs a push. |
 * | `ci-failed-stale-base` | `waiting` | `needs-rebase` (same clearer) | A check is red, but the PR's base is stale — `main` has moved past the CI base, so the red may be main's fault rather than this PR's. coord diagnosed it (predicate code `ci-not-green-stale-base`), and coord's OWN stale-base freshen MAY update the branch and re-run CI — but it refuses a distance-only stale base outright. This row is the token ALONE (UNKNOWN), amber because red would send the author to fix a failure that may not be theirs, not because the freshen is promised. What coord serves in `freshen` then decides the row through `readBehindFreshen`. |
 * | `ci-failed-infra-kill` | `waiting` | (none — see why) | Added by qontinui-coord#2723 and mapped here AHEAD of coord emitting it: every failing check run at the head failed on a SELF-HOSTED runner with zero failed steps — an infrastructure failure (runner lost, host down, setup/credential error), proven by coord's own per-job classifier. Not the author's code, so never author red. The remedy is re-running the failed jobs once the runner is healthy — infra/operator-side, named in coord's `blocking_summary`. Nothing clears it on its own (coord's bounded re-run reflex is a deferred phase), so `WAITING_AMBER` would promise a self-clearing that never comes: like `terminal-proposal-held` it is a real block with no self-clearing promise and no author move, so it sits at `UNKNOWN_AMBER`. No `prPipeline` counterpart: no existing `UnifiedStatusKind` fits (there it still reads as `checks-failing`, `author`). |
 * | `required-checks-missing` | `author` | `checks-failing` (same class) | A required check is UNSATISFIED. coord reconciles `required_checks_satisfied` against GitHub's aggregate at hydration, so a surviving `false` may never clear on its own. `trainActivity` grades it `blocking` and names `ci-failed` — not `behind-base` — as its sibling; amber here would promise a clearer that does not exist. |
 * | `review-required` | `author` | `requirements` | A required review or ruleset condition is unmet. Nothing dispatches the reviewer for you. |
 * | `blast-radius-block` | `author` | `requirements` | Over the repo's line budget: coord parks it and waits for a human decision. No timer clears it. |
 * | `ready-but-unlanded` | `author` | `conflict-stranded` (same class) | coord says ready and it has not landed — a wedge. The promise that something else would land it is demonstrably false. |
 * | `dependency-upstream-closed` | `author` | (none — see why) | A `coord:stacked-on=` / `coord:downstream-of=` label names an upstream PR that is CLOSED and did not land (qontinui-coord#2819). Unlike its `has-cross-repo-dependency` sibling inside `predicate-blocked`, no other party is coming: the edge never clears on its own, and coord classifies it `AuthorActs`. The move is to re-anchor the label onto the successor PR, or remove it if the upstream's content already landed — coord's `blocking_summary` names the dead parent. No `prPipeline` counterpart: its `blocked` row carries the "lands after the other PR" promise this state exists to retract. |
 * | `repo-unreachable` | `author` | `not-mergeable` | coord cannot clone the repo (deleted/renamed, or App access revoked). Not fixable by a rebase or a re-evaluate; a human must restore access. |
 * | `predicate-blocked` | `waiting` | (none — see why) | coord's merge predicate is holding the PR with no more specific token. A real block, so never calm. But it is a RESIDUE bucket spanning states with OPPOSITE readings: `main-red` and `has-cross-repo-dependency` clear themselves with no author action, while `has-blocking-label` needs a human and `dry-run-mode` is operator config. Red would assert "someone must act now", false for at least two members; plain `WAITING_AMBER` would promise "something else will clear this", false for at least two others. So it sits at the IGNORANCE FLOOR alongside `unknown` — we cannot say whose move it is. It differs from `unknown` in that coord DID diagnose it and names the specific code in `blocking_summary`, which `derivePrStatus` already surfaces as the badge's `reason`/`title`, so the operator can read the real cause off the row. No `prPipeline` counterpart genuinely fits: `blocked` (`waiting`) covers only the cross-repo-dependency member and carries the "lands after the other PR" promise this bucket cannot make, so naming it would be an invented alignment. |
 * | `terminal-proposal-held` | `waiting` | (none — see why) | Green + CLEAN + open, but the train's only proposal at this head is TERMINAL and HELD, so coord will not re-cut it (already-landed, merge-resolution-discarded, reap-hardcap, superseded-empty candidate, merged, plain cancelled). Split out of `ready-but-unlanded`, which keeps the no-proposal stall and every terminal coord re-cuts or re-probes itself (infra / transient errors, content and textual conflicts, shadow-landed). Like `predicate-blocked` it is a real block whose members disagree about whose move it is — linearize / close / push a new head are the AUTHOR's, a hardcap cancel-unblock is the OPERATOR's — so red would name the wrong actor for half of it and `WAITING_AMBER` would promise a self-clearing that never comes. It sits at the IGNORANCE FLOOR with `UNKNOWN_AMBER`, and coord's `blocking_summary` (the badge's `reason`/`title`) names the actual move. No `prPipeline` counterpart: `conflict-stranded` is `author`, which is the misreading this row exists to avoid. |
 * | `landed-open` | `none` | `merged` (`isMergedPr` reads the token) | coord LANDED this PR at its CURRENT head and GitHub has not closed it yet — the phantom-open ff-land window. Nobody's move: the code is on the base branch, no author can clear it, and coord's own sweep does the close (`pr_merge_phantom_open_stuck` fires when it cannot). Its `none` siblings are `ready`/`queued`/`draft`, not `unknown` — this is the one state where we know MORE than usual, not less. |
 * | `unknown` | `waiting` | `unknown` | R3's IGNORANCE FLOOR. We cannot say whose move this is, and calm would assert nothing is wrong. |
 */
export const PR_ATTENTION_BY_MERGE_STATUS: Record<PrMergeStatus, Attention> = {
  // --- nobody is blocked → never red or amber -------------------------------
  ready: "none",
  queued: "none",
  "ci-pending": "none",
  draft: "none",
  // Landed at this head; GitHub has not closed it yet. Calm is RIGHT here and
  // is not an ignorance claim — the opposite: coord corroborated a `merged`
  // proposal at this PR's exact current head. Amber would promise a clearer
  // that is not a person, and red would send someone to act on finished work.
  "landed-open": "none",
  // --- waiting on something other than the author → amber ------------------
  "behind-base": "waiting",
  "awaiting-specialist-review": "waiting",
  // Red on a stale base: not the author's red. The token alone cannot say
  // whether coord's freshen will act; `readBehindFreshen` reads what it served.
  "ci-failed-stale-base": "waiting",
  // Red from a self-hosted runner kill (zero failed steps; qontinui-coord#2723):
  // the remedy is a re-run once the runner is healthy — infra/operator-side,
  // not the author's code. No operator attention exists in this vocabulary;
  // `author` would be the misreading coord split this token out to stop.
  // Palette is the ignorance floor, not the self-clearing amber — see below.
  "ci-failed-infra-kill": "waiting",
  // --- someone must act now → red ------------------------------------------
  conflicts: "author",
  "ci-failed": "author",
  // Split out of `review-required`, but it belongs to the CI dimension, not to
  // a reviewer (coord's own `merge_verdict.rs` maps it to `"ci"`). Same
  // attention either way: nothing dispatches the missing check for you.
  "required-checks-missing": "author",
  "review-required": "author",
  "blast-radius-block": "author",
  "ready-but-unlanded": "author",
  "repo-unreachable": "author",
  // A dep edge onto a CLOSED, unlanded upstream: no other party will clear
  // it, so it leaves the `predicate-blocked` floor for author red.
  "dependency-upstream-closed": "author",
  // --- we do not know → the ignorance floor, amber's lighter sibling --------
  // coord's residue token: a real block whose members disagree about whose
  // move it is, so neither red nor the self-clearing promise is honest.
  "predicate-blocked": "waiting",
  // The HELD half of the old `ready-but-unlanded`: a diagnosed block whose
  // move is the author's for some members and the operator's for others, so
  // the same floor as `predicate-blocked`, never `author` red.
  "terminal-proposal-held": "waiting",
  unknown: "waiting",
};

// ----------------------------------------------------------------------------
// The freshen reading
// ----------------------------------------------------------------------------

/**
 * The two `merge_status` tokens coord serves `freshen` on: BEHIND (or a stale
 * CI base) is the PR's only known block, so the only open question is whether
 * coord will bring the branch current. Every other token names its own block.
 */
export type FreshenPromiseToken = "behind-base" | "ci-failed-stale-base";

export function isFreshenPromiseToken(
  token: string | null | undefined
): token is FreshenPromiseToken {
  return token === "behind-base" || token === "ci-failed-stale-base";
}

const FRESHEN_STATES: ReadonlySet<string> = new Set<FreshenState>([
  "eligible",
  "in_progress",
  "ineligible",
  "exhausted",
  "suppressed",
  "disabled",
  "unknown",
]);

/**
 * The state coord served, or `unknown`. An absent block (an older coord) and a
 * state this build does not know are both ignorance, and neither may render as
 * `eligible`.
 */
export function freshenStateOf(
  freshen: PrFreshen | null | undefined
): FreshenState {
  const state = freshen?.state;
  return state && FRESHEN_STATES.has(state) ? state : "unknown";
}

/**
 * A served reading's kind. `unknown` has none: each surface keeps its own
 * ignorance-floor kind there (`needs-rebase`; the verbatim token).
 */
export type BehindFreshenKind = "behind-freshening" | "behind-freshen-refused";

/**
 * | kind | attention | why |
 * |---|---|---|
 * | `behind-freshening` | `waiting` | Coord said it will act (`eligible`, `in_progress`), which is the nameable clearer amber requires. Dwell-capped: if the branch never moves, `prPipeline` re-escalates it. |
 * | `behind-freshen-refused` | `author` | Coord said it will NOT act (`exhausted`, `ineligible`, `suppressed`, `disabled`). Nobody else is coming, so it counts as needing attention from the first second rather than after a dwell cap. |
 */
export const BEHIND_FRESHEN_ATTENTION_BY_KIND: Record<
  BehindFreshenKind,
  Attention
> = {
  "behind-freshening": "waiting",
  "behind-freshen-refused": "author",
};

/** `null` is the UNKNOWN reading: amber, no kind, no promise. */
const FRESHEN_KIND_BY_STATE: Record<FreshenState, BehindFreshenKind | null> = {
  eligible: "behind-freshening",
  in_progress: "behind-freshening",
  exhausted: "behind-freshen-refused",
  ineligible: "behind-freshen-refused",
  suppressed: "behind-freshen-refused",
  disabled: "behind-freshen-refused",
  unknown: null,
};

export interface FreshenReading {
  /** `null` on the UNKNOWN reading; the surface keeps its own floor kind. */
  kind: BehindFreshenKind | null;
  state: FreshenState;
  /** `null` on the UNKNOWN reading; the surface keeps its own label. */
  label: string | null;
  reason: string;
  attention: Attention;
}

/** A minute-precision UTC stamp, or nothing for a value that does not parse. */
function formatAttemptTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function attemptClause(freshen: PrFreshen | null | undefined): string {
  const max = freshen?.max_attempts;
  const of = max == null ? "" : `/${max}`;
  const attempts = freshen?.attempts;
  const count =
    attempts == null ? `attempt count unreadable` : `attempt ${attempts}${of}`;
  const last = formatAttemptTime(freshen?.last_attempt_at);
  return last ? `${count}, last ${last}` : count;
}

/** `6 tries`, or the ceiling unnamed when coord served no number for it. */
function ceilingClause(freshen: PrFreshen | null | undefined): string {
  const max = freshen?.max_attempts;
  return max == null ? "its attempt ceiling" : `${max} tries`;
}

/** Coord's own clause, for the two rows whose table text cannot say why. */
function coordClause(freshen: PrFreshen | null | undefined): string {
  const clause = redactSecrets(freshen?.reason?.trim() ?? "");
  return clause ? ` (coord: ${clause})` : "";
}

/**
 * What coord's served state says about a row carrying a promise token — the D2
 * table, for both surfaces and both tokens.
 *
 * A token that is NOT a promise token reads UNKNOWN whatever `freshen` says:
 * coord serves the block only on the two promise tokens, so a block anywhere
 * else is not a statement about this verdict. `prPipeline` reaches that arm for
 * a BEHIND row with no merge_status, or one whose token names no hold.
 */
export function readBehindFreshen(pr: {
  merge_status?: string | null;
  base_branch?: string | null;
  freshen?: PrFreshen | null;
}): FreshenReading {
  const base = pr.base_branch || "main";
  const staleBase = pr.merge_status === "ci-failed-stale-base";
  const freshen = isFreshenPromiseToken(pr.merge_status) ? pr.freshen : null;
  const state = freshenStateOf(freshen);
  const kind = FRESHEN_KIND_BY_STATE[state];
  const lead = staleBase ? "red on a stale base" : `behind ${base}`;
  const shortLead = staleBase ? "Stale base" : `Behind ${base}`;
  const reading = (label: string, reason: string): FreshenReading => ({
    kind,
    state,
    label,
    reason,
    attention: kind ? BEHIND_FRESHEN_ATTENTION_BY_KIND[kind] : "waiting",
  });
  switch (state) {
    case "eligible":
      // Coord served that it WILL act, not that it has started.
      return reading(
        `${shortLead} — coord will update`,
        `${lead} — coord will update the branch (${attemptClause(freshen)})`
      );
    case "in_progress":
      return reading(
        `${shortLead} — coord updating`,
        `${lead} — coord is updating the branch (${attemptClause(freshen)})`
      );
    case "exhausted":
      return reading(
        `${shortLead} — coord gave up`,
        `${lead} — coord stopped updating it after ${ceilingClause(freshen)} ` +
          `and handed it to its unlandable shepherd; it needs a rebase ` +
          `by an author or agent`
      );
    case "ineligible": {
      const skip = redactSecrets(freshen?.skip?.trim() ?? "");
      return reading(
        `${shortLead} — not freshened`,
        `${lead} — coord does not freshen this kind` +
          `${skip ? ` (${skip})` : ""}; rebase or re-run it`
      );
    }
    case "suppressed":
      return reading(
        `${shortLead} — nothing to update`,
        `${lead} — coord found nothing to update (content already on ${base})` +
          `${coordClause(freshen)}; check whether it already landed`
      );
    case "disabled":
      return reading(
        `${shortLead} — updater off`,
        `${lead} — coord's branch updater is switched off on this build`
      );
    case "unknown":
      return {
        kind: null,
        state,
        label: null,
        reason:
          (staleBase
            ? `CI red on a stale base — ${base} moved past it; whether coord will freshen it is UNKNOWN`
            : `behind ${base} — whether coord will update it is UNKNOWN`) +
          coordClause(freshen),
        attention: "waiting",
      };
  }
}

/**
 * One sentence over a group of promise-token PRs, for a surface that speaks
 * about them together (`trainActivity`). Same reading as each row's.
 */
export function freshenGroupClause(
  prs: ReadonlyArray<Parameters<typeof readBehindFreshen>[0]>
): string {
  let updating = 0;
  let refused = 0;
  let unknown = 0;
  for (const pr of prs) {
    const { kind } = readBehindFreshen(pr);
    if (kind === "behind-freshening") updating += 1;
    else if (kind === "behind-freshen-refused") refused += 1;
    else unknown += 1;
  }
  if (updating === 0 && refused === 0) {
    return unknown === 1
      ? "Whether coord will update it is UNKNOWN."
      : "Whether coord will update them is UNKNOWN.";
  }
  const parts: string[] = [];
  if (updating > 0) parts.push(`coord is updating or will update ${updating}`);
  if (refused > 0) parts.push(`coord will not update ${refused}`);
  if (unknown > 0) parts.push(`UNKNOWN for ${unknown}`);
  return `${parts.join("; ")}.`;
}

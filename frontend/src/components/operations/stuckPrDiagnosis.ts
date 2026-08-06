// ============================================================================
// Stuck-PR diagnosis — the model behind the tenant self-service recovery card
// ============================================================================
//
// Plan `2026-07-30-coord-tenant-self-service-merge-recovery.md` Phase 4.
//
// coord already DETECTS a wedged PR and already NOTIFIES its author
// (`GET /pr-merge/:repo/stuck-nudges`). What it has never exposed to the party
// who owns the PR is a door: the levers that clear a wedge
// (`POST /pr-merge/tenant/proposals/:id/cancel`, `POST /pr-merge/prs/:o/:n/:pr/
// reevaluate`) were admin-only. Phase 1/2 of the plan moves those two onto a
// Tier-2 (`require_jwt`-or-operator-Cognito + tenant-owns-repo) authorization
// tier, and this module is the web half.
//
// The two levers moved differently, and the difference is load-bearing here:
//   * `reevaluate` kept its URL — only its tier changed, so there is exactly
//     one registration and no admin twin.
//   * `cancel` got a DISTINCT `/tenant/` path. The admin cancel survives as the
//     only door to the terminal reap-hardcap unblock (a capability Tier 2 is
//     refused, not merely rate-limited), and axum forbids two handlers on one
//     path. So a `device`/`agent` lever must name `/pr-merge/tenant/proposals/
//     :id/cancel`; only the `operator_cognito` hardcap lever names the bare
//     admin path.
//
// ---------------------------------------------------------------------------
// Why the types below mirror coord's `diagnose.rs` verbatim
// ---------------------------------------------------------------------------
//
// coord's `coord_diagnose` emits, per hypothesis, a list of
// `{lever, transport, required_identity, safe_now, why}` (`diagnose.rs:353`).
// `RequiredIdentity` (`diagnose.rs:239-305`) and `Transport`
// (`diagnose.rs:184-235`) serialize to the exact string unions declared here.
// The web renders THAT vocabulary rather than a parallel one, so an agent
// reading `coord_diagnose` over MCP and a human reading this card are told the
// same thing about the same wedge — and, critically, are told the same thing
// about WHO may pull each lever.
//
// `coord_diagnose` itself is MCP-only today (there is no HTTP route for it —
// `routes.rs` has zero `diagnose` hits), so the card derives its hypotheses
// here, from the tenant-readable coord reads (`stuck-nudges`, `/pr-merge/prs`,
// `/pr-merge/verdict/...`). The anti-drift guarantee is NOT that this file and
// `diagnose.rs` agree by convention — it is that both surfaces' ACTIONS land on
// the same coord core (the Phase-2 shared cancel/reevaluate handlers). This
// module owns the presentation; coord owns the effect, and coord's refusal
// (409/404) is always authoritative over anything decided here.
//
// ---------------------------------------------------------------------------
// The UX gates this module encodes (they are gates, not preferences)
// ---------------------------------------------------------------------------
//
// * **Predictability.** `leverAffordance` is the SINGLE decision point for
//   "does this lever become a clickable button?" — driven by
//   `required_identity` and `safe_now` alone. A lever a tenant cannot pull is
//   never rendered as one they can.
// * **Discoverability without clutter.** A lever that is out of reach is still
//   NAMED (`safe_now: false` means "named so you can escalate precisely, not
//   hidden") — it just isn't clickable.
// * **No-surprise reversibility.** Cancel deletes coord's merge-candidate ref
//   and comments on the PR. Every cancel lever carries `consequences`, which
//   the card states BEFORE the click.
// * **Honesty about uncertainty.** `confidence` is carried through and
//   rendered. Below `LOW_CONFIDENCE_THRESHOLD` the card says it is guessing.

// ---------------------------------------------------------------------------
// coord wire vocabulary (mirrors `qontinui-coord/src/diagnose.rs`)
// ---------------------------------------------------------------------------

/**
 * Who the caller must be to pull a lever. Mirrors coord's `RequiredIdentity`
 * (`diagnose.rs:239-305`), whose manual `Serialize` emits exactly these
 * lowercase strings.
 */
export type RequiredIdentity =
  | "device"
  | "agent"
  | "operator_cognito"
  | "admin_secret"
  | "github_write";

/** How a lever is pulled. Mirrors coord's `Transport` (`diagnose.rs:184-235`). */
export type Transport = "mcp" | "http" | "git_door" | "github_api";

/**
 * The identities a TENANT can present. `device`/`agent` are the Tier-2
 * principals (a paired runner, or an agent JWT minted for one); everything else
 * is a Qontinui-operator or GitHub-app identity that a customer cannot obtain,
 * so those levers are named for escalation rather than offered.
 */
const TENANT_REACHABLE_IDENTITIES: ReadonlySet<RequiredIdentity> =
  new Set<RequiredIdentity>(["device", "agent"]);

/** One observation backing a hypothesis. Mirrors coord's `Evidence`. */
export interface Evidence {
  source: string;
  pointer: string;
  value: string;
}

/** A remediation lever carrying its auth scope. Mirrors coord's `Lever`. */
export interface Lever {
  lever: string;
  transport: Transport;
  required_identity: RequiredIdentity;
  safe_now: boolean;
  why: string;
}

/**
 * The Tier-2 web actions this card can actually perform. Each maps 1:1 onto a
 * coord route the web backend proxies:
 *
 * - `reevaluate`     → `POST /pr-merge/prs/:owner/:name/:pr/reevaluate`
 * - `cancel_stop`    → `POST /pr-merge/tenant/proposals/:id/cancel {"unblock": false}`
 * - `cancel_unblock` → `POST /pr-merge/tenant/proposals/:id/cancel {"unblock": true}`
 *
 * `cancel_stop` and `cancel_unblock` are deliberately SEPARATE actions and
 * never share a button: they read identically as "Cancel" and do opposite
 * things to whether the PR retries.
 */
export type LeverActionKind = "reevaluate" | "cancel_stop" | "cancel_unblock";

/**
 * A coord lever plus the web-local presentation the card needs. `lever` keeps
 * coord's canonical identifier verbatim (so the card and an MCP agent are
 * demonstrably discussing the same lever); `title`/`useWhen`/`consequences` are
 * the plain-language layer the UX gate requires — coord's jargon is shown as a
 * sub-line, never as the button label.
 */
export interface StuckPrLever extends Lever {
  /** Plain-language label. This is what the button says. */
  title: string;
  /** When a non-expert should reach for this, in their own vocabulary. */
  useWhen?: string;
  /**
   * Exactly what pulling this does to the outside world, stated BEFORE the
   * click. Present on every destructive-shaped lever.
   */
  consequences?: string[];
  /** Bound web action; absent means "you do this yourself, not from here". */
  action?: LeverActionKind;
}

/** One ranked hypothesis. Mirrors coord's `Hypothesis` (`diagnose.rs:367`). */
export interface Hypothesis {
  /** Stable kebab id — what a runbook or a test keys on. */
  hypothesis: string;
  /** coord's `Symptom` taxonomy value for a wedged PR. */
  symptom: "pr_stuck";
  /** 0.0–1.0, hand-calibrated. NOT a learned score. */
  confidence: number;
  /** One-sentence statement of what is wrong. */
  summary: string;
  /** Why we believe it. */
  evidence: Evidence[];
  /** What can be done about it, and by whom. */
  levers: StuckPrLever[];
}

// ---------------------------------------------------------------------------
// coord constants this module must agree with EXACTLY
// ---------------------------------------------------------------------------

/**
 * `coord.merge_proposals.status` values coord treats as terminal
 * (`merge.rs:113-114`). A terminal prior at the PR's current head is what
 * blocks a re-enqueue — which is precisely what `unblock: true` clears.
 */
export const TERMINAL_PROPOSAL_STATUSES: ReadonlySet<string> = new Set([
  "merged",
  "conflict",
  "cancelled",
  "shadow-landed",
]);

/**
 * coord's evidence-absence reap hardcap stamp
 * (`outbound_git.rs:703 EVIDENCE_REAP_HARDCAP_PREFIX`). A `conflict` row
 * carrying this prefix is a DURABLE circuit breaker: coord blocks re-enqueue at
 * this head unconditionally, and clearing it stays operator-only on purpose —
 * the row means evidence-absence, and "investigate why" is the wrong thing to
 * self-serve. Do not change the literal; persisted rows are classified by it.
 */
export const EVIDENCE_REAP_HARDCAP_PREFIX = "evidence-absence reap hardcap: ";

/**
 * How long a non-terminal proposal may sit without an update before the card
 * calls it stuck. coord's own wedge that motivated this plan sat in
 * `awaiting-ci` for 4h02m; 30 minutes is well clear of a healthy CI round-trip
 * and well short of "nobody noticed".
 */
export const STALE_PROPOSAL_SECS = 1_800;

/** Below this, the card says out loud that it is guessing. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * What a cancel does to the outside world, in the user's vocabulary. Shown
 * BEFORE the click on every cancel lever (both modes) — cancel is
 * destructive-shaped and must never be a surprise.
 */
export const CANCEL_CONSEQUENCES: readonly string[] = [
  "Deletes the merge-candidate branch coord created for this PR.",
  "Posts a comment on the pull request recording the cancellation.",
  "Cannot be undone from here — coord would have to build a new candidate.",
];

// ---------------------------------------------------------------------------
// Reading coord's tenant-readable payloads
// ---------------------------------------------------------------------------

/**
 * The newest `coord.merge_proposals` row cut at the PR's current head, read
 * from `GET /pr-merge/verdict/:owner/:name/:pr` → `proposal` (coord's
 * `ProposalView`, `merge_verdict.rs:181`). Terminal rows are INCLUDED — a
 * terminal prior is exactly what blocks a re-enqueue, so hiding it would hide
 * the diagnosis.
 */
export interface ProposalView {
  proposalId: string;
  status: string;
  ageSeconds: number;
  secondsSinceUpdate: number;
  candidateRef: string | null;
  error: string | null;
  hadRebaseConflict: boolean;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Parse coord's verdict body into a {@link ProposalView}. Returns `null` when
 * the PR has no proposal at its current head (coord omits the key), or when the
 * payload is missing the two fields the card cannot act without
 * (`proposal_id`, `status`). Pure — exported for the vitest suite.
 */
export function parseProposalView(body: unknown): ProposalView | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { proposal?: unknown }).proposal;
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const proposalId = asString(p.proposal_id);
  const status = asString(p.status);
  if (!proposalId || !status) return null;
  return {
    proposalId,
    status,
    ageSeconds: asFiniteNumber(p.age_seconds) ?? 0,
    secondsSinceUpdate: asFiniteNumber(p.seconds_since_update) ?? 0,
    candidateRef: asString(p.candidate_ref),
    error: asString(p.error),
    hadRebaseConflict: p.had_rebase_conflict === true,
  };
}

/** One PR coord currently considers stuck, fused from its two nudge lists. */
export interface StuckPr {
  prNumber: number;
  /**
   * coord's live `NudgeReason` code from `stuck_now[]`
   * (`stuck_author_nudge.rs:116-128` — today the closed set is
   * `merge_conflict`). `null` when the PR is known only from a stale proposal.
   */
  reason: string | null;
  /** How many times coord has nudged this PR's author. */
  nudgeCount: number;
  lastNudgedAt: string | null;
  lastOutcome: string | null;
}

/** Parsed `GET /pr-merge/:repo/stuck-nudges`. */
export interface StuckNudges {
  repo: string;
  /** coord's `COORD_PR_STUCK_NUDGE_*` feature flag. */
  enabled: boolean;
  /** coord's per-PR nudge cap; past it the author stops being told. */
  maxNudges: number | null;
  prs: StuckPr[];
}

/**
 * Parse coord's stuck-nudges body. The live `stuck_now[]` list drives the PR
 * set (it is coord's own classification of "dirty right now"); `nudges[]` is
 * history and only ENRICHES a live row — a PR that was nudged last week and has
 * since been fixed must not reappear as a live problem. Pure — exported for the
 * vitest suite.
 */
export function parseStuckNudges(body: unknown): StuckNudges | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const repo = asString(b.repo);
  if (!repo) return null;

  const history = new Map<
    number,
    {
      nudgeCount: number;
      lastNudgedAt: string | null;
      lastOutcome: string | null;
    }
  >();
  if (Array.isArray(b.nudges)) {
    for (const row of b.nudges) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const prNumber = asFiniteNumber(r.pr_number);
      if (prNumber === null) continue;
      // `nudges` is ordered last_nudged_at DESC, so the FIRST row per PR wins.
      if (history.has(prNumber)) continue;
      history.set(prNumber, {
        nudgeCount: asFiniteNumber(r.nudge_count) ?? 0,
        lastNudgedAt: asString(r.last_nudged_at),
        lastOutcome: asString(r.last_outcome),
      });
    }
  }

  const prs: StuckPr[] = [];
  if (Array.isArray(b.stuck_now)) {
    for (const row of b.stuck_now) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const prNumber = asFiniteNumber(r.pr_number);
      if (prNumber === null) continue;
      const h = history.get(prNumber);
      prs.push({
        prNumber,
        reason: asString(r.reason),
        nudgeCount: h?.nudgeCount ?? 0,
        lastNudgedAt: h?.lastNudgedAt ?? null,
        lastOutcome: h?.lastOutcome ?? null,
      });
    }
  }
  prs.sort((a, c) => a.prNumber - c.prNumber);

  return {
    repo,
    enabled: b.enabled === true,
    maxNudges: asFiniteNumber(b.max_nudges),
    prs,
  };
}

// ---------------------------------------------------------------------------
// Lever constructors
// ---------------------------------------------------------------------------

/**
 * Re-run coord's merge decision against fresh GitHub truth. Read-then-decide:
 * it hydrates PR state and re-evaluates, and never pushes, deletes or comments
 * — which is why it is `safe_now` unconditionally.
 */
function leverReevaluate(repo: string, prNumber: number): StuckPrLever {
  return {
    lever: `POST /pr-merge/prs/${repo}/${prNumber}/reevaluate`,
    transport: "http",
    required_identity: "device",
    safe_now: true,
    why:
      "Re-runs the merge decision against a fresh read of GitHub. It only " +
      "looks and decides — it never pushes, deletes a branch, or comments.",
    title: "Re-check this PR now",
    useWhen:
      "Try this first, and again after you push a fix: coord may still be " +
      "holding a decision it made against an older view of the PR.",
    action: "reevaluate",
  };
}

/**
 * Plain cancel (`unblock: false`) — STOP. The cancelled row stays on record at
 * this head and BLOCKS a fresh attempt until the PR gets a new commit.
 */
function leverCancelStop(
  proposalId: string,
  opts: { safeNow: boolean; why?: string }
): StuckPrLever {
  return {
    // The TIER-2 path. coord serves proposal-cancel on two paths, and the one
    // named here must match this lever's `required_identity`: `/tenant/…` is
    // Tier 2 (ownership floor, rate-limited, refuses the hardcap breaker),
    // while the bare `/pr-merge/proposals/:id/cancel` is the admin escalation
    // door — see `leverHardcapUnblock`, which is `operator_cognito` and names
    // that one. Printing the admin path on a `device` lever would hand a tenant
    // a call they are 403'd on.
    lever: `POST /pr-merge/tenant/proposals/${proposalId}/cancel {"unblock": false}`,
    transport: "http",
    required_identity: "device",
    safe_now: opts.safeNow,
    why:
      opts.why ??
      "Takes the PR out of the merge queue and LEAVES it out. The stopped " +
        "attempt stays on record against this commit, so coord will not retry " +
        "until you push a new one.",
    title: "Stop trying to merge this PR",
    useWhen:
      "Use this when you are about to push a change — you do not want coord " +
      "retrying the commit you are replacing.",
    consequences: [
      ...CANCEL_CONSEQUENCES,
      "This PR will NOT be retried until you push a new commit.",
    ],
    action: "cancel_stop",
  };
}

/**
 * Cancel with `unblock: true` — RETRY. Clears the stuck attempt AND re-enqueues
 * the PR for a fresh attempt at the SAME commit.
 */
function leverCancelUnblock(proposalId: string): StuckPrLever {
  return {
    // Tier-2 path — see the note in `leverCancelStop`.
    lever: `POST /pr-merge/tenant/proposals/${proposalId}/cancel {"unblock": true}`,
    transport: "http",
    required_identity: "device",
    safe_now: true,
    why:
      "Clears the stuck attempt AND puts the PR straight back in the merge " +
      "queue for a fresh attempt at the same commit.",
    title: "Clear the block and try again",
    useWhen:
      "Use this when the code is fine and the attempt jammed on something " +
      "that has since passed — a flaky check, a queue collision, a stale view.",
    consequences: [
      ...CANCEL_CONSEQUENCES,
      "This PR WILL be retried immediately, at the same commit.",
    ],
    action: "cancel_unblock",
  };
}

/**
 * The reap-hardcap escape. Deliberately `operator_cognito` + `safe_now: false`:
 * coord keeps this one operator-only because the row means coord could not find
 * its own merge candidate N times running, and "work out why" is not a
 * self-service question. NAMED so the tenant can escalate precisely — not
 * hidden, and not offered as a button.
 */
function leverHardcapUnblock(proposalId: string): StuckPrLever {
  return {
    lever: `POST /pr-merge/proposals/${proposalId}/cancel {"unblock": true}`,
    transport: "http",
    required_identity: "operator_cognito",
    safe_now: false,
    why:
      "This attempt tripped coord's safety breaker: the merge candidate kept " +
      "disappearing before it could be checked. Clearing the breaker without " +
      "finding out why would just re-run the loop, so it stays with the " +
      "Qontinui operator. Quote this PR when you contact them.",
    title: "Clear the safety breaker (Qontinui operator only)",
  };
}

/** Resolve the conflict on the branch. A tenant CAN do this — just not here. */
function leverResolveConflict(): StuckPrLever {
  return {
    lever: "rebase the PR branch onto its base branch and push",
    transport: "git_door",
    required_identity: "device",
    safe_now: true,
    why:
      "Only the branch's owner can decide how the conflicting lines should " +
      "read, so this one happens in your checkout, not from this page.",
    title: "Resolve the conflict on your branch, then push",
    useWhen: "This is the fix. Everything else here is cleanup around it.",
  };
}

/**
 * Push a new commit — the no-operator escape from a per-commit block. coord
 * scopes both the terminal-prior block and the reap-hardcap breaker to the
 * PR's CURRENT head, so a new head clears them without anyone's permission.
 */
function leverPushNewCommit(): StuckPrLever {
  return {
    lever: "push a new commit to the PR branch",
    transport: "git_door",
    required_identity: "device",
    safe_now: true,
    why:
      "coord's block is pinned to this exact commit. Pushing any new commit " +
      "gives it a fresh one to work with and clears the block outright — no " +
      "cancellation and nobody's permission needed.",
    title: "Push a new commit",
    useWhen: "The simplest way out if you have a change to make anyway.",
  };
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

/** Everything the card knows about one stuck PR. */
export interface StuckPrInput {
  /** `owner/name`. */
  repo: string;
  prNumber: number;
  /** coord's live `stuck_now[].reason` code, or `null`. */
  reason: string | null;
  /** How many times coord has nudged the author. */
  nudgeCount: number;
  /** coord's nudge cap, or `null` when unknown. */
  maxNudges: number | null;
  /** coord's own plain-language hold reason from `/pr-merge/prs`. */
  blockingSummary: string | null;
  /** The newest proposal at this PR's head, or `null` when coord has none. */
  proposal: ProposalView | null;
  /**
   * Whether the proposal read has SETTLED. While `false`, proposal-shaped
   * hypotheses are withheld rather than guessed — "I don't know yet" is not the
   * same claim as "there is no merge attempt".
   */
  proposalLoaded: boolean;
}

/** Does this proposal error carry coord's durable reap-hardcap breaker stamp? */
export function isHardcapError(error: string | null): boolean {
  return error !== null && error.startsWith(EVIDENCE_REAP_HARDCAP_PREFIX);
}

/** Is this proposal status one coord treats as terminal? */
export function isTerminalProposalStatus(status: string): boolean {
  return TERMINAL_PROPOSAL_STATUSES.has(status);
}

/** Compact duration label for evidence values. Pure. */
export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) {
    return `${Math.max(0, Math.round(seconds || 0))}s`;
  }
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Rank a stuck PR's hypotheses, highest confidence first. Pure — exported for
 * the vitest suite, and the single place the card's content is decided.
 *
 * Every hypothesis is grounded in a field coord actually returns; none is
 * invented. When nothing matches, the result is a single explicitly LOW
 * confidence hypothesis rather than a confident-sounding guess.
 */
export function diagnoseStuckPr(input: StuckPrInput): Hypothesis[] {
  const { repo, prNumber, proposal } = input;
  const out: Hypothesis[] = [];
  const reevaluate = leverReevaluate(repo, prNumber);

  const nudgeEvidence: Evidence[] =
    input.nudgeCount > 0
      ? [
          {
            source: "coord stuck-nudges",
            pointer: `${repo}#${prNumber}.nudge_count`,
            value:
              input.maxNudges !== null && input.nudgeCount >= input.maxNudges
                ? `${input.nudgeCount} (cap reached — coord has stopped nudging)`
                : String(input.nudgeCount),
          },
        ]
      : [];

  // ---- Merge conflict: coord's own live classification. -------------------
  if (input.reason === "merge_conflict") {
    out.push({
      hypothesis: "merge-conflict-blocks-candidate",
      symptom: "pr_stuck",
      confidence: 0.9,
      summary:
        "This PR conflicts with the branch it is merging into, so coord " +
        "cannot build a merge candidate for it at all.",
      evidence: [
        {
          source: "coord stuck-nudges",
          pointer: `${repo}#${prNumber}.stuck_now[].reason`,
          value: "merge_conflict",
        },
        ...nudgeEvidence,
      ],
      levers: [leverResolveConflict(), reevaluate],
    });
  }

  if (proposal) {
    const stale = proposal.secondsSinceUpdate >= STALE_PROPOSAL_SECS;
    const terminal = isTerminalProposalStatus(proposal.status);
    const statusEvidence: Evidence = {
      source: "coord merge proposal",
      pointer: `proposal ${proposal.proposalId}.status`,
      value:
        `${proposal.status} (no change for ` +
        `${durationLabel(proposal.secondsSinceUpdate)}, age ` +
        `${durationLabel(proposal.ageSeconds)})`,
    };

    // ---- Landing: a fast-forward push may already be executing. -----------
    if (proposal.status === "landing") {
      out.push({
        hypothesis: "land-in-flight",
        symptom: "pr_stuck",
        confidence: 0.8,
        summary:
          "coord is pushing this PR onto the base branch right now. There is " +
          "nothing to clear — it is mid-land, not stuck.",
        evidence: [statusEvidence],
        levers: [
          leverCancelStop(proposal.proposalId, {
            safeNow: false,
            why:
              "The push may already be running. coord refuses to cancel a " +
              "landing attempt rather than risk a half-landed merge. Wait for " +
              "it to finish or fail.",
          }),
        ],
      });
    }

    // ---- Terminal reap-hardcap breaker: operator-only, but NAMED. ---------
    if (terminal && isHardcapError(proposal.error)) {
      out.push({
        hypothesis: "reap-hardcap-breaker-tripped",
        symptom: "pr_stuck",
        confidence: 0.85,
        summary:
          "coord's safety breaker has tripped for this commit: the merge " +
          "candidate kept vanishing before it could be checked, so coord will " +
          "not try again at this commit.",
        evidence: [
          statusEvidence,
          {
            source: "coord merge proposal",
            pointer: `proposal ${proposal.proposalId}.error`,
            value: proposal.error ?? "",
          },
        ],
        // The breaker is scoped to THIS head, so a new commit escapes it with
        // no operator at all. Offer that first, then name the escalation.
        levers: [
          leverPushNewCommit(),
          leverHardcapUnblock(proposal.proposalId),
        ],
      });
    } else if (terminal && proposal.status !== "merged") {
      // ---- A failed/cancelled prior at this head blocks re-enqueue. -------
      out.push({
        hypothesis: "terminal-prior-blocks-this-commit",
        symptom: "pr_stuck",
        confidence: 0.75,
        summary:
          `A previous merge attempt at this commit ended as ` +
          `"${proposal.status}". coord keeps that on record, and it is what ` +
          "stops this PR being queued again at the same commit.",
        evidence: [
          statusEvidence,
          ...(proposal.error
            ? [
                {
                  source: "coord merge proposal",
                  pointer: `proposal ${proposal.proposalId}.error`,
                  value: proposal.error,
                },
              ]
            : []),
        ],
        levers: [
          leverCancelUnblock(proposal.proposalId),
          leverPushNewCommit(),
          reevaluate,
        ],
      });
    }

    // ---- Non-terminal and not moving: the zombie. ------------------------
    if (!terminal && proposal.status !== "landing" && stale) {
      out.push({
        hypothesis: "stale-proposal-zombie",
        symptom: "pr_stuck",
        confidence: 0.7,
        summary:
          `This PR's merge attempt has been sitting in "${proposal.status}" ` +
          `for ${durationLabel(proposal.secondsSinceUpdate)} without moving. ` +
          "It is holding a merge slot and will not clear itself.",
        evidence: [statusEvidence, ...nudgeEvidence],
        levers: [
          leverCancelUnblock(proposal.proposalId),
          leverCancelStop(proposal.proposalId, { safeNow: true }),
          reevaluate,
        ],
      });
    }
  }

  // ---- Nothing matched: say so, at low confidence. ------------------------
  if (out.length === 0) {
    out.push({
      hypothesis: "unclassified-hold",
      symptom: "pr_stuck",
      confidence: 0.3,
      summary:
        input.blockingSummary && input.blockingSummary.length > 0
          ? `coord is holding this PR back and reports: ` +
            `"${input.blockingSummary}". That does not match a wedge this page ` +
            "knows how to name."
          : "coord flagged this PR as stuck, but nothing here matches a wedge " +
            "this page knows how to name.",
      evidence: [
        {
          source: "coord",
          pointer: `${repo}#${prNumber}`,
          value: input.proposalLoaded
            ? (input.proposal?.status ?? "no merge attempt at this commit")
            : "merge attempt not read yet",
        },
        ...nudgeEvidence,
      ],
      levers: [reevaluate],
    });
  }

  // Stable: confidence first, then hypothesis id, so equal-confidence rows
  // never reshuffle between polls.
  out.sort(
    (a, b) =>
      b.confidence - a.confidence || a.hypothesis.localeCompare(b.hypothesis)
  );
  return out;
}

/**
 * Plain-language confidence band. Used for the badge AND for the "we are
 * guessing" disclosure — a low-confidence hypothesis must not be presented as a
 * finding. Pure — exported for the vitest suite.
 */
export function confidenceLabel(confidence: number): "high" | "likely" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return "likely";
  return "low";
}

// ---------------------------------------------------------------------------
// The single gate: which levers become clickable buttons
// ---------------------------------------------------------------------------

/**
 * How one lever should be surfaced. Four outcomes, one decision point.
 *
 * - `action`   — tenant-reachable identity, safe right now, and bound to a web
 *                action → an ENABLED button.
 * - `blocked`  — tenant-reachable and bound, but coord says not safe right now
 *                → a DISABLED button carrying the reason.
 * - `manual`   — tenant-reachable but there is no web action (it happens in the
 *                user's checkout) → named as an instruction, no button.
 * - `escalate` — the identity is one a customer cannot obtain → named precisely
 *                so they can escalate, never dressed up as a button.
 */
export type LeverAffordance =
  | { kind: "action"; action: LeverActionKind }
  | { kind: "blocked"; action: LeverActionKind; reason: string }
  | { kind: "manual"; reason: string }
  | { kind: "escalate"; identity: RequiredIdentity; reason: string };

/**
 * Decide a lever's affordance from `required_identity` and `safe_now` ALONE.
 * Pure — exported for the vitest suite, and the only place this decision is
 * made. Identity is checked FIRST: an out-of-reach lever is never rendered as a
 * disabled-but-mine button, because "you may not" and "not right now" are
 * different statements.
 */
export function leverAffordance(lever: StuckPrLever): LeverAffordance {
  if (!TENANT_REACHABLE_IDENTITIES.has(lever.required_identity)) {
    return {
      kind: "escalate",
      identity: lever.required_identity,
      reason: lever.why,
    };
  }
  if (!lever.action) {
    return { kind: "manual", reason: lever.why };
  }
  if (!lever.safe_now) {
    return { kind: "blocked", action: lever.action, reason: lever.why };
  }
  return { kind: "action", action: lever.action };
}

/** Human label for a `required_identity` a tenant cannot present. */
export function identityLabel(identity: RequiredIdentity): string {
  switch (identity) {
    case "operator_cognito":
      return "Qontinui operator";
    case "admin_secret":
      return "Qontinui fleet admin";
    case "github_write":
      return "GitHub write access";
    case "device":
      return "your paired runner";
    case "agent":
      return "one of your agents";
  }
}

// ---------------------------------------------------------------------------
// coord's refusals, in the user's words
// ---------------------------------------------------------------------------

/** A coord refusal, translated. */
export interface ActionError {
  /** coord's machine code when it emitted one, else a synthetic marker. */
  code: string;
  /** What to show the user. */
  message: string;
  /**
   * True for coord's deliberate 404-not-403 posture. coord answers 404 for a
   * cross-tenant or unknown row SO AS NOT to leak that the row exists — so this
   * must surface as "not found", NEVER as "forbidden".
   */
  notFound: boolean;
}

/**
 * coord's machine error codes, in the user's vocabulary. Anything not listed
 * falls through to coord's own text, so a new coord code degrades to honest
 * passthrough rather than a wrong translation.
 */
const CODE_MESSAGES: Record<string, string> = {
  land_in_flight:
    "This PR is already landing — there is nothing to cancel. Wait for the " +
    "push to finish or fail.",
  batch_in_flight:
    "Its commits are already part of a combined merge batch, so cancelling " +
    "this one alone would break the batch. It will land or fail with the batch.",
  pr_not_found_in_tenant_scope:
    "Not found — coord has no record of this pull request in your " +
    "organization. It may already have been cleared.",
  proposal_not_found_in_tenant_scope:
    "Not found — coord has no record of this merge attempt in your " +
    "organization. It may already have been cleared.",
};

/** The codes that are coord's "I will not confirm this row exists" answer. */
const NOT_FOUND_CODES = new Set([
  "pr_not_found_in_tenant_scope",
  "proposal_not_found_in_tenant_scope",
]);

/** Match coord's prose 409 for an already-finished proposal. */
const TERMINAL_PROSE = /^proposal already in terminal status:\s*(.+)$/;

/**
 * Translate a coord refusal into something a non-expert can act on. `body` is
 * coord's response body VERBATIM — the web backend proxies coord's status code
 * and JSON body through untouched, so `{"error": "land_in_flight", …}` arrives
 * intact. Pure — exported for the vitest suite.
 */
export function describeActionError(
  status: number,
  body: unknown
): ActionError {
  const obj =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  // coord uses `error`; the web backend's own failures (coord unreachable,
  // timeout) use FastAPI's `detail`.
  const raw = asString(obj.error) ?? asString(obj.detail) ?? "";

  const known = CODE_MESSAGES[raw];
  if (raw && known) {
    return { code: raw, message: known, notFound: NOT_FOUND_CODES.has(raw) };
  }

  const terminal = TERMINAL_PROSE.exec(raw);
  if (terminal) {
    return {
      code: "already_terminal",
      message:
        `This merge attempt has already finished (${terminal[1]}) — there is ` +
        "nothing left to cancel.",
      notFound: false,
    };
  }

  if (status === 404) {
    return {
      code: raw || "not_found",
      message:
        "Not found — coord has no record of this in your organization. It may " +
        "already have been cleared.",
      notFound: true,
    };
  }

  if (status === 401 || status === 403) {
    return {
      code: raw || "not_authorized",
      message:
        "coord did not accept this account for that action. If this keeps " +
        "happening, contact the Qontinui operator.",
      notFound: false,
    };
  }

  return {
    code: raw || `http_${status}`,
    message: raw || `coord returned HTTP ${status}.`,
    notFound: false,
  };
}

/**
 * What coord's 200 means, in the user's words. Pure — exported for the vitest
 * suite.
 *
 * The two cancel modes get DIFFERENT confirmations on purpose: the whole risk
 * this card guards against is a user believing they retried when they stopped
 * (or the reverse), and the moment after the click is the last chance to say
 * which one happened.
 */
export function describeActionSuccess(
  kind: LeverActionKind,
  body: unknown
): string {
  const b =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  switch (kind) {
    case "reevaluate": {
      if (b.result === "pass") {
        return (
          "Re-checked: this PR now passes coord's merge checks. It should be " +
          "picked up on the next queue pass."
        );
      }
      const code = asString(b.block_reason_code);
      return code
        ? `Re-checked: coord is still holding this PR back (${code}).`
        : "Re-checked: coord is still holding this PR back.";
    }
    case "cancel_stop":
      return (
        "Stopped. This PR is out of the merge queue and will NOT be retried " +
        "until you push a new commit."
      );
    case "cancel_unblock":
      return (
        "Cleared. coord will queue a fresh merge attempt for this PR at the " +
        "same commit."
      );
  }
}

/** The justification stamped onto coord's cancel audit trail + PR comment. */
export const CANCEL_REASON =
  "cancelled by the PR owner from the Qontinui web console";

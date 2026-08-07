import { describe, expect, it } from "vitest";

import {
  CANCEL_CONSEQUENCES,
  EVIDENCE_REAP_HARDCAP_PREFIX,
  LOW_CONFIDENCE_THRESHOLD,
  STALE_PROPOSAL_SECS,
  confidenceLabel,
  describeActionError,
  describeActionSuccess,
  diagnoseStuckPr,
  durationLabel,
  identityLabel,
  isHardcapError,
  isRetractedByVerdict,
  isTerminalProposalStatus,
  leverAffordance,
  parseProposalView,
  parseStuckNudges,
  type Hypothesis,
  type ProposalView,
  type StuckPrInput,
  type StuckPrLever,
} from "./stuckPrDiagnosis";

/**
 * Tests for the stuck-PR diagnosis model (plan
 * `2026-07-30-coord-tenant-self-service-merge-recovery.md` Phase 4).
 *
 * The load-bearing contracts here are:
 * 1. `leverAffordance` — the SINGLE gate deciding which levers become
 *    clickable buttons, from `required_identity` + `safe_now` alone.
 * 2. cancel-vs-unblock — two distinct levers that must never read alike.
 * 3. `describeActionError` — coord's 409s rendered specifically, and its
 *    deliberate 404-not-403 posture rendered as NOT FOUND, never forbidden.
 */

const REPO = "jspinak/qontinui-runner";

function proposal(overrides: Partial<ProposalView> = {}): ProposalView {
  return {
    proposalId: "11111111-2222-3333-4444-555555555555",
    status: "awaiting-ci",
    ageSeconds: 4 * 3600,
    secondsSinceUpdate: 4 * 3600,
    candidateRef: "refs/heads/coord/merge-candidate/1",
    error: null,
    hadRebaseConflict: false,
    statusNote: null,
    ...overrides,
  };
}

function input(overrides: Partial<StuckPrInput> = {}): StuckPrInput {
  return {
    repo: REPO,
    prNumber: 503,
    reason: null,
    nudgeCount: 0,
    maxNudges: 3,
    lastNudgedAt: null,
    lastOutcome: null,
    nudgesEnabled: true,
    blockingSummary: null,
    proposal: null,
    proposalLoaded: true,
    ...overrides,
  };
}

/** The first hypothesis carrying a lever bound to `action`. */
function leverFor(
  hypotheses: Hypothesis[],
  action: string
): StuckPrLever | undefined {
  for (const h of hypotheses) {
    const found = h.levers.find((l) => l.action === action);
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Parsing coord's payloads
// ---------------------------------------------------------------------------

describe("parseProposalView", () => {
  it("lifts coord's ProposalView out of the verdict envelope", () => {
    expect(
      parseProposalView({
        pr_number: 503,
        proposal: {
          proposal_id: "abc-def",
          status: "awaiting-ci",
          age_seconds: 14520,
          seconds_since_update: 14400,
          candidate_ref: "refs/heads/x",
          error: "boom",
          had_rebase_conflict: true,
          status_note:
            "status `awaiting-ci` describes this proposal's QUEUE SLOT",
        },
      })
    ).toEqual<ProposalView>({
      proposalId: "abc-def",
      status: "awaiting-ci",
      ageSeconds: 14520,
      secondsSinceUpdate: 14400,
      candidateRef: "refs/heads/x",
      error: "boom",
      hadRebaseConflict: true,
      statusNote: "status `awaiting-ci` describes this proposal's QUEUE SLOT",
    });
  });

  it("nulls `status_note` when coord omits it (status and error agree)", () => {
    // coord emits the key only on the contradiction, so its absence is the
    // common case and must not become a truthy empty string.
    const parsed = parseProposalView({
      proposal: { proposal_id: "a", status: "queued" },
    });
    expect(parsed?.statusNote).toBeNull();
  });

  it("returns null when coord omits `proposal` (no attempt at this head)", () => {
    expect(parseProposalView({ pr_number: 503 })).toBeNull();
    expect(parseProposalView(null)).toBeNull();
    expect(parseProposalView("nope")).toBeNull();
  });

  it("returns null without the two fields an action cannot be built from", () => {
    expect(parseProposalView({ proposal: { status: "landing" } })).toBeNull();
    expect(parseProposalView({ proposal: { proposal_id: "a" } })).toBeNull();
  });
});

describe("parseStuckNudges", () => {
  const body = {
    repo: REPO,
    enabled: true,
    cooldown_secs: 3600,
    max_nudges: 3,
    nudges: [
      {
        pr_number: 503,
        reason: "merge_conflict",
        first_nudged_at: "2026-08-05T00:00:00Z",
        last_nudged_at: "2026-08-06T00:00:00Z",
        nudge_count: 2,
        last_outcome: null,
      },
      // Older duplicate for the same PR — must not overwrite the newest.
      {
        pr_number: 503,
        reason: "merge_conflict",
        first_nudged_at: "2026-08-01T00:00:00Z",
        last_nudged_at: "2026-08-01T00:00:00Z",
        nudge_count: 1,
        last_outcome: "ignored",
      },
      // History for a PR that is NOT stuck any more.
      {
        pr_number: 400,
        reason: "merge_conflict",
        first_nudged_at: "2026-07-01T00:00:00Z",
        last_nudged_at: "2026-07-01T00:00:00Z",
        nudge_count: 5,
        last_outcome: null,
      },
    ],
    stuck_now: [{ pr_number: 503, reason: "merge_conflict" }],
  };

  it("drives the PR set from stuck_now and enriches from nudge history", () => {
    const got = parseStuckNudges(body);
    expect(got?.repo).toBe(REPO);
    expect(got?.maxNudges).toBe(3);
    expect(got?.prs).toEqual([
      {
        prNumber: 503,
        reason: "merge_conflict",
        nudgeCount: 2,
        lastNudgedAt: "2026-08-06T00:00:00Z",
        lastOutcome: null,
      },
    ]);
  });

  it("never resurrects a PR that only appears in history", () => {
    // #400 was nudged five times but is not stuck now — it must not appear.
    expect(parseStuckNudges(body)?.prs.map((p) => p.prNumber)).not.toContain(
      400
    );
  });

  it("tolerates missing / malformed payloads", () => {
    expect(parseStuckNudges(null)).toBeNull();
    expect(parseStuckNudges({ enabled: true })).toBeNull();
    expect(parseStuckNudges({ repo: REPO })?.prs).toEqual([]);
    expect(
      parseStuckNudges({ repo: REPO, stuck_now: "nope", nudges: 42 })?.prs
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// coord constants
// ---------------------------------------------------------------------------

describe("coord constants", () => {
  it("matches coord's terminal proposal status set verbatim", () => {
    for (const s of ["merged", "conflict", "cancelled", "shadow-landed"]) {
      expect(isTerminalProposalStatus(s)).toBe(true);
    }
    for (const s of ["awaiting-ci", "dry-rebasing", "landing", "queued"]) {
      expect(isTerminalProposalStatus(s)).toBe(false);
    }
  });

  it("recognizes coord's reap-hardcap breaker stamp by prefix", () => {
    expect(
      isHardcapError(`${EVIDENCE_REAP_HARDCAP_PREFIX}candidate vanished 3x`)
    ).toBe(true);
    expect(isHardcapError("rebase conflict")).toBe(false);
    expect(isHardcapError(null)).toBe(false);
  });
});

describe("durationLabel", () => {
  it("renders seconds, minutes, hours and days", () => {
    expect(durationLabel(30)).toBe("30s");
    expect(durationLabel(600)).toBe("10m");
    expect(durationLabel(4 * 3600 + 120)).toBe("4h 2m");
    expect(durationLabel(5 * 86400)).toBe("5d");
  });
});

// ---------------------------------------------------------------------------
// The gate: which levers become clickable buttons
// ---------------------------------------------------------------------------

describe("leverAffordance", () => {
  function lever(overrides: Partial<StuckPrLever>): StuckPrLever {
    return {
      lever: "POST /x",
      transport: "http",
      required_identity: "device",
      safe_now: true,
      why: "because",
      title: "Do the thing",
      action: "reevaluate",
      ...overrides,
    };
  }

  it("gives a tenant-reachable, safe, bound lever an enabled action", () => {
    expect(leverAffordance(lever({ required_identity: "device" }))).toEqual({
      kind: "action",
      action: "reevaluate",
    });
    expect(leverAffordance(lever({ required_identity: "agent" }))).toEqual({
      kind: "action",
      action: "reevaluate",
    });
  });

  it("names an out-of-reach identity for escalation instead of offering it", () => {
    for (const identity of [
      "operator_cognito",
      "admin_secret",
      "github_write",
    ] as const) {
      const got = leverAffordance(lever({ required_identity: identity }));
      expect(got.kind).toBe("escalate");
      // Identity is checked FIRST: even a safe, action-bound lever must not
      // degrade to a merely-disabled button when it is not the caller's to pull.
      if (got.kind === "escalate") expect(got.identity).toBe(identity);
    }
  });

  it("keeps identity ahead of safe_now — 'you may not' outranks 'not now'", () => {
    const got = leverAffordance(
      lever({ required_identity: "admin_secret", safe_now: false })
    );
    expect(got.kind).toBe("escalate");
  });

  it("disables (not hides) a tenant lever coord says is unsafe right now", () => {
    const got = leverAffordance(
      lever({ safe_now: false, why: "the push may already be running" })
    );
    expect(got).toEqual({
      kind: "blocked",
      action: "reevaluate",
      reason: "the push may already be running",
    });
  });

  it("renders an unbound tenant lever as a manual instruction, not a button", () => {
    const got = leverAffordance(
      lever({ action: undefined, transport: "git_door" })
    );
    expect(got).toEqual({ kind: "manual", reason: "because" });
  });
});

describe("identityLabel", () => {
  it("names every identity in words a customer can escalate with", () => {
    expect(identityLabel("operator_cognito")).toBe("Qontinui operator");
    expect(identityLabel("admin_secret")).toBe("Qontinui fleet admin");
    expect(identityLabel("github_write")).toBe("GitHub write access");
    expect(identityLabel("device")).toBe("your paired runner");
    expect(identityLabel("agent")).toBe("one of your agents");
  });
});

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

describe("diagnoseStuckPr", () => {
  it("names a merge conflict from coord's own live classification", () => {
    const got = diagnoseStuckPr(input({ reason: "merge_conflict" }));
    expect(got[0].hypothesis).toBe("merge-conflict-blocks-candidate");
    expect(got[0].confidence).toBeGreaterThanOrEqual(0.8);
    // The fix is on the branch, so the top lever is an instruction, not a
    // button — and re-checking is still offered.
    expect(leverAffordance(got[0].levers[0]).kind).toBe("manual");
    expect(leverFor(got, "reevaluate")).toBeDefined();
  });

  it("names a stale non-terminal proposal as a zombie, with both cancels", () => {
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({
          status: "awaiting-ci",
          secondsSinceUpdate: STALE_PROPOSAL_SECS + 1,
        }),
      })
    );
    expect(got[0].hypothesis).toBe("stale-proposal-zombie");
    expect(leverFor(got, "cancel_unblock")).toBeDefined();
    expect(leverFor(got, "cancel_stop")).toBeDefined();
  });

  it("does not call a freshly-updated proposal stuck", () => {
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({ secondsSinceUpdate: STALE_PROPOSAL_SECS - 1 }),
      })
    );
    expect(got.map((h) => h.hypothesis)).not.toContain("stale-proposal-zombie");
  });

  it("blocks cancel while the PR is landing, with coord's reason", () => {
    const got = diagnoseStuckPr(
      input({ proposal: proposal({ status: "landing" }) })
    );
    expect(got[0].hypothesis).toBe("land-in-flight");
    const stop = leverFor(got, "cancel_stop");
    expect(stop?.safe_now).toBe(false);
    expect(leverAffordance(stop!).kind).toBe("blocked");
    // No unblock offered at all — there is nothing to re-queue mid-land.
    expect(leverFor(got, "cancel_unblock")).toBeUndefined();
  });

  it("offers unblock when a terminal prior blocks this commit", () => {
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({ status: "conflict", error: "rebase failed" }),
      })
    );
    expect(got[0].hypothesis).toBe("terminal-prior-blocks-this-commit");
    expect(leverAffordance(leverFor(got, "cancel_unblock")!).kind).toBe(
      "action"
    );
  });

  it("keeps the reap-hardcap breaker operator-only, but NAMES it", () => {
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({
          status: "conflict",
          error: `${EVIDENCE_REAP_HARDCAP_PREFIX}candidate vanished 3x`,
        }),
      })
    );
    expect(got[0].hypothesis).toBe("reap-hardcap-breaker-tripped");
    // Named, not hidden — and never clickable.
    const operatorLever = got[0].levers.find(
      (l) => l.required_identity === "operator_cognito"
    );
    expect(operatorLever).toBeDefined();
    expect(leverAffordance(operatorLever!).kind).toBe("escalate");
    // No self-service cancel is offered for this class at all.
    expect(leverFor(got, "cancel_unblock")).toBeUndefined();
    expect(leverFor(got, "cancel_stop")).toBeUndefined();
  });

  it("says it is guessing rather than inventing a finding", () => {
    const got = diagnoseStuckPr(
      input({ blockingSummary: "waiting on review" })
    );
    expect(got).toHaveLength(1);
    expect(got[0].hypothesis).toBe("unclassified-hold");
    expect(got[0].confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(got[0].summary).toContain("waiting on review");
    // Only the read-only lever is offered when we do not know what is wrong.
    expect(got[0].levers.every((l) => l.action === "reevaluate")).toBe(true);
  });

  it("withholds 'there is no merge attempt' while the read is in flight", () => {
    const pending = diagnoseStuckPr(input({ proposalLoaded: false }));
    expect(pending[0].evidence[0].value).toBe("merge attempt not read yet");
    const settled = diagnoseStuckPr(input({ proposalLoaded: true }));
    expect(settled[0].evidence[0].value).toBe(
      "no merge attempt at this commit"
    );
  });

  it("ranks by confidence and is stable across identical inputs", () => {
    const args = input({
      reason: "merge_conflict",
      proposal: proposal({
        status: "awaiting-ci",
        secondsSinceUpdate: STALE_PROPOSAL_SECS + 1,
      }),
    });
    const a = diagnoseStuckPr(args).map((h) => h.hypothesis);
    const b = diagnoseStuckPr(args).map((h) => h.hypothesis);
    expect(a).toEqual(b);
    expect(a[0]).toBe("merge-conflict-blocks-candidate");
  });
});

// ---------------------------------------------------------------------------
// Fields coord returns that the card must actually READ
// ---------------------------------------------------------------------------

describe("diagnoseStuckPr — coord's status/error contradiction", () => {
  const NOTE =
    "status `awaiting-ci` describes this proposal's QUEUE SLOT, not its " +
    "outcome — the row carries an error, so a prior attempt did not complete: " +
    'authority_mismatch. Do NOT read `awaiting-ci` as "still waiting".';

  it("leads with `status_note` and outranks every inferred hypothesis", () => {
    // coord ASSERTS this one; everything else on the card is inferred from
    // shapes. It has to sort first or the user reads the guess and stops.
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({
          status: "awaiting-ci",
          error: "authority_mismatch",
          statusNote: NOTE,
          secondsSinceUpdate: STALE_PROPOSAL_SECS + 1,
        }),
      })
    );
    expect(got[0].hypothesis).toBe("status-contradicts-recorded-error");
    expect(got[0].confidence).toBeGreaterThan(0.9);
    expect(
      got[0].evidence.some((e) => e.pointer.endsWith(".status_note"))
    ).toBe(true);
  });

  it("suppresses the zombie hypothesis it would otherwise duplicate", () => {
    // Same stale row: without the note this is `stale-proposal-zombie`. With
    // it, "coord says exactly why" must not sit above "we don't know why".
    const stale = {
      status: "awaiting-ci",
      secondsSinceUpdate: STALE_PROPOSAL_SECS + 1,
    };
    const without = diagnoseStuckPr(input({ proposal: proposal(stale) })).map(
      (h) => h.hypothesis
    );
    const withNote = diagnoseStuckPr(
      input({ proposal: proposal({ ...stale, statusNote: NOTE }) })
    ).map((h) => h.hypothesis);

    expect(without).toContain("stale-proposal-zombie");
    expect(withNote).not.toContain("stale-proposal-zombie");
  });

  it("respects coord's land-in-flight refusal when the note fires on `landing`", () => {
    // `status_note` fires on any in-flight status, `landing` included. Offering
    // an enabled cancel there would be a button coord answers with a 409.
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({
          status: "landing",
          error: "boom",
          statusNote: NOTE,
        }),
      })
    );
    const top = got.find(
      (h) => h.hypothesis === "status-contradicts-recorded-error"
    );
    expect(top).toBeDefined();
    expect(leverFor([top!], "cancel_unblock")).toBeUndefined();
    expect(leverAffordance(leverFor([top!], "cancel_stop")!).kind).toBe(
      "blocked"
    );
  });
});

describe("diagnoseStuckPr — had_rebase_conflict", () => {
  it("does NOT offer a same-commit retry for a rebase conflict", () => {
    // The regression this guards: `conflict` is terminal, so without reading
    // `had_rebase_conflict` the terminal-prior arm fires and leads with "Clear
    // the block and try again" — a retry that re-runs the same rebase into the
    // same conflict.
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({ status: "conflict", hadRebaseConflict: true }),
      })
    );
    expect(got[0].hypothesis).toBe("rebase-conflict-needs-your-branch");
    expect(got.map((h) => h.hypothesis)).not.toContain(
      "terminal-prior-blocks-this-commit"
    );
    expect(leverFor(got, "cancel_unblock")).toBeUndefined();
    // The real fix is in the user's checkout.
    expect(leverAffordance(got[0].levers[0]).kind).toBe("manual");
  });

  it("still offers the retry for a terminal row that is NOT a rebase conflict", () => {
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({ status: "conflict", hadRebaseConflict: false }),
      })
    );
    expect(got[0].hypothesis).toBe("terminal-prior-blocks-this-commit");
    expect(leverFor(got, "cancel_unblock")).toBeDefined();
  });

  it("does not name the same conflict twice when stuck-nudges already did", () => {
    const got = diagnoseStuckPr(
      input({
        reason: "merge_conflict",
        proposal: proposal({ status: "conflict", hadRebaseConflict: true }),
      })
    ).map((h) => h.hypothesis);
    expect(got).toContain("merge-conflict-blocks-candidate");
    expect(got).not.toContain("rebase-conflict-needs-your-branch");
  });

  it("leaves the hardcap breaker ahead of it — that one is operator-only", () => {
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({
          status: "conflict",
          hadRebaseConflict: true,
          error: `${EVIDENCE_REAP_HARDCAP_PREFIX}3 reaps`,
        }),
      })
    ).map((h) => h.hypothesis);
    expect(got).toContain("reap-hardcap-breaker-tripped");
    expect(got).not.toContain("rebase-conflict-needs-your-branch");
  });
});

describe("diagnoseStuckPr — nudge history and the nudge feature flag", () => {
  it("carries `last_nudged_at` and `last_outcome` into the evidence", () => {
    // Both were parsed off coord's payload and then dropped on the floor: a
    // bare count cannot date the problem, and only `last_outcome` says whether
    // the nudges coord counted ever reached anyone.
    const got = diagnoseStuckPr(
      input({
        reason: "merge_conflict",
        nudgeCount: 2,
        lastNudgedAt: "2026-08-07T09:00:00Z",
        lastOutcome: "delivered",
      })
    );
    const pointers = got[0].evidence.map((e) => e.pointer);
    expect(pointers.some((p) => p.endsWith(".last_nudged_at"))).toBe(true);
    expect(pointers.some((p) => p.endsWith(".last_outcome"))).toBe(true);
  });

  it("says nudges are OFF rather than letting silence read as health", () => {
    const got = diagnoseStuckPr(
      input({
        nudgesEnabled: false,
        proposal: proposal({
          status: "awaiting-ci",
          secondsSinceUpdate: STALE_PROPOSAL_SECS + 1,
        }),
      })
    );
    const flag = got[0].evidence.find((e) => e.pointer.endsWith(".enabled"));
    expect(flag?.value).toContain("false");
  });

  it("stays quiet about the flag when it is on", () => {
    const got = diagnoseStuckPr(
      input({
        nudgesEnabled: true,
        proposal: proposal({
          status: "awaiting-ci",
          secondsSinceUpdate: STALE_PROPOSAL_SECS + 1,
        }),
      })
    );
    expect(got[0].evidence.some((e) => e.pointer.endsWith(".enabled"))).toBe(
      false
    );
  });

  it("names the candidate ref a cancel would delete", () => {
    const got = diagnoseStuckPr(
      input({
        proposal: proposal({
          status: "awaiting-ci",
          secondsSinceUpdate: STALE_PROPOSAL_SECS + 1,
          candidateRef: "refs/heads/merge-candidate/abc",
        }),
      })
    );
    expect(
      got[0].evidence.find((e) => e.pointer.endsWith(".candidate_ref"))?.value
    ).toBe("refs/heads/merge-candidate/abc");
  });
});

describe("isRetractedByVerdict", () => {
  const moving = { status: "awaiting-ci", secondsSinceUpdate: 60 };

  it("retracts a PR the age screen caught but the verdict cleared", () => {
    // The false alarm: `/pr-merge/prs` only carries proposal AGE, so an
    // ordinary 45-minute CI round trip clears the screen every time.
    expect(isRetractedByVerdict(input({ proposal: proposal(moving) }))).toBe(
      true
    );
  });

  it("keeps the PR when coord's live nudges also accused it", () => {
    expect(
      isRetractedByVerdict(
        input({ reason: "merge_conflict", proposal: proposal(moving) })
      )
    ).toBe(false);
    expect(
      isRetractedByVerdict(input({ nudgeCount: 1, proposal: proposal(moving) }))
    ).toBe(false);
  });

  it("keeps the PR when the proposal is stalled, terminal, or contradicted", () => {
    expect(
      isRetractedByVerdict(
        input({
          proposal: proposal({
            ...moving,
            secondsSinceUpdate: STALE_PROPOSAL_SECS,
          }),
        })
      )
    ).toBe(false);
    expect(
      isRetractedByVerdict(
        input({ proposal: proposal({ status: "conflict" }) })
      )
    ).toBe(false);
    expect(
      isRetractedByVerdict(
        input({
          proposal: proposal({ ...moving, statusNote: "contradiction" }),
        })
      )
    ).toBe(false);
  });

  it("never retracts on an unsettled or absent read", () => {
    // "Not read yet" and "no merge attempt" are the two states with the LEAST
    // evidence — neither is grounds to tell the user nothing is wrong.
    expect(
      isRetractedByVerdict(
        input({ proposal: proposal(moving), proposalLoaded: false })
      )
    ).toBe(false);
    expect(isRetractedByVerdict(input({ proposal: null }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cancel vs unblock — the pair that must never read alike
// ---------------------------------------------------------------------------

describe("cancel vs unblock legibility", () => {
  const got = diagnoseStuckPr(
    input({
      proposal: proposal({ secondsSinceUpdate: STALE_PROPOSAL_SECS + 1 }),
    })
  );
  const stop = leverFor(got, "cancel_stop")!;
  const unblock = leverFor(got, "cancel_unblock")!;

  it("gives the two modes different labels — neither says just 'Cancel'", () => {
    expect(stop.title).not.toBe(unblock.title);
    expect(stop.title).toBe("Stop trying to merge this PR");
    expect(unblock.title).toBe("Clear the block and try again");
    for (const t of [stop.title, unblock.title]) {
      expect(t.toLowerCase()).not.toBe("cancel");
    }
  });

  it("states opposite retry outcomes in the user's own words", () => {
    expect(stop.consequences?.join(" ")).toContain("will NOT be retried");
    expect(unblock.consequences?.join(" ")).toContain("WILL be retried");
  });

  it("states the destructive effects on BOTH modes before the click", () => {
    for (const l of [stop, unblock]) {
      for (const c of CANCEL_CONSEQUENCES) {
        expect(l.consequences).toContain(c);
      }
      expect(l.consequences?.join(" ")).toContain("merge-candidate branch");
      expect(l.consequences?.join(" ")).toContain(
        "comment on the pull request"
      );
    }
  });

  it("keeps coord's canonical lever string so web and MCP name one lever", () => {
    expect(stop.lever).toContain('"unblock": false');
    expect(unblock.lever).toContain('"unblock": true');
  });
});

// ---------------------------------------------------------------------------
// coord's answers, translated
// ---------------------------------------------------------------------------

describe("describeActionError", () => {
  it("renders 409 land_in_flight as 'already landing, nothing to cancel'", () => {
    const got = describeActionError(409, {
      error: "land_in_flight",
      detail: "the ff-push may already be executing",
      status: "landing",
    });
    expect(got.code).toBe("land_in_flight");
    expect(got.message).toContain("already landing");
    expect(got.message).toContain("nothing to cancel");
    expect(got.notFound).toBe(false);
  });

  it("renders 409 batch_in_flight as 'it lands with its batch'", () => {
    const got = describeActionError(409, { error: "batch_in_flight" });
    expect(got.code).toBe("batch_in_flight");
    expect(got.message).toContain("batch");
  });

  it("renders coord's prose already-terminal 409 (the idempotence answer)", () => {
    const got = describeActionError(409, {
      error: "proposal already in terminal status: cancelled",
      status: "cancelled",
    });
    expect(got.code).toBe("already_terminal");
    expect(got.message).toContain("already finished (cancelled)");
  });

  it("renders coord's 404 as NOT FOUND — never as forbidden", () => {
    for (const code of [
      "pr_not_found_in_tenant_scope",
      "proposal_not_found_in_tenant_scope",
    ]) {
      const got = describeActionError(404, { error: code });
      expect(got.notFound).toBe(true);
      expect(got.message.toLowerCase()).toContain("not found");
      // coord answers 404 rather than 403 so it cannot leak that the row
      // exists. Saying "forbidden" here would undo that on the way out.
      expect(got.message.toLowerCase()).not.toContain("forbidden");
      expect(got.message.toLowerCase()).not.toContain("permission");
      expect(got.message.toLowerCase()).not.toContain("not allowed");
    }
  });

  it("renders a bare 404 as not-found too", () => {
    const got = describeActionError(404, {});
    expect(got.notFound).toBe(true);
    expect(got.message.toLowerCase()).toContain("not found");
  });

  it("does not claim not-found for a real authorization failure", () => {
    const got = describeActionError(403, { error: "tenant_not_resolved" });
    expect(got.notFound).toBe(false);
    expect(got.message).toContain("Qontinui operator");
  });

  it("passes an unknown coord code through rather than mistranslating it", () => {
    const got = describeActionError(409, { error: "some_new_coord_code" });
    expect(got.code).toBe("some_new_coord_code");
    expect(got.message).toBe("some_new_coord_code");
  });

  it("reads FastAPI's own `detail` when the web backend itself failed", () => {
    const got = describeActionError(502, { detail: "coord is not reachable" });
    expect(got.message).toBe("coord is not reachable");
  });
});

describe("describeActionSuccess", () => {
  it("distinguishes a passing re-check from a still-blocked one", () => {
    expect(describeActionSuccess("reevaluate", { result: "pass" })).toContain(
      "now passes"
    );
    const blocked = describeActionSuccess("reevaluate", {
      result: "block",
      block_reason_code: "main-red",
    });
    expect(blocked).toContain("still holding");
    expect(blocked).toContain("main-red");
  });

  it("confirms which of the two cancels actually happened", () => {
    expect(describeActionSuccess("cancel_stop", {})).toContain(
      "NOT be retried"
    );
    expect(describeActionSuccess("cancel_unblock", {})).toContain(
      "fresh merge attempt"
    );
  });
});

describe("confidenceLabel", () => {
  it("bands confidence, and calls anything under the threshold low", () => {
    expect(confidenceLabel(0.9)).toBe("high");
    expect(confidenceLabel(0.8)).toBe("high");
    expect(confidenceLabel(0.7)).toBe("likely");
    expect(confidenceLabel(LOW_CONFIDENCE_THRESHOLD)).toBe("likely");
    expect(confidenceLabel(LOW_CONFIDENCE_THRESHOLD - 0.01)).toBe("low");
    expect(confidenceLabel(0.3)).toBe("low");
  });
});

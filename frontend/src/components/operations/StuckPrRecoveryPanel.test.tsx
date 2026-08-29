import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => fetchMock(...args),
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const defaultRepoMock = vi.fn(() => ({ defaultRepo: REPO, loading: false }));
vi.mock("./useTenantDefaultRepo", () => ({
  useTenantDefaultRepo: () => defaultRepoMock(),
}));

import {
  StuckPrRecoveryPanel,
  fuseStuckCandidates,
  type StuckCandidate,
} from "./StuckPrRecoveryPanel";
import { EVIDENCE_REAP_HARDCAP_PREFIX, type StuckPr } from "./stuckPrDiagnosis";
import type { PrRow } from "./mergeTypes";

/**
 * Tests for the tenant self-service recovery panel (plan
 * `2026-07-30-coord-tenant-self-service-merge-recovery.md` Phase 4).
 *
 * Written in the style of `RedMainBanner.test.tsx` — mocked `httpClient`,
 * `data-testid` hooks, `fireEvent`. The contracts under test are the UX gates:
 * a diagnosis (not a bare button), tenant-reachable levers as buttons while
 * admin-only levers are named-not-offered, cancel and unblock visibly
 * different, and coord's 409/404 rendered inline and specifically.
 */

const REPO = "jspinak/qontinui-runner";
const PROPOSAL_ID = "11111111-2222-3333-4444-555555555555";
const STALE = 4 * 3600;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Wiring {
  /** coord `stuck_now[]` rows. */
  stuckNow?: { pr_number: number; reason: string }[];
  /** coord `nudges[]` rows. */
  nudges?: Record<string, unknown>[];
  /** Rows for the fleet PR list. */
  prs?: Partial<PrRow>[];
  /** coord's `proposal` on the verdict read; `null` omits the key. */
  proposal?: Record<string, unknown> | null;
  /** Response to the next cancel/reevaluate POST. */
  actionResponse?: Response;
}

/**
 * Route the mocked `httpClient` by URL so a test declares coord's state rather
 * than the call order (the card's verdict read races the panel's two reads).
 */
function wire(w: Wiring): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve(
        w.actionResponse ?? jsonResponse({ status: "cancelled" })
      );
    }
    if (url.includes("/stuck-nudges")) {
      return Promise.resolve(
        jsonResponse({
          repo: REPO,
          enabled: true,
          cooldown_secs: 3600,
          max_nudges: 3,
          nudges: w.nudges ?? [],
          stuck_now: w.stuckNow ?? [],
        })
      );
    }
    if (url.includes("/pr-merge/verdict/")) {
      return Promise.resolve(
        jsonResponse(w.proposal ? { proposal: w.proposal } : {})
      );
    }
    // The fleet PR list.
    return Promise.resolve(jsonResponse({ prs: w.prs ?? [], total: 0 }));
  });
}

/** A zombie: non-terminal proposal that has not moved for four hours. */
function zombieProposal(overrides: Record<string, unknown> = {}) {
  return {
    proposal_id: PROPOSAL_ID,
    status: "awaiting-ci",
    age_seconds: STALE,
    seconds_since_update: STALE,
    candidate_ref: "refs/heads/coord/mc/1",
    error: null,
    had_rebase_conflict: false,
    status_note: null,
    ...overrides,
  };
}

/** One `stuck_now[]` PR as `parseStuckNudges` hands it to the fusion. */
function nudgedPr(overrides: Partial<StuckPr> & { prNumber: number }): StuckPr {
  return {
    reason: null,
    nudgeCount: 0,
    lastNudgedAt: null,
    lastOutcome: null,
    ...overrides,
  };
}

/** A wedged PR row as the fleet PR list reports it. */
function stalePrRow(prNumber: number): Partial<PrRow> {
  return {
    repo: REPO,
    pr_number: prNumber,
    proposal_status: "awaiting-ci",
    proposal_age_secs: STALE,
    blocking_summary: "waiting for candidate CI",
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  defaultRepoMock.mockReturnValue({ defaultRepo: REPO, loading: false });
});

// ---------------------------------------------------------------------------
// Candidate fusion
// ---------------------------------------------------------------------------

describe("fuseStuckCandidates", () => {
  it("takes coord's live nudges AND stale non-terminal proposals", () => {
    const got = fuseStuckCandidates(
      REPO,
      [nudgedPr({ prNumber: 7, reason: "merge_conflict", nudgeCount: 2 })],
      3,
      [stalePrRow(9) as PrRow]
    );
    expect(got.map((c) => c.prNumber)).toEqual([7, 9]);
    expect(got[0].reason).toBe("merge_conflict");
    // The zombie class never appears in `stuck_now` — sourcing only nudges
    // would leave the wedge this feature exists for invisible.
    expect(got[1].reason).toBeNull();
    expect(got[1].blockingSummary).toBe("waiting for candidate CI");
  });

  it("carries the nudge history `parseStuckNudges` resolved", () => {
    // These two were parsed off coord's `nudges[]` and then dropped here, so
    // the diagnosis could never date the problem or say whether the author was
    // actually reached.
    const got = fuseStuckCandidates(
      REPO,
      [
        nudgedPr({
          prNumber: 7,
          nudgeCount: 2,
          lastNudgedAt: "2026-08-07T09:00:00Z",
          lastOutcome: "delivered",
        }),
      ],
      3,
      []
    );
    expect(got[0].lastNudgedAt).toBe("2026-08-07T09:00:00Z");
    expect(got[0].lastOutcome).toBe("delivered");
  });

  it("enriches a nudged PR with coord's blocking summary rather than duplicating it", () => {
    const got = fuseStuckCandidates(
      REPO,
      [nudgedPr({ prNumber: 7, reason: "merge_conflict", nudgeCount: 1 })],
      3,
      [{ ...stalePrRow(7), blocking_summary: "conflict with base" } as PrRow]
    );
    expect(got).toHaveLength(1);
    expect(got[0].blockingSummary).toBe("conflict with base");
  });

  it("ignores other repos, terminal proposals and fresh ones", () => {
    const got = fuseStuckCandidates(REPO, [], 3, [
      { ...stalePrRow(1), repo: "other/repo" } as PrRow,
      { ...stalePrRow(2), proposal_status: "conflict" } as PrRow,
      { ...stalePrRow(3), proposal_age_secs: 60 } as PrRow,
      { ...stalePrRow(4), proposal_status: null } as PrRow,
    ]);
    expect(got).toEqual<StuckCandidate[]>([]);
  });
});

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

describe("<StuckPrRecoveryPanel>", () => {
  it("renders nothing at all when no PR is stuck", async () => {
    wire({});
    const { container } = render(<StuckPrRecoveryPanel />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("stuck-pr-panel")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders a DIAGNOSIS — what is wrong and why — not a bare button", async () => {
    wire({ prs: [stalePrRow(503)], proposal: zombieProposal() });
    render(<StuckPrRecoveryPanel />);

    const card = await screen.findByTestId("stuck-pr-card-503");
    // The card withholds proposal-shaped hypotheses until the verdict read
    // settles (by design — "not read yet" is not "no merge attempt"), so wait
    // for the classified state rather than the first paint.
    await waitFor(() =>
      expect(
        screen
          .getByTestId("stuck-pr-hypothesis")
          .getAttribute("data-hypothesis")
      ).toBe("stale-proposal-zombie")
    );
    const hypothesis = screen.getByTestId("stuck-pr-hypothesis");
    // The statement of what is wrong…
    expect(hypothesis.textContent).toContain("awaiting-ci");
    expect(hypothesis.textContent).toContain("without moving");
    // …the evidence behind it…
    expect(screen.getByTestId("stuck-pr-evidence").textContent).toContain(
      PROPOSAL_ID
    );
    // …and a stated confidence.
    expect(
      screen
        .getByTestId("stuck-pr-confidence")
        .getAttribute("data-confidence-band")
    ).toBe("likely");
    expect(card.textContent).toContain(REPO);
  });

  it("offers tenant-reachable levers as buttons and names the operator-only one without one", async () => {
    wire({
      prs: [stalePrRow(503)],
      proposal: zombieProposal({
        status: "conflict",
        error: `${EVIDENCE_REAP_HARDCAP_PREFIX}candidate vanished 3x`,
      }),
    });
    render(<StuckPrRecoveryPanel />);

    // The operator-only lever IS rendered — named, so the tenant can escalate
    // precisely — but never as a clickable action.
    const escalate = await screen.findByTestId("stuck-pr-lever-escalate");
    expect(escalate.getAttribute("data-lever-identity")).toBe(
      "operator_cognito"
    );
    expect(escalate.textContent).toContain("Qontinui operator");
    expect(escalate.querySelector("button")).toBeNull();

    // …and no cancel button is offered for this class at all.
    expect(screen.queryByTestId("stuck-pr-lever-cancel_unblock")).toBeNull();
    expect(screen.queryByTestId("stuck-pr-lever-cancel_stop")).toBeNull();

    // The tenant-reachable escape (push a new commit) is still named.
    expect(screen.getByTestId("stuck-pr-lever-manual").textContent).toContain(
      "Push a new commit"
    );
  });

  it("renders cancel and unblock as two visibly different actions", async () => {
    wire({ prs: [stalePrRow(503)], proposal: zombieProposal() });
    render(<StuckPrRecoveryPanel />);

    const unblock = await screen.findByTestId("stuck-pr-lever-cancel_unblock");
    const stop = await screen.findByTestId("stuck-pr-lever-cancel_stop");
    expect(unblock.textContent).toContain("Clear the block and try again");
    expect(stop.textContent).toContain("Stop trying to merge this PR");
    expect(unblock.textContent).not.toBe(stop.textContent);
    expect((unblock as HTMLButtonElement).disabled).toBe(false);
    expect((stop as HTMLButtonElement).disabled).toBe(false);
  });

  it("states the destructive effects BEFORE the click, and posts the right unblock mode", async () => {
    wire({
      prs: [stalePrRow(503)],
      proposal: zombieProposal(),
      actionResponse: jsonResponse({
        proposal_id: PROPOSAL_ID,
        previous_status: "awaiting-ci",
        status: "cancelled",
      }),
    });
    render(<StuckPrRecoveryPanel />);

    fireEvent.click(await screen.findByTestId("stuck-pr-lever-cancel_unblock"));

    // A confirm step, not an immediate mutation.
    const confirm = await screen.findByTestId("stuck-pr-confirm");
    expect(confirm.getAttribute("data-lever-action")).toBe("cancel_unblock");
    expect(confirm.textContent).toContain("Deletes the merge-candidate branch");
    expect(confirm.textContent).toContain(
      "Posts a comment on the pull request"
    );
    expect(confirm.textContent).toContain("WILL be retried");
    const postsBefore = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    ).length;
    expect(postsBefore).toBe(0);

    fireEvent.click(screen.getByTestId("stuck-pr-confirm-go"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      );
      expect(post).toBeDefined();
      expect(post![0]).toBe(
        `/api/v1/operations/pr-merge/proposals/${PROPOSAL_ID}/cancel`
      );
      expect(JSON.parse((post![1] as RequestInit).body as string).unblock).toBe(
        true
      );
    });

    expect(
      (await screen.findByTestId("stuck-pr-result")).textContent
    ).toContain("fresh merge attempt");
  });

  it("posts unblock:false for the STOP mode", async () => {
    wire({ prs: [stalePrRow(503)], proposal: zombieProposal() });
    render(<StuckPrRecoveryPanel />);

    fireEvent.click(await screen.findByTestId("stuck-pr-lever-cancel_stop"));
    const confirm = await screen.findByTestId("stuck-pr-confirm");
    expect(confirm.textContent).toContain("will NOT be retried");
    fireEvent.click(screen.getByTestId("stuck-pr-confirm-go"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      );
      expect(post).toBeDefined();
      expect(JSON.parse((post![1] as RequestInit).body as string).unblock).toBe(
        false
      );
    });
  });

  it("backs out of the confirm step without mutating anything", async () => {
    wire({ prs: [stalePrRow(503)], proposal: zombieProposal() });
    render(<StuckPrRecoveryPanel />);

    fireEvent.click(await screen.findByTestId("stuck-pr-lever-cancel_stop"));
    fireEvent.click(await screen.findByTestId("stuck-pr-confirm-cancel"));

    await screen.findByTestId("stuck-pr-lever-cancel_stop");
    expect(
      fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      )
    ).toHaveLength(0);
  });

  it("surfaces coord's 409 land_in_flight inline and specifically", async () => {
    wire({
      prs: [stalePrRow(503)],
      proposal: zombieProposal(),
      actionResponse: jsonResponse(
        {
          error: "land_in_flight",
          detail: "the ff-push may already be executing",
          proposal_id: PROPOSAL_ID,
          status: "landing",
        },
        409
      ),
    });
    render(<StuckPrRecoveryPanel />);

    fireEvent.click(await screen.findByTestId("stuck-pr-lever-cancel_unblock"));
    fireEvent.click(await screen.findByTestId("stuck-pr-confirm-go"));

    const err = await screen.findByTestId("stuck-pr-error");
    expect(err.getAttribute("data-error-code")).toBe("land_in_flight");
    expect(err.textContent).toContain("already landing");
    expect(err.textContent).toContain("nothing to cancel");
    // The lever stays available for a later retry.
    expect(screen.getByTestId("stuck-pr-lever-cancel_unblock")).toBeTruthy();
  });

  it("renders coord's 404 as NOT FOUND, never as forbidden", async () => {
    wire({
      prs: [stalePrRow(503)],
      proposal: zombieProposal(),
      actionResponse: jsonResponse(
        {
          error: "proposal_not_found_in_tenant_scope",
          proposal_id: PROPOSAL_ID,
        },
        404
      ),
    });
    render(<StuckPrRecoveryPanel />);

    fireEvent.click(await screen.findByTestId("stuck-pr-lever-cancel_unblock"));
    fireEvent.click(await screen.findByTestId("stuck-pr-confirm-go"));

    const err = await screen.findByTestId("stuck-pr-error-not-found");
    expect(err.textContent?.toLowerCase()).toContain("not found");
    expect(err.textContent?.toLowerCase()).not.toContain("forbidden");
    expect(err.textContent?.toLowerCase()).not.toContain("permission");
    // It is rendered in the NOT-FOUND slot, not the generic error slot.
    expect(screen.queryByTestId("stuck-pr-error")).toBeNull();
  });

  it("re-checks a PR through the reevaluate route without a confirm step", async () => {
    wire({
      stuckNow: [{ pr_number: 503, reason: "merge_conflict" }],
      actionResponse: jsonResponse({
        repo: REPO,
        pr_number: 503,
        evaluated: true,
        result: "block",
        outer_state: "BLOCKED",
        block_reason_code: "main-red",
        block_payload: null,
      }),
    });
    render(<StuckPrRecoveryPanel />);

    // Re-checking is read-only, so it fires straight away — no confirm.
    fireEvent.click(await screen.findByTestId("stuck-pr-lever-reevaluate"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      );
      expect(post).toBeDefined();
      expect(post![0]).toBe(
        "/api/v1/operations/pr-merge/prs/jspinak/qontinui-runner/503/reevaluate"
      );
    });
    expect(
      (await screen.findByTestId("stuck-pr-result")).textContent
    ).toContain("main-red");
  });

  it("disables cancel while the PR is landing, and says why", async () => {
    wire({
      prs: [stalePrRow(503)],
      proposal: zombieProposal({ status: "landing" }),
    });
    render(<StuckPrRecoveryPanel />);

    const stop = (await screen.findByTestId(
      "stuck-pr-lever-cancel_stop"
    )) as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
    expect(screen.getByTestId("stuck-pr-lever-blocked").textContent).toContain(
      "not right now"
    );
    expect(stop.title).toContain("half-landed");
  });

  it("says it is guessing when it cannot classify the wedge", async () => {
    wire({
      stuckNow: [{ pr_number: 503, reason: "something_new" }],
      proposal: null,
    });
    render(<StuckPrRecoveryPanel />);

    const note = await screen.findByTestId("stuck-pr-low-confidence");
    expect(note.textContent).toContain("not a finding");
    expect(
      screen
        .getByTestId("stuck-pr-confidence")
        .getAttribute("data-confidence-band")
    ).toBe("low");
  });

  it("renders nothing while the tenant has no default repo", async () => {
    defaultRepoMock.mockReturnValue({ defaultRepo: null, loading: false });
    wire({ prs: [stalePrRow(503)] });
    render(<StuckPrRecoveryPanel />);
    await waitFor(() =>
      expect(screen.queryByTestId("stuck-pr-panel")).toBeNull()
    );
  });
});

// ---------------------------------------------------------------------------
// The verdict read, and what it corrects
// ---------------------------------------------------------------------------

describe("<StuckPrRecoveryPanel> — the verdict overrides the age screen", () => {
  it("stays silent about a proposal that is old but still moving", async () => {
    // `/pr-merge/prs` carries proposal AGE only, so an ordinary 45-minute CI
    // round trip clears the candidate screen. Before the verdict was consulted
    // for the list, this rendered "1 pull request is stuck in the merge queue"
    // over a 0.3-confidence guess about a perfectly healthy PR.
    wire({
      prs: [stalePrRow(503)],
      proposal: zombieProposal({ seconds_since_update: 90 }),
    });
    const { container } = render(<StuckPrRecoveryPanel />);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes("/pr-merge/verdict/")
        )
      ).toBe(true)
    );
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByTestId("stuck-pr-panel")).toBeNull();
  });

  it("keeps a moving proposal that coord's live nudges DID flag", async () => {
    // The screen was not the only accuser, so there is nothing to retract.
    wire({
      stuckNow: [{ pr_number: 503, reason: "merge_conflict" }],
      proposal: zombieProposal({ seconds_since_update: 90 }),
    });
    render(<StuckPrRecoveryPanel />);
    expect(await screen.findByTestId("stuck-pr-panel")).toBeTruthy();
  });

  it("leads with coord's own status/error contradiction", async () => {
    wire({
      prs: [stalePrRow(503)],
      proposal: zombieProposal({
        error: "authority_mismatch",
        status_note:
          "status `awaiting-ci` describes this proposal's QUEUE SLOT, not " +
          "its outcome",
      }),
    });
    render(<StuckPrRecoveryPanel />);

    const first = (await screen.findAllByTestId("stuck-pr-hypothesis"))[0];
    expect(first.getAttribute("data-hypothesis")).toBe(
      "status-contradicts-recorded-error"
    );
    expect(first.textContent).toContain("QUEUE SLOT");
    // The duplicate it replaces must be gone.
    expect(
      screen
        .queryAllByTestId("stuck-pr-hypothesis")
        .map((n) => n.getAttribute("data-hypothesis"))
    ).not.toContain("stale-proposal-zombie");
  });

  it("sends a rebase conflict to the branch, not to a same-commit retry", async () => {
    wire({
      prs: [stalePrRow(503)],
      proposal: zombieProposal({
        status: "conflict",
        had_rebase_conflict: true,
      }),
    });
    render(<StuckPrRecoveryPanel />);

    const first = (await screen.findAllByTestId("stuck-pr-hypothesis"))[0];
    expect(first.getAttribute("data-hypothesis")).toBe(
      "rebase-conflict-needs-your-branch"
    );
    // "Clear the block and try again" would re-run the same rebase into the
    // same conflict, so that button must not exist on this card.
    expect(screen.queryByTestId("stuck-pr-lever-cancel_unblock")).toBeNull();
    expect(
      screen.getAllByTestId("stuck-pr-lever-manual").length
    ).toBeGreaterThan(0);
  });

  it("names the candidate ref a cancel would delete", async () => {
    wire({ prs: [stalePrRow(503)], proposal: zombieProposal() });
    render(<StuckPrRecoveryPanel />);
    const evidence = await screen.findByTestId("stuck-pr-evidence");
    expect(evidence.textContent).toContain("refs/heads/coord/mc/1");
  });

  it("says so when coord's author nudges are switched off for the repo", async () => {
    // Zero nudges with the flag OFF is not "coord saw nothing wrong" — coord
    // was not looking, and the card must not read the silence as health.
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/stuck-nudges")) {
        return Promise.resolve(
          jsonResponse({
            repo: REPO,
            enabled: false,
            max_nudges: 3,
            nudges: [],
            stuck_now: [],
          })
        );
      }
      if (url.includes("/pr-merge/verdict/")) {
        return Promise.resolve(jsonResponse({ proposal: zombieProposal() }));
      }
      return Promise.resolve(
        jsonResponse({ prs: [stalePrRow(503)], total: 1 })
      );
    });
    render(<StuckPrRecoveryPanel />);
    const evidence = await screen.findByTestId("stuck-pr-evidence");
    // Scoped to the SWEEP: `enabled` gates the tick that writes
    // `merge_conflict` rows, while the CI-red path ships armed and un-gated —
    // so "off" here must not be read as "coord is silent about this PR".
    expect(evidence.textContent).toContain("the stuck-PR sweep is off");
    expect(evidence.textContent).toContain("CI-red nudges are unaffected");
  });
});

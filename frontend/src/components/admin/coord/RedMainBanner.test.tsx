import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const getMock = vi.fn();
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

import {
  RedMainBanner,
  compactPrincipal,
  parseAlertClaim,
  parseFixSession,
  parseRedMainAlerts,
  redMainHeadline,
  sinceLabel,
  truncateAgentId,
  type AlertClaimState,
  type FixSessionState,
  type RedMainAlert,
} from "./RedMainBanner";

/**
 * Tests for the red-main banner (plan
 * `2026-07-06-coord-red-main-auto-remediation-and-dashboard-alert.md`).
 * Phase 1 (D2) is the pure parse/headline contract. Plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 8 removed the "Spawn fix session" control and made the banner say
 * whether an agent holds the alert's claim, and who — with an older coord
 * that sends no claim fields rendered as UNKNOWN, never as unclaimed.
 */
describe("parseRedMainAlerts", () => {
  const redRow = {
    id: 1,
    alert_key: "red_main:jspinak/qontinui-runner",
    severity: "critical",
    kind: "red_main",
    summary: "Main CI for jspinak/qontinui-runner is RED",
    first_seen_at: "2026-07-06T01:00:00Z",
    detail: {
      repo: "jspinak/qontinui-runner",
      workflows: ["CI", "release"],
      blocked_pr_count: 8,
      fix_session: "none",
    },
  };

  it("extracts repo, workflows, blast radius, since and remediation state", () => {
    const got = parseRedMainAlerts([redRow]);
    expect(got).toEqual<RedMainAlert[]>([
      {
        alertKey: "red_main:jspinak/qontinui-runner",
        repo: "jspinak/qontinui-runner",
        workflows: ["CI", "release"],
        blockedPrCount: 8,
        since: "2026-07-06T01:00:00Z",
        fixSession: { kind: "none" },
        // No `claimed` / `claim` on the row: an older coord.
        claim: { kind: "unknown", cause: "not-reported" },
      },
    ]);
  });

  it("parses an object fix_session", () => {
    const got = parseRedMainAlerts([
      {
        ...redRow,
        detail: {
          ...redRow.detail,
          auto_fix_red_main: true,
          fix_session: {
            state: "running",
            agent_id: "11111111-2222-3333-4444-555555555555",
            spawned_at: "2026-07-06T01:05:00Z",
          },
        },
      },
    ]);
    expect(got[0].fixSession).toEqual<FixSessionState>({
      kind: "running",
      agentId: "11111111-2222-3333-4444-555555555555",
      spawnedAt: "2026-07-06T01:05:00Z",
    });
  });

  it("ignores non-red_main keys and resolved rows", () => {
    expect(
      parseRedMainAlerts([
        { ...redRow, alert_key: "pr_merge_train_stalled:a/b" },
        { ...redRow, resolved_at: "2026-07-06T02:00:00Z" },
      ])
    ).toEqual([]);
  });

  it("falls back to the alert-key repo when detail is missing or malformed", () => {
    // A malformed detail payload must never hide a live episode.
    const got = parseRedMainAlerts([
      { alert_key: "red_main:owner/repo", detail: undefined },
      { alert_key: "red_main:owner/other", detail: { workflows: "not-a-list" } },
    ]);
    expect(got.map((a) => a.repo)).toEqual(["owner/other", "owner/repo"]);
    for (const a of got) {
      expect(a.workflows).toEqual([]);
      expect(a.blockedPrCount).toBe(0);
      // Missing / malformed remediation state degrades to "none", and a row
      // with no claim fields has an UNKNOWN claim.
      expect(a.fixSession).toEqual({ kind: "none" });
      expect(a.claim).toEqual({ kind: "unknown", cause: "not-reported" });
    }
  });

  it("sorts per-repo so the banner stack is stable across polls", () => {
    const got = parseRedMainAlerts([
      { ...redRow, alert_key: "red_main:z/last", detail: { repo: "z/last" } },
      { ...redRow, alert_key: "red_main:a/first", detail: { repo: "a/first" } },
    ]);
    expect(got.map((a) => a.repo)).toEqual(["a/first", "z/last"]);
  });

  it("tolerates a non-array body", () => {
    expect(parseRedMainAlerts(undefined)).toEqual([]);
    expect(parseRedMainAlerts(null)).toEqual([]);
    expect(parseRedMainAlerts({ alerts: [] })).toEqual([]);
  });
});

describe("parseFixSession", () => {
  it("maps the literal placeholder to none", () => {
    expect(parseFixSession("none")).toEqual({ kind: "none" });
  });

  it("treats any non-none string as an active self-heal", () => {
    expect(parseFixSession("auto-rerun-failed-jobs:29677365432")).toEqual({
      kind: "self_heal",
      raw: "auto-rerun-failed-jobs:29677365432",
    });
  });

  it("maps an object with a known state, carrying agent id + spawn time", () => {
    expect(
      parseFixSession({
        state: "stalled",
        agent_id: "abc",
        spawned_at: "2026-07-06T01:05:00Z",
      })
    ).toEqual({
      kind: "stalled",
      agentId: "abc",
      spawnedAt: "2026-07-06T01:05:00Z",
    });
  });

  it("degrades missing / malformed payloads to none", () => {
    expect(parseFixSession(undefined)).toEqual({ kind: "none" });
    expect(parseFixSession(null)).toEqual({ kind: "none" });
    expect(parseFixSession({ state: "bogus" })).toEqual({ kind: "none" });
    expect(parseFixSession(42)).toEqual({ kind: "none" });
  });
});

describe("parseAlertClaim", () => {
  it("reads coord's claimed verdict and names the claimant", () => {
    expect(
      parseAlertClaim({
        claimed: true,
        claim: {
          claimed_by: "agent:11111111-2222-3333-4444-555555555555",
          claimed_at: "2026-09-18T11:00:00Z",
          claim_expires_at: "2026-09-18T13:00:00Z",
        },
      })
    ).toEqual<AlertClaimState>({
      kind: "claimed",
      claimedBy: "agent:11111111-2222-3333-4444-555555555555",
      claimedAt: "2026-09-18T11:00:00Z",
      expiresAt: "2026-09-18T13:00:00Z",
    });
  });

  it("is unclaimed when coord says so", () => {
    expect(parseAlertClaim({ claimed: false, claim: null })).toEqual({
      kind: "unclaimed",
    });
  });

  it("is UNKNOWN, not unclaimed, when coord could not read the lease", () => {
    // `fleet_health.rs` `alert_row_claim`: lease columns unreadable, or a
    // row's claim undecodable, renders `claimed: null, claim: null`.
    expect(parseAlertClaim({ claimed: null, claim: null })).toEqual({
      kind: "unknown",
      cause: "unreadable",
    });
  });

  it("is UNKNOWN for every row when the body says claims_scrape_up: false", () => {
    expect(
      parseAlertClaim({ claimed: false, claim: null }, false)
    ).toEqual({ kind: "unknown", cause: "unreadable" });
    expect(parseAlertClaim({ claimed: true }, false).kind).toBe("unknown");
  });

  it("is UNKNOWN, not unclaimed, when coord sends no claim fields", () => {
    // An older coord build. Absent claim fields say nothing about who is
    // working on it.
    expect(parseAlertClaim({})).toEqual({
      kind: "unknown",
      cause: "not-reported",
    });
  });

  it("trusts coord's verdict over a lease it did not name", () => {
    expect(parseAlertClaim({ claimed: true })).toEqual({
      kind: "claimed",
      claimedBy: undefined,
      claimedAt: undefined,
      expiresAt: undefined,
    });
  });

  it("never infers a verdict from a lease object alone", () => {
    expect(
      parseAlertClaim({
        claim: { claimed_by: "session:abc", claim_expires_at: "2099-01-01T00:00:00Z" },
      }).kind
    ).toBe("unknown");
  });
});

describe("compactPrincipal", () => {
  it("keeps the principal kind and shortens only the id", () => {
    expect(
      compactPrincipal("agent:11111111-2222-3333-4444-555555555555")
    ).toBe("agent:11111111…");
    expect(compactPrincipal("device:c79a07d5")).toBe("device:c79a07d5");
    expect(compactPrincipal("no-prefix-but-quite-long")).toBe("no-prefi…");
  });
});

describe("truncateAgentId", () => {
  it("passes short ids through and ellipsizes long ones", () => {
    expect(truncateAgentId("short")).toBe("short");
    expect(truncateAgentId("11111111-2222-3333")).toBe("11111111…");
  });
});

describe("sinceLabel", () => {
  const now = Date.parse("2026-07-06T12:00:00Z");

  it("renders minutes, hours and days", () => {
    expect(sinceLabel("2026-07-06T11:35:00Z", now)).toBe("25m");
    expect(sinceLabel("2026-07-06T08:30:00Z", now)).toBe("3h 30m");
    expect(sinceLabel("2026-07-03T12:00:00Z", now)).toBe("3d");
  });

  it("never goes negative on clock skew and survives bad input", () => {
    expect(sinceLabel("2026-07-06T12:05:00Z", now)).toBe("0m");
    expect(sinceLabel(undefined, now)).toBe("unknown");
    expect(sinceLabel("not-a-date", now)).toBe("not-a-date");
  });
});

describe("redMainHeadline", () => {
  const now = Date.parse("2026-07-06T12:00:00Z");

  it("carries the D2 wording: repo, since, blast radius, no-merges warning", () => {
    const headline = redMainHeadline(
      {
        alertKey: "red_main:jspinak/qontinui-runner",
        repo: "jspinak/qontinui-runner",
        workflows: ["CI"],
        blockedPrCount: 8,
        since: "2026-07-06T09:00:00Z",
        fixSession: { kind: "none" },
        claim: { kind: "unknown", cause: "not-reported" },
      },
      now
    );
    expect(headline).toBe(
      "🔴 jspinak/qontinui-runner main is RED since 3h 0m ago — " +
        "8 PRs blocked, no merges will land until fixed"
    );
  });

  it("uses singular PR for a blast radius of one", () => {
    const headline = redMainHeadline(
      {
        alertKey: "red_main:a/b",
        repo: "a/b",
        workflows: [],
        blockedPrCount: 1,
        since: undefined,
        fixSession: { kind: "none" },
        claim: { kind: "unknown", cause: "not-reported" },
      },
      now
    );
    expect(headline).toContain("1 PR blocked");
    // No first_seen_at → no dangling "since … ago" clause.
    expect(headline).not.toContain("since");
    expect(headline).toContain("a/b main is RED — ");
  });
});

// ---------------------------------------------------------------------------
// Plan 2026-09-18 Phase 8 — the banner reports the claim, and spawns nothing.
// ---------------------------------------------------------------------------

describe("<RedMainBanner> claim and remediation", () => {
  const REPO = "jspinak/qontinui-runner";

  function alertRow(extra: Record<string, unknown> = {}, detail = {}) {
    return {
      id: 1,
      alert_key: `red_main:${REPO}`,
      severity: "critical",
      kind: "red_main",
      summary: `Main CI for ${REPO} is RED`,
      first_seen_at: "2026-07-06T01:00:00Z",
      detail: {
        repo: REPO,
        workflows: ["CI"],
        blocked_pr_count: 3,
        fix_session: "none",
        ...detail,
      },
      ...extra,
    };
  }

  beforeEach(() => {
    getMock.mockReset();
    fetchMock.mockReset();
  });

  it("renders no spawn control and never POSTs", async () => {
    getMock.mockResolvedValue([alertRow()]);
    render(<RedMainBanner />);

    await screen.findByTestId("red-main-banner");
    expect(screen.queryByTestId("red-main-spawn-fix")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the agent holding the claim", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    getMock.mockResolvedValue([
      alertRow({
        claimed: true,
        claim: {
          claimed_by: "agent:11111111-2222-3333-4444-555555555555",
          claimed_at: "2026-07-06T01:05:00Z",
          claim_expires_at: future,
        },
      }),
    ]);
    render(<RedMainBanner />);

    const chip = await screen.findByTestId("red-main-claim");
    expect(chip).toHaveAttribute("data-claim-state", "claimed");
    expect(chip.textContent).toBe("claimed by agent:11111111…");
    expect(chip.getAttribute("title")).toContain(
      "agent:11111111-2222-3333-4444-555555555555"
    );
  });

  it("says plainly when no agent has claimed it", async () => {
    getMock.mockResolvedValue([alertRow({ claimed: false, claim: null })]);
    render(<RedMainBanner />);

    const chip = await screen.findByTestId("red-main-claim");
    expect(chip).toHaveAttribute("data-claim-state", "unclaimed");
    expect(chip.textContent).toBe("no agent has claimed it");
  });

  it("renders coord's unreadable claim (claimed: null) as unknown, and says why", async () => {
    getMock.mockResolvedValue({
      alerts: [alertRow({ claimed: null, claim: null })],
      claims_scrape_up: true,
    });
    render(<RedMainBanner />);

    const chip = await screen.findByTestId("red-main-claim");
    expect(chip).toHaveAttribute("data-claim-state", "unknown");
    expect(chip).toHaveAttribute("data-claim-unknown-cause", "unreadable");
    expect(chip.textContent).toBe("claim unknown");
    expect(chip.getAttribute("title")).toContain("could not read");
  });

  it("renders every claim unknown when the body says claims_scrape_up: false", async () => {
    getMock.mockResolvedValue({
      alerts: [alertRow({ claimed: false, claim: null })],
      claims_scrape_up: false,
    });
    render(<RedMainBanner />);

    const chip = await screen.findByTestId("red-main-claim");
    expect(chip).toHaveAttribute("data-claim-state", "unknown");
    expect(chip.textContent).not.toContain("no agent");
  });

  it("renders an older coord's missing claim fields as unknown, not unclaimed", async () => {
    getMock.mockResolvedValue([alertRow()]);
    render(<RedMainBanner />);

    const chip = await screen.findByTestId("red-main-claim");
    expect(chip).toHaveAttribute("data-claim-state", "unknown");
    expect(chip).toHaveAttribute("data-claim-unknown-cause", "not-reported");
    expect(chip.textContent).toBe("claim unknown");
    expect(chip.textContent).not.toContain("no agent");
    expect(chip.getAttribute("title")).toContain("does not report alert claims");
  });

  it("shows coord's own active remediation, read only", async () => {
    getMock.mockResolvedValue([
      alertRow({}, { fix_session: { state: "running", agent_id: "abc" } }),
    ]);
    render(<RedMainBanner />);

    const note = await screen.findByTestId("red-main-remediation");
    expect(note.textContent).toContain("fix session running");
    expect(note.textContent).toContain("abc");
  });

  it("shows no remediation note when none is active", async () => {
    getMock.mockResolvedValue([alertRow()]);
    render(<RedMainBanner />);

    await screen.findByTestId("red-main-banner");
    expect(screen.queryByTestId("red-main-remediation")).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Reachability: the banner must SURVIVE coord's churning alert window.
//
// Measured 2026-08-14 across 5 samples 25s apart (plan
// `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md`, § MEASURED M2): the
// unfiltered rollup is ordered `last_seen_at DESC` under a hard 500-row cap,
// every watcher re-stamps `last_seen_at` on its own tick, and the single
// `red_main` row appeared in 1 of 5 answers. The banner overwrote its state
// from every successful poll, so the surface that tells the fleet main is red
// was blind ~80% of the time. These are the fix's regression tests.
// ----------------------------------------------------------------------------
describe("<RedMainBanner> reachability", () => {
  const REPO = "jspinak/qontinui-runner";

  function redRow() {
    return {
      id: 7,
      alert_key: `red_main:${REPO}`,
      severity: "critical",
      kind: "red_main",
      summary: `Main CI for ${REPO} is RED`,
      first_seen_at: "2026-08-14T01:00:00Z",
      detail: {
        repo: REPO,
        workflows: ["CI"],
        blocked_pr_count: 3,
        fix_session: "none",
      },
    };
  }

  beforeEach(() => {
    getMock.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks coord for the red_main KIND, not the unfiltered rollup", async () => {
    getMock.mockResolvedValue([redRow()]);
    render(<RedMainBanner />);

    await screen.findByTestId("red-main-banner");
    const url = String(getMock.mock.calls[0][0]);
    expect(url).toContain("kind=red_main");
    expect(url).toContain("include_resolved=false");
  });

  it("keeps the banner up across a single empty poll, and clears once emptiness persists", async () => {
    vi.useFakeTimers();
    // One live answer, then nothing — exactly the 1-of-5 eviction pattern.
    getMock.mockResolvedValueOnce([redRow()]).mockResolvedValue([]);
    render(<RedMainBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByTestId("red-main-banner")).toBeInTheDocument();

    // Polls 2 and 3 come back empty. Under the old code the first of these
    // blanked a tenant-wide merge-outage banner.
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.queryByTestId("red-main-banner")).toBeInTheDocument();
    }

    // Sustained emptiness IS believed — a fixed main clears the banner.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByTestId("red-main-banner")).not.toBeInTheDocument();
  });

  it("does not count a FAILED poll toward the clear streak", async () => {
    vi.useFakeTimers();
    getMock
      .mockResolvedValueOnce([redRow()])
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValue(new Error("boom"));
    render(<RedMainBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }
    // An outage in the READ path is not evidence that main went green.
    expect(screen.queryByTestId("red-main-banner")).toBeInTheDocument();
  });
});

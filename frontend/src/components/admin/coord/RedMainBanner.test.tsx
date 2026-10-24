import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const getMock = vi.fn();
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    // The banner reads through `lib/api/operations/alerts.ts`, which calls
    // `httpClient.fetch` with `GET`: that read is served by `getMock` (its
    // parsed body as a 200 Response; a rejection passes through). Any OTHER
    // method lands on `fetchMock`, so "never POSTs" still means exactly that.
    fetch: async (url: string, init: { method?: string } = {}) =>
      init.method === "GET"
        ? new Response(JSON.stringify((await getMock(url, init)) ?? null))
        : fetchMock(url, init),
  },
}));

import { GLOSSARY } from "@qontinui/shared-types/glossary";
import {
  FixedPresentationMode,
  PresentationScopeProvider,
  captionSegments,
  sessionMachineAliases,
  type CaptionText,
  type PresentationScopeState,
} from "@/components/presentation";
import {
  RED_MAIN_PROVENANCE_SOURCE,
  WITHHELD_REPOSITORY,
  RedMainBanner,
  plainDuration,
  presentationHeadline,
  claimChip,
  compactPrincipal,
  presentableClaimant,
  redMainRowView,
  remediationText,
  parseAlertClaim,
  parseBaselineFreshness,
  parseFixSession,
  parseRedMainAlerts,
  redMainHeadline,
  sinceLabel,
  truncateAgentId,
  type AlertClaimState,
  type FixSessionState,
  type RedMainAlert,
} from "./RedMainBanner";

/** Caption copy as the words on screen, glossary terms included. */
function plain(text: CaptionText): string {
  return captionSegments(text)
    .map((segment) =>
      typeof segment === "string"
        ? segment
        : (segment.text ?? GLOSSARY[segment.term].term)
    )
    .join("");
}

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
      queued_proposal_count: 3,
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
        queuedProposalCount: 3,
        since: "2026-07-06T01:00:00Z",
        fixSession: { kind: "none" },
        // No `claimed` / `claim` on the row: an older coord.
        claim: { kind: "unknown", cause: "not-reported" },
        baselineFreshness: "unread",
        staleWorkflows: [],
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
      {
        alert_key: "red_main:owner/other",
        detail: { workflows: "not-a-list" },
      },
    ]);
    expect(got.map((a) => a.repo)).toEqual(["owner/other", "owner/repo"]);
    for (const a of got) {
      expect(a.workflows).toEqual([]);
      expect(a.blockedPrCount).toBe(0);
      // An absent queue depth is UNREAD, never 0.
      expect(a.queuedProposalCount).toBeNull();
      // Missing / malformed remediation state degrades to "none", and a row
      // with no claim fields has an UNKNOWN claim.
      expect(a.fixSession).toEqual({ kind: "none" });
      expect(a.claim).toEqual({ kind: "unknown", cause: "not-reported" });
    }
  });

  it("reads coord's explicit null, and any malformed count, as UNREAD — never 0", () => {
    // coord (qontinui-coord#2545) writes JSON null when it could not count.
    for (const raw of [null, "3", -1, 2.5, Number.NaN]) {
      const [a] = parseRedMainAlerts([
        { ...redRow, detail: { ...redRow.detail, queued_proposal_count: raw } },
      ]);
      expect(a.queuedProposalCount).toBeNull();
    }
    const [zero] = parseRedMainAlerts([
      { ...redRow, detail: { ...redRow.detail, queued_proposal_count: 0 } },
    ]);
    // A measured zero stays zero.
    expect(zero.queuedProposalCount).toBe(0);
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
    expect(parseAlertClaim({ claimed: false, claim: null }, false)).toEqual({
      kind: "unknown",
      cause: "unreadable",
    });
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
        claim: {
          claimed_by: "session:abc",
          claim_expires_at: "2099-01-01T00:00:00Z",
        },
      }).kind
    ).toBe("unknown");
  });
});

describe("compactPrincipal", () => {
  it("keeps the principal kind and shortens only the id", () => {
    expect(compactPrincipal("agent:11111111-2222-3333-4444-555555555555")).toBe(
      "agent:11111111…"
    );
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

  it("carries repo, since, main-red count and queue depth — never a no-merges claim", () => {
    const headline = redMainHeadline(
      {
        alertKey: "red_main:jspinak/qontinui-runner",
        repo: "jspinak/qontinui-runner",
        workflows: ["CI"],
        blockedPrCount: 8,
        queuedProposalCount: 3,
        since: "2026-07-06T09:00:00Z",
        fixSession: { kind: "none" },
        claim: { kind: "unknown", cause: "not-reported" },
        baselineFreshness: "unread",
        staleWorkflows: [],
      },
      now
    );
    expect(headline).toBe(
      "🔴 jspinak/qontinui-runner main is RED since 3h 0m ago — " +
        "8 PRs read main-red, 3 proposals queued; " +
        "a candidate lands only if its own rebased CI is green"
    );
    // The falsified claim (coord FALSIFIED_RED_MAIN_PHRASES) must never return.
    expect(headline.toLowerCase()).not.toContain("no merges will land");
  });

  it("uses singular PR for a blast radius of one", () => {
    const headline = redMainHeadline(
      {
        alertKey: "red_main:a/b",
        repo: "a/b",
        workflows: [],
        blockedPrCount: 1,
        queuedProposalCount: 1,
        since: undefined,
        fixSession: { kind: "none" },
        claim: { kind: "unknown", cause: "not-reported" },
        baselineFreshness: "unread",
        staleWorkflows: [],
      },
      now
    );
    expect(headline).toContain("1 PR read main-red");
    expect(headline).toContain("1 proposal queued");
    // No first_seen_at → no dangling "since … ago" clause.
    expect(headline).not.toContain("since");
    expect(headline).toContain("a/b main is RED — ");
  });
});

describe("redMainHeadline — unread queue depth", () => {
  it("says the depth is unknown instead of rendering 0", () => {
    const headline = redMainHeadline(
      {
        alertKey: "red_main:a/b",
        repo: "a/b",
        workflows: [],
        blockedPrCount: 2,
        queuedProposalCount: null,
        since: undefined,
        fixSession: { kind: "none" },
        claim: { kind: "unknown", cause: "not-reported" },
        baselineFreshness: "unread",
        staleWorkflows: [],
      },
      Date.parse("2026-07-06T12:00:00Z")
    );
    expect(headline).toContain("merge-queue depth unknown");
    expect(headline).not.toMatch(/\b0 proposals?\b/);
  });
});

// ---------------------------------------------------------------------------
// Plan 2026-10-03-coord-red-main-watcher-error-leaves-a-stale-red-baseline-
// blocking-the-repo Phase 3b — coord's `detail.baseline_freshness` evidence.
// ---------------------------------------------------------------------------

/** One `detail.baseline_freshness.workflows[]` row, as coord serializes it. */
function wfRow(workflow: string, verdict: string) {
  const newer = verdict === "unobserved" ? null : 9;
  return {
    workflow,
    baseline_run_id: 5,
    verdict,
    newer_run_id: newer,
    newer_event: newer === null ? null : "schedule",
    newer_conclusion:
      newer === null
        ? null
        : verdict === "contradicted"
          ? "success"
          : "failure",
  };
}

describe("parseBaselineFreshness", () => {
  it("reads every workflow contradicted as all_contradicted", () => {
    expect(
      parseBaselineFreshness({
        read: "ok",
        all_contradicted: true,
        workflows: [
          wfRow("CI", "contradicted"),
          wfRow("release", "contradicted"),
        ],
      })
    ).toEqual({
      baselineFreshness: "all_contradicted",
      staleWorkflows: ["CI", "release"],
    });
  });

  it("reads some contradicted as partial, naming only the stale ones", () => {
    expect(
      parseBaselineFreshness({
        read: "ok",
        all_contradicted: false,
        workflows: [
          wfRow("CI", "contradicted"),
          wfRow("release", "corroborated"),
        ],
      })
    ).toEqual({ baselineFreshness: "partial", staleWorkflows: ["CI"] });
    // An unobserved row is not a pass: the repo stays partial, not all-contradicted.
    expect(
      parseBaselineFreshness({
        read: "ok",
        all_contradicted: false,
        workflows: [wfRow("CI", "contradicted"), wfRow("lint", "unobserved")],
      }).baselineFreshness
    ).toBe("partial");
  });

  it("reads evidence that contradicts nothing as not_contradicted", () => {
    expect(
      parseBaselineFreshness({
        read: "ok",
        all_contradicted: false,
        workflows: [wfRow("CI", "corroborated"), wfRow("lint", "unobserved")],
      })
    ).toEqual({ baselineFreshness: "not_contradicted", staleWorkflows: [] });
  });

  it("reads coord's unread marker and an absent field as unread", () => {
    expect(parseBaselineFreshness({ read: "unread" }).baselineFreshness).toBe(
      "unread"
    );
    expect(parseBaselineFreshness(undefined).baselineFreshness).toBe("unread");
    expect(parseBaselineFreshness(null).baselineFreshness).toBe("unread");
  });

  it("reads malformed evidence as unread — never as contradicted", () => {
    const malformed: unknown[] = [
      "contradicted",
      { read: "ok", all_contradicted: true }, // no workflows
      { read: "ok", all_contradicted: true, workflows: [] }, // nothing to contradict
      { all_contradicted: true, workflows: [wfRow("CI", "contradicted")] }, // no read
      {
        read: "ok",
        all_contradicted: true,
        workflows: [wfRow("CI", "contradicted"), null],
      },
      {
        read: "ok",
        all_contradicted: true,
        workflows: [{ verdict: "contradicted" }],
      },
      { read: "ok", all_contradicted: true, workflows: [wfRow("CI", "stale")] },
      // The flag and the rows disagree, in either direction.
      {
        read: "ok",
        all_contradicted: true,
        workflows: [wfRow("CI", "corroborated")],
      },
      {
        read: "ok",
        all_contradicted: false,
        workflows: [wfRow("CI", "contradicted")],
      },
      { read: "ok", workflows: [wfRow("CI", "contradicted")] },
    ];
    for (const raw of malformed) {
      expect(parseBaselineFreshness(raw)).toEqual({
        baselineFreshness: "unread",
        staleWorkflows: [],
      });
    }
  });

  it("is carried onto the parsed alert", () => {
    const [got] = parseRedMainAlerts([
      {
        alert_key: "red_main:a/b",
        detail: {
          repo: "a/b",
          workflows: ["CI"],
          baseline_freshness: {
            read: "ok",
            all_contradicted: true,
            workflows: [wfRow("CI", "contradicted")],
          },
        },
      },
    ]);
    expect(got.baselineFreshness).toBe("all_contradicted");
    expect(got.staleWorkflows).toEqual(["CI"]);
  });
});

describe("redMainHeadline — baseline freshness", () => {
  const now = Date.parse("2026-07-06T12:00:00Z");
  const base: RedMainAlert = {
    alertKey: "red_main:a/b",
    repo: "a/b",
    workflows: ["CI", "release"],
    blockedPrCount: 4,
    queuedProposalCount: 2,
    since: "2026-07-06T09:00:00Z",
    fixSession: { kind: "none" },
    claim: { kind: "unknown", cause: "not-reported" },
    baselineFreshness: "unread",
    staleWorkflows: [],
  };
  const unread = redMainHeadline(base, now);

  it("renders UNKNOWN, never RED or green, when every red is contradicted", () => {
    const headline = redMainHeadline(
      {
        ...base,
        baselineFreshness: "all_contradicted",
        staleWorkflows: ["CI", "release"],
      },
      now
    );
    expect(headline).toBe(
      "⚠️ a/b main status UNKNOWN — red push baseline contradicted by newer " +
        "passing runs, awaiting a push run — 4 PRs read main-red, 2 proposals " +
        "queued; a candidate lands only if its own rebased CI is green " +
        "(alert open since 3h 0m ago)"
    );
    expect(headline).not.toMatch(/main is red/i);
    expect(headline).not.toMatch(/main is green/i);
  });

  it("keeps RED on partial evidence and names the stale workflows", () => {
    const headline = redMainHeadline(
      { ...base, baselineFreshness: "partial", staleWorkflows: ["CI"] },
      now
    );
    expect(headline).toBe(
      `${unread} (stale push baseline, contradicted by newer passing runs: CI)`
    );
    expect(headline).toContain("a/b main is RED since 3h 0m ago — ");
  });

  it("renders unread and not-contradicted evidence as today's text exactly", () => {
    expect(unread).toBe(
      "🔴 a/b main is RED since 3h 0m ago — 4 PRs read main-red, 2 proposals " +
        "queued; a candidate lands only if its own rebased CI is green"
    );
    expect(
      redMainHeadline({ ...base, baselineFreshness: "not_contradicted" }, now)
    ).toBe(unread);
  });

  it("renders a malformed payload as unread, not contradicted", () => {
    const [parsed] = parseRedMainAlerts([
      {
        alert_key: "red_main:a/b",
        first_seen_at: "2026-07-06T09:00:00Z",
        detail: {
          repo: "a/b",
          workflows: ["CI", "release"],
          blocked_pr_count: 4,
          queued_proposal_count: 2,
          baseline_freshness: {
            read: "ok",
            all_contradicted: true,
            workflows: "CI",
          },
        },
      },
    ]);
    expect(parsed.baselineFreshness).toBe("unread");
    expect(redMainHeadline(parsed, now)).toBe(unread);
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
    expect(chip.getAttribute("title")).toContain(
      "does not report alert claims"
    );
  });

  it("renders a contradicted red baseline as UNKNOWN in the mounted banner", async () => {
    getMock.mockResolvedValue([
      alertRow(
        {},
        {
          baseline_freshness: {
            read: "ok",
            all_contradicted: true,
            workflows: [
              {
                workflow: "CI",
                baseline_run_id: 1,
                verdict: "contradicted",
                newer_run_id: 2,
                newer_event: "schedule",
                newer_conclusion: "success",
              },
            ],
          },
        }
      ),
    ]);
    render(<RedMainBanner />);

    const banner = await screen.findByTestId("red-main-banner");
    expect(banner.textContent).toContain("main status UNKNOWN");
    expect(banner.textContent).not.toMatch(/main is red/i);
    expect(banner.textContent).not.toMatch(/main is green/i);
    expect(
      banner.querySelector('[data-baseline-freshness="all_contradicted"]')
    ).not.toBeNull();
    const workflows = screen.getByTestId("red-main-workflows");
    expect(workflows.textContent).toBe("red push baseline: CI");
    expect(banner.textContent).not.toContain("failing:");
  });

  it("keeps RED and the failing label on partial evidence in the mounted banner", async () => {
    getMock.mockResolvedValue([
      alertRow(
        {},
        {
          workflows: ["CI", "release"],
          baseline_freshness: {
            read: "ok",
            all_contradicted: false,
            workflows: [
              {
                workflow: "CI",
                baseline_run_id: 1,
                verdict: "contradicted",
                newer_run_id: 2,
                newer_event: "schedule",
                newer_conclusion: "success",
              },
              {
                workflow: "release",
                baseline_run_id: 3,
                verdict: "corroborated",
                newer_run_id: 4,
                newer_event: "schedule",
                newer_conclusion: "failure",
              },
            ],
          },
        }
      ),
    ]);
    render(<RedMainBanner />);

    const banner = await screen.findByTestId("red-main-banner");
    expect(banner.textContent).toMatch(/main is RED/);
    expect(banner.textContent).not.toContain("main status UNKNOWN");
    expect(screen.getByTestId("red-main-workflows").textContent).toBe(
      "failing: CI, release"
    );
    expect(
      banner.querySelector('[data-baseline-freshness="partial"]')
    ).not.toBeNull();
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
    // blanked a live red-main banner.
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

describe("<RedMainBanner> in presentation mode (plan 2026-10-23-console-presentation-spaces)", () => {
  const FIRST_PARTY = "qontinui/qontinui-web";
  const FOREIGN = "client-org/portal";

  function row(repo: string, workflows: string[]) {
    return {
      id: 1,
      alert_key: `red_main:${repo}`,
      severity: "critical",
      kind: "red_main",
      summary: `Main CI for ${repo} is RED`,
      first_seen_at: "2026-07-06T01:00:00Z",
      detail: { repo, workflows, blocked_pr_count: 1, fix_session: "none" },
    };
  }

  beforeEach(() => {
    getMock.mockReset();
    fetchMock.mockReset();
  });

  it("still says a main is red, but withholds whose while the scope is unknown", async () => {
    getMock.mockResolvedValue([row(FIRST_PARTY, ["CI"])]);
    const { container } = render(
      <FixedPresentationMode presenting>
        <RedMainBanner />
      </FixedPresentationMode>
    );

    const banner = await screen.findByTestId("red-main-banner-row");
    expect(banner).toHaveAttribute("data-redacted", "true");
    expect(banner).toHaveTextContent(
      `${WITHHELD_REPOSITORY}'s main branch is failing its checks`
    );
    expect(screen.queryByTestId("red-main-workflows")).toBeNull();
    expect(container.innerHTML).not.toContain("qontinui-web");
  });

  it("names a first-party repository the scope clears, and still withholds a foreign one", async () => {
    getMock.mockResolvedValue([
      row(FIRST_PARTY, ["CI"]),
      row(FOREIGN, ["deploy"]),
    ]);
    const { container } = render(
      <FixedPresentationMode presenting>
        <PresentationScopeProvider
          state={{
            status: "ready",
            scope: { firstPartyOwners: ["qontinui"], confidentialTerms: [] },
          }}
        >
          <RedMainBanner />
        </PresentationScopeProvider>
      </FixedPresentationMode>
    );

    const rows = await screen.findAllByTestId("red-main-banner-row");
    const shown = rows.find((r) => r.getAttribute("data-redacted") === "false");
    const withheld = rows.find(
      (r) => r.getAttribute("data-redacted") === "true"
    );
    expect(shown).toHaveTextContent(
      `${FIRST_PARTY}'s main branch is failing its checks`
    );
    expect(shown).toHaveTextContent("failing checks: CI");
    expect(withheld).toHaveTextContent(
      `${WITHHELD_REPOSITORY}'s main branch is failing its checks`
    );
    expect(container.innerHTML).not.toContain("client-org");
    expect(container.innerHTML).not.toContain("deploy");
  });

  it("renders every repository for the operator", async () => {
    getMock.mockResolvedValue([row(FOREIGN, ["deploy"])]);
    render(
      <FixedPresentationMode presenting={false}>
        <RedMainBanner />
      </FixedPresentationMode>
    );
    const banner = await screen.findByTestId("red-main-banner-row");
    expect(banner).toHaveTextContent(`${FOREIGN} main is RED`);
    expect(banner).not.toHaveAttribute("data-redacted");
    // The operator's rows carry their own staleness note, not the chip.
    expect(screen.queryByTestId("red-main-provenance")).toBeNull();
  });

  it("says where the row came from and when coord confirmed it, and explains its terms", async () => {
    getMock.mockResolvedValue([row(FIRST_PARTY, ["CI"])]);
    render(
      <FixedPresentationMode presenting>
        <RedMainBanner />
      </FixedPresentationMode>
    );
    const banner = await screen.findByTestId("red-main-banner-row");
    const chip = screen.getByTestId("red-main-provenance");
    expect(banner).toContainElement(chip);
    expect(chip).toHaveTextContent(`source: ${RED_MAIN_PROVENANCE_SOURCE}`);
    expect(chip).toHaveAttribute("data-provenance-known", "true");
    expect(
      banner.querySelector('[data-glossary-term="merge_train"]')
    ).not.toBeNull();
  });
});

describe("plainDuration", () => {
  const now = Date.parse("2026-07-06T12:00:00Z");
  it.each<[string | undefined, string]>([
    ["2026-07-06T11:59:30Z", " for under a minute"],
    ["2026-07-06T11:59:00Z", " for 1 minute"],
    ["2026-07-06T11:15:00Z", " for 45 minutes"],
    ["2026-07-06T11:00:00Z", " for 1 hour"],
    ["2026-07-05T12:00:00Z", " for 24 hours"],
    ["2026-07-03T12:00:00Z", " for 3 days"],
    // No start, or an unreadable one, states no duration at all.
    [undefined, ""],
    ["not a time", ""],
  ])("%s → %j", (iso, words) => {
    expect(plainDuration(iso, now)).toBe(words);
  });
});

describe("presentationHeadline", () => {
  const now = Date.parse("2026-07-06T12:00:00Z");
  it("names a cleared row's recovered checks, and counts a withheld row's", () => {
    const facts = {
      repo: "qontinui/qontinui-web",
      since: "2026-07-06T09:00:00Z",
      blockedPrCount: 3,
      baselineFreshness: "partial" as const,
      staleWorkflows: ["CI", "lint"],
      named: true,
    };
    expect(plain(presentationHeadline(facts, now))).toBe(
      "qontinui/qontinui-web's main branch is failing its checks for 3 hours. " +
        "3 open pull requests are affected; the merge train still lands a pull " +
        "request whose own checks pass. 2 failing checks have since passed on a " +
        "newer run (CI, lint)."
    );
    expect(
      plain(
        presentationHeadline(
          { ...facts, repo: WITHHELD_REPOSITORY, named: false },
          now
        )
      )
    ).not.toContain("lint");
  });
});

// ---------------------------------------------------------------------------
// The presentation row is rebuilt field by field — review round 1 found the
// blanked-fields version printing a withheld row's stale workflow names, the
// claimant's device id and coord's run reference.
// ---------------------------------------------------------------------------

describe("<RedMainBanner> in presentation mode — nothing leaks past the allowlist", () => {
  const READY: PresentationScopeState = {
    status: "ready",
    scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["acme"] },
  };
  const DEVICE = "0b9d6a54-0000-4000-8000-0000000000aa";
  const SESSION = "5f3c2e1d-1111-4222-8333-444455556666";
  const AGENT = "11111111-2222-3333-4444-555555555555";
  const RUN = "987654321";

  /** A partial red: `stale` contradicted, the rest of `freshnessRows` corroborated. */
  function partialRow(
    repo: string,
    workflows: string[],
    freshnessRows: string[],
    stale: string[],
    extra: Record<string, unknown> = {},
    detail: Record<string, unknown> = {}
  ) {
    return {
      id: 7,
      alert_key: `red_main:${repo}`,
      severity: "critical",
      kind: "red_main",
      first_seen_at: "2026-07-06T01:00:00Z",
      detail: {
        repo,
        workflows,
        blocked_pr_count: 2,
        fix_session: "none",
        baseline_freshness: {
          read: "ok",
          all_contradicted: false,
          workflows: freshnessRows.map((workflow) => ({
            workflow,
            verdict: stale.includes(workflow) ? "contradicted" : "corroborated",
          })),
        },
        ...detail,
      },
      ...extra,
    };
  }

  function renderPresenting(scope?: PresentationScopeState) {
    return render(
      <FixedPresentationMode presenting>
        {scope ? (
          <PresentationScopeProvider state={scope}>
            <RedMainBanner />
          </PresentationScopeProvider>
        ) : (
          <RedMainBanner />
        )}
      </FixedPresentationMode>
    );
  }

  beforeEach(() => {
    getMock.mockReset();
    fetchMock.mockReset();
    sessionMachineAliases.reset();
  });

  it("counts a withheld row's stale baselines instead of naming them while the scope is unknown", async () => {
    getMock.mockResolvedValue([
      partialRow(
        "client-org/portal",
        ["deploy-portal-prod", "lint-portal"],
        ["deploy-portal-prod", "lint-portal"],
        ["deploy-portal-prod"]
      ),
    ]);
    const { container } = renderPresenting();

    const banner = await screen.findByTestId("red-main-banner-row");
    expect(banner).toHaveAttribute("data-redacted", "true");
    expect(banner).toHaveAttribute("data-baseline-freshness", "partial");
    expect(banner).toHaveTextContent(
      "A repository's main branch is failing its checks for"
    );
    expect(banner).toHaveTextContent(
      "1 failing check has since passed on a newer run."
    );
    expect(container.innerHTML).not.toContain("deploy-portal-prod");
    expect(container.innerHTML).not.toContain("lint-portal");
    expect(container.innerHTML).not.toContain("client-org");
  });

  it("withholds a first-party row whose STALE workflow names a confidential term", async () => {
    // `deploy-acme` is in the freshness evidence but not in `workflows`: the
    // verdict must read the stale names too, not lean on coord sending them
    // as a subset.
    getMock.mockResolvedValue([
      partialRow(
        "qontinui/qontinui-web",
        ["CI"],
        ["deploy-acme", "CI"],
        ["deploy-acme"]
      ),
    ]);
    const { container } = renderPresenting(READY);

    const banner = await screen.findByTestId("red-main-banner-row");
    expect(banner).toHaveAttribute("data-redacted", "true");
    expect(container.innerHTML.toLowerCase()).not.toContain("acme");
    expect(container.innerHTML).not.toContain("qontinui-web");
  });

  it("names a cleared row's stale workflows", async () => {
    getMock.mockResolvedValue([
      partialRow(
        "qontinui/qontinui-web",
        ["CI", "release"],
        ["CI", "release"],
        ["CI"]
      ),
    ]);
    renderPresenting(READY);

    const banner = await screen.findByTestId("red-main-banner-row");
    expect(banner).toHaveAttribute("data-redacted", "false");
    expect(banner).toHaveTextContent(
      "1 failing check has since passed on a newer run (CI)."
    );
    expect(screen.getByTestId("red-main-workflows")).toHaveTextContent(
      "failing checks: CI, release"
    );
  });

  it("names a device claimant by its machine alias, with no id in the text or the tooltip", async () => {
    getMock.mockResolvedValue([
      partialRow("qontinui/qontinui-web", ["CI"], ["CI"], [], {
        claimed: true,
        claim: {
          claimed_by: `device:${DEVICE}:session:${SESSION}`,
          claimed_at: "2026-07-06T01:05:00Z",
          claim_expires_at: "2026-07-06T02:05:00Z",
        },
      }),
    ]);
    const { container } = renderPresenting(READY);

    const chip = await screen.findByTestId("red-main-claim");
    expect(chip).toHaveAttribute("data-claim-state", "claimed");
    expect(chip.textContent).toBe("claimed by an agent on Machine A");
    expect(chip.getAttribute("title")).toContain(
      "Claimed by an agent on Machine A"
    );
    expect(container.innerHTML).not.toContain(DEVICE.slice(0, 8));
    expect(container.innerHTML).not.toContain(SESSION.slice(0, 8));
    expect(container.innerHTML).not.toContain("device:");
  });

  it("names an agent claimant by kind, even on a row the scope clears", async () => {
    getMock.mockResolvedValue([
      partialRow("qontinui/qontinui-web", ["CI"], ["CI"], [], {
        claimed: true,
        claim: { claimed_by: `agent:${AGENT}` },
      }),
    ]);
    const { container } = renderPresenting(READY);

    const chip = await screen.findByTestId("red-main-claim");
    expect(chip.textContent).toBe("claimed by an agent");
    expect(container.innerHTML).not.toContain(AGENT.slice(0, 8));
  });

  it("drops coord's run reference and the fix session's agent id from the remediation note", async () => {
    getMock.mockResolvedValue([
      partialRow(
        "qontinui/qontinui-web",
        ["CI"],
        ["CI"],
        [],
        {},
        { fix_session: `auto-rerun-failed-jobs:${RUN}` }
      ),
      partialRow(
        "qontinui/qontinui-runner",
        ["CI"],
        ["CI"],
        [],
        {},
        { fix_session: { state: "running", agent_id: AGENT } }
      ),
    ]);
    const { container } = renderPresenting(READY);

    const notes = await screen.findAllByTestId("red-main-remediation");
    expect(notes.map((n) => n.textContent)).toEqual([
      "an agent is fixing it",
      "re-running its failed checks",
    ]);
    for (const note of notes) expect(note).not.toHaveAttribute("title");
    expect(container.innerHTML).not.toContain(RUN);
    expect(container.innerHTML).not.toContain(AGENT.slice(0, 8));
  });

  it("still shows the operator every name, id and reference", async () => {
    getMock.mockResolvedValue([
      partialRow(
        "client-org/portal",
        ["deploy-portal-prod"],
        ["deploy-portal-prod", "lint-portal"],
        ["deploy-portal-prod"],
        {
          claimed: true,
          claim: { claimed_by: `device:${DEVICE}` },
        },
        { fix_session: `auto-rerun-failed-jobs:${RUN}` }
      ),
    ]);
    render(
      <FixedPresentationMode presenting={false}>
        <RedMainBanner />
      </FixedPresentationMode>
    );

    const banner = await screen.findByTestId("red-main-banner-row");
    expect(banner).toHaveTextContent("client-org/portal main is RED");
    expect(banner).toHaveTextContent(
      "contradicted by newer passing runs: deploy-portal-prod"
    );
    expect(
      screen.getByTestId("red-main-claim").getAttribute("title")
    ).toContain(`device:${DEVICE}`);
    expect(screen.getByTestId("red-main-remediation")).toHaveAttribute(
      "title",
      `auto-rerun-failed-jobs:${RUN}`
    );
  });
});

describe("presentableClaimant", () => {
  const alias = (id: string) => `Machine<${id.length}>`;

  it.each<[string, string | null]>([
    ["device:abc", "Machine<3>"],
    ["device:abc:session:def", "an agent on Machine<3>"],
    ["DEVICE:abc:SESSION:def", "an agent on Machine<3>"],
    ["device:", "a machine"],
    ["agent:11111111-2222", "an agent"],
    ["session:sess-1", "an agent session"],
    ["operator:op-1", "the operator"],
    ["robot:r-1", null],
    ["someone", null],
    ["", null],
  ])("%s → %s", (label, phrase) => {
    expect(presentableClaimant(label, alias)).toBe(phrase);
  });
});

describe("claimChip", () => {
  const aliasDevice = () => "Machine C";
  const claimed: AlertClaimState = {
    kind: "claimed",
    claimedBy: "device:dev-1",
    claimedAt: "2026-07-06T01:05:00Z",
  };

  it("names the claimant in full for the operator", () => {
    expect(claimChip(claimed, null)).toEqual({
      state: "claimed",
      text: "claimed by device:dev-1",
      title: "Claimed by device:dev-1, since 2026-07-06T01:05:00Z",
    });
  });

  it("names it by alias in presentation mode", () => {
    expect(claimChip(claimed, { aliasDevice })).toEqual({
      state: "claimed",
      text: "claimed by Machine C",
      title: "Claimed by Machine C, since 2026-07-06T01:05:00Z",
    });
  });

  it("withholds a claimant of a kind it does not know, rather than guessing", () => {
    const chip = claimChip(
      { kind: "claimed", claimedBy: "robot:r-1" },
      { aliasDevice }
    );
    expect(chip.text).toBe("claimed (claimant withheld)");
    expect(chip.title).not.toContain("robot");
  });

  it("says when coord named nobody, in either mode", () => {
    expect(claimChip({ kind: "claimed" }, { aliasDevice }).text).toBe(
      "claimed (claimant not named)"
    );
    expect(claimChip({ kind: "claimed" }, null).text).toBe(
      "claimed (claimant not named)"
    );
  });

  it("renders unclaimed and unknown the same in both modes", () => {
    for (const claim of [
      { kind: "unclaimed" },
      { kind: "unknown", cause: "unreadable" },
      { kind: "unknown", cause: "not-reported" },
    ] as AlertClaimState[]) {
      expect(claimChip(claim, { aliasDevice })).toEqual(claimChip(claim, null));
    }
  });
});

describe("remediationText", () => {
  it.each<[FixSessionState, boolean, ReturnType<typeof remediationText>]>([
    [{ kind: "none" }, false, null],
    [{ kind: "none" }, true, null],
    [
      { kind: "self_heal", raw: "auto-rerun-failed-jobs:42" },
      false,
      { text: "auto-rerun in flight", title: "auto-rerun-failed-jobs:42" },
    ],
    [
      { kind: "self_heal", raw: "auto-rerun-failed-jobs:42" },
      true,
      { text: "re-running its failed checks" },
    ],
    [
      { kind: "running", agentId: "abcdefgh-1234-5678" },
      false,
      { text: "fix session running · abcdefgh…" },
    ],
    [
      { kind: "running", agentId: "abcdefgh-1234-5678" },
      true,
      { text: "an agent is fixing it" },
    ],
    [
      { kind: "failed", agentId: "abc" },
      false,
      { text: "fix session failed · abc" },
    ],
    [
      { kind: "stalled", agentId: "abc" },
      true,
      { text: "an agent's fix has stalled" },
    ],
    [
      { kind: "failed", agentId: "abc" },
      true,
      { text: "an agent's fix failed" },
    ],
  ])("%j (presenting: %s)", (fixSession, presenting, expected) => {
    expect(remediationText(fixSession, presenting)).toEqual(expected);
  });
});

describe("redMainRowView", () => {
  const now = Date.parse("2026-07-06T12:00:00Z");
  const partial: RedMainAlert = {
    alertKey: "red_main:client-org/portal",
    repo: "client-org/portal",
    workflows: ["deploy", "lint"],
    blockedPrCount: 1,
    queuedProposalCount: null,
    since: "2026-07-06T11:00:00Z",
    fixSession: { kind: "none" },
    claim: { kind: "unclaimed" },
    baselineFreshness: "partial",
    staleWorkflows: ["deploy", "lint-extra"],
  };
  const lens = (scope: PresentationScopeState) =>
    ({ presenting: true, scope, aliasDevice: () => "Machine A" }) as const;

  it("is the parsed row verbatim for the operator", () => {
    const view = redMainRowView(partial, now, { presenting: false });
    expect(view.withheld).toBeNull();
    expect(view.headline).toBe(redMainHeadline(partial, now));
    expect(view.workflows).toBe("failing: deploy, lint");
  });

  it("counts two stale baselines in the plural on a withheld row, in plain words", () => {
    const view = redMainRowView(partial, now, lens({ status: "unknown" }));
    expect(view.withheld).toBe(true);
    expect(view.workflows).toBeNull();
    expect(plain(view.headline)).toBe(
      "A repository's main branch is failing its checks for 1 hour. 1 open " +
        "pull request is affected; the merge train still lands a pull request " +
        "whose own checks pass. 2 failing checks have since passed on a newer run."
    );
  });

  it("speaks no merge-train vocabulary to an evaluator, and explains its product terms", () => {
    for (const freshness of [
      "partial",
      "all_contradicted",
      "not_contradicted",
      "unread",
    ] as const) {
      const view = redMainRowView(
        { ...partial, baselineFreshness: freshness },
        now,
        lens({ status: "unknown" })
      );
      const words = plain(view.headline);
      for (const internal of [
        "main-red",
        "candidate",
        "rebased",
        "push baseline",
        "main is RED",
        "proposal",
        "🔴",
        "⚠️",
      ]) {
        expect(words, `${freshness}: "${internal}"`).not.toContain(internal);
      }
      const terms = captionSegments(view.headline).flatMap((segment) =>
        typeof segment === "string" ? [] : [segment.term]
      );
      expect(terms, freshness).toContain("merge_train");
    }
  });

  it("says a main whose failing checks all passed since is UNKNOWN, through the glossary", () => {
    const view = redMainRowView(
      { ...partial, baselineFreshness: "all_contradicted" },
      now,
      lens({ status: "unknown" })
    );
    expect(plain(view.headline)).toBe(
      "A repository's main branch: status UNKNOWN — the checks that failed " +
        "have since passed on a newer run, and the next push will settle it. " +
        "1 open pull request is affected; the merge train still lands a pull " +
        "request whose own checks pass."
    );
    expect(
      captionSegments(view.headline).some(
        (segment) => typeof segment !== "string" && segment.term === "unknown"
      )
    ).toBe(true);
  });

  it("withholds on every scope state that is not ready", () => {
    for (const scope of [
      { status: "unknown" },
      { status: "loading" },
      { status: "error", reason: "boom" },
    ] as PresentationScopeState[]) {
      expect(redMainRowView(partial, now, lens(scope)).withheld).toBe(true);
    }
  });
});

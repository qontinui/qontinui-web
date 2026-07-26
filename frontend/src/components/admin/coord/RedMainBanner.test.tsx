import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  fixButtonState,
  parseFixSession,
  parseRedMainAlerts,
  redMainHeadline,
  sinceLabel,
  truncateAgentId,
  type FixSessionState,
  type RedMainAlert,
} from "./RedMainBanner";

/**
 * Tests for the red-main banner (plan
 * `2026-07-06-coord-red-main-auto-remediation-and-dashboard-alert.md`).
 * Phase 1 (D2) is the pure parse/headline contract; Phase 4b adds the
 * operator-driven "Spawn fix session" control whose enabled/disabled state is
 * derived SOLELY from the same alert row (`detail.fix_session` +
 * `detail.auto_fix_red_main`), and which POSTs through the web→coord
 * operations proxy.
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
        autoFixRedMain: false,
      },
    ]);
  });

  it("parses an object fix_session and the auto_fix_red_main opt-in", () => {
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
    expect(got[0].autoFixRedMain).toBe(true);
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
      // Missing / malformed remediation state degrades to "none" (button stays
      // available) with auto-fix treated as off.
      expect(a.fixSession).toEqual({ kind: "none" });
      expect(a.autoFixRedMain).toBe(false);
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

describe("fixButtonState", () => {
  function makeAlert(overrides: Partial<RedMainAlert> = {}): RedMainAlert {
    return {
      alertKey: "red_main:a/b",
      repo: "a/b",
      workflows: [],
      blockedPrCount: 1,
      since: undefined,
      fixSession: { kind: "none" },
      autoFixRedMain: true,
      ...overrides,
    };
  }

  it("is enabled whenever auto-fix is off, regardless of remediation state", () => {
    for (const kind of ["none", "running", "self_heal", "stalled", "failed"] as const) {
      const state = fixButtonState(
        makeAlert({ autoFixRedMain: false, fixSession: { kind } })
      );
      expect(state.enabled).toBe(true);
    }
  });

  it("is enabled (spawn) when auto-fix on but no remediation is active", () => {
    expect(fixButtonState(makeAlert({ fixSession: { kind: "none" } }))).toEqual({
      enabled: true,
      label: "Spawn fix session",
    });
  });

  it("is enabled (retry) when a prior session stalled or failed", () => {
    for (const kind of ["stalled", "failed"] as const) {
      expect(fixButtonState(makeAlert({ fixSession: { kind } }))).toEqual({
        enabled: true,
        label: "Retry fix session",
      });
    }
  });

  it("is disabled while a session is running", () => {
    expect(
      fixButtonState(makeAlert({ fixSession: { kind: "running" } }))
    ).toEqual({ enabled: false, label: "fix session running" });
  });

  it("is disabled while coord's own auto-rerun is in flight", () => {
    expect(
      fixButtonState(makeAlert({ fixSession: { kind: "self_heal", raw: "x" } }))
    ).toEqual({ enabled: false, label: "auto-rerun in flight" });
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
        autoFixRedMain: false,
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
        autoFixRedMain: false,
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
// Phase 4b — the "Spawn fix session" control rendered inside the banner.
// ---------------------------------------------------------------------------

describe("<RedMainBanner> spawn fix session", () => {
  const REPO = "jspinak/qontinui-runner";

  function alertRow(fixDetail: Record<string, unknown>) {
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
        ...fixDetail,
      },
    };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  beforeEach(() => {
    getMock.mockReset();
    fetchMock.mockReset();
  });

  it("renders an enabled spawn button and POSTs the correct path on click", async () => {
    getMock.mockResolvedValue([alertRow({ fix_session: "none" })]);
    fetchMock.mockResolvedValue(
      jsonResponse({ agent_id: "11111111-2222-3333-4444-555555555555" })
    );
    render(<RedMainBanner />);

    const btn = (await screen.findByTestId(
      "red-main-spawn-fix"
    )) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("Spawn fix session");

    fireEvent.click(btn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/v1/operations/pr-merge/red-main/${REPO}/spawn-fix`
    );
    expect(init.method).toBe("POST");
  });

  it("renders the optimistic running state on a 200 success", async () => {
    getMock.mockResolvedValue([alertRow({ fix_session: "none" })]);
    fetchMock.mockResolvedValue(
      jsonResponse({ agent_id: "11111111-2222-3333-4444-555555555555" })
    );
    render(<RedMainBanner />);

    fireEvent.click(await screen.findByTestId("red-main-spawn-fix"));

    const running = await screen.findByTestId("red-main-fix-running");
    expect(running.textContent).toContain("fix session running");
    // Truncated agent id is shown.
    expect(running.textContent).toContain("11111111…");
    // The button is replaced by the running badge.
    expect(screen.queryByTestId("red-main-spawn-fix")).toBeNull();
  });

  it("surfaces coord's 409 message inline and keeps the button enabled", async () => {
    getMock.mockResolvedValue([alertRow({ fix_session: "none" })]);
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "fix session already running" }, 409)
    );
    render(<RedMainBanner />);

    fireEvent.click(await screen.findByTestId("red-main-spawn-fix"));

    const err = await screen.findByTestId("red-main-spawn-fix-error");
    expect(err.textContent).toContain("fix session already running");
    // No optimistic running badge, and the button re-enables for a retry.
    expect(screen.queryByTestId("red-main-fix-running")).toBeNull();
    const btn = screen.getByTestId("red-main-spawn-fix") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("disables the button while a fix session is already running", async () => {
    getMock.mockResolvedValue([
      alertRow({
        auto_fix_red_main: true,
        fix_session: { state: "running", agent_id: "abc" },
      }),
    ]);
    render(<RedMainBanner />);

    const btn = (await screen.findByTestId(
      "red-main-spawn-fix"
    )) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("fix session running");
  });
});

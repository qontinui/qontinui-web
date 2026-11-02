/**
 * sessionAccount — the Account cell's states, the detail card's identity facts
 * and the census live line. Plan
 * `2026-10-19-session-lookup-by-name-shows-claude-account-in-web` Phase 3.
 *
 * The load-bearing distinctions, each pinned below:
 *
 * - an ABSENT stamp key (coord does not serve it) is a different UNKNOWN from a
 *   `null` one (no device has reported) — never conflated, never "none";
 * - `default` always carries its config dir;
 * - the census never yields "not live" except on coord's own `dead`.
 */

import { describe, expect, it } from "vitest";

import {
  AgentSessionsApiError,
  type SessionCard,
  type SessionCensusResponse,
} from "@/services/agent-sessions-api";
import {
  ACCOUNT_FACET_UNKNOWN,
  accountFacetValue,
  classifyCensusError,
  deriveAccountCell,
  deriveCardIdentity,
  deriveLiveStatus,
  formatAccountLabel,
  readAccountFact,
  type AccountCell,
} from "./sessionAccount";
import type { ConsolidatedSessionRow } from "./sessionConsoleStatus";

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const SID = "86e2b721-8270-49fe-bb15-6c8b33b000c8";

const machineLabel = (id: string | null | undefined) =>
  id === "dev-a" ? "spaceship" : id ? `${id.slice(0, 8)}…` : null;

function linked(
  agent: ConsolidatedSessionRow["agent_session"]
): ConsolidatedSessionRow {
  return {
    id: "coord-1",
    device_id: "dev-a",
    row_class: "linked",
    agent_session: agent,
  };
}

function textOf(cell: AccountCell): string {
  return cell.kind === "not-applicable" ? "–" : cell.label;
}

describe("formatAccountLabel", () => {
  it("renders a named account as its label", () => {
    expect(formatAccountLabel("qontinui", "/home/x/.claude-qontinui")).toBe(
      "qontinui"
    );
  });

  it("renders `default` WITH its config dir — two boxes' defaults differ", () => {
    expect(formatAccountLabel("default", "/home/spinak/.claude")).toBe(
      "default (/home/spinak/.claude)"
    );
  });

  it("says the config dir is UNKNOWN rather than printing `default ()`", () => {
    expect(formatAccountLabel("default", null)).toBe(
      "default (config dir UNKNOWN)"
    );
    expect(formatAccountLabel("default", "  ")).toBe(
      "default (config dir UNKNOWN)"
    );
  });
});

describe("readAccountFact — absent key vs null", () => {
  it("an ABSENT key is coord not reporting, not a device's omission", () => {
    const fact = readAccountFact({}, "spaceship");
    expect(fact).toMatchObject({
      state: "unknown",
      reason: "coord-not-reporting",
      label: "UNKNOWN — coord does not report the account yet",
    });
    expect(fact.label).not.toMatch(/spaceship|not yet reported by/);
  });

  it("a null value is the named device not having reported", () => {
    expect(readAccountFact({ account: null }, "spaceship")).toMatchObject({
      state: "unknown",
      reason: "not-yet-reported",
      label: "UNKNOWN — account not yet reported by spaceship",
    });
  });

  it("an empty string is treated as not reported, never as an account", () => {
    expect(readAccountFact({ account: "  " }, "spaceship").state).toBe(
      "unknown"
    );
  });

  it("no device at all is said, rather than leaving a blank slot", () => {
    expect(readAccountFact({ account: null }, null).label).toBe(
      "UNKNOWN — account not yet reported (coord recorded no device for this session)"
    );
  });
});

describe("deriveAccountCell — the three UNKNOWNs and the label", () => {
  it("state 1: the label", () => {
    const cell = deriveAccountCell(
      linked({
        id: SID,
        device_id: "dev-a",
        account: "qontinui",
        config_dir: "C:/claude/.claude-qontinui",
        account_observed_at: "2026-11-01T10:00:00Z",
      }),
      { machineLabel }
    );
    expect(cell).toMatchObject({
      kind: "fact",
      state: "known",
      label: "qontinui",
    });
    expect(cell.title).toContain("C:/claude/.claude-qontinui");
    expect(accountFacetValue(cell)).toBe("qontinui");
  });

  it("state 1, `default`: renders `default (<config_dir>)`", () => {
    const cell = deriveAccountCell(
      linked({
        id: SID,
        account: "default",
        config_dir: "/home/spinak/.claude",
      }),
      { machineLabel }
    );
    expect(textOf(cell)).toBe("default (/home/spinak/.claude)");
    expect(accountFacetValue(cell)).toBe("default (/home/spinak/.claude)");
  });

  it("state 2: agent half read, account null → not yet reported by <device>", () => {
    const cell = deriveAccountCell(
      linked({ id: SID, device_id: "dev-a", account: null }),
      { machineLabel }
    );
    expect(textOf(cell)).toBe(
      "UNKNOWN — account not yet reported by spaceship"
    );
    expect(cell).toMatchObject({
      state: "unknown",
      reason: "not-yet-reported",
    });
  });

  it("state 2 names the AGENT half's device, falling back to the row's", () => {
    const cell = deriveAccountCell(
      {
        ...linked({ id: SID, device_id: null, account: null }),
        device_id: "dev-a",
      },
      { machineLabel }
    );
    expect(textOf(cell)).toContain("spaceship");
  });

  it("state 3: row_class null → agent half unread, with the list's detail", () => {
    const row: ConsolidatedSessionRow = {
      id: "coord-1",
      device_id: "dev-a",
      row_class: null,
      agent_session: null,
    };
    expect(
      textOf(
        deriveAccountCell(row, {
          machineLabel,
          agentHalf: { read: "failed", detail: "502: coord is not reachable" },
        })
      )
    ).toBe("UNKNOWN — agent half unread (502: coord is not reachable)");
    expect(
      textOf(
        deriveAccountCell(row, { machineLabel, agentHalf: { read: "ok" } })
      )
    ).toBe(
      "UNKNOWN — agent half unread (the agent read did not carry this row)"
    );
  });

  it("the ABSENT field (coord not serving the stamp yet) is its own UNKNOWN", () => {
    // The shape the deployed coord serves today: an agent row with no
    // `account` key at all.
    const cell = deriveAccountCell(
      linked({ id: SID, device_id: "dev-a", name: "spaceship-latency" }),
      { machineLabel }
    );
    expect(textOf(cell)).toBe(
      "UNKNOWN — coord does not report the account yet"
    );
    expect(cell).toMatchObject({
      state: "unknown",
      reason: "coord-not-reporting",
    });
    // NOT conflated with the device's omission, and never "none".
    expect(textOf(cell)).not.toMatch(/not yet reported by|none/i);
    expect(cell.title).toMatch(/fact about coord/);
  });

  it("an agent_only row reads its own agent half", () => {
    const cell = deriveAccountCell(
      {
        id: SID,
        device_id: "dev-b",
        row_class: "agent_only",
        agent_session: { id: SID, device_id: "dev-b", account: "gmail" },
      },
      { machineLabel }
    );
    expect(textOf(cell)).toBe("gmail");
  });

  it("a lifecycle_only row is NOT APPLICABLE — a shell has no Claude account", () => {
    const cell = deriveAccountCell(
      { id: "coord-2", row_class: "lifecycle_only", agent_session: null },
      { machineLabel }
    );
    expect(cell.kind).toBe("not-applicable");
    expect(cell.title).toMatch(/not applicable/);
    expect(accountFacetValue(cell)).toBeNull();
  });

  it("every UNKNOWN shares the one facet chip", () => {
    for (const agent of [{ id: SID }, { id: SID, account: null }]) {
      expect(
        accountFacetValue(deriveAccountCell(linked(agent), { machineLabel }))
      ).toBe(ACCOUNT_FACET_UNKNOWN);
    }
  });
});

// ---------------------------------------------------------------------------
// The detail card
// ---------------------------------------------------------------------------

const CARD: SessionCard = {
  id: SID,
  name: "proud-nimbus-rooster",
  label: null,
  derived_name: "proud-nimbus-rooster",
  user_id: null,
  device_id: "dev-a",
  first_seen: "2026-10-19T08:00:00Z",
  last_seen: "2026-10-19T09:00:00Z",
  closed_at: "2026-10-19T09:00:00Z",
  status: "closed",
  machine: null,
  summary: null,
  working_on: null,
};

describe("deriveCardIdentity", () => {
  const hostnameFor = (id: string) =>
    id === "dev-a" ? "spaceship" : undefined;

  it("a stamped card yields every fact, names labelled by source", () => {
    const id = deriveCardIdentity(
      {
        ...CARD,
        account: "qontinui",
        config_dir: "C:/claude/.claude-qontinui",
        account_observed_at: "2026-11-02T10:00:00Z",
        registry_name: "spaceship latency",
        tag_name: "spaceship-latency",
      },
      { hostnameFor, now: NOW }
    );
    expect(id.account).toMatchObject({ state: "known", label: "qontinui" });
    expect(id.configDir).toEqual({
      state: "known",
      text: "C:/claude/.claude-qontinui",
    });
    expect(id.device).toEqual({ state: "known", text: `spaceship (dev-a)` });
    expect(id.observed).toMatchObject({ state: "known", text: "2h ago" });
    // registry first, then the tag — they DIFFER, so both are shown.
    expect(id.names.map((n) => [n.source, n.value])).toEqual([
      ["registry", "spaceship latency"],
      ["tag", "spaceship-latency"],
    ]);
    expect(id.namesUnknown).toBeNull();
  });

  it("falls back to the tag name when there is no registry name", () => {
    const id = deriveCardIdentity({
      ...CARD,
      account: "qontinui",
      tag_name: "t",
    });
    expect(id.names).toEqual([
      expect.objectContaining({ source: "tag", value: "t" }),
    ]);
  });

  it("shows one name when registry and tag agree", () => {
    const id = deriveCardIdentity({
      ...CARD,
      registry_name: "same",
      tag_name: "same",
    });
    expect(id.names).toHaveLength(1);
  });

  it("an UNSTAMPED card (coord not serving) says so for every stamp fact", () => {
    const id = deriveCardIdentity(CARD, { hostnameFor });
    expect(id.account.label).toBe(
      "UNKNOWN — coord does not report the account yet"
    );
    expect(id.configDir).toEqual({
      state: "unknown",
      text: "UNKNOWN — coord does not report the config dir yet",
    });
    expect(id.observed.state).toBe("unknown");
    expect(id.observed.text).toMatch(/coord does not report/);
    expect(id.namesUnknown).toBe(
      "UNKNOWN — coord does not report registry or tag names yet"
    );
  });

  it("a stamped-but-unreported card names the device that owes the report", () => {
    const id = deriveCardIdentity(
      {
        ...CARD,
        account: null,
        config_dir: null,
        account_observed_at: null,
        registry_name: null,
        tag_name: null,
      },
      { hostnameFor }
    );
    expect(id.account.label).toBe(
      "UNKNOWN — account not yet reported by spaceship"
    );
    expect(id.configDir.text).toBe(
      "UNKNOWN — config dir not yet reported by spaceship"
    );
    expect(id.namesUnknown).toBe(
      "UNKNOWN — registry or tag name not yet reported by spaceship"
    );
  });

  it("an unparseable observation time is UNKNOWN, not a known value", () => {
    const id = deriveCardIdentity({
      ...CARD,
      account: "qontinui",
      account_observed_at: "not-a-time",
    });
    expect(id.observed).toEqual({
      state: "unknown",
      text: "UNKNOWN — coord served an unparseable observation time (not-a-time)",
    });
  });

  it("a card with no device says so instead of a blank device", () => {
    const id = deriveCardIdentity({ ...CARD, device_id: null });
    expect(id.device).toEqual({
      state: "unknown",
      text: "UNKNOWN — coord recorded no device for this session",
    });
  });
});

// ---------------------------------------------------------------------------
// Live status — the census
// ---------------------------------------------------------------------------

function served(
  sessions: Extract<SessionCensusResponse, { served: true }>["sessions"],
  over: Partial<Extract<SessionCensusResponse, { served: true }>> = {}
): SessionCensusResponse {
  return {
    served: true,
    census_present: true,
    sessions,
    count: sessions.length,
    truncated: false,
    ...over,
  };
}

describe("deriveLiveStatus", () => {
  it("a census coord does not serve is UNKNOWN — census not served, never 'not live'", () => {
    const status = deriveLiveStatus(
      {
        state: "resolved",
        value: {
          served: false,
          unknown_reason: "census_not_served",
          detail: '{"error":"no_such_route"}',
        },
      },
      SID
    );
    expect(status).toMatchObject({
      state: "unknown",
      text: "live status UNKNOWN — census not served",
    });
    expect(status.text).not.toMatch(/not live/);
  });

  it("a raw 404 that reached the client is the same 'not served' fact", () => {
    const half = classifyCensusError(
      new AgentSessionsApiError(404, "no_such_route")
    );
    expect(deriveLiveStatus(half, SID).text).toBe(
      "live status UNKNOWN — census not served"
    );
  });

  it("a failed read is UNKNOWN with the status attached", () => {
    const half = classifyCensusError(
      new AgentSessionsApiError(502, "coord is not reachable")
    );
    expect(deriveLiveStatus(half, SID).text).toBe(
      "live status UNKNOWN — census read failed (502: coord is not reachable)"
    );
  });

  it("alive → live now, on the census hostname", () => {
    const status = deriveLiveStatus(
      {
        state: "resolved",
        value: served([
          {
            session_id: SID,
            liveness: "alive",
            hostname: "spaceship",
            observed_at: "2026-11-02T11:59:00Z",
          },
        ]),
      },
      SID,
      { now: NOW }
    );
    expect(status).toMatchObject({
      state: "live",
      text: "live now on spaceship",
    });
  });

  it("dead → not live, with when it last acted", () => {
    const status = deriveLiveStatus(
      {
        state: "resolved",
        value: served([
          {
            session_id: SID,
            liveness: "dead",
            last_acted_at: "2026-11-02T09:00:00Z",
          },
        ]),
      },
      SID,
      { now: NOW }
    );
    expect(status).toMatchObject({
      state: "not-live",
      text: "not live — last acted 3h ago",
    });
  });

  it("matches a census row by alias (the coord.sessions id)", () => {
    const status = deriveLiveStatus(
      {
        state: "resolved",
        value: served([
          {
            session_id: "other",
            aliases: [SID.toUpperCase()],
            liveness: "alive",
          },
        ]),
      },
      SID
    );
    expect(status.state).toBe("live");
  });

  it("no row for this session is UNKNOWN, not ended", () => {
    const status = deriveLiveStatus(
      { state: "resolved", value: served([]) },
      SID
    );
    expect(status).toMatchObject({
      state: "unknown",
      text: "live status UNKNOWN — no census row covers this session",
    });
  });

  it("coord's own unknown keeps its reason", () => {
    const status = deriveLiveStatus(
      {
        state: "resolved",
        value: served([
          {
            session_id: SID,
            liveness: "unknown",
            liveness_reason: "device_snapshot_stale",
          },
        ]),
      },
      SID
    );
    expect(status.text).toBe("live status UNKNOWN — device_snapshot_stale");
  });

  it("an unreadable census store is UNKNOWN even with an empty list", () => {
    const status = deriveLiveStatus(
      { state: "resolved", value: served([], { census_present: false }) },
      SID
    );
    expect(status.text).toBe(
      "live status UNKNOWN — the census tables are unreadable on coord"
    );
  });
});

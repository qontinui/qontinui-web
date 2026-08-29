/**
 * SessionsConsole — the consolidated `/sessions` list.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 1, §8's
 * unit/render bar: *"all three D1 row classes render `–` and never `0`/`false`
 * for a missing half"*.
 *
 * The list poll is disabled and the fetcher injected, so no timer runs and no
 * network is touched. The clock is injected too, so the heartbeat bands and
 * every relative timestamp are deterministic.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SessionsConsole } from "./SessionsConsole";
import type {
  ConsolidatedSessionRow,
  ConsolidatedSessionsResponse,
} from "./sessionConsoleStatus";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const LINKED: ConsolidatedSessionRow = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  device_id: "dev-a",
  row_class: "linked",
  session_kind: "terminal_claude",
  provider: "claude",
  state: "active",
  started_at: ago(600_000),
  last_heartbeat_at: ago(5_000),
  intent: { purpose: "ship the console" },
  agent_session: { id: "agent-1", status: "live", last_seen: ago(5_000) },
};

const LIFECYCLE_ONLY: ConsolidatedSessionRow = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  device_id: "dev-a",
  row_class: "lifecycle_only",
  session_kind: "terminal_shell",
  provider: null,
  state: "active",
  started_at: ago(600_000),
  last_heartbeat_at: ago(5_000),
  intent: { purpose: "plain shell" },
  agent_session: null,
};

// The lifecycle keys are ABSENT, not null — that is exactly what the backend
// emits for a row with no `coord.sessions` half.
const AGENT_ONLY: ConsolidatedSessionRow = {
  id: "cccccccc-0000-0000-0000-000000000003",
  device_id: "dev-b",
  row_class: "agent_only",
  agent_session: {
    id: "cccccccc-0000-0000-0000-000000000003",
    status: "live",
    name: "brave-otter",
    last_seen: ago(20_000),
  },
};

function envelope(
  sessions: ConsolidatedSessionRow[],
  over: Partial<ConsolidatedSessionsResponse> = {}
): ConsolidatedSessionsResponse {
  return {
    count: sessions.length,
    scope: "all",
    shape: "consolidated",
    sessions,
    row_class_counts: { linked: 0, lifecycle_only: 0, agent_only: 0, unknown: 0 },
    agent_half: { read: "ok" },
    ...over,
  };
}

function mount(
  response: ConsolidatedSessionsResponse | Error,
  props: Partial<React.ComponentProps<typeof SessionsConsole>> = {}
) {
  const fetcher = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  render(
    <SessionsConsole
      pollEnabled={false}
      now={NOW}
      fetcher={fetcher as never}
      hostnameFor={(id) => (id === "dev-a" ? "alpha" : "beta")}
      {...props}
    />
  );
  return fetcher;
}

async function rowFor(id: string) {
  const rows = await screen.findAllByTestId("sessions-console-row");
  const row = rows.find((r) => r.getAttribute("data-row-key") === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
}

// ---------------------------------------------------------------------------
// D1 — all three row classes render
// ---------------------------------------------------------------------------

describe("D1 — the three row classes", () => {
  it("renders one line per session for linked, lifecycle_only and agent_only", async () => {
    mount(envelope([LINKED, LIFECYCLE_ONLY, AGENT_ONLY]));
    await waitFor(async () =>
      expect(await screen.findAllByTestId("sessions-console-row")).toHaveLength(3)
    );
  });

  it("renders the machine as a COLUMN, not a grouping container", async () => {
    mount(envelope([LINKED, AGENT_ONLY]));
    const linkedRow = await rowFor(LINKED.id);
    expect(
      within(linkedRow).getByTestId("sessions-console-row-machine")
    ).toHaveTextContent("alpha");
    const agentRow = await rowFor(AGENT_ONLY.id);
    expect(
      within(agentRow).getByTestId("sessions-console-row-machine")
    ).toHaveTextContent("beta");
  });
});

// ---------------------------------------------------------------------------
// D2 — absence is not zero
// ---------------------------------------------------------------------------

describe("D2 — a missing half renders a dash, never 0 / false / closed", () => {
  it("a lifecycle_only row renders – for transcript/lineage, not 'none'", async () => {
    mount(envelope([LIFECYCLE_ONLY]));
    const row = await rowFor(LIFECYCLE_ONLY.id);
    const cell = within(row).getByTestId("sessions-console-row-lineage");
    expect(cell).toHaveTextContent("–");
    expect(cell.textContent).not.toMatch(/none|no transcript|0/i);
    // And the dash says WHICH unknown it is: not applicable, not missing.
    expect(within(cell).getByTestId("sessions-console-unknown")).toHaveAttribute(
      "title",
      expect.stringContaining("not applicable")
    );
  });

  it("an agent_only row renders – for heartbeat/state, not false / 0 / closed", async () => {
    mount(envelope([AGENT_ONLY]));
    const row = await rowFor(AGENT_ONLY.id);
    const cell = within(row).getByTestId("sessions-console-row-heartbeat");
    expect(cell).toHaveTextContent("–");
    expect(cell.textContent).not.toMatch(/closed|false|^0$/i);
    expect(within(cell).getByTestId("sessions-console-unknown")).toHaveAttribute(
      "title",
      expect.stringContaining("NOT closed")
    );
    // The status badge must not read "closed" either.
    expect(row.textContent).not.toMatch(/\bclosed\b/);
  });

  it("an agent_only row renders – for its session kind, not an empty cell", async () => {
    mount(envelope([AGENT_ONLY]));
    const row = await rowFor(AGENT_ONLY.id);
    expect(
      within(row).getByTestId("sessions-console-row-kind")
    ).toHaveTextContent("–");
  });

  it("an unresolved row (row_class null) dashes BOTH halves", async () => {
    const unresolved: ConsolidatedSessionRow = {
      ...LINKED,
      id: "dddddddd-0000-0000-0000-000000000004",
      row_class: null,
      agent_session: null,
    };
    mount(envelope([unresolved]));
    const row = await rowFor(unresolved.id);
    expect(
      within(row).getByTestId("sessions-console-row-lineage")
    ).toHaveTextContent("–");
    expect(
      within(row).getByTestId("sessions-console-row-heartbeat")
    ).toHaveTextContent("–");
  });

  it("the detail's raw slot dashes the id the row does not have", async () => {
    mount(envelope([AGENT_ONLY]));
    const row = await rowFor(AGENT_ONLY.id);
    await userEvent.click(within(row).getByRole("button"));
    const detail = await screen.findByTestId("sessions-console-detail");
    expect(detail).toHaveTextContent("agent_only");
    expect(detail).toHaveTextContent(/heartbeat and lifecycle state are unknown/i);
  });
});

// ---------------------------------------------------------------------------
// The READ axis (readFailure.ts) is not the JOIN axis
// ---------------------------------------------------------------------------

describe("the read axis vs the join axis", () => {
  it("a failed FIRST read is UNKNOWN — the empty state refuses to claim zero", async () => {
    mount(new Error("GET /sessions failed: 502 - coord is not reachable"));
    const state = await screen.findByTestId("sessions-console-unknown-state");
    expect(state).toHaveTextContent(/could not be read/i);
    expect(state).toHaveTextContent(/not a claim that there are no sessions/i);
  });

  it("a landed read over an empty list says so — 'we looked, nothing matched'", async () => {
    mount(envelope([]));
    const empty = await screen.findByTestId("sessions-console-empty");
    expect(empty).toHaveTextContent(/No sessions on the fleet/i);
  });

  it("a failed AGENT half keeps the rows and says the columns are unknown", async () => {
    // The read landed. `readIsUnknown(loaded=true, readFailed=false)` is false
    // for exactly this case, which is why the join axis needs its own spelling.
    mount(
      envelope([{ ...LINKED, row_class: null, agent_session: null }], {
        agent_half: { read: "failed", detail: "502: coord is not reachable" },
      })
    );
    expect(await screen.findAllByTestId("sessions-console-row")).toHaveLength(1);
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveTextContent(/agent half did not answer/i);
    expect(health).toHaveAttribute("data-health-level", "amber");
  });
});

// ---------------------------------------------------------------------------
// R6 — counts
// ---------------------------------------------------------------------------

describe("R6 — an unfetched count is a dash, a measured zero is a zero", () => {
  it("the inactive status tabs render – (never fetched), the active one a number", async () => {
    mount(envelope([LINKED]));
    await screen.findAllByTestId("sessions-console-row");
    // `all` is the active tab, so its count is measured.
    expect(screen.getByTestId("sessions-console-status-all")).toHaveTextContent(
      "1"
    );
    for (const tab of ["live", "stale", "closed"]) {
      expect(
        screen.getByTestId(`sessions-console-status-${tab}`)
      ).toHaveTextContent("–");
    }
  });

  it("an unknown read dashes every stat, including the active tab's", async () => {
    mount(new Error("GET /sessions failed: 502 - down"));
    await screen.findByTestId("sessions-console-unknown-state");
    expect(screen.getByTestId("sessions-console-status-all")).toHaveTextContent(
      "–"
    );
    const stats = screen.getByTestId("sessions-console-stats");
    expect(stats.textContent).not.toMatch(/\d/);
  });
});

// ---------------------------------------------------------------------------
// R6 — FilterChips: empty selection means NO filter
// ---------------------------------------------------------------------------

describe("the facets", () => {
  it("start with an empty selection, which is NO filter — no synthetic 'any'", async () => {
    mount(envelope([LINKED, LIFECYCLE_ONLY, AGENT_ONLY]));
    await screen.findAllByTestId("sessions-console-row");
    const kind = screen.getByTestId("sessions-console-kind");
    expect(kind).toHaveAttribute("data-selected", "");
    // The `all` chip is a CLEAR action, not a member of the vocabulary.
    expect(screen.getByTestId("sessions-console-kind-all")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      within(kind).queryByTestId("sessions-console-kind-any")
    ).toBeNull();
  });

  it("selecting a kind narrows the list, and deselecting widens it back", async () => {
    mount(envelope([LINKED, LIFECYCLE_ONLY, AGENT_ONLY]));
    await screen.findAllByTestId("sessions-console-row");
    const chip = screen.getByTestId("sessions-console-kind-terminal_shell");
    await userEvent.click(chip);
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(1)
    );
    await userEvent.click(chip);
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(3)
    );
  });
});

// ---------------------------------------------------------------------------
// The wire params the redirected routes bring with them
// ---------------------------------------------------------------------------

describe("the request", () => {
  it("forwards ?device= verbatim as a SERVER filter", async () => {
    const fetcher = mount(envelope([]), { initialDevice: "dev-b" });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(fetcher.mock.calls[0][0]).toMatchObject({ device: "dev-b" });
  });

  it("sends no status on the `all` tab — an empty filter is not a value", async () => {
    const fetcher = mount(envelope([]));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(fetcher.mock.calls[0][0].status).toBeUndefined();
  });
});

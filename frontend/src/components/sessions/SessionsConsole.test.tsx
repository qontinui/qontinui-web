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

import { SessionsApiError } from "./api";
import { SessionsConsole, parseStatusTab } from "./SessionsConsole";
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

/**
 * The reads an OPEN row makes. Stubbed by default so a collapsed-row test
 * never touches the network, and so the "nothing fetches while shut" assertion
 * has something to count.
 */
function stubReaders() {
  return {
    coordinationReaders: {
      claims: vi.fn(async () => ({ claims: [], count: 0 })),
      agents: vi.fn(async () => ({ agents: [], count: 0 })),
      lineage: vi.fn(async () => ({ session_id: "s", actions: [] })),
    },
    readOutput: vi.fn(async () => ({
      session_id: "s",
      tier: "warm",
      chunks: [],
      count: 0,
    })),
    listArtifacts: vi.fn(async () => ({
      items: [],
      total: 0,
      offset: 0,
      limit: 10,
    })),
    // Phase 4: an OPEN row follows the session's SSE stream. Stubbed so a test
    // that expands a row still touches no network — and so "nothing fetches
    // while shut" can also count subscriptions.
    revalidation: { subscribe: vi.fn(() => () => {}) },
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
  const stubs = stubReaders();
  render(
    <SessionsConsole
      pollEnabled={false}
      now={NOW}
      fetcher={fetcher as never}
      hostnameFor={(id) => (id === "dev-a" ? "alpha" : "beta")}
      {...(stubs as never)}
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
// The WORK axis facet — `coord.sessions.session_status`.
//
// Plan `2026-09-01-session-finished-marker-and-unfinished-resume` Phase 4. A
// CLIENT facet, not a `?status=` tab: those filter `state` (liveness) and this
// one filters work, and the two cross.
// ---------------------------------------------------------------------------

/** Declared its work complete, and still live. Both axes at once. */
const FINISHED_LIVE: ConsolidatedSessionRow = {
  ...LINKED,
  id: "eeeeeeee-0000-0000-0000-000000000005",
  intent: { purpose: "shipped the console" },
  session_status: "finished",
};

/** Closed WITHOUT ever finishing — the row the resume half goes looking for. */
const CLOSED_UNFINISHED: ConsolidatedSessionRow = {
  ...LINKED,
  id: "ffffffff-0000-0000-0000-000000000006",
  intent: { purpose: "died mid-task" },
  state: "closed",
  session_status: "working",
};

describe("the work facet (session_status)", () => {
  it("starts with an empty selection, which is NO filter", async () => {
    mount(envelope([FINISHED_LIVE, CLOSED_UNFINISHED, LINKED]));
    await screen.findAllByTestId("sessions-console-row");
    const work = screen.getByTestId("sessions-console-work");
    expect(work).toHaveAttribute("data-selected", "");
    expect(screen.getByTestId("sessions-console-work-all")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(3);
  });

  it("counts both chips from the rows on the page — a measured 0, never a dash", async () => {
    // Only `LINKED` here, and it has never reported a work status. R6: we
    // LOOKED, so `0` is the honest number for `finished`.
    mount(envelope([LINKED]));
    await screen.findAllByTestId("sessions-console-row");
    expect(
      screen.getByTestId("sessions-console-work-finished")
    ).toHaveTextContent("0");
    expect(
      screen.getByTestId("sessions-console-work-unfinished")
    ).toHaveTextContent("1");
  });

  it("selecting `unfinished` HIDES finished sessions, and deselecting widens back", async () => {
    mount(envelope([FINISHED_LIVE, CLOSED_UNFINISHED, LINKED]));
    await screen.findAllByTestId("sessions-console-row");
    const chip = screen.getByTestId("sessions-console-work-unfinished");
    await userEvent.click(chip);
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(2)
    );
    expect(screen.queryByText("shipped the console")).toBeNull();
    await userEvent.click(chip);
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(3)
    );
  });

  it("selecting `finished` narrows to exactly the finished rows", async () => {
    mount(envelope([FINISHED_LIVE, CLOSED_UNFINISHED, LINKED]));
    await screen.findAllByTestId("sessions-console-row");
    await userEvent.click(screen.getByTestId("sessions-console-work-finished"));
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(1)
    );
    expect(screen.getByText("shipped the console")).toBeInTheDocument();
  });

  // The absent-key case, at the surface rather than only in the pure module.
  it("a row that never reported a work status stays VISIBLE while finished are hidden", async () => {
    mount(envelope([FINISHED_LIVE, LINKED]));
    await screen.findAllByTestId("sessions-console-row");
    expect("session_status" in LINKED).toBe(false);
    await userEvent.click(
      screen.getByTestId("sessions-console-work-unfinished")
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(1)
    );
    // Unknown is SHOWN — hiding it would be treating an absence as a measured
    // "finished", which is the one thing this facet must never do.
    expect(await rowFor(LINKED.id)).toBeTruthy();
  });

  it("a list emptied by the work facet says a FILTER emptied it", async () => {
    mount(envelope([LINKED]));
    await screen.findAllByTestId("sessions-console-row");
    await userEvent.click(screen.getByTestId("sessions-console-work-finished"));
    const empty = await screen.findByTestId("sessions-console-empty");
    expect(empty).toHaveTextContent(/No sessions match this filter/i);
    expect(empty.textContent).not.toMatch(/No sessions on the fleet/i);
  });
});

describe("the finished marker on a row", () => {
  it("renders BESIDE the liveness badge, not instead of it", async () => {
    mount(envelope([FINISHED_LIVE]));
    const row = await rowFor(FINISHED_LIVE.id);
    // Liveness still says `active` — the session has not exited.
    expect(row.querySelector('[data-status-kind="active"]')).toBeTruthy();
    // ...and the work axis says it is done, with the colourblind-safe glyph.
    const work = within(row).getByTestId("sessions-console-row-work");
    expect(work).toHaveTextContent("finished");
    expect(work).toHaveTextContent("✓");
  });

  it("is VISUALLY DISTINCT from `closed` — orthogonal axes, different hues", async () => {
    const finishedAndClosed: ConsolidatedSessionRow = {
      ...FINISHED_LIVE,
      id: "99999999-0000-0000-0000-000000000009",
      state: "closed",
    };
    mount(envelope([finishedAndClosed]));
    const row = await rowFor(finishedAndClosed.id);
    const closed = row.querySelector('[data-status-kind="closed"]');
    const finished = row.querySelector('[data-status-kind="finished"]');
    expect(closed).toBeTruthy();
    expect(finished).toBeTruthy();
    // The whole point: an operator must be able to tell "this stopped" from
    // "this is done". Same class on both would collapse the two axes.
    expect(finished!.className).not.toBe(closed!.className);
  });

  it("paints NO marker on a row that never reported a work status", async () => {
    mount(envelope([LINKED]));
    const row = await rowFor(LINKED.id);
    expect(
      within(row).queryByTestId("sessions-console-row-work")
    ).toBeNull();
    // And nothing fabricates the opposite claim either.
    expect(row.textContent).not.toMatch(/unfinished/i);
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

  // Phase 3: `/admin/agent-sessions?live=true` 308s to `/sessions?status=live`.
  // Without `initialStatus` the mapped param would land on a page that ignores
  // it — a redirect that LOOKS like it carried the filter over and did not.
  it("opens on the status tab the redirect asked for", async () => {
    const fetcher = mount(envelope([]), { initialStatus: "live" });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(fetcher.mock.calls[0][0]).toMatchObject({ status: "live" });
  });
});

describe("parseStatusTab", () => {
  it("accepts the four tab ids", () => {
    expect(parseStatusTab("all")).toBe("all");
    expect(parseStatusTab("live")).toBe("live");
    expect(parseStatusTab("stale")).toBe("stale");
    expect(parseStatusTab("closed")).toBe("closed");
  });

  it("returns null for anything else rather than widening to `all`", () => {
    // Widening would make a typo'd deep link render as a working one.
    expect(parseStatusTab("LIVE")).toBeNull();
    expect(parseStatusTab("running")).toBeNull();
    expect(parseStatusTab("")).toBeNull();
    expect(parseStatusTab(null)).toBeNull();
    expect(parseStatusTab(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — D3: the detail expands IN PLACE, with all five slots
// ---------------------------------------------------------------------------

describe("D3 — the expansion", () => {
  it("renders BELOW the row it belongs to, not as a slide-over", async () => {
    mount(envelope([LINKED]));
    const row = await rowFor(LINKED.id);
    await userEvent.click(within(row).getByRole("button"));
    const detail = await screen.findByTestId("sessions-console-detail");
    // R5: the panel is a CHILD of the row, sharing its border. A sheet would
    // be a sibling of the list, portalled to the document body.
    expect(row.contains(detail)).toBe(true);
  });

  it("fills all five RecordDetail slots — why, problems, actions, history, raw", async () => {
    mount(envelope([LINKED]));
    const row = await rowFor(LINKED.id);
    await userEvent.click(within(row).getByRole("button"));
    const detail = await screen.findByTestId("sessions-console-detail");

    expect(detail).toHaveTextContent(/Both halves/i); // why
    expect(
      within(detail).getByTestId("sessions-console-detail-coordination")
    ).toBeInTheDocument(); // problems
    expect(
      within(detail).getByTestId("sessions-console-open-full")
    ).toHaveAttribute("href", `/sessions/${LINKED.id}`); // actions
    expect(
      within(detail).getByTestId("sessions-console-detail-lineage")
    ).toBeInTheDocument(); // history
    expect(detail).toHaveTextContent("row_class"); // raw
  });

  it("makes NO coordination read while the row is shut", async () => {
    const stubs = stubReaders();
    render(
      <SessionsConsole
        pollEnabled={false}
        now={NOW}
        fetcher={(async () => envelope([LINKED])) as never}
        {...(stubs as never)}
      />
    );
    await screen.findAllByTestId("sessions-console-row");
    expect(stubs.coordinationReaders.claims).not.toHaveBeenCalled();
    expect(stubs.readOutput).not.toHaveBeenCalled();
    expect(stubs.listArtifacts).not.toHaveBeenCalled();
  });

  it("distinguishes 'coord answered none' from 'the read did not land'", async () => {
    const stubs = stubReaders();
    stubs.coordinationReaders.agents = vi.fn(async () => {
      throw new SessionsApiError("GET /agent-status failed: 502", 502);
    }) as never;
    render(
      <SessionsConsole
        pollEnabled={false}
        now={NOW}
        fetcher={(async () => envelope([LINKED])) as never}
        {...(stubs as never)}
      />
    );
    const row = await rowFor(LINKED.id);
    await userEvent.click(within(row).getByRole("button"));

    // The claims read ANSWERED with an empty list — that is data.
    const claims = await screen.findByTestId("sessions-console-detail-claims");
    await waitFor(() =>
      expect(claims).toHaveTextContent(/coord answered: this session holds no claims/i)
    );
    // The agent-status read did NOT land — that is a dash and a sentence.
    const agents = screen.getByTestId("sessions-console-detail-agent-status");
    await waitFor(() => expect(agents).toHaveTextContent("–"));
    expect(agents).toHaveTextContent(/unknown, not idle/i);
    expect(agents.textContent).not.toMatch(/^0$|\bfalse\b/i);
  });

  it("a lifecycle_only row's lineage slot says NOT APPLICABLE, never empty", async () => {
    mount(envelope([LIFECYCLE_ONLY]));
    const row = await rowFor(LIFECYCLE_ONLY.id);
    await userEvent.click(within(row).getByRole("button"));
    const na = await screen.findByTestId("sessions-console-detail-lineage-na");
    expect(na).toHaveTextContent(/Not applicable/i);
    expect(na.textContent).not.toMatch(/\bnone\b|^0$/i);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — BOTH transcript stores, and the per-row indicator
// ---------------------------------------------------------------------------

describe("the two transcript stores", () => {
  it("the per-row indicator is – until probed — unknown, not 'no transcript'", async () => {
    mount(envelope([LINKED]));
    const row = await rowFor(LINKED.id);
    const cell = within(row).getByTestId("sessions-console-row-transcript");
    expect(cell).toHaveTextContent("–");
    expect(cell.textContent).not.toMatch(/closed|false|^0$/i);
    expect(within(cell).getByTestId("sessions-console-unknown")).toHaveAttribute(
      "title",
      expect.stringContaining("not probed")
    );
  });

  it("reports the coord tier once the row is opened", async () => {
    const stubs = stubReaders();
    stubs.readOutput = vi.fn(async () => ({
      session_id: "s",
      tier: "warm",
      chunks: [{ chunk_offset: 0, payload_b64: "aGk=" }],
      count: 1,
    })) as never;
    render(
      <SessionsConsole
        pollEnabled={false}
        now={NOW}
        fetcher={(async () => envelope([LINKED])) as never}
        {...(stubs as never)}
      />
    );
    const row = await rowFor(LINKED.id);
    await userEvent.click(within(row).getByRole("button"));
    await waitFor(() =>
      expect(
        within(row).getByTestId("sessions-console-row-transcript")
      ).toHaveTextContent("warm")
    );
  });

  it("links the PERMANENT copy — the forward half of the round trip", async () => {
    const stubs = stubReaders();
    stubs.listArtifacts = vi.fn(async () => ({
      items: [
        {
          id: "artifact-9",
          claude_session_id: "agent-1",
          account_label: "work",
          coord_session_id: LINKED.id,
          body_source: "disk_verbatim",
          content_sha256: "abc",
          turn_count: 12,
          byte_count: 99,
          last_activity_at: null,
        },
      ],
      total: 1,
      offset: 0,
      limit: 10,
    })) as never;
    render(
      <SessionsConsole
        pollEnabled={false}
        now={NOW}
        fetcher={(async () => envelope([LINKED])) as never}
        {...(stubs as never)}
      />
    );
    const row = await rowFor(LINKED.id);
    await userEvent.click(within(row).getByRole("button"));

    const links = await screen.findByTestId("session-transcript-archive-links");
    expect(within(links).getByRole("link")).toHaveAttribute(
      "href",
      "/sessions/repository/artifact-9"
    );
    // It is looked up by the archive's OWN identity column, not the coord id.
    expect(stubs.listArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ claudeSessionId: "agent-1" })
    );
  });

  it("a session with no archived row renders –, NOT 'no transcript'", async () => {
    mount(envelope([LINKED]));
    const row = await rowFor(LINKED.id);
    await userEvent.click(within(row).getByRole("button"));

    const state = await screen.findByTestId("session-transcript-archive-state");
    await waitFor(() => expect(state).toHaveTextContent("–"));
    expect(state.textContent).not.toMatch(/closed|false|^0$/i);
    expect(state).toHaveAttribute(
      "title",
      expect.stringContaining("holds no row")
    );
    expect(screen.queryByTestId("session-transcript-archive-links")).toBeNull();
  });

  it("keeps the two stores as TWO — coord's stream is not the archive", async () => {
    mount(envelope([LINKED]));
    const row = await rowFor(LINKED.id);
    await userEvent.click(within(row).getByRole("button"));
    const stores = await screen.findByTestId("session-transcript-stores");
    expect(
      within(stores).getByTestId("session-transcript-live")
    ).toHaveTextContent(/coord/i);
    expect(
      within(stores).getByTestId("session-transcript-archive")
    ).toHaveTextContent(/qontinui-web/i);
    expect(stores).toHaveTextContent(/7 days/i);
  });
});

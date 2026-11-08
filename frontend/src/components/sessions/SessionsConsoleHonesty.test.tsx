/**
 * SessionsConsole — the console must not hide its own columns, must not paint
 * a green empty fleet before its first read, must name the question its
 * numbers answer, and must say when coord's read stopped at its ceiling.
 *
 * Plan `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
 * (qontinui-dev-notes). Every Phase 2 / Phase 3 test here (U2, U3, U4) was
 * observed failing against the console as it stood before those phases.
 *
 * A vitest DOM cannot measure CSS, so the layout half (Phase 1) is pinned by
 * its class contract only; the operated UI Bridge re-run in the plan's
 * Acceptance section is what proves the console fits its column.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { BoundedReadMeta } from "@/components/admin/coord/cursorPager";
import { SessionsConsole } from "./SessionsConsole";
import type {
  ConsolidatedSessionRow,
  ConsolidatedSessionsResponse,
} from "./sessionConsoleStatus";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** A live, linked session on `device`. */
function linked(
  n: number,
  device: string,
  purpose = `job ${n}`
): ConsolidatedSessionRow {
  const id = `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
  return {
    id,
    device_id: device,
    row_class: "linked",
    session_kind: "terminal_claude",
    provider: "claude",
    state: "active",
    started_at: ago(600_000),
    last_heartbeat_at: ago(5_000),
    intent: { purpose },
    agent_session: { id: `agent-${n}`, status: "live", last_seen: ago(5_000) },
  };
}

function envelope(
  sessions: ConsolidatedSessionRow[],
  over: Partial<ConsolidatedSessionsResponse> = {}
): ConsolidatedSessionsResponse {
  return {
    count: sessions.length,
    scope: "all",
    shape: "consolidated",
    sessions,
    row_class_counts: {
      linked: sessions.length,
      lifecycle_only: 0,
      agent_only: 0,
      unknown: 0,
    },
    agent_half: { read: "ok" },
    ...over,
  };
}

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
    revalidation: { subscribe: vi.fn(() => () => {}) },
  };
}

function mount(
  fetcher: (args: {
    q?: string;
    status?: string;
  }) => Promise<ConsolidatedSessionsResponse>,
  props: Partial<React.ComponentProps<typeof SessionsConsole>> = {}
) {
  const fn = vi.fn(fetcher);
  render(
    <SessionsConsole
      pollEnabled={false}
      now={NOW}
      fetcher={fn as never}
      hostnameFor={(id) => id}
      {...(stubReaders() as never)}
      {...props}
    />
  );
  return fn;
}

/** 31 sessions over three machines — the Bauhaus fleet the plan measured. */
const FLEET: ConsolidatedSessionRow[] = [
  ...Array.from({ length: 20 }, (_, i) => linked(i + 1, "dev-a")),
  ...Array.from({ length: 10 }, (_, i) => linked(i + 21, "dev-b")),
  linked(31, "dev-c", "the outgoing one"),
];

// ---------------------------------------------------------------------------
// Phase 2 — U2: nothing is painted as measured before the first read lands
// ---------------------------------------------------------------------------

describe("U2 — before the first read lands", () => {
  it("is amber, says it is reading, and never says 'No sessions match'", () => {
    // A read that has not answered yet — the ~1.6 s window E4 captured, where
    // the strip pulsed green over "No sessions match this filter".
    mount(() => new Promise<ConsolidatedSessionsResponse>(() => {}));
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveAttribute("data-health-level", "amber");
    expect(health).toHaveTextContent("Reading sessions…");
    expect(health).toHaveTextContent(
      "Nothing has answered yet, so every count is a dash rather than a zero."
    );
    expect(screen.queryByText(/No sessions match/i)).toBeNull();
    expect(screen.queryByText(/No sessions on the fleet/i)).toBeNull();
  });

  it("renders every count as a dash, never 0", () => {
    mount(() => new Promise<ConsolidatedSessionsResponse>(() => {}));
    // Tabs: the active one too — nothing has been measured yet.
    for (const tab of ["all", "live", "stale", "closed"]) {
      expect(
        screen.getByTestId(`sessions-console-status-${tab}`)
      ).toHaveTextContent("–");
    }
    // Stats and the health strip's numbers.
    expect(
      screen.getByTestId("sessions-console-stats").textContent
    ).not.toMatch(/\d/);
    const health = screen.getByTestId("sessions-console-health");
    expect(health.textContent).not.toMatch(/\b0\b/);
    expect(health).toHaveTextContent("needs a person –");
    expect(health).toHaveTextContent("active –");
    // The authored work facet counts, too.
    for (const v of ["finished", "unfinished"]) {
      expect(
        screen.getByTestId(`sessions-console-work-${v}`)
      ).toHaveTextContent("–");
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — U3: the strip names the question coord answered, and only that
// ---------------------------------------------------------------------------

describe("U3 — the strip counts coord's answer; the facets narrow only the list", () => {
  it("a machine facet narrows the list, not the banner, the stats or the All badge", async () => {
    mount(async () => envelope(FLEET));
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(31)
    );
    // Nothing narrows yet, so there is no scoped line.
    expect(screen.queryByTestId("sessions-console-scope")).toBeNull();

    await userEvent.click(screen.getByTestId("sessions-console-machine-dev-c"));
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(1)
    );
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveTextContent("31 sessions running cleanly");
    expect(health).toHaveTextContent(/31 rows across 3 machines/);
    expect(screen.getByTestId("sessions-console-stats")).toHaveTextContent(
      "rows 31"
    );
    expect(screen.getByTestId("sessions-console-status-all")).toHaveTextContent(
      "31"
    );
    expect(screen.getByTestId("sessions-console-scope")).toHaveTextContent(
      "showing 1 of 31 rows — filtered by machine"
    );

    // A second facet emptying the list: the strip still holds the tab's
    // numbers, the scoped line names both facets, and the empty state says a
    // filter did it.
    await userEvent.click(screen.getByTestId("sessions-console-work-finished"));
    const empty = await screen.findByTestId("sessions-console-empty");
    expect(empty).toHaveTextContent("No sessions match this filter");
    expect(screen.getByTestId("sessions-console-scope")).toHaveTextContent(
      "showing 0 of 31 rows — filtered by machine and work"
    );
    expect(health).toHaveTextContent(/31 rows across 3 machines/);
    expect(health).not.toHaveTextContent(/No sessions/);
  });

  it("a search is the referent: the strip names it, never 'on the fleet', and All counts coord's answer", async () => {
    // E5: search `outgoing` read "1 session waiting on the fleet ... 1 row
    // across 1 machine" while five were waiting. `q` is a SERVER filter, so
    // the page holds no unsearched read for "the fleet" to be said of.
    const outgoing: ConsolidatedSessionRow = {
      ...linked(31, "dev-c", "the outgoing one"),
      last_heartbeat_at: ago(60_000),
    };
    const fleet = [...FLEET.slice(0, 30), outgoing];
    const fn = mount(async ({ q }) =>
      q ? envelope([outgoing]) : envelope(fleet)
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(31)
    );
    await userEvent.type(
      screen.getByTestId("sessions-console-query"),
      "outgoing"
    );
    await waitFor(
      () =>
        expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(1),
      { timeout: 3000 }
    );
    expect(fn.mock.calls.some(([a]) => a.q === "outgoing")).toBe(true);
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveTextContent(
      "1 of the sessions matching “outgoing” is waiting"
    );
    expect(health).toHaveTextContent(
      "1 row matching “outgoing” across 1 machine"
    );
    expect(health).not.toHaveTextContent(/on the fleet/);
    // The All badge is coord's count for the search — the server filter's
    // answer, not a client-faceted one.
    expect(screen.getByTestId("sessions-console-status-all")).toHaveTextContent(
      "1"
    );
    // No client facet narrowed anything, so there is no scoped line.
    expect(screen.queryByTestId("sessions-console-scope")).toBeNull();
  });

  it("an empty search: the strip names the search, the list says a filter emptied it — neither restates the other", async () => {
    mount(async ({ q }) => (q ? envelope([]) : envelope(FLEET)));
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(31)
    );
    await userEvent.type(
      screen.getByTestId("sessions-console-query"),
      "zzz-no-match"
    );
    const empty = await screen.findByTestId(
      "sessions-console-empty",
      undefined,
      {
        timeout: 3000,
      }
    );
    expect(empty).toHaveTextContent("No sessions match this filter");
    expect(empty).toHaveTextContent("Clear a filter to widen the question.");
    const health = screen.getByTestId("sessions-console-health");
    expect(health).not.toHaveTextContent(/No sessions match/);
    expect(health).toHaveTextContent("0 sessions match “zzz-no-match”");
    expect(health).not.toHaveTextContent(/on the fleet/);
  });

  it("an empty tab: the strip names the tab's sessions, the list only its narrowing and next step", async () => {
    mount(async () => envelope([]), { initialStatus: "live" });
    const empty = await screen.findByTestId("sessions-console-empty");
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveTextContent("No live sessions on the fleet");
    expect(health).not.toHaveTextContent(/No sessions match/);
    expect(empty).toHaveTextContent("No sessions match this filter");
    expect(empty).not.toHaveTextContent(/on the fleet|coord answered/);
    // A measured zero on the answered tab — coord looked.
    expect(
      screen.getByTestId("sessions-console-status-live")
    ).toHaveTextContent("0");
  });

  it("an empty fleet: the strip says so once, the list carries only the next step", async () => {
    mount(async () => envelope([]));
    const empty = await screen.findByTestId("sessions-console-empty");
    expect(screen.getByTestId("sessions-console-health")).toHaveTextContent(
      "No sessions on the fleet"
    );
    expect(empty).toHaveTextContent(
      "Start a session from any runner and it will surface here."
    );
    expect(empty).not.toHaveTextContent(/No sessions/);
  });

  it("a `?device=` deep link is the referent too: the strip names the machine, never the fleet", async () => {
    // `/environments/machines` links here with `?device=`, a SERVER filter on
    // both halves — the rows are that machine's, not the fleet's.
    const waiting: ConsolidatedSessionRow = {
      ...linked(31, "dev-c", "the outgoing one"),
      last_heartbeat_at: ago(60_000),
    };
    mount(async () => envelope([waiting]), { initialDevice: "dev-c" });
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(1)
    );
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveTextContent("1 session waiting on dev-c");
    expect(health).not.toHaveTextContent(/on the fleet/);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — U5: a facet row that can never narrow anything is not rendered
// ---------------------------------------------------------------------------

describe("U5 — a facet with no option beside `all` is hidden", () => {
  it("renders no provider row when no session carries a provider", async () => {
    mount(async () => envelope(FLEET.map((r) => ({ ...r, provider: null }))));
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(31)
    );
    expect(screen.queryByTestId("sessions-console-provider")).toBeNull();
    // A facet that DOES offer a choice keeps its testid.
    expect(screen.getByTestId("sessions-console-machine")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — U1: the class contract a DOM test can encode
// ---------------------------------------------------------------------------

/** The row's optional columns, in the order they drop as the console narrows. */
const DROP_ORDER = [
  "heartbeat",
  "transcript",
  "lineage",
  "kind",
  "account",
  "machine",
] as const;

/** Every `@min-[<n>rem]:inline` container reveal on an element, as rem. */
function containerReveals(el: Element): number[] {
  return [
    ...el.className.matchAll(
      /(?:^|\s)@min-\[(\d+(?:\.\d+)?)rem\]:inline(?=\s|$)/g
    ),
  ].map((m) => Number(m[1]));
}

async function rowById(id: string): Promise<HTMLElement> {
  const row = (await screen.findAllByTestId("sessions-console-row")).find(
    (r) => r.getAttribute("data-row-key") === id
  );
  if (!row) throw new Error(`no row for ${id}`);
  return row;
}

describe("U1 — the console sizes to its column, not to its widest row", () => {
  it("is a container-query root, so its columns answer to its own width", async () => {
    mount(async () => envelope(FLEET));
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(31)
    );
    const root = document.querySelector(
      '[data-ui-bridge-id="sessions.console"]'
    );
    expect(root).not.toBeNull();
    expect(root!.className).toMatch(/(^|\s)@container(\/\S+)?(\s|$)/);
  });

  it("reveals no row column on a VIEWPORT breakpoint", async () => {
    mount(async () => envelope(FLEET));
    const rows = await screen.findAllByTestId("sessions-console-row");
    const cells = within(rows[0]).getAllByTestId(/^sessions-console-row-/);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.className).not.toMatch(
        /(^|\s)(sm|md|lg|xl|2xl):inline(\s|$)/
      );
    }
  });

  it("reveals each optional column at its own container width, heartbeat first to go and machine last", async () => {
    mount(async () => envelope(FLEET));
    const [row] = await screen.findAllByTestId("sessions-console-row");
    const thresholds = DROP_ORDER.map((name) => {
      const cell = within(row!).getByTestId(`sessions-console-row-${name}`);
      // Hidden until ONE container query says the console has room for it.
      expect(cell.className, name).toMatch(/(^|\s)hidden(\s|$)/);
      const reveals = containerReveals(cell);
      expect(reveals, name).toHaveLength(1);
      return reveals[0]!;
    });
    // Each column needs a wider console than the column that outlasts it.
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]!).toBeLessThan(thresholds[i - 1]!);
    }
    // E1's column: a 1280 px viewport beside the 256 px sidebar leaves the
    // console 976 px = 61rem, where the row must fit with its purpose, status,
    // reason and age — so no optional column may claim space at that width.
    expect(Math.min(...thresholds)).toBeGreaterThan(61);
  });

  it("holds the purpose label at a 12rem floor wherever a column can show, and it still truncates with its title", async () => {
    mount(async () => envelope(FLEET));
    const row = await rowById(FLEET[30]!.id);
    const purpose = within(row).getByTestId("sessions-console-row-purpose");
    expect(purpose).toHaveTextContent("the outgoing one");
    expect(purpose).toHaveAttribute("title", "the outgoing one");
    expect(purpose.className).toMatch(/(^|\s)truncate(\s|$)/);

    const firstColumn = Math.min(
      ...DROP_ORDER.flatMap((name) =>
        containerReveals(
          within(row).getByTestId(`sessions-console-row-${name}`)
        )
      )
    );
    // A `min-w-[≥12rem]` floor — unconditional, or engaged no later than the
    // first optional column can appear beside the label.
    const floor =
      /(?:^|\s)(?:@min-\[(\d+(?:\.\d+)?)rem\]:)?min-w-\[(\d+(?:\.\d+)?)rem\](?=\s|$)/.exec(
        purpose.className
      );
    expect(
      floor,
      "the purpose label carries a rem min-width floor"
    ).not.toBeNull();
    expect(Number(floor![2])).toBeGreaterThanOrEqual(12);
    const engagesAt = floor![1] === undefined ? 0 : Number(floor![1]);
    expect(engagesAt).toBeLessThanOrEqual(firstColumn);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — U1: whatever a narrow row hides, its expansion still names
// ---------------------------------------------------------------------------

describe("U1 — every identity column a narrow row hides stays reachable in its expansion", () => {
  async function expand(id: string) {
    const row = await rowById(id);
    await userEvent.click(within(row).getByRole("button"));
    const identity = await within(row).findByTestId(
      "sessions-console-expansion-identity"
    );
    return { row, identity };
  }

  const item = (identity: HTMLElement, name: string) =>
    within(identity).getByTestId(`sessions-console-expansion-identity-${name}`);

  const dashTitle = (el: HTMLElement) =>
    within(el).getByTestId("sessions-console-unknown").getAttribute("title");

  it("names the machine, the Claude account, the session kind and the heartbeat", async () => {
    const session: ConsolidatedSessionRow = {
      ...linked(1, "dev-a"),
      agent_session: {
        id: "agent-1",
        status: "live",
        last_seen: ago(5_000),
        account: "qontinui",
        config_dir: "C:/claude/.claude-qontinui",
      },
    };
    mount(async () => envelope([session]));
    const { row, identity } = await expand(session.id);

    expect(item(identity, "machine")).toHaveTextContent("dev-a");
    // The raw device id rides in the title, as on the row's machine cell.
    expect(item(identity, "machine")).toHaveAttribute("title", "dev-a");
    expect(item(identity, "account")).toHaveTextContent("qontinui");
    expect(item(identity, "account")).toHaveAttribute(
      "title",
      within(row)
        .getByTestId("sessions-console-row-account")
        .getAttribute("title")!
    );
    expect(item(identity, "kind")).toHaveTextContent("terminal_claude");
    expect(item(identity, "heartbeat")).toHaveTextContent("5s ago");
  });

  it("dashes what the row's cell dashes, with the same sentence in the title", async () => {
    // No lifecycle half and no device: machine, kind and heartbeat are unknown.
    const agentOnly: ConsolidatedSessionRow = {
      id: "cccccccc-0000-0000-0000-000000000003",
      device_id: null,
      row_class: "agent_only",
      agent_session: {
        id: "cccccccc-0000-0000-0000-000000000003",
        status: "live",
        last_seen: ago(20_000),
      },
    };
    // No Claude Code session id: an account is not applicable, not missing.
    const shell: ConsolidatedSessionRow = {
      ...linked(2, "dev-a", "plain shell"),
      row_class: "lifecycle_only",
      session_kind: "terminal_shell",
      provider: null,
      agent_session: null,
    };
    // Active, but no heartbeat recorded yet.
    const starting: ConsolidatedSessionRow = {
      ...linked(3, "dev-b", "warming up"),
      last_heartbeat_at: null,
    };
    mount(async () => envelope([agentOnly, shell, starting]));

    const cases: Array<[ConsolidatedSessionRow, string[]]> = [
      [agentOnly, ["machine", "kind", "heartbeat"]],
      [shell, ["account"]],
      [starting, ["heartbeat"]],
    ];
    for (const [session, names] of cases) {
      const { row, identity } = await expand(session.id);
      for (const name of names) {
        const cell = within(row).getByTestId(`sessions-console-row-${name}`);
        const value = item(identity, name);
        expect(value, `${session.id} ${name}`).toHaveTextContent("–");
        expect(dashTitle(value), `${session.id} ${name}`).toBe(dashTitle(cell));
        expect(dashTitle(value), `${session.id} ${name}`).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — U4: a read that stopped at coord's ceiling says so
// ---------------------------------------------------------------------------

/**
 * One half's `bound` exactly as the backend serves it — `bounded_read.unknown`
 * for a full 500-row page (nothing fetched past it, so `truncated` and `total`
 * are null), `bounded_read.complete` below the ceiling.
 */
function atCeiling(): BoundedReadMeta {
  return {
    available: true,
    bound_kind: "unknown",
    count: 500,
    enumerate_via: null,
    filter_narrowed: null,
    limit: 500,
    next_cursor: null,
    shown: 500,
    total: null,
    truncated: null,
  };
}

function belowCeiling(shown: number): BoundedReadMeta {
  return {
    available: true,
    bound_kind: "complete",
    count: shown,
    enumerate_via: null,
    filter_narrowed: null,
    limit: 500,
    next_cursor: null,
    shown,
    total: null,
    truncated: false,
  };
}

/** No coord.sessions row bridges it — among the rows coord served. */
const AGENT_ONLY: ConsolidatedSessionRow = {
  id: "cccccccc-0000-0000-0000-000000000003",
  device_id: "dev-c",
  row_class: "agent_only",
  agent_session: {
    id: "cccccccc-0000-0000-0000-000000000003",
    status: "live",
    last_seen: ago(20_000),
  },
};

const BEYOND_CEILING =
  "no coord.sessions row among the 500 most recently started that coord served — one may exist beyond its ceiling";

describe("U4 — the 500-row ceiling is disclosed, never presented as the fleet", () => {
  it("says both halves stopped at their ceiling and reads every fleet number as a floor", async () => {
    // The Live tab over a full read: coord served its 500 most recently
    // started lifecycle sessions and 500 most recently seen agent sessions,
    // and 31 of them are live.
    mount(
      async () =>
        envelope(FLEET, {
          lifecycle_half: { read: "ok", bound: atCeiling() },
          agent_half: { read: "ok", bound: atCeiling() },
        }),
      { initialStatus: "live" }
    );
    const note = await screen.findByTestId("sessions-console-truncated");
    expect(note).toHaveTextContent(
      "500 most recently started lifecycle sessions and the 500 most recently seen agent sessions"
    );
    expect(note).toHaveTextContent("fleet totals may be higher");

    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveTextContent(
      "at least 31 live rows across at least 3 machines"
    );
    expect(health).toHaveTextContent(
      "At least 31 live sessions running cleanly"
    );
    // Never the green all-clear: the rows past the ceiling were not read.
    expect(health).toHaveAttribute("data-health-level", "amber");
    expect(health).toHaveTextContent("active ≥31");

    const stats = screen.getByTestId("sessions-console-stats");
    expect(stats).toHaveTextContent("rows ≥31");
    expect(stats).toHaveTextContent("machines ≥3");
    expect(
      screen.getByTestId("sessions-console-status-live")
    ).toHaveTextContent("31+");
  });

  it("names only the half that reached its ceiling", async () => {
    mount(async () =>
      envelope(FLEET, {
        lifecycle_half: { read: "ok", bound: belowCeiling(31) },
        agent_half: { read: "ok", bound: atCeiling() },
      })
    );
    const note = await screen.findByTestId("sessions-console-truncated");
    expect(note).toHaveTextContent(
      "Showing the 500 most recently seen agent sessions; fleet totals may be higher."
    );
    expect(note).not.toHaveTextContent(/lifecycle/);
    expect(screen.getByTestId("sessions-console-health")).toHaveTextContent(
      /at least 31 rows/
    );
  });

  it("narrows agent_only to the lifecycle rows coord served while that half is capped", async () => {
    mount(async () =>
      envelope([...FLEET.slice(0, 2), AGENT_ONLY], {
        lifecycle_half: { read: "ok", bound: atCeiling() },
        agent_half: { read: "ok", bound: belowCeiling(3) },
      })
    );
    const row = (await screen.findAllByTestId("sessions-console-row")).find(
      (r) => r.getAttribute("data-row-key") === AGENT_ONLY.id
    )!;
    // The class and its agent half are kept — never demoted to "unresolved".
    expect(
      within(row).getByTestId("sessions-console-row-account")
    ).not.toHaveTextContent(/agent half unread/);
    await userEvent.click(within(row).getByRole("button"));
    const detail = await screen.findByTestId("sessions-console-detail");
    expect(detail).toHaveTextContent(BEYOND_CEILING);
    expect(detail).not.toHaveTextContent(/that no coord\.sessions row bridges/);

    // The stat reads as a floor, and its title says what was compared.
    const stat = within(screen.getByTestId("sessions-console-stats"))
      .getByText(/agent-only/)
      .closest("[data-slot=badge]")!;
    expect(stat).toHaveTextContent("agent-only ≥1");
    expect(stat.getAttribute("title")).toContain(BEYOND_CEILING);
  });

  it("follows the read it describes: a complete read, or a backend that reports no ceiling, says nothing", async () => {
    const answers: ConsolidatedSessionsResponse[] = [
      envelope(FLEET, {
        lifecycle_half: { read: "ok", bound: atCeiling() },
        agent_half: { read: "ok", bound: atCeiling() },
      }),
      // Below both ceilings: every count is exact again.
      envelope(FLEET, {
        lifecycle_half: { read: "ok", bound: belowCeiling(31) },
        agent_half: { read: "ok", bound: belowCeiling(31) },
      }),
      // An older backend: no `lifecycle_half`, no `bound` — not reported, so
      // the page claims nothing about a ceiling in either direction.
      envelope(FLEET),
    ];
    let call = 0;
    mount(async () => answers[Math.min(call++, answers.length - 1)]!);
    expect(
      await screen.findByTestId("sessions-console-truncated")
    ).toBeInTheDocument();

    for (let next = 1; next < answers.length; next++) {
      await userEvent.click(screen.getByTestId("sessions-console-refresh"));
      await waitFor(() =>
        expect(screen.queryByTestId("sessions-console-truncated")).toBeNull()
      );
      const health = screen.getByTestId("sessions-console-health");
      expect(health).toHaveTextContent(/31 rows across 3 machines/);
      expect(health).not.toHaveTextContent(/at least/i);
      expect(health).toHaveAttribute("data-health-level", "green");
      expect(screen.getByTestId("sessions-console-stats")).toHaveTextContent(
        "rows 31"
      );
      expect(
        screen.getByTestId("sessions-console-status-all")
      ).toHaveTextContent(/^All31$/);
    }
    expect(call).toBe(3);
  });
});

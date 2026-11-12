/**
 * SessionsConsole — the console must not hide its own columns, must not paint
 * a green empty fleet before its first read, must name the question its
 * numbers answer, and must say when coord's read stopped at its ceiling.
 *
 * Plan `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
 * (qontinui-dev-notes). Every Phase 2 / Phase 3 test here (U2, U3, U4) was
 * observed failing against the console as it stood before those phases. The
 * review-fix cases — agent-only's direction under each ceiling, a half of
 * unknown size, a full half named by `shown`, one floor spelling and a floor
 * of zero, hidden matches on an empty tab, and the empty state's referent —
 * were observed failing against 90a74da48, before their fixes.
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
    // answer (1), never the unsearched read's (31). An EXACT match: a bare
    // `toHaveTextContent("1")` also passes on "All31".
    const all = screen.getByTestId("sessions-console-status-all");
    expect(all).toHaveTextContent(/^All1$/);
    // No client facet narrowed anything, so there is no scoped line.
    expect(screen.queryByTestId("sessions-console-scope")).toBeNull();
    // … and never a client-faceted count: a facet that hides the one row
    // moves the scoped line, not the badge.
    await userEvent.click(screen.getByTestId("sessions-console-work-finished"));
    await screen.findByTestId("sessions-console-empty");
    expect(all).toHaveTextContent(/^All1$/);
    expect(screen.getByTestId("sessions-console-scope")).toHaveTextContent(
      "showing 0 of 1 row — filtered by work"
    );
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

  it("an empty tab whose filter hid sessions with disagreeing halves is amber and names them — never a green empty fleet", async () => {
    // coord's agent half matched the Live filter for two sessions whose
    // lifecycle half did not: the tab's empty answer is not the whole story.
    mount(async () => envelope([], { withheld_by_filter: 2 }), {
      initialStatus: "live",
    });
    await screen.findByTestId("sessions-console-empty");
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveAttribute("data-health-level", "amber");
    expect(health).toHaveTextContent(
      "No live sessions on the fleet — 2 matches hidden: their two halves disagree"
    );
  });

  it("the empty state answers the question the rows answer, not the one the controls are already asking", async () => {
    // Live is clicked and its read has not landed: the rows on screen are
    // still coord's answer for All, and the strip still says so — so the empty
    // state below must not call that same answer a filtered list.
    let answerLive: (r: ConsolidatedSessionsResponse) => void = () => {};
    mount(({ status }) =>
      status === "live"
        ? new Promise<ConsolidatedSessionsResponse>((resolve) => {
            answerLive = resolve;
          })
        : Promise.resolve(envelope([]))
    );
    await screen.findByTestId("sessions-console-empty");
    await userEvent.click(screen.getByTestId("sessions-console-status-live"));
    expect(screen.getByTestId("sessions-console-health")).toHaveTextContent(
      "No sessions on the fleet"
    );
    const pending = screen.getByTestId("sessions-console-empty");
    expect(pending).toHaveTextContent(
      "Start a session from any runner and it will surface here."
    );
    expect(pending).not.toHaveTextContent(/No sessions match this filter/);

    // Once Live answers, the rows answer the narrowed question — and so do
    // the strip and the empty state, together.
    answerLive(envelope([]));
    await waitFor(() =>
      expect(screen.getByTestId("sessions-console-empty")).toHaveTextContent(
        "No sessions match this filter"
      )
    );
    expect(screen.getByTestId("sessions-console-health")).toHaveTextContent(
      "No live sessions on the fleet"
    );
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
 * for a full page (nothing fetched past it, so `truncated` and `total` are
 * null; `shown` is what coord served, which may pass the 500 asked for),
 * `bounded_read.complete` below the ceiling.
 */
function atCeiling(shown = 500): BoundedReadMeta {
  return {
    available: true,
    bound_kind: "unknown",
    count: shown,
    enumerate_via: null,
    filter_narrowed: null,
    limit: 500,
    next_cursor: null,
    shown,
    total: null,
    truncated: null,
  };
}

/**
 * The route's THIRD arm: `bounded_read.unknown(0, 500)` for a coord body that
 * carried no `sessions` list — not complete, and not a full page either.
 */
function unanswered(): BoundedReadMeta {
  return { ...atCeiling(0), count: 0, shown: 0 };
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

/** One badge of the stat cluster, by its label. */
function statBadge(label: string): HTMLElement {
  const badge = [
    ...screen
      .getByTestId("sessions-console-stats")
      .querySelectorAll<HTMLElement>("[data-slot=badge]"),
  ].find((b) => b.firstElementChild?.textContent?.trim() === label);
  if (!badge) throw new Error(`no stat badge "${label}"`);
  return badge;
}

/** One badge of the health strip, by the words it opens with. */
function stripBadge(prefix: string): HTMLElement {
  const badge = [
    ...screen
      .getByTestId("sessions-console-health")
      .querySelectorAll<HTMLElement>("[data-slot=badge]"),
  ].find((b) => b.textContent?.startsWith(prefix));
  if (!badge) throw new Error(`no strip badge "${prefix}"`);
  return badge;
}

/** What every floor of zero says in its title, whatever its slot. */
const COUNTS_ONLY_ROWS_READ = "counts only the rows read";

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
    // ONE numeric spelling of a floor — the tab, the stats and the strip's
    // badges alike; "at least" is the prose spelling, kept to sentences.
    expect(
      screen.getByTestId("sessions-console-status-live")
    ).toHaveTextContent(/^Live≥31$/);
    // A floor of zero is true of every count and says nothing: it reads as
    // the count of the rows read instead — named for the ROWS, and said again
    // in the slot's title.
    expect(health).toHaveTextContent("needs a person 0 among rows read");
    expect(stripBadge("needs a person").getAttribute("title")).toContain(
      COUNTS_ONLY_ROWS_READ
    );
    expect(statBadge("lifecycle-only")).toHaveTextContent(
      /^lifecycle-only 0 among rows read$/
    );
    expect(statBadge("lifecycle-only").getAttribute("title")).toContain(
      COUNTS_ONLY_ROWS_READ
    );
    // (The strip's PROSE may say "— of those read, 31 active …": that is a
    // sentence about the rows read. No count slot says "0 of those read".)
    expect(document.body.textContent).not.toMatch(
      /≥0|\d\+|at least 0|0 of those read/
    );
  });

  it("a floor of zero in a count slot: a bare 0 in the tab, words where there is room — and each says in its title that it counts only the rows read", async () => {
    // The Live tab over a FULL lifecycle half: coord served its 500 most
    // recently started sessions and none of them is live. More may be, past
    // the ceiling — so this zero is a count of the rows read, nothing more.
    mount(
      async () =>
        envelope([], {
          lifecycle_half: { read: "ok", bound: atCeiling() },
          agent_half: { read: "ok", bound: belowCeiling(0) },
        }),
      { initialStatus: "live" }
    );
    await screen.findByTestId("sessions-console-empty");

    // The tab's monospace count slot has no room for words.
    const tab = screen.getByTestId("sessions-console-status-live");
    expect(tab).toHaveTextContent(/^Live0$/);
    expect(tab.getAttribute("title")).toContain(COUNTS_ONLY_ROWS_READ);

    // Where there is room, the words are in the slot — about ROWS, never
    // "0 of those read" under a label that counts machines.
    expect(statBadge("machines")).toHaveTextContent(
      /^machines 0 among rows read$/
    );
    expect(statBadge("machines").getAttribute("title")).toContain(
      COUNTS_ONLY_ROWS_READ
    );
    expect(stripBadge("needs a person")).toHaveTextContent(
      /^needs a person 0 among rows read$/
    );
    expect(document.body.textContent).not.toMatch(/0 of those read|≥0/);
  });

  it("names the rows a full half actually served — `shown`, not the limit it asked for", async () => {
    mount(async () =>
      envelope(FLEET, {
        lifecycle_half: { read: "ok", bound: atCeiling(600) },
        agent_half: { read: "ok", bound: belowCeiling(31) },
      })
    );
    expect(
      await screen.findByTestId("sessions-console-truncated")
    ).toHaveTextContent(
      "Showing the 600 most recently started lifecycle sessions; fleet totals may be higher."
    );
  });

  it("a half whose read carried nothing countable is of UNKNOWN size: dashes and words, never a ceiling over zero rows", async () => {
    // The route's `unknown(0, 500)`: coord answered `/sessions` with no list.
    // It is not a full page, so nothing about "the 500 most recently started"
    // is true of it, and `≥0` is a floor of nothing.
    mount(async () =>
      envelope([AGENT_ONLY], {
        lifecycle_half: { read: "ok", bound: unanswered() },
        agent_half: { read: "ok", bound: belowCeiling(1) },
      })
    );
    const note = await screen.findByTestId("sessions-console-truncated");
    expect(note).toHaveTextContent(
      "The lifecycle half's size is unknown: coord's answer for it carried nothing countable, so the fleet counts above are dashes, not zeros."
    );
    expect(note).not.toHaveTextContent(
      /most recently|fleet totals may be higher/
    );

    for (const label of [
      "rows",
      "machines",
      "linked",
      "lifecycle-only",
      "agent-only",
    ]) {
      expect(statBadge(label), label).toHaveTextContent(
        new RegExp(`^${label} –$`)
      );
    }
    // A property of THIS read, not a fleet total: still a number.
    expect(statBadge("unresolved")).toHaveTextContent(/^unresolved 0$/);
    expect(screen.getByTestId("sessions-console-status-all")).toHaveTextContent(
      /^All–$/
    );
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveAttribute("data-health-level", "amber");
    expect(health).toHaveTextContent("1 session read — the total is unknown");
    expect(health).toHaveTextContent("needs a person –");
    expect(health).toHaveTextContent("active –");
    expect(document.body.textContent).not.toMatch(/≥|\d\+|at least/);

    // The agent-only row is qualified by what was compared — never "no
    // coord.sessions row bridges it", and never a 500 that was not served.
    const row = await rowById(AGENT_ONLY.id);
    await userEvent.click(within(row).getByRole("button"));
    const detail = await screen.findByTestId("sessions-console-detail");
    expect(detail).toHaveTextContent(
      "no coord.sessions row among the lifecycle rows coord served — that half's size is unknown, so one may exist that it did not serve"
    );
    expect(detail).not.toHaveTextContent(
      /that no coord\.sessions row bridges|500/
    );
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

    // `agent_only` is a set difference against the lifecycle rows SERVED, so
    // a capped lifecycle half can only have made it too BIG: a row's twin may
    // lie past the ceiling. Every agent session was read, so 1 is a ceiling of
    // the true count — never a floor.
    const stat = statBadge("agent-only");
    expect(stat).toHaveTextContent(/^agent-only ≤1$/);
    expect(stat.getAttribute("title")).toContain("at most");
    expect(stat.getAttribute("title")).toContain(BEYOND_CEILING);
  });

  it("agent-only is a floor only when the AGENT half stopped and the lifecycle half did not", async () => {
    // Every lifecycle row was served, so each unmatched agent row really has
    // no coord.sessions row; agent sessions past the agent ceiling were not
    // read, and any of them may be unmatched too.
    mount(async () =>
      envelope([...FLEET.slice(0, 2), AGENT_ONLY], {
        lifecycle_half: { read: "ok", bound: belowCeiling(2) },
        agent_half: { read: "ok", bound: atCeiling() },
      })
    );
    await screen.findAllByTestId("sessions-console-row");
    const stat = statBadge("agent-only");
    expect(stat).toHaveTextContent(/^agent-only ≥1$/);
    expect(stat.getAttribute("title")).toContain("at least");
  });

  it("with both halves stopped, agent-only is neither a floor nor a ceiling — and says so", async () => {
    // A twin may lie past the lifecycle ceiling (too big) while unmatched
    // agent sessions lie past the agent ceiling (too small): the number is
    // only how many rows read went unmatched.
    mount(async () =>
      envelope([...FLEET.slice(0, 2), AGENT_ONLY], {
        lifecycle_half: { read: "ok", bound: atCeiling() },
        agent_half: { read: "ok", bound: atCeiling() },
      })
    );
    await screen.findAllByTestId("sessions-console-row");
    const stat = statBadge("agent-only");
    expect(stat).toHaveTextContent(/^agent-only 1 unmatched among rows read$/);
    expect(stat.textContent).not.toMatch(/[≥≤]/);
    expect(stat.getAttribute("title")).toContain(
      "neither a floor nor a ceiling"
    );
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
      // An older backend: no `lifecycle_half`, no `bound`. The page reads it
      // as complete — exact counts, no disclosure — which IS a claim, the one
      // it made before the field existed; kept for deploy skew only.
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

// ---------------------------------------------------------------------------
// A FAILED agent read is not a complete one
// ---------------------------------------------------------------------------

/**
 * A lifecycle row as the route serves it once the agent read FAILED: every
 * row's class is withheld (`row_class: null`) — bridged rows and shells alike,
 * because with no agent payload the route classifies nothing.
 */
function unclassified(
  n: number,
  device: string,
  bridged = true
): ConsolidatedSessionRow {
  return {
    ...linked(n, device),
    row_class: null,
    agent_session: null,
    claude_code_session_id: bridged ? `bridge-${n}` : null,
    ...(bridged ? {} : { session_kind: "terminal_shell", provider: null }),
  };
}

const FAILED_AGENT_HALF = {
  read: "failed",
  detail: "502: coord is not reachable",
} as const;

const AGENT_HALF_DID_NOT_ANSWER =
  "the agent half did not answer — unknown, not zero";

describe("a FAILED agent read is not a complete one", () => {
  /** Every join-class count is unknown — its dash says why, never a zero. */
  function expectJoinClassesUnknown() {
    for (const label of ["linked", "lifecycle-only", "agent-only"]) {
      const stat = statBadge(label);
      expect(stat, label).toHaveTextContent(new RegExp(`^${label} –$`));
      expect(stat.getAttribute("title"), label).toBe(AGENT_HALF_DID_NOT_ANSWER);
    }
    // No row's status is established, so no one is counted as needing a
    // person or as active — unknown, not zero.
    expect(stripBadge("needs a person")).toHaveTextContent(
      /^needs a person –$/
    );
    expect(stripBadge("active")).toHaveTextContent(/^active –$/);
  }

  it("beside a FULL lifecycle half: agent-only is unknown, never 'every agent session was read'", async () => {
    mount(async () =>
      envelope(
        [
          unclassified(1, "dev-a"),
          unclassified(2, "dev-a"),
          unclassified(3, "dev-b", false),
        ],
        {
          lifecycle_half: { read: "ok", bound: atCeiling() },
          agent_half: FAILED_AGENT_HALF,
        }
      )
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(3)
    );
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveTextContent(
      "Lifecycle half only — the agent half did not answer"
    );
    expectJoinClassesUnknown();
    expect(statBadge("agent-only").getAttribute("title")).not.toMatch(
      /every agent session was read/
    );
    // The rows the lifecycle half served are real: floors, never totals.
    expect(statBadge("rows")).toHaveTextContent(/^rows ≥3$/);
    expect(statBadge("machines")).toHaveTextContent(/^machines ≥2$/);
    // Exact: these are the rows of THIS read whose class was withheld.
    expect(statBadge("unresolved")).toHaveTextContent(/^unresolved 3$/);
  });

  it("beside a COMPLETE lifecycle half: rows and machines are floors — sessions only the agent half holds were not read", async () => {
    mount(async () =>
      envelope([unclassified(1, "dev-a"), unclassified(2, "dev-b", false)], {
        lifecycle_half: { read: "ok", bound: belowCeiling(2) },
        agent_half: FAILED_AGENT_HALF,
      })
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(2)
    );
    expect(statBadge("rows")).toHaveTextContent(/^rows ≥2$/);
    expect(statBadge("machines")).toHaveTextContent(/^machines ≥2$/);
    expect(screen.getByTestId("sessions-console-status-all")).toHaveTextContent(
      /^All≥2$/
    );
    expectJoinClassesUnknown();
    expect(statBadge("unresolved")).toHaveTextContent(/^unresolved 2$/);
    // No half reached a ceiling: the strip names the failure, and there is
    // no ceiling sentence to add.
    expect(screen.getByTestId("sessions-console-health")).toHaveTextContent(
      "Lifecycle half only — the agent half did not answer"
    );
    expect(screen.queryByTestId("sessions-console-truncated")).toBeNull();
  });
});

describe("lifecycle-only is read off the lifecycle half alone", () => {
  it("stays exact beside a FULL agent half when every lifecycle row was read", async () => {
    const shell = (n: number): ConsolidatedSessionRow => ({
      ...linked(n, "dev-a", `shell ${n}`),
      row_class: "lifecycle_only",
      session_kind: "terminal_shell",
      provider: null,
      agent_session: null,
    });
    mount(async () =>
      envelope([shell(1), shell(2), linked(3, "dev-b")], {
        lifecycle_half: { read: "ok", bound: belowCeiling(3) },
        agent_half: { read: "ok", bound: atCeiling() },
      })
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(3)
    );
    // The agent half is full, so fleet counts are floors…
    expect(statBadge("rows")).toHaveTextContent(/^rows ≥3$/);
    // …but a shell has no Claude session id, a fact of the lifecycle row,
    // and every lifecycle row was read: the count is exact.
    expect(statBadge("lifecycle-only")).toHaveTextContent(/^lifecycle-only 2$/);
  });
});

describe("linked is exact when no bridged row could hide past a ceiling", () => {
  it("stays exact beside a FULL agent half when every lifecycle row was read and none is unresolved", async () => {
    mount(async () =>
      envelope([linked(1, "dev-a"), linked(2, "dev-b")], {
        lifecycle_half: { read: "ok", bound: belowCeiling(2) },
        agent_half: { read: "ok", bound: atCeiling() },
      })
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(2)
    );
    expect(statBadge("rows")).toHaveTextContent(/^rows ≥2$/);
    expect(statBadge("linked")).toHaveTextContent(/^linked 2$/);
  });
});

describe("a count is floored only where an unread or unresolved row could raise it", () => {
  it("needs-a-person stays exact beside a FULL agent half when nothing is unresolved", async () => {
    mount(async () =>
      envelope([linked(1, "dev-a"), linked(2, "dev-b")], {
        lifecycle_half: { read: "ok", bound: belowCeiling(2) },
        agent_half: { read: "ok", bound: atCeiling() },
      })
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(2)
    );
    // Needs-a-person comes only from a lifecycle state, and every lifecycle
    // row was read and resolved: exact, though the agent half is full.
    expect(stripBadge("needs a person")).toHaveTextContent(
      /^needs a person 0$/
    );
    // Active can be an agent-only session past the agent ceiling: a floor.
    expect(stripBadge("active")).toHaveTextContent(/^active ≥2$/);
  });

  it("an unresolved row floors linked and needs-a-person even when neither half is full", async () => {
    mount(async () =>
      envelope([linked(1, "dev-a"), unclassified(2, "dev-b")], {
        lifecycle_half: { read: "ok", bound: belowCeiling(2) },
        agent_half: { read: "ok", bound: belowCeiling(1) },
      })
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(2)
    );
    // The unresolved row's twin may have been filtered out coord-side: it may
    // be linked, and its masked status may need a person.
    expect(statBadge("linked")).toHaveTextContent(/^linked ≥1$/);
    expect(stripBadge("needs a person")).toHaveTextContent(
      /^needs a person 0 among rows read$/
    );
  });
});

describe("the strip's waiting-on-a-person sentence uses needs-a-person's own basis", () => {
  it("states it exactly beside a FULL agent half when nothing is unresolved", async () => {
    mount(async () =>
      envelope(
        [
          { ...linked(1, "dev-a"), state: "pending_resolution" },
          linked(2, "dev-b"),
        ],
        {
          lifecycle_half: { read: "ok", bound: belowCeiling(2) },
          agent_half: { read: "ok", bound: atCeiling() },
        }
      )
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("sessions-console-row")).toHaveLength(2)
    );
    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveTextContent("1 session waiting on a person");
    expect(health).not.toHaveTextContent(
      /at least 1 session waiting on a person/i
    );
  });
});

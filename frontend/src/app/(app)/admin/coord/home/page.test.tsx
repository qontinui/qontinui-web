/**
 * /admin/coord/home — the rendered composition.
 *
 * Plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4. The derivations are pinned in `coordHomeStatus.test.ts`; this file
 * pins what reaches the screen:
 *
 * - every region is present, with its `data-ui-bridge-id` and `data-testid`,
 *   whatever the door answered — including before any read;
 * - "Nothing needs you" renders ONLY on a read needs_me block with a zero —
 *   never on coord's current `not_implemented`, never on `could_not_read`;
 * - the word "stalled" never reaches the screen, even with a repo's named
 *   units expanded;
 * - named units link to `/admin/coord/work-units/[slug]`;
 * - a failed poll after a good one keeps the render and says it is stale.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

/**
 * The stubbed transport: `httpClient.fetch`, which `fetchProjectState` calls
 * with the relative URL and reads through `readJson`. Every answer is a FRESH
 * `Response`, because a body can be read only once.
 */
const httpFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => httpFetch(...args) },
}));

/** An answer carrying `body` as JSON. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [{ id: TENANT_ID, name: "Qontinui" }],
    activeTenantId: TENANT_ID,
    loading: false,
    error: null,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import CoordHomePage from "./page";

const REGIONS = [
  "coord-home.strip",
  "coord-home.needs-you",
  "coord-home.degrading",
  "coord-home.on-track",
  "coord-home.correct",
  "coord-home.does-not-know",
];

const CLASSES = {
  shipped: 4,
  in_flight: 2,
  stalled: 1,
  blocked_on_dependency: 0,
  waiting_on_gate: 1,
  not_started: 3,
  closed_other: 0,
  off_vocabulary: 0,
  unset: 0,
};

/** Coord's body as the Phase 1–2 door serves it today. */
function doorBody(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    generated_at: new Date().toISOString(),
    tenant_id: TENANT_ID,
    scope: "operator",
    on_track: {
      state: "read",
      totals: { row_count: 11, classes: CLASSES },
      groups: [
        {
          key: "qontinui-web",
          kind: "repo",
          row_count: 11,
          classes: CLASSES,
          named: {
            stalled: {
              units: [
                {
                  slug: "2026-09-01-old-plan",
                  title: "An old plan",
                  first_in_progress_at: "2026-09-01T00:00:00Z",
                  last_recorded_change_at: "2026-09-02T00:00:00Z",
                  age_secs: 28 * 86_400,
                  age_basis: "last_recorded_change",
                },
              ],
              omitted: 0,
            },
            waiting_on_gate: { units: [], omitted: 0 },
          },
        },
      ],
      stall_window_secs: 1_209_600,
      history_not_recorded: 0,
      initiative: {
        state: "read",
        status: "live",
        ends: "2026-10-31",
        alignment: "unknown",
        in_scope: [
          { text: "remote runner session access", key: "remote-runner" },
        ],
      },
    },
    correctness: {
      state: "unknown",
      reason: "verification_metrics_door_absent",
      inputs: null,
    },
    needs_me: { state: "not_implemented" },
    degradations: {
      state: "read",
      headline: "degraded",
      open: [
        {
          id: "alert:7",
          plane: "runner",
          subject: { kind: "device", name: "box-1", id: "dev-1" },
          headline: "A runner stopped answering",
          onset_observed_at: "2026-09-30T08:00:00Z",
          last_seen_at: "2026-09-30T11:00:00Z",
          age_secs: 3 * 3600,
          auto_remediation: { bound: true, response: "agent:runner_restart" },
          drill: "/admin/coord/devops",
          declared: false,
        },
      ],
      declared: [],
      recently_cleared: [
        {
          id: "alert:3",
          plane: "disk",
          headline: "Disk was nearly full",
          onset_observed_at: "2026-09-30T01:00:00Z",
          resolved_at: "2026-09-30T02:00:00Z",
          duration_secs: 3600,
          declared: false,
        },
      ],
    },
    does_not_know: [
      { source: "work_units", state: "read", as_of: "2026-09-30T12:00:00Z" },
      {
        // coord's own wording today names the class by its wire key; the
        // page must not put that word on screen (R8).
        source: "work_unit_status_history",
        state: "read",
        as_of: "2026-09-30T12:00:00Z",
        rows_considered: 3,
        rows_excluded: 1,
        exclusion_reason:
          "in_progress units with NO status-history row cannot be judged stalled; they are classed in_flight with history: not_recorded",
      },
      {
        source: "needs_me (agent_questions operator audience + operator gates)",
        state: "not_implemented",
        exclusion_reason: "plan Phase 3",
      },
    ],
    ...overrides,
  };
}

async function renderWith(body: unknown) {
  httpFetch.mockImplementation(async () => jsonResponse(body));
  render(<CoordHomePage />);
  await waitFor(() => expect(httpFetch).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
  );
}

describe("/admin/coord/home", () => {
  beforeEach(() => {
    httpFetch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the project-state proxy, and nothing else", async () => {
    await renderWith(doorBody());
    expect(httpFetch.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/operations/project-state",
    ]);
  });

  it("renders every region with its ui-bridge id and testid", async () => {
    await renderWith(doorBody());
    for (const id of REGIONS) {
      const el = screen.getByTestId(id);
      expect(el).toHaveAttribute("data-ui-bridge-id", id);
    }
  });

  it("renders every region before any read, with no counts", async () => {
    httpFetch.mockReturnValue(new Promise(() => {}));
    render(<CoordHomePage />);
    for (const id of REGIONS)
      expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId("coord-home.strip.health")).toHaveAttribute(
      "data-health-level",
      "amber"
    );
    expect(screen.queryByText("Nothing needs you")).not.toBeInTheDocument();
  });

  // Until coord serves `GET /coord/project-state`, the first read is a 404.
  // Both shapes the browser can receive are pinned: coord's router fallback
  // (`404 {"error":"no_such_route",…}`, re-raised by the web proxy with
  // coord's text as the message), and a web backend that does not mount the
  // proxy yet. The client rejects with `GET <url> failed: <status> - <body>`
  // (`readJson`) in both cases. Each must render a labelled UNKNOWN, never a calm,
  // empty page.
  it.each([
    [
      "coord's no_such_route, relayed by the proxy",
      JSON.stringify({
        error: "NOT_FOUND",
        message: JSON.stringify({
          error: "no_such_route",
          method: "GET",
          path: "/coord/project-state",
          message: "no route is registered at this path.",
        }),
        path: "https://api.example.test/api/v1/operations/project-state",
      }),
    ],
    [
      "a web backend without the proxy",
      JSON.stringify({ error: "NOT_FOUND", message: "Not Found" }),
    ],
  ])(
    "renders a labelled UNKNOWN, never an empty healthy page, on a 404 first read (%s)",
    async (_shape, body) => {
      httpFetch.mockImplementation(
        async () => new Response(body, { status: 404 })
      );
      render(<CoordHomePage />);
      const unread = await screen.findByTestId("coord-home.unread");
      expect(unread).toHaveTextContent(
        "Coord's project state could not be read: this deployment does not serve the project-state door yet — unknown."
      );
      expect(unread).toHaveTextContent(
        "Every count on this page is a dash, not a zero."
      );
      const strip = screen.getByTestId("coord-home.strip.health");
      expect(strip).toHaveAttribute("data-health-level", "amber");
      expect(strip).toHaveTextContent("Cannot tell");
      expect(
        screen.getByTestId("coord-home.strip.needs-you")
      ).toHaveTextContent("needs you –");
      for (const id of REGIONS)
        expect(screen.getByTestId(id)).toBeInTheDocument();
      // No calm empty state, in either tense (a stale read words them in the
      // past: "Nothing needed you …", "Nothing was degrading …").
      expect(
        screen.queryByTestId("coord-home.needs-you.empty")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("coord-home.degrading.empty")
      ).not.toBeInTheDocument();
      for (const calm of [
        /Nothing need(s|ed) you/,
        /Nothing (is|was) degrading/,
        /^No work units\.$/,
      ])
        expect(screen.queryByText(calm)).not.toBeInTheDocument();
    }
  );

  it("never says 'Nothing needs you' over coord's not_implemented needs_me", async () => {
    await renderWith(doorBody());
    expect(screen.queryByText("Nothing needs you")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("coord-home.needs-you.not-read")
    ).toHaveTextContent(/Not known/);
  });

  it.each(["could_not_read", "stale", "unknown"])(
    "never says 'Nothing needs you' when needs_me is %s",
    async (state) => {
      await renderWith(doorBody({ needs_me: { state, total: 0, items: [] } }));
      expect(screen.queryByText("Nothing needs you")).not.toBeInTheDocument();
    }
  );

  it("says 'Nothing needs you' on a read block with a zero", async () => {
    await renderWith(
      doorBody({ needs_me: { state: "read", total: 0, omitted: 0, items: [] } })
    );
    expect(screen.getByTestId("coord-home.needs-you.empty")).toHaveTextContent(
      "Nothing needs you"
    );
  });

  it("lists a fork with its recommendation, and shows total and omitted", async () => {
    await renderWith(
      doorBody({
        needs_me: {
          state: "read",
          total: 430,
          omitted: 429,
          items: [
            {
              source: "question",
              id: "q-1",
              fork: "Merge the migration first?",
              recommendation: "Yes, land it first",
              if_overturned: "The coord PR waits",
              shape: "fork_with_recommendation",
              answer_at: "/admin/coord/questions/q-1",
            },
          ],
        },
      })
    );
    expect(screen.getByTestId("coord-home.needs-you.count")).toHaveTextContent(
      "1 shown of 430 · 429 not shown"
    );
    fireEvent.click(screen.getByText("Merge the migration first?"));
    expect(screen.getByTestId("coord-home.needs-you.answer")).toHaveAttribute(
      "href",
      "/admin/coord/questions/q-1"
    );
    expect(screen.getByTestId("coord-home.strip.health")).toHaveAttribute(
      "data-health-level",
      "red"
    );
  });

  // coord ages its waiting_on_gate list from first_in_progress_at, and the
  // list holds ANY unfinished unit with an open gate — a draft one included.
  // A unit that never started is not "in progress for unknown".
  it("words a waiting unit's age by what coord measured, for a draft that never started", async () => {
    const base = doorBody();
    const group = (
      (base.on_track as Record<string, unknown>).groups as Record<
        string,
        unknown
      >[]
    )[0];
    await renderWith(
      doorBody({
        on_track: {
          ...(base.on_track as Record<string, unknown>),
          groups: [
            {
              ...group,
              named: {
                stalled: { units: [], omitted: 0 },
                waiting_on_gate: {
                  units: [
                    {
                      slug: "2026-10-20-a-draft-plan",
                      title: "A draft plan",
                      first_in_progress_at: null,
                      last_recorded_change_at: "2026-10-20T00:00:00Z",
                      age_secs: null,
                      age_basis: "first_in_progress",
                    },
                    {
                      slug: "2026-09-01-a-vetted-plan",
                      title: "A vetted plan",
                      first_in_progress_at: "2026-09-10T00:00:00Z",
                      last_recorded_change_at: "2026-10-01T00:00:00Z",
                      age_secs: 40 * 86_400,
                      age_basis: "first_in_progress",
                    },
                  ],
                  omitted: 0,
                },
              },
            },
          ],
        },
      })
    );
    const onTrack = screen.getByTestId("coord-home.on-track");
    fireEvent.click(within(onTrack).getByText(/shipped 4/));
    const waiting = within(onTrack).getByTestId(
      "coord-home.on-track.named.waiting_on_condition"
    );
    expect(
      within(waiting).getByText("A draft plan").closest("li")
    ).toHaveTextContent(/never recorded in progress$/);
    expect(
      within(waiting).getByText("A vetted plan").closest("li")
    ).toHaveTextContent(/first in progress 40d 0h ago$/);
    expect(waiting).not.toHaveTextContent(/in progress for/);
  });

  it("never renders the word 'stalled', even with named units open", async () => {
    await renderWith(doorBody());
    const onTrack = screen.getByTestId("coord-home.on-track");
    fireEvent.click(within(onTrack).getByText(/shipped 4/));
    const link = within(onTrack).getByText("An old plan");
    expect(link.closest("a")).toHaveAttribute(
      "href",
      "/admin/coord/work-units/2026-09-01-old-plan"
    );
    // …and with coord's exclusion reason that names the class expanded too.
    const dnk = screen.getByTestId("coord-home.does-not-know");
    fireEvent.click(within(dnk).getByText("Work unit status changes"));
    expect(dnk).toHaveTextContent("Why excluded:");
    expect(document.body.textContent ?? "").not.toMatch(/stalled/i);
    expect(onTrack).toHaveTextContent("no recorded change in 14 days");
  });

  it("goes amber when a later poll fails over a calm view, and words the empty states in the past", async () => {
    await renderWith(
      doorBody({
        correctness: { state: "read", reason: null },
        needs_me: { state: "read", total: 0, omitted: 0, items: [] },
        degradations: {
          state: "read",
          headline: "none",
          open: [],
          declared: [],
          recently_cleared: [],
          planes: {},
        },
        does_not_know: [{ source: "work_units", state: "read" }],
      })
    );
    const health = screen.getByTestId("coord-home.strip.health");
    expect(health).toHaveAttribute("data-health-level", "green");
    expect(screen.getByTestId("coord-home.needs-you.empty")).toHaveTextContent(
      /^Nothing needs you$/
    );

    httpFetch.mockRejectedValueOnce(new TypeError("coord unreachable"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-home.refresh"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("coord-home.strip.health")).toHaveAttribute(
        "data-health-level",
        "amber"
      )
    );
    expect(screen.getByTestId("coord-home.strip.health")).toHaveTextContent(
      /at the last good read/
    );
    expect(screen.getByTestId("coord-home.needs-you.empty")).toHaveTextContent(
      /Nothing needed you at the last good read/
    );
    expect(screen.getByTestId("coord-home.degrading.empty")).toHaveTextContent(
      /Nothing was degrading at the last good read/
    );
  });

  it("says it cannot tell when a read degradations block serves no open list", async () => {
    await renderWith(
      doorBody({
        degradations: { state: "read", headline: "none", recently_cleared: [] },
      })
    );
    expect(
      screen.getByTestId("coord-home.degrading.no-list")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-home.degrading.empty")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-home.strip.degraded")).toHaveTextContent(
      "degraded –"
    );
  });

  it("does not give an exact cleared count on a stale block", async () => {
    await renderWith(
      doorBody({
        degradations: {
          state: "stale",
          headline: "unknown",
          open: [],
          recently_cleared: [{ id: "alert:3", plane: "disk" }],
        },
      })
    );
    expect(
      screen.getByTestId("coord-home.degrading.cleared-count")
    ).toHaveTextContent("–");
  });

  // coord's own shape for a stale block that carries an open row: the
  // headline is `degraded`, and its reason explains the HEADLINE. Printing
  // that reason after "Incomplete view —" gave the operator a false cause.
  it("words a stale block's gap from its stale watchers, never from the degraded headline's reason", async () => {
    const base = doorBody();
    await renderWith(
      doorBody({
        degradations: {
          ...(base.degradations as Record<string, unknown>),
          state: "stale",
          headline: "degraded",
          headline_reason: "at least one operator-plane degradation is open",
          planes: {
            runner: {
              fresh: true,
              watchers: [{ name: "health_ledger", state: "fresh" }],
            },
            merge_train: {
              fresh: false,
              watchers: [
                {
                  name: "stuck_pr_watcher",
                  state: "stale",
                  reason: "no_successful_tick",
                },
              ],
            },
          },
        },
      })
    );
    const line = screen.getByTestId("coord-home.degrading.incomplete");
    expect(line).toHaveTextContent(
      /^Incomplete view — not every watcher is fresh \(merge train\)\. The rows below are real; there may be others\.$/
    );
    expect(line).not.toHaveTextContent(/at least one/);
    // The open row is still shown: positive facts survive a stale block.
    expect(screen.getByText("A runner stopped answering")).toBeInTheDocument();
  });

  // coord's unknown headline names the partial source by its raw id
  // ("source `fleet_drain` was not fully read"). R8: the sentence names it in
  // words, from the does_not_know row coord served beside the block, and
  // coord's own reason is kept for the title only.
  it("names a partial source in words on the unknown headline, keeping coord's reason for the title", async () => {
    const base = doorBody();
    await renderWith(
      doorBody({
        degradations: {
          state: "stale",
          headline: "unknown",
          headline_reason: "source `fleet_drain` was not fully read",
          open: [],
          recently_cleared: [],
          planes: {},
        },
        does_not_know: [
          ...(base.does_not_know as unknown[]),
          { source: "fleet_drain", state: "could_not_read", error: "timeout" },
        ],
      })
    );
    const line = screen.getByTestId("coord-home.degrading.incomplete");
    expect(line).toHaveTextContent(
      /^Incomplete view — not fully read: machine drains\. The rows below are real; there may be others\.$/
    );
    expect(line).not.toHaveTextContent(/fleet_drain|`/);
    expect(line).toHaveAttribute(
      "title",
      "source `fleet_drain` was not fully read"
    );
  });

  // coord's disk plane has NO watcher: its `fresh` is whether the fleet
  // roster was read with its resource dimension scraped. A failed reading is
  // not a watcher, and neither the gap sentence nor the plane line may say so.
  it("words a disk reading that could not be taken without blaming a watcher", async () => {
    const base = doorBody();
    await renderWith(
      doorBody({
        degradations: {
          ...(base.degradations as Record<string, unknown>),
          state: "stale",
          headline: "degraded",
          headline_reason: "at least one operator-plane degradation is open",
          planes: {
            runner: {
              fresh: true,
              watchers: [{ name: "health_ledger", state: "fresh" }],
            },
            disk: { watchers: [], fresh: false, detection_bound_secs: 180 },
          },
        },
        does_not_know: [
          ...(base.does_not_know as unknown[]),
          {
            source: "fleet_health roster",
            state: "stale",
            error:
              "resource_scrape_up=false, credential_dark_scrape_up=true — a dimension of the roster could not be read",
          },
        ],
      })
    );
    const line = screen.getByTestId("coord-home.degrading.incomplete");
    expect(line).toHaveTextContent(
      /^Incomplete view — the disk reading could not be taken; not fully read: machines in the fleet\. The rows below are real; there may be others\.$/
    );
    expect(line).not.toHaveTextContent(/watcher/);
    const planesLine = screen.getByTestId("coord-home.degrading.planes");
    expect(planesLine).toHaveTextContent(
      "disk: no watcher; its reading could not be taken"
    );
    expect(planesLine).not.toHaveTextContent(/no watcher reported/);
  });

  it.each([
    [
      1,
      "Coord counted 1 decision for you but did not serve it; open Questions.",
    ],
    [
      3,
      "Coord counted 3 decisions for you but served none of them; open Questions.",
    ],
    [
      null,
      "Coord counted an unknown number of decisions for you but served none of them; open Questions.",
    ],
  ])(
    "words %p decisions counted but not served in proper English",
    async (total, sentence) => {
      await renderWith(
        doorBody({
          needs_me: { state: "read", total, omitted: total, items: [] },
        })
      );
      expect(
        screen.getByTestId("coord-home.needs-you.unserved")
      ).toHaveTextContent(sentence);
    }
  );

  it("shows merge-train watcher freshness under Degrading", async () => {
    await renderWith(
      doorBody({
        degradations: {
          state: "stale",
          headline: "unknown",
          open: [],
          planes: {
            merge_train: {
              fresh: false,
              watchers: [
                {
                  name: "train_health",
                  state: "stale",
                  reason: "no_successful_tick",
                },
              ],
            },
          },
        },
      })
    );
    expect(screen.getByTestId("coord-home.degrading.planes")).toHaveTextContent(
      "merge train: 1 of 1 watcher not fresh — no successful run on record"
    );
    expect(
      screen.getByTestId("coord-home.degrading.planes")
    ).not.toHaveTextContent("train_health");
  });

  it("words watcher freshness at the last good read when a poll failed", async () => {
    await renderWith(
      doorBody({
        degradations: {
          state: "read",
          headline: "none",
          open: [],
          recently_cleared: [],
          planes: {
            merge_train: {
              fresh: true,
              watchers: [{ name: "train_health", state: "fresh" }],
            },
          },
        },
      })
    );
    expect(
      screen.queryByTestId("coord-home.degrading.planes.stale")
    ).not.toBeInTheDocument();
    httpFetch.mockRejectedValueOnce(new TypeError("coord unreachable"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-home.refresh"));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-home.degrading.planes.stale")
      ).toHaveTextContent(/Watcher freshness at the last good read/)
    );
    const line = screen.getByText(/merge train: its watcher is fresh/);
    expect(line).toHaveAttribute("title", "train_health: fresh");
  });

  it("never prints '1 shown of 0' when coord's total is below what it listed", async () => {
    await renderWith(
      doorBody({
        needs_me: {
          state: "read",
          total: 0,
          omitted: 0,
          items: [{ id: "q-1", fork: "Pick one" }],
        },
      })
    );
    expect(screen.getByTestId("coord-home.needs-you.count")).toHaveTextContent(
      "1 shown of an unknown number"
    );
    expect(screen.getByTestId("coord-home.strip.needs-you")).toHaveTextContent(
      "needs you –"
    );
  });

  it.each([
    [
      "on_track error + initiative error",
      {
        on_track: {
          state: "could_not_read",
          error: "the work_units sub-read stalled",
          initiative: {
            state: "unparseable",
            error: "frontmatter parser stalled on line 3",
          },
        },
      },
    ],
    [
      "initiative reason",
      {
        on_track: {
          state: "could_not_read",
          initiative: {
            state: "read",
            alignment: "no_live_initiative",
            reason: "the initiative is stalled pending review",
          },
        },
      },
    ],
  ])(
    "keeps 'stalled' out of coord free text: %s, and the correctness reason",
    async (_label, overrides) => {
      await renderWith(
        doorBody({
          ...overrides,
          correctness: {
            state: "unknown",
            reason: "verification source stalled",
          },
        })
      );
      // A reason other than coord's "no source" one is an unread reading,
      // not a missing source, so the row says it was not read.
      fireEvent.click(
        screen.getByText(
          "Not known — coord gave no reading of trust calibration."
        )
      );
      expect(screen.getByTestId("coord-home.correct")).toHaveTextContent(
        "verification source without recorded change"
      );
      expect(screen.getByTestId("coord-home.on-track")).toHaveTextContent(
        /without recorded change/
      );
      expect(document.body.textContent ?? "").not.toMatch(/stalled/i);
    }
  );

  it.each([
    ["unknown", /not known yet/],
    [undefined, /not known yet/],
    ["unsupported", /coord cannot retire them/],
  ])(
    "renders retirement %p honestly, never as supported",
    async (retirement, text) => {
      await renderWith(
        doorBody({
          needs_me: {
            state: "read",
            total: 0,
            omitted: 0,
            items: [],
            retirement,
          },
        })
      );
      expect(
        screen.getByTestId("coord-home.needs-you.retirement")
      ).toHaveTextContent(text);
    }
  );

  it("says nothing about retirement when coord says it is supported", async () => {
    await renderWith(
      doorBody({
        needs_me: {
          state: "read",
          total: 0,
          omitted: 0,
          items: [],
          retirement: "supported",
        },
      })
    );
    expect(
      screen.queryByTestId("coord-home.needs-you.retirement")
    ).not.toBeInTheDocument();
  });

  it("renders a gate item as an approval, answered on the gates page", async () => {
    await renderWith(
      doorBody({
        needs_me: {
          state: "read",
          total: 1,
          omitted: 0,
          retirement: "supported",
          by_domain: { operator_gate: 1 },
          items: [
            {
              source: "operator_gate",
              id: "g-1",
              fork: "Deploy gate — build is an ancestor",
              options: ["mark met", "reject"],
              recommendation: null,
              if_overturned: null,
              shape: "open_question",
              blocking: {
                work_unit_slug: "2026-09-20-x",
                plan_phase: "Phase 4",
              },
              answer_at: "/admin/coord/gates",
            },
          ],
        },
      })
    );
    const needs = screen.getByTestId("coord-home.needs-you");
    // Scoped to the gate's own row: the by-domain line also says "approval".
    const row = within(needs).getByTestId("coord-home.needs-you.row");
    const badge = row.querySelector("[data-status-kind]");
    expect(badge?.textContent).toBe("✕ approval");
    expect(row).not.toHaveTextContent("open question");
    expect(
      screen.getByTestId("coord-home.needs-you.by-domain")
    ).toHaveTextContent("operator approval gate 1");
    fireEvent.click(screen.getByText("Deploy gate — build is an ancestor"));
    const expanded = within(needs).getByTestId("coord-home.needs-you.row");
    expect(expanded).not.toHaveTextContent("open question");
    expect(expanded).toHaveTextContent("Recommended: none given");
    expect(expanded).not.toHaveTextContent("Recommended: approval");
    expect(needs).toHaveTextContent("Options: mark met · reject");
    expect(needs).toHaveTextContent("Blocks: 2026-09-20-x, phase Phase 4");
    expect(screen.getByTestId("coord-home.needs-you.answer")).toHaveAttribute(
      "href",
      "/admin/coord/gates"
    );
  });

  it("names work linked to an item the initiative does not list", async () => {
    await renderWith(
      doorBody({
        on_track: {
          state: "read",
          totals: { row_count: 11, classes: CLASSES },
          groups: [],
          initiative: {
            state: "read",
            status: "live",
            alignment: "read",
            in_scope: [
              {
                text: "remote runner session access",
                key: "remote-runner",
                units: { total: 0, in_flight: 0, shipped: 0 },
              },
            ],
            unknown_key: {
              total: 2,
              in_flight: 1,
              shipped: 1,
              keys: ["old-key"],
            },
          },
        },
      })
    );
    const line = screen.getByTestId(
      "coord-home.on-track.initiative.unknown-key"
    );
    expect(line).toHaveTextContent("old-key");
    expect(line).toHaveTextContent("2 units, 1 in flight, 1 shipped");
  });

  it("shows the unknown-key line when coord gives keys but no total", async () => {
    await renderWith(
      doorBody({
        on_track: {
          state: "read",
          totals: { row_count: 11, classes: CLASSES },
          groups: [],
          initiative: {
            state: "read",
            alignment: "read",
            in_scope: [],
            unknown_key: { keys: ["old-key"] },
          },
        },
      })
    );
    expect(
      screen.getByTestId("coord-home.on-track.initiative.unknown-key")
    ).toHaveTextContent("– units");
  });

  it.each([
    [{}, true],
    [{ total: 0, in_flight: 0, shipped: 0, keys: [] }, false],
  ])("renders the unknown-key line for %j: %s", async (unknownKey, shown) => {
    await renderWith(
      doorBody({
        on_track: {
          state: "read",
          totals: { row_count: 11, classes: CLASSES },
          groups: [],
          initiative: {
            state: "read",
            alignment: "read",
            in_scope: [],
            unknown_key: unknownKey,
          },
        },
      })
    );
    const line = screen.queryByTestId(
      "coord-home.on-track.initiative.unknown-key"
    );
    if (shown) {
      expect(line).toHaveTextContent("– units, – in flight, – shipped");
      expect(line).toHaveTextContent("keys not served");
    } else {
      expect(line).toBeNull();
    }
  });

  it("shows initiative attribution when coord's alignment is read", async () => {
    await renderWith(
      doorBody({
        on_track: {
          state: "read",
          totals: { row_count: 11, classes: CLASSES },
          groups: [],
          initiative: {
            state: "read",
            status: "live",
            ends: "2026-10-31",
            alignment: "read",
            in_scope: [
              {
                text: "remote runner session access",
                key: "remote-runner",
                units: { total: 3, in_flight: 2, shipped: 1 },
              },
            ],
            unattributed: { total: 4, in_flight: 1, shipped: 3 },
          },
        },
      })
    );
    expect(
      screen.getByTestId("coord-home.on-track.initiative.alignment")
    ).toHaveTextContent("work attributed to it: 2 in flight");
    expect(
      screen.getByTestId("coord-home.on-track.initiative.in-scope")
    ).toHaveTextContent(
      "remote runner session access — 3 units, 2 in flight, 1 shipped"
    );
    expect(
      screen.getByTestId("coord-home.on-track.initiative.unattributed")
    ).toHaveTextContent("4 units, 1 in flight, 3 shipped");
  });

  it("says unknown, not 'No work units', when a read on_track serves no groups", async () => {
    await renderWith(
      doorBody({
        on_track: {
          state: "read",
          totals: { row_count: 11, classes: CLASSES },
          stall_window_secs: 1_209_600,
        },
      })
    );
    const onTrack = screen.getByTestId("coord-home.on-track");
    expect(onTrack).toHaveTextContent("no per-repo breakdown — unknown");
    expect(onTrack).not.toHaveTextContent("No work units.");
  });

  it("flags unretirable questions and unreadable options", async () => {
    await renderWith(
      doorBody({
        needs_me: {
          state: "read",
          total: 1,
          omitted: 0,
          retirement: "unsupported",
          by_domain: { repo_pull: 1 },
          items: [{ id: "q-9", fork: "Which way?", options: [{ value: 1 }] }],
        },
      })
    );
    expect(
      screen.getByTestId("coord-home.needs-you.retirement")
    ).toHaveTextContent(/condition has already resolved/);
    expect(
      screen.getByTestId("coord-home.needs-you.by-domain")
    ).toHaveTextContent("pulling a repository 1");
    fireEvent.click(screen.getByText("Which way?"));
    expect(screen.getByTestId("coord-home.needs-you")).toHaveTextContent(
      "Options: not readable"
    );
  });

  // coord#3053 serves the initiative inside a could_not_read on_track block
  // when the unit read failed, with alignment `unknown` for THAT reason.
  it("says the initiative's work was not counted when the unit read failed", async () => {
    await renderWith(
      doorBody({
        on_track: {
          state: "could_not_read",
          error: "the dependency DAG hit its node ceiling",
          initiative: {
            state: "read",
            status: "live",
            ends: "2026-10-31",
            alignment: "unknown",
            reason:
              "work_units_could_not_read — the unit read failed, so no attribution was counted",
            in_scope: [
              {
                text: "remote runner session access",
                key: "remote-runner",
                units: null,
                reason: "work_units_could_not_read",
              },
            ],
          },
        },
      })
    );
    const alignment = screen.getByTestId(
      "coord-home.on-track.initiative.alignment"
    );
    expect(alignment).toHaveTextContent(
      "work attributed to it: the work units could not be read, so it was not counted"
    );
    expect(alignment).not.toHaveTextContent("not yet attributable");
  });

  it("renders the initiative's in-scope items verbatim, alignment not yet attributable", async () => {
    await renderWith(doorBody());
    expect(
      screen.getByTestId("coord-home.on-track.initiative.in-scope")
    ).toHaveTextContent("remote runner session access");
    expect(
      screen.getByTestId("coord-home.on-track.initiative.alignment")
    ).toHaveTextContent("not yet attributable");
  });

  it("renders Correct? as not measured, in the unknown palette", async () => {
    await renderWith(doorBody());
    const row = screen.getByTestId("coord-home.correct.row");
    expect(row).toHaveTextContent("Not measured — no trust-calibration source");
    expect(row.querySelector("[data-attention]")).toHaveAttribute(
      "data-attention",
      "waiting"
    );
  });

  // R8: the tenant's UUID is a raw id — the title, never the strip's text.
  it("shows the tenant name in the strip, its id only in the title", async () => {
    await renderWith(doorBody());
    expect(screen.getByTestId("coord-home.strip")).toHaveTextContent(
      "Tenant: Qontinui"
    );
    expect(screen.getByTestId("coord-home.strip")).not.toHaveTextContent(
      TENANT_ID
    );
    expect(screen.getByTestId("coord-home.strip.tenant")).toHaveAttribute(
      "title",
      TENANT_ID
    );
  });

  // R8: a degradation's subject id (a device UUID beside its hostname) is a
  // raw id — on the expanded detail's last line only.
  it("names a degradation's subject on the row and keeps its id for the raw line", async () => {
    await renderWith(doorBody());
    const row = screen.getByTestId("coord-home.degrading.degrading");
    expect(row).toHaveTextContent("box-1");
    expect(row).not.toHaveTextContent("dev-1");
    fireEvent.click(screen.getByText("A runner stopped answering"));
    expect(
      within(row).getByTestId("coord-home.degrading.raw")
    ).toHaveTextContent(/^alert:7 · subject dev-1 · agent:runner_restart$/);
  });

  // The proxy's own 504 carries a Refusal envelope; its raw JSON is not a
  // reason. The strip's "Last failure:" renders the refusal's sentence.
  it("words a failed poll's 504 refusal as its sentence, not its JSON", async () => {
    await renderWith(doorBody());
    httpFetch.mockResolvedValueOnce(
      new Response(
        '{"error":"GATEWAY_TIMEOUT","message":"timeout waiting for coord","refusal":{"code":"upstream_timeout","detail":"timeout waiting for coord","discriminator":"coord_timeout","glossary_terms":["coord"],"next_action":{"kind":"retry_later"},"observed_at":"2026-10-27T16:27:56.834400+00:00","source":"web_backend"}}',
        { status: 504 }
      )
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-home.refresh"));
    });
    const strip = screen.getByTestId("coord-home.strip");
    await waitFor(() => expect(strip).toHaveAttribute("data-stale", "true"));
    expect(strip).toHaveTextContent(
      "Last failure: A service this operation depends on did not answer in time (coord_timeout). Try again later."
    );
    expect(strip).not.toHaveTextContent(/GATEWAY_TIMEOUT|\{|later\.\./);
  });

  it("shows a degradation's onset and keeps the cleared count visible while collapsed", async () => {
    await renderWith(doorBody());
    const deg = screen.getByTestId("coord-home.degrading");
    expect(
      within(deg).getByText("A runner stopped answering")
    ).toBeInTheDocument();
    expect(deg).toHaveTextContent("since ");
    expect(
      screen.getByTestId("coord-home.degrading.cleared-count")
    ).toHaveTextContent("1");
    expect(screen.queryByText("Disk was nearly full")).not.toBeInTheDocument();
  });

  it("lists what the view does not know, with not-read sources marked", async () => {
    await renderWith(doorBody());
    const rows = screen.getAllByTestId("coord-home.does-not-know.row");
    expect(rows).toHaveLength(3);
    expect(screen.getByTestId("coord-home.does-not-know")).toHaveTextContent(
      "1 of 3 sources not read"
    );
  });

  // R8: coord's `source` strings are its own identifiers. The row says what
  // the source is in words; the raw id is in the title and, once expanded,
  // in the detail's last line only.
  it("labels each source in words, keeping coord's raw ids off the collapsed rows", async () => {
    const base = doorBody();
    await renderWith(
      doorBody({
        degradations: {
          ...(base.degradations as Record<string, unknown>),
          state: "stale",
          planes: {
            merge_train: {
              fresh: false,
              watchers: [
                {
                  name: "stuck_pr_watcher",
                  state: "stale",
                  reason: "no_successful_tick",
                },
              ],
            },
          },
        },
        does_not_know: [
          ...(base.does_not_know as unknown[]),
          {
            source: "watcher:stuck_pr_watcher",
            state: "stale",
            freshness_bound_secs: 300,
            error: "no_successful_tick",
          },
          {
            source: "fleet_drain",
            state: "could_not_read",
            error: "timeout",
          },
        ],
      })
    );
    const dnk = screen.getByTestId("coord-home.does-not-know");
    for (const [label, raw] of [
      ["Work units", "work_units"],
      ["Work unit status changes", "work_unit_status_history"],
      [
        "Decisions waiting on you",
        "needs_me (agent_questions operator audience + operator gates)",
      ],
      ["Watcher feeding merge train", "watcher:stuck_pr_watcher"],
      ["Machine drains", "fleet_drain"],
    ]) {
      expect(within(dnk).getByText(label)).toHaveAttribute("title", raw);
    }
    // Nothing collapsed prints a raw id, a reason token or the old shorthand.
    expect(dnk.textContent ?? "").not.toMatch(
      /work_unit|watcher:|needs_me|fleet_drain|no_successful_tick|bound –|excluded –/
    );
    const watcherRow = within(dnk)
      .getByText("Watcher feeding merge train")
      .closest('[data-testid="coord-home.does-not-know.row"]') as HTMLElement;
    expect(watcherRow).toHaveTextContent(
      "no successful run on record · freshness bound 5m · exclusions not stated"
    );
    expect(watcherRow).not.toHaveTextContent(/may be up to/);
    fireEvent.click(within(dnk).getByText("Watcher feeding merge train"));
    expect(
      within(watcherRow).getByTestId("coord-home.does-not-know.raw")
    ).toHaveTextContent("watcher:stuck_pr_watcher · no_successful_tick");
    // coord's error chain is not on the collapsed row; expanded, it is
    // quoted on the detail's last line only.
    const drainRow = within(dnk)
      .getByText("Machine drains")
      .closest('[data-testid="coord-home.does-not-know.row"]') as HTMLElement;
    expect(drainRow).toHaveTextContent(
      "coord reported an error · maximum age not stated · exclusions not stated"
    );
    expect(drainRow).not.toHaveTextContent(/timeout/);
    fireEvent.click(within(dnk).getByText("Machine drains"));
    expect(drainRow).toHaveTextContent(
      "Coord reported an error; it is quoted on the last line."
    );
    expect(
      within(drainRow).getByTestId("coord-home.does-not-know.raw")
    ).toHaveTextContent(/^fleet_drain · timeout$/);
  });

  // A watcher row's `as_of` is the watcher's last SUCCESSFUL run (coord
  // copies it from the plane), not a time coord read anything.
  it("captions a watcher row's time as its last successful run, and a source's as its read", async () => {
    const base = doorBody();
    await renderWith(
      doorBody({
        does_not_know: [
          ...(base.does_not_know as unknown[]),
          {
            source: "watcher:merge_scheduler.dispatch",
            state: "stale",
            as_of: "2026-09-30T09:00:00Z",
            freshness_bound_secs: 90,
            error: "last_success_older_than_3x_interval",
          },
        ],
      })
    );
    const dnk = screen.getByTestId("coord-home.does-not-know");
    const rows = within(dnk).getAllByTestId("coord-home.does-not-know.row");
    const watcherRow = rows[rows.length - 1];
    expect(watcherRow).toHaveTextContent(
      "last run is overdue · last success older than its 1m freshness bound · exclusions not stated"
    );
    expect(
      watcherRow.querySelector('[title^="Last successful run "]')
    ).not.toBeNull();
    expect(watcherRow.querySelector('[title^="Read "]')).toBeNull();
    expect(rows[0].querySelector('[title^="Read "]')).not.toBeNull();
  });

  // `useVisiblePoll`'s single-flight guard covers the poll only; a press
  // never passes through it. The hook's own guard makes a press during a read
  // JOIN that read: one request, and the button busy until it lands.
  it("joins the outstanding read when refresh is pressed, instead of issuing a second", async () => {
    let deliver!: (res: Response) => void;
    httpFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        deliver = resolve;
      })
    );
    render(<CoordHomePage />);
    await waitFor(() => expect(httpFetch).toHaveBeenCalledTimes(1));
    const button = screen.getByTestId("coord-home.refresh");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(httpFetch).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      deliver(jsonResponse(doorBody()));
    });
    await waitFor(() =>
      expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
    );
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    // Nothing is out any more, so the next press reads again.
    httpFetch.mockResolvedValueOnce(jsonResponse(doorBody()));
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(httpFetch).toHaveBeenCalledTimes(2));
  });

  it("keeps the last good render on a failed poll and says it is stale", async () => {
    await renderWith(doorBody());
    httpFetch.mockRejectedValueOnce(new TypeError("coord unreachable"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-home.refresh"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("coord-home.strip")).toHaveAttribute(
        "data-stale",
        "true"
      )
    );
    expect(screen.getByTestId("coord-home.strip")).toHaveTextContent(
      /Last refresh failed/
    );
    expect(screen.getByText("A runner stopped answering")).toBeInTheDocument();
  });
});

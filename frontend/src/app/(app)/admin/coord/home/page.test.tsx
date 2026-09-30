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

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => httpGet(...args) },
}));

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
  httpGet.mockResolvedValue(body);
  render(<CoordHomePage />);
  await waitFor(() => expect(httpGet).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
  );
}

describe("/admin/coord/home", () => {
  beforeEach(() => {
    httpGet.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the project-state proxy, and nothing else", async () => {
    await renderWith(doorBody());
    expect(httpGet.mock.calls.map((c) => c[0])).toEqual([
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
    httpGet.mockReturnValue(new Promise(() => {}));
    render(<CoordHomePage />);
    for (const id of REGIONS)
      expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId("coord-home.strip.health")).toHaveAttribute(
      "data-health-level",
      "amber"
    );
    expect(screen.queryByText("Nothing needs you")).not.toBeInTheDocument();
  });

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
    fireEvent.click(within(dnk).getByText("work_unit_status_history"));
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

    httpGet.mockRejectedValueOnce(new Error("coord unreachable"));
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
      "merge train: 1 of 1 watcher not fresh — has not completed a run"
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
    httpGet.mockRejectedValueOnce(new Error("coord unreachable"));
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
      fireEvent.click(
        screen.getByText("Not measured — no trust-calibration source")
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
    expect(needs).toHaveTextContent("approval");
    expect(
      screen.getByTestId("coord-home.needs-you.by-domain")
    ).toHaveTextContent("operator approval gate 1");
    fireEvent.click(screen.getByText("Deploy gate — build is an ancestor"));
    expect(needs).toHaveTextContent("Options: mark met · reject");
    expect(needs).toHaveTextContent("Blocks: 2026-09-20-x, phase Phase 4");
    expect(screen.getByTestId("coord-home.needs-you.answer")).toHaveAttribute(
      "href",
      "/admin/coord/gates"
    );
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

  it("shows the tenant name and id in the strip", async () => {
    await renderWith(doorBody());
    expect(screen.getByTestId("coord-home.strip")).toHaveTextContent(
      `Tenant: Qontinui (${TENANT_ID})`
    );
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

  it("keeps the last good render on a failed poll and says it is stale", async () => {
    await renderWith(doorBody());
    httpGet.mockRejectedValueOnce(new Error("coord unreachable"));
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

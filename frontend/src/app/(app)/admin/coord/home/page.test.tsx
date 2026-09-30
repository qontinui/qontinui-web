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
    expect(document.body.textContent ?? "").not.toMatch(/stalled/i);
    expect(onTrack).toHaveTextContent("no recorded change in 14 days");
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
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId("coord-home.does-not-know")).toHaveTextContent(
      "1 of 2 sources not read"
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

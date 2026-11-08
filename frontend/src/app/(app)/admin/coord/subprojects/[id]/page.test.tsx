/**
 * `/admin/coord/subprojects/[id]` — the first screen answers "why has this
 * stopped, and what would restart it?" (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * D12 and Phase 8 (d)): every reason with its references linked where they
 * live, every source coord could not read named, the next steps with their
 * provenance, and the members — sessions open AND closed, gates open first.
 * A 404 is coord's answer; a read that did not land is UNKNOWN (R6).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SubprojectDetailResponse } from "@/lib/api/operations/coordSubprojects";

const fetchSubproject = vi.fn();
const updateSubproject = vi.fn();
vi.mock("@/lib/api/operations/coordSubprojects", () => ({
  fetchSubproject: (...args: unknown[]) => fetchSubproject(...args),
  updateSubproject: (...args: unknown[]) => updateSubproject(...args),
  fetchSubprojects: vi.fn(() => new Promise(() => {})),
  mergeSubproject: vi.fn(),
  changeSubprojectMember: vi.fn(),
  continueSubproject: vi.fn(),
}));

let mockAdmin = false;
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: mockAdmin }),
}));

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
let mockId = ID;
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: mockId }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import SubprojectDetailPage from "./page";

const UNIT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SUBPROJECT = "0b1c2d3e-4f50-4617-8899-aabbccddeeff";

function detail(
  over: Partial<SubprojectDetailResponse> = {}
): SubprojectDetailResponse {
  return {
    subproject: {
      id: ID,
      slug: "dashboards",
      title: "dashboards-and-presentation",
      title_source: "explicit",
      goal: "Presentation spaces for the console",
      origin: "operator_prompt",
      status: "open",
      merged_into: null,
      root_agent_session_id: "dede6a19-0000-4000-8000-000000000001",
      created_at: "2026-10-23T09:00:00Z",
      updated_at: "2026-11-08T10:49:00Z",
      closed_at: null,
      headline: "stalled",
      top_reason: null,
      reasons_count: 2,
      sessions: { live: 0, total: 2 },
      work_units: { total: 1, open: 1 },
      last_activity_at: "2026-11-08T10:49:00Z",
      verdict_as_of: "2026-11-08T15:00:00Z",
      next_steps_note: "Adopt runner#2569 first.",
      next_steps_note_by: "operator",
      next_steps_note_at: "2026-11-08T12:00:00Z",
    },
    verdict: {
      headline: "stalled",
      reasons: [
        {
          kind: "gate_dependency_unowned",
          summary: "The resume gate waits on a PR whose author session closed",
          refs: [
            { type: "gate", id: "132fc978", label: "resume gate" },
            {
              type: "pr",
              id: "qontinui/qontinui-runner#2569",
              label: "runner#2569",
            },
            { type: "session", id: "6c3e0aac", label: "dashboards-27-10" },
            { type: "work_unit", id: UNIT_ID, label: "spawn-time effort" },
            {
              type: "subproject",
              id: OTHER_SUBPROJECT,
              label: "effort profiles",
            },
          ],
          detail: null,
        },
        {
          kind: "abandoned",
          summary: "A member unit is unfinished and no member session is live",
          refs: [],
          detail: null,
        },
      ],
      sources: [
        {
          source: "gates",
          state: "read",
          as_of: "2026-11-08T15:00:00Z",
          error: null,
        },
        {
          source: "session_obligations",
          state: "could_not_read",
          as_of: null,
          error: "deadline exceeded",
        },
      ],
      as_of: "2026-11-08T15:00:00Z",
    },
    next_steps: [
      {
        source: "note",
        text: "Adopt runner#2569 first.",
        refs: [],
        remedy_kind: null,
      },
      {
        source: "remedy",
        text: "Spawn a session to adopt qontinui/qontinui-runner#2569",
        refs: [
          {
            type: "pr",
            id: "qontinui/qontinui-runner#2569",
            label: "runner#2569",
          },
        ],
        remedy_kind: "spawn_to_adopt_pr",
      },
    ],
    sessions: [
      {
        agent_session_id: "6c3e0aac-0000-4000-8000-000000000001",
        coord_session_id: null,
        allocation_agent_id: null,
        pending: false,
        name: "dashboards-27-10",
        device_id: null,
        device_name: "spaceship",
        liveness: "closed",
        session_status: null,
        finish_reason: null,
        first_seen: "2026-10-27T09:00:00Z",
        last_seen: "2026-11-08T10:49:00Z",
        closed_at: "2026-11-08T10:49:00Z",
        joined_via: "operator_move",
        via_ref: null,
        added_at: "2026-11-08T13:00:00Z",
      },
      {
        agent_session_id: null,
        coord_session_id: null,
        allocation_agent_id: "01a1bbe4-53fb-7101-ac6b-57bc45151491",
        pending: true,
        name: null,
        device_id: null,
        device_name: null,
        liveness: "unknown",
        session_status: null,
        finish_reason: null,
        first_seen: null,
        last_seen: null,
        closed_at: null,
        joined_via: "spawn",
        via_ref: null,
        added_at: "2026-11-08T15:05:00Z",
      },
    ],
    work_units: [
      {
        work_unit_id: UNIT_ID,
        slug: "2026-10-27-spawn-time-effort",
        title: "Spawn-time effort profiles",
        status: "in_progress",
        project_state_class: "waiting_on_gate",
        phases_remaining: null,
        joined_via: "auto_attach",
      },
    ],
    gates: [
      {
        gate_id: "aaaaaaaa-0000-4000-8000-000000000001",
        phase_name: "Phase 4",
        predicate_kind: "pr_merged",
        verdict: "cleared",
        attribution: "proven",
        registered_by_session: null,
        mover: { state: "landed", summary: "merged" },
        continuation_state: null,
      },
      {
        gate_id: "132fc978-0000-4000-8000-000000000001",
        phase_name: "Phase 5 resume",
        predicate_kind: "pr_merged",
        verdict: "pending",
        attribution: "uncertain",
        registered_by_session: null,
        mover: {
          state: "not_watched",
          summary: "runner#2569's author session closed",
        },
        continuation_state: "never_dispatched",
      },
    ],
    prs: [
      {
        repo: "qontinui/qontinui-runner",
        number: 2569,
        state: "open",
        author_agent_session_id: null,
        url: null,
      },
    ],
    history: [
      {
        at: "2026-11-08T13:00:00Z",
        event: "member_moved",
        detail: { by: "operator" },
      },
    ],
    ...over,
  };
}

describe("/admin/coord/subprojects/[id]", () => {
  beforeEach(() => {
    fetchSubproject.mockReset();
    updateSubproject.mockReset();
    mockAdmin = false;
    mockId = ID;
  });

  it("answers why it stopped first: the headline, every reason, and refs linked where they live", async () => {
    fetchSubproject.mockResolvedValue(detail());
    render(<SubprojectDetailPage />);
    const why = await screen.findByTestId("coord-subproject-why");
    expect(why).toHaveTextContent(
      "Stalled — The resume gate waits on a PR whose author session closed"
    );
    expect(why).toHaveTextContent("Waiting on work nobody is doing");
    expect(why).toHaveTextContent("Unfinished work with no live session");
    const hrefs = within(why)
      .getAllByTestId("subproject-ref")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/admin/coord/gates?gate=132fc978",
      "https://github.com/qontinui/qontinui-runner/pull/2569",
      "/sessions/6c3e0aac",
      "/admin/coord/work-units/2026-10-27-spawn-time-effort",
      `/admin/coord/subprojects/${OTHER_SUBPROJECT}`,
    ]);
  });

  it("names every source the live verdict could not read", async () => {
    fetchSubproject.mockResolvedValue(detail());
    render(<SubprojectDetailPage />);
    const unread = await screen.findByTestId("coord-subproject-unread-sources");
    expect(unread).toHaveTextContent(
      "session obligations could not be read — deadline exceeded"
    );
    expect(unread).not.toHaveTextContent(/^gates/);
  });

  it("lists the next steps with where each came from", async () => {
    fetchSubproject.mockResolvedValue(detail());
    render(<SubprojectDetailPage />);
    const steps = await screen.findByTestId("coord-subproject-next-steps");
    expect(steps).toHaveTextContent(
      "Note: Adopt runner#2569 first. (by operator"
    );
    expect(steps).toHaveTextContent(
      "To restart it: Spawn a session to adopt the pull request — Spawn a session to adopt qontinui/qontinui-runner#2569"
    );
  });

  it("lists sessions open AND closed, a pending spawn first, and a NULL work status as unknown", async () => {
    fetchSubproject.mockResolvedValue(detail());
    render(<SubprojectDetailPage />);
    const rows = await screen.findAllByTestId("coord-subproject-session-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Pending");
    expect(rows[1]).toHaveTextContent("Closed");
    expect(rows[1]).toHaveTextContent("work status not recorded");
  });

  it("lists gates open first, the one nothing is moving on top", async () => {
    fetchSubproject.mockResolvedValue(detail());
    render(<SubprojectDetailPage />);
    const rows = await screen.findAllByTestId("coord-subproject-gate-row");
    expect(rows[0]).toHaveTextContent("Nothing moving it");
    expect(rows[0]?.querySelector("[data-status-kind]")).toHaveAttribute(
      "data-status-kind",
      "not_watched"
    );
    expect(rows[1]).toHaveTextContent("Cleared");
    expect(screen.getByTestId("coord-subproject-gates")).toHaveTextContent(
      "1 open of 2"
    );
  });

  it("shows the work units with phases left unknown, never none, and the PRs", async () => {
    fetchSubproject.mockResolvedValue(detail());
    render(<SubprojectDetailPage />);
    expect(
      await screen.findByTestId("coord-subproject-unit-row")
    ).toHaveTextContent("waiting on a gate · phases left unknown");
    expect(screen.getByTestId("coord-subproject-pr-row")).toHaveTextContent(
      "#2569"
    );
  });

  it("says coord has no such subproject on a 404 — an answer, not an outage", async () => {
    fetchSubproject.mockRejectedValue(
      new Error(
        `GET /api/v1/operations/subprojects/${ID} failed: 404 - {"error":"subproject_not_found"}`
      )
    );
    render(<SubprojectDetailPage />);
    expect(
      await screen.findByTestId("coord-subproject-not-found")
    ).toHaveTextContent(`coord has no subproject ${ID} in this project`);
    expect(
      screen.queryByTestId("coord-subproject-unknown")
    ).not.toBeInTheDocument();
  });

  it("is UNKNOWN, not missing, when the read never lands", async () => {
    fetchSubproject.mockRejectedValue(
      new Error(
        `GET /api/v1/operations/subprojects/${ID} failed: 502 - {"error":"BAD_GATEWAY"}`
      )
    );
    render(<SubprojectDetailPage />);
    expect(
      await screen.findByTestId("coord-subproject-unknown")
    ).toHaveTextContent("Whether it exists, and where it stands, is unknown.");
    expect(
      screen.queryByTestId("coord-subproject-not-found")
    ).not.toBeInTheDocument();
  });

  it("keeps the last good read across a failed re-read, and says it is not current", async () => {
    fetchSubproject.mockResolvedValueOnce(detail());
    render(<SubprojectDetailPage />);
    await screen.findByTestId("coord-subproject-actions");
    fetchSubproject.mockRejectedValue(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByTestId("coord-subproject-refresh"));
    const stale = await screen.findByTestId("coord-subproject-stale");
    expect(stale).toHaveTextContent(/^The latest read failed/);
    expect(stale).toHaveTextContent(/Everything below is the last good read/);
    expect(stale).toHaveTextContent(/not a current one\.$/);
    // The record stays on screen; the page is not UNKNOWN.
    expect(screen.getByTestId("coord-subproject-actions")).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-subproject-unknown")
    ).not.toBeInTheDocument();
  });

  it("never shows one subproject's record under another's id", async () => {
    fetchSubproject.mockImplementation((id: string) =>
      id === ID ? Promise.resolve(detail()) : new Promise(() => {})
    );
    const { rerender } = render(<SubprojectDetailPage />);
    await screen.findByTestId("coord-subproject-actions");
    mockId = OTHER_SUBPROJECT;
    rerender(<SubprojectDetailPage />);
    // The new id is being read: its page is loading, not the old record.
    await waitFor(() =>
      expect(
        screen.queryByTestId("coord-subproject-actions")
      ).not.toBeInTheDocument()
    );
    expect(
      screen.queryByText("dashboards-and-presentation")
    ).not.toBeInTheDocument();
    expect(fetchSubproject).toHaveBeenLastCalledWith(
      OTHER_SUBPROJECT,
      expect.anything()
    );
  });

  it("does not carry one subproject's failed read onto the next", async () => {
    fetchSubproject.mockImplementation((id: string) =>
      id === ID
        ? Promise.reject(
            new Error(
              `GET /api/v1/operations/subprojects/${ID} failed: 502 - {"error":"BAD_GATEWAY"}`
            )
          )
        : new Promise(() => {})
    );
    const { rerender } = render(<SubprojectDetailPage />);
    await screen.findByTestId("coord-subproject-unknown");
    mockId = OTHER_SUBPROJECT;
    rerender(<SubprojectDetailPage />);
    await waitFor(() =>
      expect(
        screen.queryByTestId("coord-subproject-unknown")
      ).not.toBeInTheDocument()
    );
    expect(
      screen.queryByTestId("coord-subproject-not-found")
    ).not.toBeInTheDocument();
  });

  it("tells a door that is not deployed yet from a missing subproject", async () => {
    fetchSubproject.mockRejectedValue(
      new Error(
        `GET /api/v1/operations/subprojects/${ID} failed: 404 - {"error":"no_such_route","path":"/coord/subprojects/${ID}"}`
      )
    );
    render(<SubprojectDetailPage />);
    expect(
      await screen.findByTestId("coord-subproject-unknown")
    ).toHaveTextContent("does not serve subprojects yet");
  });

  it("shows the levers to an admin only", async () => {
    fetchSubproject.mockResolvedValue(detail());
    const { unmount } = render(<SubprojectDetailPage />);
    const actions = await screen.findByTestId("coord-subproject-actions");
    expect(
      within(actions).queryByTestId("coord-subproject-continue")
    ).not.toBeInTheDocument();
    expect(actions).toHaveTextContent("administrator only");
    unmount();

    mockAdmin = true;
    render(<SubprojectDetailPage />);
    const adminActions = await screen.findByTestId("coord-subproject-actions");
    for (const id of [
      "coord-subproject-continue",
      "coord-subproject-rename",
      "coord-subproject-goal-action",
      "coord-subproject-note-action",
      "coord-subproject-done-toggle",
      "coord-subproject-merge",
      "coord-subproject-move",
    ]) {
      expect(within(adminActions).getByTestId(id)).toBeInTheDocument();
    }
  });

  it("marks done, acknowledges it, and re-reads what coord now holds", async () => {
    mockAdmin = true;
    fetchSubproject.mockResolvedValue(detail());
    updateSubproject.mockResolvedValue({ id: ID, status: "done" });
    render(<SubprojectDetailPage />);
    fireEvent.click(await screen.findByTestId("coord-subproject-done-toggle"));
    await waitFor(() =>
      expect(updateSubproject).toHaveBeenCalledWith(ID, { status: "done" })
    );
    await waitFor(() => expect(fetchSubproject).toHaveBeenCalledTimes(2));
  });

  it("treats an archived subproject as closed: it offers Reopen, never Mark done", async () => {
    mockAdmin = true;
    const base = detail();
    fetchSubproject.mockResolvedValue(
      detail({ subproject: { ...base.subproject, status: "archived" } })
    );
    updateSubproject.mockResolvedValue({ id: ID, status: "open" });
    render(<SubprojectDetailPage />);
    const toggle = await screen.findByTestId("coord-subproject-done-toggle");
    expect(toggle).toHaveTextContent("Reopen");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(updateSubproject).toHaveBeenCalledWith(ID, { status: "open" })
    );
  });

  it("says why a reference is not linked in text a screen reader reads, not only a tooltip", async () => {
    const base = detail();
    const unknownUnit = "99999999-9999-4999-8999-999999999999";
    fetchSubproject.mockResolvedValue(
      detail({
        verdict: {
          ...base.verdict,
          reasons: [
            {
              kind: "abandoned",
              summary: "A unit nobody is working",
              refs: [
                { type: "work_unit", id: unknownUnit, label: "a stray unit" },
              ],
              detail: null,
            },
          ],
        },
      })
    );
    render(<SubprojectDetailPage />);
    const why = await screen.findByTestId("coord-subproject-why");
    const unlinked = within(why).getByTestId("subproject-ref-unlinked");
    expect(unlinked).toHaveTextContent(/^a stray unit \(not linked: .+\)$/);
    expect(unlinked.querySelector(".sr-only")).not.toBeNull();
  });

  it("keeps a refused write in view as coord's reading", async () => {
    mockAdmin = true;
    fetchSubproject.mockResolvedValue(detail());
    updateSubproject.mockRejectedValue(
      new Error(
        `PATCH /api/v1/operations/subprojects/${ID} failed: 403 - {"error":"not_coord_tenant_admin","message":"not_coord_tenant_admin"}`
      )
    );
    render(<SubprojectDetailPage />);
    fireEvent.click(await screen.findByTestId("coord-subproject-done-toggle"));
    expect(
      await screen.findByTestId("coord-subproject-done-error")
    ).toBeInTheDocument();
  });
});

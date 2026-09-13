/**
 * /admin/coord/runners — per-runner drain, readiness and session wind-down.
 *
 * Plan `2026-09-13-drained-runner-never-reaches-idle` Phase 8.
 *
 * ## What is pinned, and why each would go red
 *
 * 1. **A stale readiness report renders UNKNOWN**, never its last verdict —
 *    even a verdict that said "safe". A runner that stopped reporting may be
 *    doing anything by now.
 * 2. **An absent one names the cause** ("runner build predates this
 *    surface"), rather than reading as "no sessions".
 * 3. **A null count renders UNKNOWN, a zero renders 0.** The difference is
 *    whether an operator rebuilds a machine with live work on it.
 * 4. **A failed session read is UNKNOWN**, not the empty state.
 * 5. **Actions are gated per row kind**: finish & close on idle sessions,
 *    stop at boundary on steward/loop sessions.
 * 6. **Finish & close goes through a confirm dialog that names the session**,
 *    and only the confirm sends the request.
 * 7. **Coord's typed refusals reach the row**, by name.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const DEVICE = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd";
let search = `device=${DEVICE}`;
const routerReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({
    replace: (...a: unknown[]) => routerReplace(...a),
    push: vi.fn(),
  }),
}));

const httpGet = vi.fn();
const httpFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...a: unknown[]) => httpGet(...a),
    fetch: (...a: unknown[]) => httpFetch(...a),
  },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// The confirm dialog's `DestructiveButton` refuses untrusted clicks, and jsdom
// cannot produce a trusted one (`isTrusted` is non-configurable on real
// events). The gate itself is pinned in `components/ui/destructive-button.test.tsx`;
// here it is replaced so the flow past the confirm is testable at all — the
// same stub `members/page.cognitoGroupDelete.test.tsx` uses.
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import CoordRunnersPage from "./page";

const IDLE = {
  sessionId: "aaaaaaaa-1111-4111-8111-111111111111",
  deviceId: DEVICE,
  claudeCodeSessionId: "c1a0de00-0000-4000-8000-000000000001",
  sessionStatus: "working",
  state: "active",
  startedAt: "2026-09-13T09:00:00Z",
  spawnOrigin: "operator_terminal",
  continuationGateId: null,
  dispatchSource: null,
  repo: "qontinui-web",
};

const STEWARD = {
  sessionId: "bbbbbbbb-2222-4222-8222-222222222222",
  deviceId: DEVICE,
  claudeCodeSessionId: "5e5e5e5e-0000-4000-8000-000000000002",
  sessionStatus: "working",
  state: "active",
  startedAt: "2026-09-13T08:00:00Z",
  spawnOrigin: "steward",
  continuationGateId: null,
  dispatchSource: "coord_dispatch",
  repo: "qontinui-coord",
};

function sample(overrides: Record<string, unknown> = {}) {
  return {
    latest: [
      {
        device_id: DEVICE,
        lane: "host",
        sampled_at: "2026-09-13T10:00:00Z",
        readiness_safe: false,
        readiness_reason: "2 sessions block a restart",
        readiness_blocking: 2,
        readiness_finished: 0,
        wind_down_candidates: 0,
        wind_down_exit_stuck: 0,
        wind_down_sessions: [
          {
            claude_code_session_id: IDLE.claudeCodeSessionId,
            blocks_restart: true,
            idle_state: "idle",
            eligibility: "ineligible",
            close_eligible_at: null,
            exit_stuck: false,
            spawn_origin: "operator_terminal",
          },
          {
            claude_code_session_id: STEWARD.claudeCodeSessionId,
            blocks_restart: true,
            idle_state: "busy",
            eligibility: "ineligible",
            close_eligible_at: null,
            exit_stuck: false,
            spawn_origin: "steward",
          },
        ],
        readiness_age_secs: 20,
        readiness_state: "fresh",
        ...overrides,
      },
    ],
    count: 1,
    schema_pending: false,
  };
}

function res(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => text,
  };
}

let samplesResponse = res(200, sample());
let sessionsResponse = res(200, {
  sessions: [IDLE, STEWARD],
  nextCursor: null,
  workAxisColumnsPresent: true,
});
let controlResponse = res(202, {
  event_id: "e0e0e0e0-0000-4000-8000-000000000000",
  session_id: IDLE.sessionId,
  device_id: DEVICE,
  action: "finish_and_close",
});

beforeEach(() => {
  search = `device=${DEVICE}`;
  routerReplace.mockReset();
  samplesResponse = res(200, sample());
  sessionsResponse = res(200, {
    sessions: [IDLE, STEWARD],
    nextCursor: null,
    workAxisColumnsPresent: true,
  });
  controlResponse = res(202, {
    event_id: "e0e0e0e0-0000-4000-8000-000000000000",
    session_id: IDLE.sessionId,
    device_id: DEVICE,
    action: "finish_and_close",
  });
  httpGet.mockReset();
  httpGet.mockResolvedValue({
    devices: [{ device_id: DEVICE, hostname: "spaceship", state: "healthy" }],
  });
  httpFetch.mockReset();
  httpFetch.mockImplementation(async (url: string) => {
    if (url.includes("/control")) return controlResponse;
    if (url.includes("/fleet/drain")) return res(200, { drained: {} });
    if (url.includes("/fleet/resource-samples")) return samplesResponse;
    if (url.includes("/sessions/fleet")) return sessionsResponse;
    return res(404, "not stubbed");
  });
});

async function rows() {
  await waitFor(() =>
    expect(screen.getAllByTestId("coord-runners-session-row")).toHaveLength(2)
  );
  return screen.getAllByTestId("coord-runners-session-row");
}

async function openRow(shortId: string) {
  const row = (await rows()).find((r) => r.textContent?.includes(shortId));
  if (!row) throw new Error(`no row for ${shortId}`);
  await userEvent.click(within(row).getAllByRole("button")[0]);
  return row;
}

describe("/admin/coord/runners", () => {
  it("renders a fresh unsafe verdict, red while a human must act", async () => {
    render(<CoordRunnersPage />);
    await rows();
    const strip = screen.getByTestId("coord-runners-health");
    expect(strip).toHaveTextContent("Not safe to restart");
    expect(strip).toHaveTextContent("2 sessions block a restart");
    // The idle, undeclared session is an author-action row.
    expect(strip).toHaveAttribute("data-health-level", "red");
    expect(screen.getByTestId("coord-runners-count-blocking")).toHaveTextContent(
      "blocking 2"
    );
    expect(screen.getByTestId("coord-runners-drain-badge")).toHaveTextContent(
      "not drained"
    );
  });

  it("renders a stale readiness report as UNKNOWN, never its last verdict", async () => {
    samplesResponse = res(
      200,
      sample({ readiness_safe: true, readiness_state: "stale", readiness_age_secs: 900 })
    );
    render(<CoordRunnersPage />);
    const strip = await screen.findByTestId("coord-runners-health");
    await waitFor(() => expect(strip).toHaveTextContent("Readiness UNKNOWN"));
    expect(strip).not.toHaveTextContent("Safe to restart");
    expect(strip).toHaveAttribute("data-health-level", "amber");
    for (const id of [
      "coord-runners-count-blocking",
      "coord-runners-count-finished",
      "coord-runners-count-close-eligible",
      "coord-runners-count-exit-stuck",
    ]) {
      expect(screen.getByTestId(id)).toHaveTextContent("UNKNOWN");
    }
    // The rows' wind-down state is unknown too — no idle claim, no action.
    const row = await openRow("c1a0de00");
    expect(
      within(row).getByTestId("coord-runners-finish-close-unavailable")
    ).toHaveTextContent("readiness is not fresh");
  });

  it("names an absent readiness report as a runner build that predates the surface", async () => {
    samplesResponse = res(
      200,
      sample({
        readiness_state: "absent",
        readiness_safe: null,
        wind_down_sessions: null,
      })
    );
    render(<CoordRunnersPage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-runners-health")).toHaveTextContent(
        "readiness never reported — runner build predates this surface"
      )
    );
  });

  it("renders a null count as UNKNOWN and a zero as 0", async () => {
    samplesResponse = res(
      200,
      sample({ readiness_blocking: null, readiness_finished: 0 })
    );
    render(<CoordRunnersPage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-runners-count-blocking")).toHaveTextContent(
        "blocking UNKNOWN"
      )
    );
    expect(screen.getByTestId("coord-runners-count-finished")).toHaveTextContent(
      "finished 0"
    );
  });

  it("renders a failed session read as UNKNOWN, not as no sessions", async () => {
    sessionsResponse = res(500, "db unavailable");
    render(<CoordRunnersPage />);
    const unknown = await screen.findByTestId("coord-runners-sessions-unknown");
    expect(unknown).toHaveTextContent("Sessions UNKNOWN");
    expect(unknown).toHaveTextContent('this is not "no sessions"');
    expect(
      screen.queryByTestId("coord-runners-sessions-empty")
    ).not.toBeInTheDocument();
  });

  it("offers finish & close on an idle session and not stop at boundary", async () => {
    render(<CoordRunnersPage />);
    const row = await openRow("c1a0de00");
    expect(within(row).getByTestId("coord-runners-finish-close")).toBeInTheDocument();
    expect(
      within(row).getByTestId("coord-runners-stop-boundary-unavailable")
    ).toHaveTextContent("only steward and looping-agent sessions");
    expect(within(row).getByTestId("coord-runners-session-history")).toHaveAttribute(
      "href",
      `/sessions?device=${DEVICE}`
    );
  });

  it("offers stop at boundary on a working steward and not finish & close", async () => {
    render(<CoordRunnersPage />);
    const row = await openRow("5e5e5e5e");
    expect(within(row).getByTestId("coord-runners-stop-boundary")).toBeInTheDocument();
    expect(
      within(row).getByTestId("coord-runners-finish-close-unavailable")
    ).toHaveTextContent("the session is working");
  });

  it("confirms finish & close in a dialog naming the session, then sends it", async () => {
    render(<CoordRunnersPage />);
    const row = await openRow("c1a0de00");
    await userEvent.click(within(row).getByTestId("coord-runners-finish-close"));

    const dialog = await screen.findByTestId("coord-runners-finish-confirm");
    expect(dialog).toHaveTextContent(IDLE.claudeCodeSessionId);
    expect(dialog).toHaveTextContent("operator terminal");
    // Opening the dialog sends nothing.
    expect(
      httpFetch.mock.calls.some(([url]) => String(url).includes("/control"))
    ).toBe(false);

    await userEvent.type(
      screen.getByTestId("coord-runners-finish-reason"),
      "rebuilding the runner"
    );
    await userEvent.click(screen.getByTestId("coord-runners-finish-confirm-confirm"));

    await waitFor(() =>
      expect(
        httpFetch.mock.calls.some(([url]) => String(url).includes("/control"))
      ).toBe(true)
    );
    const [url, init] = httpFetch.mock.calls.find(([u]) =>
      String(u).includes("/control")
    ) as [string, { method: string; body: string }];
    expect(url).toContain(`/api/v1/operations/sessions/${IDLE.sessionId}/control`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      action: "finish_and_close",
      reason: "rebuilding the runner",
    });
    expect(
      await within(row).findByTestId("coord-runners-action-accepted")
    ).toHaveTextContent("Request recorded (event e0e0e0e0)");
  });

  it("renders coord's typed refusal on the row, by name", async () => {
    controlResponse = res(409, { error: "session_closed" });
    render(<CoordRunnersPage />);
    const row = await openRow("c1a0de00");
    await userEvent.click(within(row).getByTestId("coord-runners-finish-close"));
    await userEvent.click(
      await screen.findByTestId("coord-runners-finish-confirm-confirm")
    );
    const error = await within(row).findByTestId("coord-runners-action-error");
    expect(error).toHaveTextContent("already closed");
    expect(error).toHaveTextContent("(session_closed)");
  });

  it("renders a 404 session_not_found from stop at boundary", async () => {
    controlResponse = res(404, { detail: { error: "session_not_found" } });
    render(<CoordRunnersPage />);
    const row = await openRow("5e5e5e5e");
    await userEvent.click(within(row).getByTestId("coord-runners-stop-boundary"));
    const error = await within(row).findByTestId("coord-runners-action-error");
    expect(error).toHaveTextContent("no session with this id");
    const [, init] = httpFetch.mock.calls.find(([u]) =>
      String(u).includes("/control")
    ) as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ action: "stop_at_boundary" });
  });

  it("asks for a device, and reads nothing per machine, until one is chosen", async () => {
    search = "";
    render(<CoordRunnersPage />);
    expect(await screen.findByTestId("coord-runners-no-device")).toBeInTheDocument();
    expect(screen.getByTestId("coord-runners-device-picker")).toBeInTheDocument();
    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    expect(
      httpFetch.mock.calls.some(
        ([url]) =>
          String(url).includes("/fleet/resource-samples") ||
          String(url).includes("/sessions/fleet")
      )
    ).toBe(false);
  });
});

/**
 * /admin/coord/machine-maintenance — one machine, one verdict, two levers.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place`
 * Phase 7. It replaced `/admin/coord/runners`; the session wind-down tests
 * that page carried moved here with it, unchanged in what they pin.
 *
 * ## What is pinned, and why each would go red
 *
 * The verdict and the levers:
 *  1. **With nothing paused the verdict is "not yet", red** — never a calm
 *     read of a momentarily idle machine.
 *  2. **A stale verdict is UNKNOWN**, never its last answer.
 *  3. **"No CI host linked — link one"** renders for a machine with no
 *     declared host, and the link form posts the bare runner name.
 *  4. **Prepare for restart names every target** before it sends, sends the
 *     closed body with `accept_ci_queueing: false`, and on
 *     `last_matching_host` shows coord's message and resends with `true`
 *     only on the explicit "Pause anyway".
 *  5. **A lever's Resume is a PATCH of that one lever**; **Return to
 *     service** is enabled whenever a window is open and posts its reason.
 *  6. **An unreadable machines read is UNKNOWN**, not an empty fleet.
 *
 * The session wind-down (moved from the Runner Drain page):
 *  7. A stale runner readiness report renders UNKNOWN, and so does every count.
 *  8. A failed session read is UNKNOWN, not the empty state.
 *  9. Finish & close goes through a confirm naming the session; only the
 *     confirm sends, and it re-checks the live row.
 * 10. One click, one request.
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
import userEvent from "@testing-library/user-event";

const DEVICE = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd";
const WINDOW = "7d7d7d7d-0000-4000-8000-000000000001";
let search = `machine=${DEVICE}`;
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

// Hoisted so a test can flip it per case (the non-admin fallback).
const authState = vi.hoisted(() => ({ isCoordAdmin: true }));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    isCoordAdmin: authState.isCoordAdmin,
    loading: false,
    user: { id: "u" },
  }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// The confirm dialog's `DestructiveButton` refuses untrusted clicks, and jsdom
// cannot produce a trusted one. The gate itself is pinned in
// `components/ui/destructive-button.test.tsx`.
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import MachineMaintenancePage from "./page";
import { toast } from "sonner";

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

function wireWindow(overrides: Record<string, unknown> = {}) {
  return {
    id: WINDOW,
    machine_device_id: DEVICE,
    ci_host: "merytshost",
    state: "open",
    until: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    reason: "kernel update",
    opened_by: "jan@example.com",
    opened_at: new Date().toISOString(),
    closed_by: null,
    closed_at: null,
    ci_paused_at: new Date().toISOString(),
    pool_health: null,
    requested_levers: ["agent_work", "ci"],
    levers: {
      agent_work: { held: true, state: "held", detail: null },
      ci: {
        held: true,
        state: "held",
        detail: null,
        labels: [
          {
            label: "qontinui",
            repo: "qontinui/qontinui-web",
            outcome: "removed",
            detail: null,
          },
        ],
      },
    },
    ...overrides,
  };
}

function machinesBody(opts: { hosts?: string[]; window?: unknown } = {}) {
  return {
    machines: [
      {
        device_id: DEVICE,
        hostname: "merytshost",
        state: "healthy",
        ci_hosts: opts.hosts ?? ["merytshost"],
        open_window: opts.window ?? null,
      },
    ],
    unlinked_ci_hosts: [{ ci_host: "msi-wsl", open_window: null }],
  };
}

/** coord's list once msi-wsl is known to be linked to DEVICE. */
function linkedMachines() {
  return {
    machines: [
      {
        device_id: DEVICE,
        hostname: "merytshost",
        state: "healthy",
        ci_hosts: ["merytshost", "msi-wsl"],
        open_window: null,
      },
    ],
    unlinked_ci_hosts: [],
  };
}

function readinessBody(overrides: Record<string, unknown> = {}) {
  return {
    window_id: WINDOW,
    verdict: "not_yet",
    reasons: ["1 CI job running"],
    computed_at: new Date().toISOString(),
    levers_held: { agent_work: true, ci: true },
    planes: {
      agent: {
        verdict: "unknown",
        sample_age_secs: null,
        detail: "not served yet",
      },
      github_ci: {
        verdict: "not_yet",
        freshness_secs: 180,
        registrations: [
          {
            repo: "qontinui/qontinui-web",
            runner_name: "merytshost",
            status: "busy",
            last_seen_at: new Date().toISOString(),
            observed_after_pause: true,
            fresh: true,
          },
        ],
        missing_repos: [],
        detail: "",
      },
      ci_node: { verdict: "safe", active_dispatches: 0, detail: "" },
    },
    ...overrides,
  };
}

function controlCalls() {
  return httpFetch.mock.calls.filter(([url]) =>
    String(url).includes("/control")
  );
}

function calls(fragment: string, method?: string) {
  return httpFetch.mock.calls.filter(
    ([url, init]) =>
      String(url).includes(fragment) &&
      (method === undefined ||
        (init as { method?: string } | undefined)?.method === method)
  );
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

type Res = ReturnType<typeof res>;

let samplesResponse: Res;
let sessionsResponse: Res;
let machinesResponse: Res;
let readinessResponse: Res;
let windowPostResponses: (Res | Promise<Res>)[];
let patchResponse: Res;
let closeResponse: Res;
let linkResponse: Res;
let controlResponse: Res | Promise<Res>;
let drainResponse: Res;
let undrainResponse: Res;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  authState.isCoordAdmin = true;
  search = `machine=${DEVICE}`;
  routerReplace.mockReset();
  samplesResponse = res(200, sample());
  sessionsResponse = res(200, {
    sessions: [IDLE, STEWARD],
    nextCursor: null,
    workAxisColumnsPresent: true,
  });
  machinesResponse = res(200, machinesBody());
  readinessResponse = res(200, readinessBody());
  windowPostResponses = [res(201, wireWindow())];
  patchResponse = res(200, wireWindow());
  closeResponse = res(200, wireWindow({ state: "closed" }));
  linkResponse = res(201, { device_id: DEVICE, ci_hosts: ["merytshost"] });
  drainResponse = res(200, { drained: {} });
  undrainResponse = res(200, {
    device_id: DEVICE,
    drained: false,
    changed: true,
  });
  controlResponse = res(202, {
    event_id: "e0e0e0e0-0000-4000-8000-000000000000",
    session_id: IDLE.sessionId,
    device_id: DEVICE,
    action: "finish_and_close",
  });
  httpGet.mockReset();
  httpGet.mockResolvedValue({ rows: [] });
  httpFetch.mockReset();
  httpFetch.mockImplementation(
    async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (url.includes("/control")) return controlResponse;
      if (url.includes("/ci-hosts")) return linkResponse;
      if (url.includes("/readiness")) return readinessResponse;
      if (url.includes("/close")) return closeResponse;
      if (url.includes("/fleet/maintenance-window")) {
        if (method === "PATCH") return patchResponse;
        if (method === "POST")
          return windowPostResponses.shift() ?? res(500, "no more");
      }
      if (url.includes("/fleet/machines")) return machinesResponse;
      if (url.includes("/fleet/undrain")) return undrainResponse;
      if (url.includes("/fleet/drain")) return drainResponse;
      if (url.includes("/fleet/ci-runners")) return res(200, { runners: [] });
      if (url.includes("/fleet/resource-samples")) return samplesResponse;
      if (url.includes("/sessions/fleet")) return sessionsResponse;
      return res(404, "not stubbed");
    }
  );
});

async function rows() {
  await waitFor(() =>
    expect(screen.getAllByTestId("coord-maintenance-session-row")).toHaveLength(
      2
    )
  );
  return screen.getAllByTestId("coord-maintenance-session-row");
}

async function openRow(shortId: string) {
  const row = (await rows()).find((r) => r.textContent?.includes(shortId));
  if (!row) throw new Error(`no row for ${shortId}`);
  await userEvent.click(within(row).getAllByRole("button")[0]);
  return row;
}

describe("/admin/coord/machine-maintenance — verdict and levers", () => {
  it("reads red 'not yet' while nothing is paused", async () => {
    render(<MachineMaintenancePage />);
    const strip = await screen.findByTestId("coord-maintenance-verdict");
    await waitFor(() =>
      expect(strip).toHaveTextContent("Not yet safe to restart")
    );
    expect(strip).toHaveAttribute("data-health-level", "red");
    expect(screen.getByTestId("coord-maintenance-identity")).toHaveTextContent(
      `merytshost · ${DEVICE}`
    );
    expect(screen.getByTestId("coord-maintenance-return")).toBeDisabled();
    // No window, no per-window readiness read.
    expect(calls("/readiness")).toHaveLength(0);
  });

  it("renders a stale verdict as UNKNOWN, never its last answer", async () => {
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    readinessResponse = res(
      200,
      readinessBody({
        verdict: "safe",
        computed_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      })
    );
    render(<MachineMaintenancePage />);
    const strip = await screen.findByTestId("coord-maintenance-verdict");
    await waitFor(() =>
      expect(strip).toHaveTextContent("Restart readiness UNKNOWN")
    );
    expect(strip).not.toHaveTextContent("Safe to restart");
    expect(strip).toHaveAttribute("data-health-level", "amber");
  });

  it("shows each plane's verdict and the CI registrations while paused", async () => {
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    render(<MachineMaintenancePage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-maintenance-verdict")).toHaveTextContent(
        "Not yet safe to restart"
      )
    );
    // Paused and waiting on a running job: self-clearing, amber.
    expect(screen.getByTestId("coord-maintenance-verdict")).toHaveAttribute(
      "data-health-level",
      "amber"
    );
    expect(
      screen.getByTestId("coord-maintenance-plane-agent")
    ).toHaveTextContent("agent UNKNOWN");
    // The agent plane's own detail, as coord sent it.
    expect(
      screen.getByTestId("coord-maintenance-agent-plane-detail")
    ).toHaveTextContent("Agent plane: not served yet");
    const reg = await screen.findByTestId("coord-maintenance-ci-registration");
    expect(reg).toHaveTextContent("merytshost");
    expect(reg).toHaveTextContent("qontinui/qontinui-web");
    expect(reg).toHaveTextContent("busy");
    expect(screen.getByTestId("coord-maintenance-ci-node")).toHaveTextContent(
      "queued / dispatched / running): 0"
    );
    expect(screen.getByTestId("coord-maintenance-lever-ci")).toHaveTextContent(
      "Paused until"
    );
    expect(screen.getByTestId("coord-maintenance-return")).not.toBeDisabled();
  });

  it("renders 'No CI host linked — link one' and links a host by its bare name", async () => {
    machinesResponse = res(200, machinesBody({ hosts: [] }));
    render(<MachineMaintenancePage />);
    const lever = await screen.findByTestId("coord-maintenance-lever-ci");
    await waitFor(() =>
      expect(lever).toHaveTextContent("No CI host linked — link one")
    );
    expect(lever).not.toHaveTextContent("not paused");
    await userEvent.type(
      screen.getByTestId("coord-maintenance-ci-host-input"),
      " merytshost "
    );
    await userEvent.click(screen.getByTestId("coord-maintenance-ci-host-link"));
    await waitFor(() => expect(calls("/ci-hosts", "POST")).toHaveLength(1));
    const [url, init] = calls("/ci-hosts", "POST")[0] as [
      string,
      { body: string },
    ];
    expect(url).toContain(
      `/api/v1/operations/fleet/machines/${DEVICE}/ci-hosts`
    );
    expect(JSON.parse(init.body)).toEqual({ ci_host: "merytshost" });
  });

  it("names every target, sends the closed body, and asks before pausing the last host", async () => {
    windowPostResponses = [
      res(409, {
        detail: {
          error: "last_matching_host",
          message:
            "merytshost is the last host that runs [self-hosted, qontinui].",
        },
      }),
      res(201, wireWindow()),
    ];
    render(<MachineMaintenancePage />);
    const prepare = await screen.findByTestId("coord-maintenance-prepare");
    await userEvent.click(prepare);

    const dialog = await screen.findByTestId(
      "coord-maintenance-prepare-dialog"
    );
    const targets = within(dialog).getAllByTestId(
      "coord-maintenance-prepare-target"
    );
    expect(targets[0]).toHaveTextContent(`${DEVICE} (merytshost)`);
    expect(targets[0]).toHaveTextContent("agent + ci");
    expect(
      targets.some((t) => t.textContent?.includes("CI host: merytshost"))
    ).toBe(true);
    // Opening the dialog sends nothing.
    expect(calls("/fleet/maintenance-window", "POST")).toHaveLength(0);

    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-preset-4h")
    );
    await userEvent.type(
      within(dialog).getByTestId("coord-maintenance-prepare-reason"),
      "kernel update"
    );
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-submit")
    );

    const question = await within(dialog).findByTestId(
      "coord-maintenance-prepare-last-host"
    );
    expect(question).toHaveTextContent("merytshost is the last host");
    const first = JSON.parse(
      (calls("/fleet/maintenance-window", "POST")[0][1] as { body: string })
        .body
    );
    expect(first).toMatchObject({
      machine_device_id: DEVICE,
      ci_host: null,
      levers: ["agent_work", "ci"],
      reason: "kernel update",
      accept_ci_queueing: false,
    });
    expect(Object.keys(first).sort()).toEqual(
      [
        "accept_ci_queueing",
        "ci_host",
        "levers",
        "machine_device_id",
        "reason",
        "until",
      ].sort()
    );

    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-accept-queueing")
    );
    await waitFor(() =>
      expect(calls("/fleet/maintenance-window", "POST")).toHaveLength(2)
    );
    const second = JSON.parse(
      (calls("/fleet/maintenance-window", "POST")[1][1] as { body: string })
        .body
    );
    expect(second.accept_ci_queueing).toBe(true);
    // After the open, the per-(label, repo) outcome is listed.
    await waitFor(() =>
      expect(
        within(dialog).getByTestId("coord-maintenance-prepare-preview")
      ).toHaveTextContent("qontinui/qontinui-web")
    );
  });

  it("resumes one lever with a PATCH of that lever", async () => {
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    render(<MachineMaintenancePage />);
    const toggle = await screen.findByTestId(
      "coord-maintenance-lever-agent-toggle"
    );
    await waitFor(() => expect(toggle).toHaveTextContent("Resume"));
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(calls("/fleet/maintenance-window", "PATCH")).toHaveLength(1)
    );
    const [url, init] = calls("/fleet/maintenance-window", "PATCH")[0] as [
      string,
      { body: string },
    ];
    expect(url).toContain(`/fleet/maintenance-window/${WINDOW}`);
    expect(JSON.parse(init.body)).toEqual({ lever: "agent_work", held: false });
  });

  it("returns the machine to service with a reason, and shows the per-lever result", async () => {
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    closeResponse = res(
      200,
      wireWindow({
        state: "closed",
        levers: {
          agent_work: { held: false, state: "released", detail: null },
          ci: {
            held: false,
            state: "released",
            detail: null,
            labels: [
              {
                label: "qontinui",
                repo: "qontinui/qontinui-web",
                outcome: "restored",
              },
            ],
          },
        },
      })
    );
    render(<MachineMaintenancePage />);
    const ret = await screen.findByTestId("coord-maintenance-return");
    await waitFor(() => expect(ret).not.toBeDisabled());
    await userEvent.click(ret);
    const submit = await screen.findByTestId("coord-maintenance-return-submit");
    expect(submit).toBeDisabled();
    await userEvent.type(
      screen.getByTestId("coord-maintenance-return-reason"),
      "done"
    );
    await userEvent.click(submit);
    await waitFor(() => expect(calls("/close", "POST")).toHaveLength(1));
    const [url, init] = calls("/close", "POST")[0] as [
      string,
      { body: string },
    ];
    expect(url).toContain(`/fleet/maintenance-window/${WINDOW}/close`);
    expect(JSON.parse(init.body)).toEqual({ reason: "done" });
    const result = await screen.findByTestId("coord-maintenance-close-result");
    expect(result).toHaveTextContent("label restored");
  });

  it("reads an unreachable machines route as UNKNOWN, not an empty fleet", async () => {
    machinesResponse = res(404, "not found");
    render(<MachineMaintenancePage />);
    const notice = await screen.findByTestId(
      "coord-maintenance-machines-notice"
    );
    expect(notice).toHaveTextContent("answered 404");
    const strip = screen.getByTestId("coord-maintenance-verdict");
    expect(strip).toHaveTextContent("Restart readiness UNKNOWN");
    // The device id in the link still reads its sessions.
    await rows();
  });

  it("asks for a machine, and reads nothing per machine, until one is chosen", async () => {
    search = "";
    render(<MachineMaintenancePage />);
    expect(
      await screen.findByTestId("coord-maintenance-no-machine")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-maintenance-machine-picker")
    ).toBeInTheDocument();
    await waitFor(() => expect(calls("/fleet/machines")).not.toHaveLength(0));
    expect(
      httpFetch.mock.calls.some(
        ([url]) =>
          String(url).includes("/fleet/resource-samples") ||
          String(url).includes("/sessions/fleet") ||
          String(url).includes("/readiness")
      )
    ).toBe(false);
  });
});

describe("/admin/coord/machine-maintenance — review round", () => {
  it("shows a raw drain outside any window and releases only that lever's lane", async () => {
    drainResponse = res(200, {
      drained: {
        [DEVICE]: {
          until: new Date(Date.now() + 3_600_000).toISOString(),
          reason: "agent drained it",
          drained_by: "agent",
          drained_at: new Date().toISOString(),
          lanes: ["agent"],
        },
      },
    });
    render(<MachineMaintenancePage />);
    const lever = await screen.findByTestId("coord-maintenance-lever-agent");
    await waitFor(() =>
      expect(lever).toHaveTextContent("Drained outside a maintenance window")
    );
    expect(lever).toHaveAttribute("data-attention", "author");
    // The drained lane has no Pause/Resume of its own — only the release.
    expect(
      screen.queryByTestId("coord-maintenance-lever-agent-toggle")
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByTestId("coord-maintenance-lever-agent-release-drain")
    );
    await userEvent.type(
      await screen.findByTestId("coord-maintenance-release-drain-agent-reason"),
      "restart done"
    );
    await userEvent.click(
      screen.getByTestId("coord-maintenance-release-drain-agent-confirm")
    );
    await waitFor(() =>
      expect(calls("/fleet/undrain", "POST")).toHaveLength(1)
    );
    const [, init] = calls("/fleet/undrain", "POST")[0] as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).toEqual({
      device_id: DEVICE,
      reason: "restart done",
      lanes: ["agent"],
    });
  });

  it("returns an UNREADABLE window to service by coord's raw id", async () => {
    machinesResponse = res(
      200,
      machinesBody({ window: { id: WINDOW, state: "??" } })
    );
    render(<MachineMaintenancePage />);
    const ret = await screen.findByTestId("coord-maintenance-return");
    await waitFor(() => expect(ret).not.toBeDisabled());
    expect(screen.getByTestId("coord-maintenance-verdict")).toHaveTextContent(
      "Restart readiness UNKNOWN"
    );
    await userEvent.click(ret);
    await userEvent.type(
      await screen.findByTestId("coord-maintenance-return-reason"),
      "done"
    );
    await userEvent.click(
      screen.getByTestId("coord-maintenance-return-submit")
    );
    await waitFor(() => expect(calls("/close", "POST")).toHaveLength(1));
    expect(String(calls("/close", "POST")[0][0])).toContain(
      `/fleet/maintenance-window/${WINDOW}/close`
    );
  });

  it("says loudly when a closed window did not fully restore CI", async () => {
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    closeResponse = res(
      200,
      wireWindow({
        state: "closed",
        levers: {
          agent_work: { held: false, state: "released" },
          ci: {
            held: false,
            state: "released",
            labels: [
              {
                label: "qontinui",
                repo: "qontinui/qontinui-web",
                outcome: "restore_failed",
                detail: "HTTP 403",
              },
            ],
          },
        },
      })
    );
    render(<MachineMaintenancePage />);
    const ret = await screen.findByTestId("coord-maintenance-return");
    await waitFor(() => expect(ret).not.toBeDisabled());
    await userEvent.click(ret);
    await userEvent.type(
      await screen.findByTestId("coord-maintenance-return-reason"),
      "done"
    );
    await userEvent.click(
      screen.getByTestId("coord-maintenance-return-submit")
    );
    const result = await screen.findByTestId("coord-maintenance-close-result");
    expect(result).toHaveAttribute("role", "alert");
    expect(
      screen.getByTestId("coord-maintenance-close-headline")
    ).toHaveTextContent("Returned to service — CI not fully restored");
  });

  it("states the last-host consequence locally, and a form change withdraws the offer", async () => {
    windowPostResponses = [
      res(409, {
        detail: {
          error: "last_matching_host",
          message: "refused",
          pool_key: "self-hosted,qontinui",
        },
      }),
    ];
    render(<MachineMaintenancePage />);
    await userEvent.click(
      await screen.findByTestId("coord-maintenance-prepare")
    );
    const dialog = await screen.findByTestId(
      "coord-maintenance-prepare-dialog"
    );
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-preset-4h")
    );
    await userEvent.type(
      within(dialog).getByTestId("coord-maintenance-prepare-reason"),
      "kernel"
    );
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-submit")
    );
    const consequence = await within(dialog).findByTestId(
      "coord-maintenance-prepare-last-host-consequence"
    );
    expect(consequence).toHaveTextContent(
      "This is the last host that runs [self-hosted,qontinui]. CI jobs will queue at GitHub until"
    );
    expect(consequence).toHaveTextContent(
      "or until you return the machine to service."
    );
    // Editing the request withdraws "Pause anyway": it may only resend the
    // exact request coord refused.
    await userEvent.type(
      within(dialog).getByTestId("coord-maintenance-prepare-reason"),
      "!"
    );
    expect(
      within(dialog).queryByTestId("coord-maintenance-prepare-last-host")
    ).not.toBeInTheDocument();
  });

  it("always offers the link form, and confirms an unlink while CI is held", async () => {
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    linkResponse = res(200, { device_id: DEVICE, ci_hosts: [] });
    render(<MachineMaintenancePage />);
    expect(
      await screen.findByTestId("coord-maintenance-ci-host-link-form")
    ).toBeInTheDocument();
    await userEvent.click(
      await screen.findByTestId("coord-maintenance-ci-host-unlink")
    );
    expect(calls("/ci-hosts", "DELETE")).toHaveLength(0);
    await userEvent.click(
      await screen.findByTestId(
        "coord-maintenance-ci-host-unlink-confirm-confirm"
      )
    );
    await waitFor(() => expect(calls("/ci-hosts", "DELETE")).toHaveLength(1));
  });
});

describe("/admin/coord/machine-maintenance — review round 2", () => {
  it("says an undrain whose answer did not parse was accepted with an UNKNOWN effect", async () => {
    drainResponse = res(200, {
      drained: {
        [DEVICE]: {
          until: new Date(Date.now() + 3_600_000).toISOString(),
          reason: "agent drained it",
          drained_by: "agent",
          drained_at: new Date().toISOString(),
          lanes: ["agent"],
        },
      },
    });
    undrainResponse = {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
      text: async () => "ok",
    };
    vi.mocked(toast).mockClear();
    vi.mocked(toast.success).mockClear();
    render(<MachineMaintenancePage />);
    await userEvent.click(
      await screen.findByTestId("coord-maintenance-lever-agent-release-drain")
    );
    await userEvent.type(
      await screen.findByTestId("coord-maintenance-release-drain-agent-reason"),
      "done"
    );
    await userEvent.click(
      screen.getByTestId("coord-maintenance-release-drain-agent-confirm")
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Undrain accepted; whether it changed anything is UNKNOWN"
      )
    );
    expect(toast.success).not.toHaveBeenCalledWith(
      expect.stringContaining("Released")
    );
  });

  it("the release confirm lists each lane's OWN hold", async () => {
    const agentUntil = new Date(Date.now() + 3_600_000).toISOString();
    const ciUntil = new Date(Date.now() + 7_200_000).toISOString();
    drainResponse = res(200, {
      drained: {
        [DEVICE]: {
          until: ciUntil,
          reason: "ci box rebuild",
          drained_by: "[redacted]",
          drained_at: new Date().toISOString(),
          lanes: ["agent", "ci"],
          by_lane: {
            agent: {
              until: agentUntil,
              reason: "agent pause",
              drained_by: "jan",
            },
            ci: {
              until: ciUntil,
              reason: "ci box rebuild",
              drained_by: "[redacted]",
            },
          },
        },
      },
    });
    render(<MachineMaintenancePage />);
    await userEvent.click(
      await screen.findByTestId("coord-maintenance-lever-agent-release-drain")
    );
    const dialog = await screen.findByTestId(
      "coord-maintenance-release-drain-agent"
    );
    expect(dialog).toHaveTextContent("agent work until");
    expect(dialog).toHaveTextContent("agent pause");
    expect(dialog).toHaveTextContent("CI until");
    expect(dialog).toHaveTextContent("ci box rebuild");
  });

  it("offers Release drain for a lane whose per-lane entry could not be read", async () => {
    const ciUntil = new Date(Date.now() + 7_200_000).toISOString();
    drainResponse = res(200, {
      drained: {
        [DEVICE]: {
          until: ciUntil,
          reason: "ci box rebuild",
          drained_by: "jan",
          drained_at: new Date().toISOString(),
          lanes: ["agent", "ci"],
          by_lane: {
            agent: { until: "garbled" },
            ci: { until: ciUntil, reason: "ci box rebuild" },
          },
        },
      },
    });
    render(<MachineMaintenancePage />);
    const lever = await screen.findByTestId("coord-maintenance-lever-agent");
    await waitFor(() =>
      expect(lever).toHaveAttribute("data-lever-kind", "unknown")
    );
    // The runner strip's drain badge is muted and says why.
    const badge = screen.getByTestId("coord-maintenance-drain-badge");
    expect(badge).toHaveAttribute(
      "title",
      "coord records a drain on agent work but that lane's per-lane entry could not be read"
    );
    await userEvent.click(
      screen.getByTestId("coord-maintenance-lever-agent-release-drain")
    );
    expect(
      await screen.findByTestId("coord-maintenance-release-drain-unreadable")
    ).toHaveTextContent("This lane's hold could not be read");
    await userEvent.type(
      screen.getByTestId("coord-maintenance-release-drain-agent-reason"),
      "recover"
    );
    await userEvent.click(
      screen.getByTestId("coord-maintenance-release-drain-agent-confirm")
    );
    await waitFor(() =>
      expect(calls("/fleet/undrain", "POST")).toHaveLength(1)
    );
    const [, init] = calls("/fleet/undrain", "POST")[0] as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body).lanes).toEqual(["agent"]);
  });

  it("offers NO release when the window is unreadable too — 'no window' is itself unknown", async () => {
    const ciUntil = new Date(Date.now() + 7_200_000).toISOString();
    machinesResponse = res(
      200,
      machinesBody({ window: { id: WINDOW, state: "??" } })
    );
    drainResponse = res(200, {
      drained: {
        [DEVICE]: {
          until: ciUntil,
          reason: "ci box rebuild",
          lanes: ["agent", "ci"],
          by_lane: {
            agent: { until: "garbled" },
            ci: { until: ciUntil, reason: "ci box rebuild" },
          },
        },
      },
    });
    render(<MachineMaintenancePage />);
    const lever = await screen.findByTestId("coord-maintenance-lever-agent");
    await waitFor(() =>
      expect(lever).toHaveAttribute("data-lever-kind", "unknown")
    );
    // Wait for the drain read to land before asserting the absence.
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-maintenance-drain-badge")
      ).toHaveTextContent("UNKNOWN")
    );
    expect(
      screen.queryByTestId("coord-maintenance-lever-agent-release-drain")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-maintenance-lever-ci-release-drain")
    ).not.toBeInTheDocument();
  });

  it("shows a non-admin the read-only notice, not the unknown-lane release", async () => {
    authState.isCoordAdmin = false;
    const ciUntil = new Date(Date.now() + 7_200_000).toISOString();
    drainResponse = res(200, {
      drained: {
        [DEVICE]: {
          until: ciUntil,
          reason: "ci box rebuild",
          lanes: ["agent", "ci"],
          by_lane: {
            agent: { until: "garbled" },
            ci: { until: ciUntil, reason: "ci box rebuild" },
          },
        },
      },
    });
    render(<MachineMaintenancePage />);
    const lever = await screen.findByTestId("coord-maintenance-lever-agent");
    await waitFor(() =>
      expect(lever).toHaveAttribute("data-lever-kind", "unknown")
    );
    expect(
      within(lever).getByTestId("coord-admin-only-notice")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-maintenance-lever-agent-release-drain")
    ).not.toBeInTheDocument();
  });

  it("confirms an unlink while the window cannot be read — it may hold CI", async () => {
    machinesResponse = res(
      200,
      machinesBody({ window: { id: WINDOW, state: "??" } })
    );
    render(<MachineMaintenancePage />);
    await userEvent.click(
      await screen.findByTestId("coord-maintenance-ci-host-unlink")
    );
    expect(
      await screen.findByTestId("coord-maintenance-ci-host-unlink-confirm")
    ).toBeInTheDocument();
    expect(calls("/ci-hosts", "DELETE")).toHaveLength(0);
  });
});

describe("/admin/coord/machine-maintenance — coord Phase 3-5 details", () => {
  it("answers ci_host_linked_to_machine with the next step and a link to that machine", async () => {
    search = "machine=ci:msi-wsl";
    windowPostResponses = [
      res(409, {
        detail: {
          error: "ci_host_linked_to_machine",
          message: "msi-wsl is linked to a machine",
          linked_device_id: DEVICE,
        },
      }),
    ];
    render(<MachineMaintenancePage />);
    await userEvent.click(
      await screen.findByTestId("coord-maintenance-prepare")
    );
    const dialog = await screen.findByTestId(
      "coord-maintenance-prepare-dialog"
    );
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-preset-1h")
    );
    await userEvent.type(
      within(dialog).getByTestId("coord-maintenance-prepare-reason"),
      "wsl restart"
    );
    const machinesReadsBefore = calls("/fleet/machines").length;
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-submit")
    );
    expect(
      await within(dialog).findByTestId(
        "coord-maintenance-prepare-error-guidance"
      )
    ).toHaveTextContent("open the window on that machine");
    expect(
      within(dialog).getByTestId("coord-maintenance-prepare-select-machine")
    ).toHaveAttribute(
      "href",
      `/admin/coord/machine-maintenance?machine=${DEVICE}`
    );
    // The list was stale — it is re-read.
    await waitFor(() =>
      expect(calls("/fleet/machines").length).toBeGreaterThan(
        machinesReadsBefore
      )
    );
  });

  it("renders coord's GitHub-plane detail as-is, and each label row's host across hosts", async () => {
    machinesResponse = res(
      200,
      machinesBody({
        hosts: ["merytshost", "msi-wsl"],
        window: wireWindow({
          levers: {
            agent_work: { held: true, state: "held" },
            ci: {
              held: true,
              state: "partial",
              labels: [
                {
                  label: "qontinui",
                  repo: "qontinui/qontinui-web",
                  host: "merytshost",
                  outcome: "removed",
                },
                {
                  label: "qontinui",
                  repo: "qontinui/qontinui-web",
                  host: "msi-wsl",
                  outcome: "failed",
                },
              ],
            },
          },
        }),
      })
    );
    readinessResponse = res(
      200,
      readinessBody({
        planes: {
          ...readinessBody().planes,
          github_ci: {
            ...readinessBody().planes.github_ci,
            detail: "qontinui/qontinui-web still routes to msi-wsl",
          },
        },
      })
    );
    render(<MachineMaintenancePage />);
    expect(
      await screen.findByTestId("coord-maintenance-ci-detail")
    ).toHaveTextContent(
      "GitHub CI: qontinui/qontinui-web still routes to msi-wsl"
    );
    const hosts = screen
      .getAllByTestId("coord-maintenance-lever-ci-label-host")
      .map((h) => h.textContent);
    expect(hosts).toEqual(["merytshost", "msi-wsl"]);
  });
});

describe("/admin/coord/machine-maintenance — round 9", () => {
  it("keeps the pinned form up when a re-read moves the selection — refusal, guidance and link stay visible", async () => {
    search = "machine=ci:msi-wsl";
    windowPostResponses = [
      res(409, {
        detail: {
          error: "ci_host_linked_to_machine",
          message: "msi-wsl is linked to a machine",
          linked_device_id: DEVICE,
        },
      }),
    ];
    render(<MachineMaintenancePage />);
    await userEvent.click(
      await screen.findByTestId("coord-maintenance-prepare")
    );
    const dialog = await screen.findByTestId(
      "coord-maintenance-prepare-dialog"
    );
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-preset-1h")
    );
    await userEvent.type(
      within(dialog).getByTestId("coord-maintenance-prepare-reason"),
      "wsl restart"
    );
    // coord's truth, served on the re-read the refusal triggers: msi-wsl is
    // linked to DEVICE, so `ci:msi-wsl` now resolves to that machine.
    machinesResponse = res(200, linkedMachines());
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-submit")
    );
    const moved = await within(dialog).findByTestId(
      "coord-maintenance-prepare-moved"
    );
    expect(moved).toHaveTextContent(
      `Selection moved to merytshost (${DEVICE})`
    );
    expect(moved).toHaveTextContent("this form still targets msi-wsl");
    // The refusal, its next step and the Select-machine link are still up.
    expect(
      within(dialog).getByTestId("coord-maintenance-prepare-error")
    ).toHaveTextContent("msi-wsl is linked to a machine");
    expect(
      within(dialog).getByTestId("coord-maintenance-prepare-error-guidance")
    ).toHaveTextContent("open the window on that machine");
    expect(
      within(dialog).getByTestId("coord-maintenance-prepare-select-machine")
    ).toHaveAttribute(
      "href",
      `/admin/coord/machine-maintenance?machine=${DEVICE}`
    );
    // …and the form cannot be sent at its old target by accident.
    expect(
      within(dialog).getByTestId("coord-maintenance-prepare-submit")
    ).toBeDisabled();
    expect(calls("/fleet/maintenance-window", "POST")).toHaveLength(1);
  });

  it("says the pinned entry VANISHED, blocks Submit, and re-enables it when it returns", async () => {
    render(<MachineMaintenancePage />);
    await userEvent.click(
      await screen.findByTestId("coord-maintenance-prepare")
    );
    const dialog = await screen.findByTestId(
      "coord-maintenance-prepare-dialog"
    );
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-preset-1h")
    );
    await userEvent.type(
      within(dialog).getByTestId("coord-maintenance-prepare-reason"),
      "kernel"
    );
    const submit = within(dialog).getByTestId(
      "coord-maintenance-prepare-submit"
    );
    expect(submit).not.toBeDisabled();
    // A re-read in which coord no longer lists the machine.
    machinesResponse = res(200, { machines: [], unlinked_ci_hosts: [] });
    fireEvent.click(screen.getByTestId("coord-maintenance-refresh"));
    const vanished = await within(dialog).findByTestId(
      "coord-maintenance-prepare-vanished"
    );
    expect(vanished).toHaveTextContent(
      `merytshost (${DEVICE}) is no longer in coord's machine list; this form cannot be sent.`
    );
    expect(
      within(dialog).queryByTestId("coord-maintenance-prepare-moved")
    ).not.toBeInTheDocument();
    expect(submit).toBeDisabled();
    // The machine is back under the pinned key: Submit is enabled again.
    machinesResponse = res(200, machinesBody());
    fireEvent.click(screen.getByTestId("coord-maintenance-refresh"));
    await waitFor(() =>
      expect(
        within(dialog).queryByTestId("coord-maintenance-prepare-vanished")
      ).not.toBeInTheDocument()
    );
    expect(submit).not.toBeDisabled();
  });

  it("a selection change while a submit is in flight keeps the outcome and the pinned target", async () => {
    search = "machine=ci:msi-wsl";
    let release!: (r: Res) => void;
    windowPostResponses = [
      new Promise<Res>((r) => {
        release = r;
      }),
    ];
    render(<MachineMaintenancePage />);
    await userEvent.click(
      await screen.findByTestId("coord-maintenance-prepare")
    );
    const dialog = await screen.findByTestId(
      "coord-maintenance-prepare-dialog"
    );
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-preset-1h")
    );
    await userEvent.type(
      within(dialog).getByTestId("coord-maintenance-prepare-reason"),
      "wsl restart"
    );
    await userEvent.click(
      within(dialog).getByTestId("coord-maintenance-prepare-submit")
    );
    // A poll lands mid-submit and moves the selection to the machine.
    machinesResponse = res(200, linkedMachines());
    fireEvent.click(screen.getByTestId("coord-maintenance-refresh"));
    await within(dialog).findByTestId("coord-maintenance-prepare-moved");
    await act(async () => {
      release(
        res(201, wireWindow({ machine_device_id: null, ci_host: "msi-wsl" }))
      );
    });
    // The outcome is shown in the still-open dialog…
    expect(
      await within(dialog).findByText("Maintenance window opened")
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("coord-maintenance-prepare-preview")
    ).toHaveTextContent("What coord did");
    // …and the request went to the entry the form was opened on.
    const sent = JSON.parse(
      (calls("/fleet/maintenance-window", "POST")[0][1] as { body: string })
        .body
    );
    expect(sent).toMatchObject({ machine_device_id: null, ci_host: "msi-wsl" });
  });

  it("a refused Return to service shows the next step and re-reads", async () => {
    // Only the interval is faked: the polls cannot fire, so the exact
    // machines-read count below holds by construction (the pattern of
    // useDeviceStatusStream.test.ts). userEvent's setTimeout stays real.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    closeResponse = res(409, {
      detail: { error: "window_changed", message: "window changed" },
    });
    render(<MachineMaintenancePage />);
    const ret = await screen.findByTestId("coord-maintenance-return");
    await waitFor(() => expect(ret).not.toBeDisabled());
    await userEvent.click(ret);
    await userEvent.type(
      await screen.findByTestId("coord-maintenance-return-reason"),
      "done"
    );
    const before = calls("/fleet/machines").length;
    await userEvent.click(
      screen.getByTestId("coord-maintenance-return-submit")
    );
    expect(
      await screen.findByTestId("coord-maintenance-close-error-guidance")
    ).toHaveTextContent("the page is re-reading it");
    // The ONLY machines read after the click is the refusal's re-read.
    await waitFor(() =>
      expect(calls("/fleet/machines")).toHaveLength(before + 1)
    );
  });

  it("a lever toggle refused with window_changed re-reads the machines", async () => {
    // Only the interval is faked: the polls cannot fire, so the exact
    // machines-read count below holds by construction (the pattern of
    // useDeviceStatusStream.test.ts). userEvent's setTimeout stays real.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    patchResponse = res(409, {
      detail: { error: "window_changed", message: "window changed" },
    });
    render(<MachineMaintenancePage />);
    const toggle = await screen.findByTestId(
      "coord-maintenance-lever-agent-toggle"
    );
    await waitFor(() => expect(toggle).toHaveTextContent("Resume"));
    const before = calls("/fleet/machines").length;
    await userEvent.click(toggle);
    expect(
      await screen.findByTestId("coord-maintenance-lever-error")
    ).toHaveTextContent("the page is re-reading it");
    // The ONLY machines read after the click is the refusal's re-read.
    await waitFor(() =>
      expect(calls("/fleet/machines")).toHaveLength(before + 1)
    );
  });
});

describe("/admin/coord/machine-maintenance — coord's final contract", () => {
  // The EXACT body the browser receives from the web proxy in production:
  // the maintenance GET proxies pass coord's error structured, and
  // `http_exception_handler` wraps it as {error, message, timestamp, path}
  // (pinned by the backend's TestReadErrorsReachTheBrowserStructured).
  const envelope = (error: string, message: string) => ({
    error,
    message,
    timestamp: 1790000000.5,
    path: "https://api.qontinui.io/api/v1/operations/fleet/machines",
  });

  it("renders schema_pending on the machines read as UNKNOWN with the migration reason", async () => {
    machinesResponse = res(
      503,
      envelope("schema_pending", "coord.maintenance_windows does not exist yet")
    );
    render(<MachineMaintenancePage />);
    const notice = await screen.findByTestId(
      "coord-maintenance-machines-notice"
    );
    expect(notice).toHaveTextContent("coord's database is not migrated yet");
    expect(notice).not.toHaveTextContent("HTTP 503");
    expect(screen.getByTestId("coord-maintenance-verdict")).toHaveTextContent(
      "Restart readiness UNKNOWN"
    );
  });

  it("still finds schema_pending in the pre-fix stringified envelope (defence in depth)", async () => {
    machinesResponse = res(
      503,
      envelope(
        "SERVICE_UNAVAILABLE",
        JSON.stringify({ error: "schema_pending", message: "not migrated" })
      )
    );
    render(<MachineMaintenancePage />);
    expect(
      await screen.findByTestId("coord-maintenance-machines-notice")
    ).toHaveTextContent("coord's database is not migrated yet");
  });

  it("renders schema_pending on the readiness read as an UNKNOWN verdict", async () => {
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    readinessResponse = res(
      503,
      envelope("schema_pending", "coord.maintenance_windows does not exist yet")
    );
    render(<MachineMaintenancePage />);
    const strip = await screen.findByTestId("coord-maintenance-verdict");
    await waitFor(() =>
      expect(strip).toHaveTextContent("coord's database is not migrated yet")
    );
    expect(strip).toHaveTextContent("Restart readiness UNKNOWN");
  });

  it("a close that leaves a removal in flight is not 'fully restored'", async () => {
    machinesResponse = res(200, machinesBody({ window: wireWindow() }));
    closeResponse = res(
      200,
      wireWindow({
        state: "closed",
        levers: {
          agent_work: { held: false, state: "released" },
          ci: {
            held: false,
            state: "released",
            labels: [
              {
                label: "qontinui",
                repo: "qontinui/qontinui-web",
                outcome: "removed",
                detail: "pending: restore owed",
              },
            ],
          },
        },
      })
    );
    render(<MachineMaintenancePage />);
    const ret = await screen.findByTestId("coord-maintenance-return");
    await waitFor(() => expect(ret).not.toBeDisabled());
    await userEvent.click(ret);
    await userEvent.type(
      await screen.findByTestId("coord-maintenance-return-reason"),
      "done"
    );
    await userEvent.click(
      screen.getByTestId("coord-maintenance-return-submit")
    );
    expect(
      await screen.findByTestId("coord-maintenance-close-headline")
    ).toHaveTextContent("Returned to service — CI not fully restored");
  });

  it("renders label rows in flight, unanswered and label-level as coord means them", async () => {
    machinesResponse = res(
      200,
      machinesBody({
        window: wireWindow({
          levers: {
            agent_work: { held: true, state: "held" },
            ci: {
              held: true,
              state: "partial",
              labels: [
                {
                  label: "qontinui",
                  repo: "qontinui/one",
                  outcome: "removed",
                  detail: "pending: sent",
                },
                {
                  label: "qontinui",
                  repo: "qontinui/two",
                  outcome: "removed",
                  detail: "outcome unknown; will be restored",
                },
                {
                  label: "linux",
                  repo: "*",
                  outcome: "failed",
                  detail: "github_read_only_label",
                },
              ],
            },
          },
        }),
      })
    );
    render(<MachineMaintenancePage />);
    await waitFor(() =>
      expect(
        screen.getAllByTestId("coord-maintenance-lever-ci-label")
      ).toHaveLength(2)
    );
    const rows = screen
      .getAllByTestId("coord-maintenance-lever-ci-label")
      .map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("removal in progress");
    expect(rows[1]).toContain("outcome unknown; will be restored");
    // The label-level refusal is its own line, not a repo.
    expect(
      screen.getByTestId("coord-maintenance-lever-ci-label-refused-all")
    ).toHaveTextContent(
      "Label `linux` was refused on all repos: github_read_only_label"
    );
    const lever = screen.getByTestId("coord-maintenance-lever-ci");
    expect(lever).toHaveTextContent("2 repos still route here");
    expect(lever).toHaveAttribute("data-lever-kind", "partial");
  });
});

describe("/admin/coord/machine-maintenance — session wind-down", () => {
  it("renders a stale runner readiness report as UNKNOWN, never its last verdict", async () => {
    samplesResponse = res(
      200,
      sample({
        readiness_safe: true,
        readiness_state: "stale",
        readiness_age_secs: 900,
      })
    );
    render(<MachineMaintenancePage />);
    const strip = await screen.findByTestId("coord-maintenance-agent-health");
    await waitFor(() => expect(strip).toHaveTextContent("Readiness UNKNOWN"));
    expect(strip).not.toHaveTextContent("Safe to restart");
    for (const id of [
      "coord-maintenance-count-blocking",
      "coord-maintenance-count-finished",
      "coord-maintenance-count-close-eligible",
      "coord-maintenance-count-exit-stuck",
    ]) {
      expect(screen.getByTestId(id)).toHaveTextContent("UNKNOWN");
    }
    const row = await openRow("c1a0de00");
    expect(
      within(row).getByTestId("coord-maintenance-finish-close-unavailable")
    ).toHaveTextContent("readiness is not fresh");
  });

  it("renders a failed session read as UNKNOWN, not as no sessions", async () => {
    sessionsResponse = res(500, "db unavailable");
    render(<MachineMaintenancePage />);
    const unknown = await screen.findByTestId(
      "coord-maintenance-sessions-unknown"
    );
    expect(unknown).toHaveTextContent('this is not "no sessions"');
    expect(
      screen.queryByTestId("coord-maintenance-sessions-empty")
    ).not.toBeInTheDocument();
  });

  it("confirms finish & close in a dialog naming the session, then sends it", async () => {
    render(<MachineMaintenancePage />);
    const row = await openRow("c1a0de00");
    await userEvent.click(
      within(row).getByTestId("coord-maintenance-finish-close")
    );
    const dialog = await screen.findByTestId(
      "coord-maintenance-finish-confirm"
    );
    expect(dialog).toHaveTextContent(IDLE.claudeCodeSessionId);
    expect(controlCalls()).toHaveLength(0);
    await userEvent.type(
      screen.getByTestId("coord-maintenance-finish-reason"),
      "restarting the machine"
    );
    await userEvent.click(
      screen.getByTestId("coord-maintenance-finish-confirm-confirm")
    );
    await waitFor(() => expect(controlCalls()).toHaveLength(1));
    const [url, init] = controlCalls()[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toContain(
      `/api/v1/operations/sessions/${IDLE.sessionId}/control`
    );
    expect(JSON.parse(init.body)).toEqual({
      action: "finish_and_close",
      reason: "restarting the machine",
    });
    expect(
      await within(row).findByTestId("coord-maintenance-action-accepted")
    ).toHaveTextContent("Request recorded (event e0e0e0e0)");
  });

  it("does not send finish & close when the session stops being idle while the dialog is open", async () => {
    render(<MachineMaintenancePage />);
    const row = await openRow("c1a0de00");
    await userEvent.click(
      within(row).getByTestId("coord-maintenance-finish-close")
    );
    const confirm = await screen.findByTestId(
      "coord-maintenance-finish-confirm-confirm"
    );
    expect(confirm).not.toBeDisabled();
    const busy = sample();
    busy.latest[0].wind_down_sessions[0].idle_state = "busy";
    samplesResponse = res(200, busy);
    fireEvent.click(screen.getByTestId("coord-maintenance-refresh"));
    expect(
      await screen.findByTestId("coord-maintenance-finish-blocked")
    ).toHaveTextContent("The session is no longer idle — not sent.");
    fireEvent.click(
      screen.getByTestId("coord-maintenance-finish-confirm-confirm")
    );
    expect(controlCalls()).toHaveLength(0);
  });

  it("posts stop at boundary once for two presses while the first is out", async () => {
    let release!: (r: Res) => void;
    controlResponse = new Promise((r) => {
      release = r;
    });
    render(<MachineMaintenancePage />);
    const row = await openRow("5e5e5e5e");
    const stop = within(row).getByTestId("coord-maintenance-stop-boundary");
    act(() => {
      stop.click();
      stop.click();
    });
    expect(controlCalls()).toHaveLength(1);
    await act(async () => {
      release(
        res(202, {
          event_id: "e0e0e0e0-0000-4000-8000-000000000000",
          session_id: STEWARD.sessionId,
          device_id: DEVICE,
          action: "stop_at_boundary",
        })
      );
    });
    expect(
      await within(row).findByTestId("coord-maintenance-action-accepted")
    ).toBeInTheDocument();
    expect(controlCalls()).toHaveLength(1);
  });
});

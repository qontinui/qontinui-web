/**
 * /admin/coord/devops in presentation mode — plan
 * `2026-10-23-console-presentation-spaces` Phase 7.
 *
 * The arming claim this file holds: `/admin/coord/devops?present=1` shows NO
 * drain control and ONLY aliased machines. It renders the real page through
 * the presentation helper (`renderInPresentationMode` — the real UI Bridge
 * provider, a fixed presenting lens, a ready redaction scope) over a fixture
 * whose every identifier is distinctive, then asserts four things:
 *
 *  1. `expectPresentationSafe` — no enabled write control, no write or
 *     undeclared UI Bridge action, no cost, and every section caption renders;
 *  2. no drain lever, dialog or target line, no CI-capacity disclosure, no
 *     rename and no role control — by testid and by accessible name;
 *  3. NO fixture hostname, device id, display name, repository, person or
 *     free-text phrase anywhere in the document — text AND attributes, so a
 *     `data-hostname`, a tooltip, a row key or an href counts;
 *  4. machines read as aliases, and the SAME machine reads as the SAME alias
 *     on the machine card, the resources table and the worktree-slots table.
 *
 * Then the operator arm (the same page, not presenting) still shows the
 * levers, and the headline strip goes UNKNOWN — never zero — when its poll
 * fails. The headline's derivations are pinned in
 * `components/operations/devOpsHeadline.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";

const httpGet = vi.fn();
const httpFetch = vi.fn();

// Same transport split as `page.test.tsx`: the typed coord reads go through
// `httpClient.fetch` and are answered from `httpGet`'s table as a 200
// Response; everything else is answered by `httpFetch`.
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    fetch: async (url: string, init?: unknown) =>
      /fleet\/health|resource-samples|worktree-slots|ci-runners|fault-to-visibility|dispatch-roles|coord\/audit/.test(
        String(url)
      )
        ? new Response(JSON.stringify(await httpGet(url, init)), {
            status: 200,
          })
        : httpFetch(url, init),
  },
}));

// The page's one device-status subscription, seeded with rows that carry
// every free-text field the tile can render.
const deviceStatusRows = new Map<string, unknown>();
vi.mock("@/components/operations/useDeviceStatusStream", () => ({
  useDeviceStatusStream: () => ({
    byHostname: deviceStatusRows,
    connected: false,
    error: null,
    seeded: true,
    everSeeded: true,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/operations/useSymbolClaimsStream", () => ({
  useSymbolClaimsStream: () => ({
    byMachine: new Map(),
    error: null,
    refetch: vi.fn(),
  }),
}));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => routerPush(...args) }),
}));

// An ADMIN, so every admin-gated write control would render for the
// operator: presentation mode must remove them, not the auth gate.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    isCoordAdmin: true,
    loading: false,
    user: { is_superuser: false, coord_is_admin: true },
  }),
}));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [{ id: "t-a", slug: "a", name: "A", roles: ["admin"] }],
    activeTenantId: "t-a",
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

import CoordDevOpsPage from "./page";
import {
  FixedPresentationMode,
  sessionMachineAliases,
  type CaptionKey,
  type PresentationScopeState,
} from "@/components/presentation";
import knownFaultToVisibility from "../../../../../../test-fixtures/devops-readout/known-fault-to-visibility.json";

// ---------------------------------------------------------------------------
// The fixture. Every identifier is distinctive so its absence is checkable.
// ---------------------------------------------------------------------------

const HOST_A = "hostname-alpha-7731";
const HOST_B = "hostname-bravo-2209";
/** In the runner inventory only — no coord device row. */
const HOST_C = "hostname-charlie-5517";
const DEV_A = "a1a1a1a1-0000-4000-8000-00000000000a";
const DEV_B = "b2b2b2b2-0000-4000-8000-00000000000b";
/** The CI mirror's device: its hostname is coord's synthetic one, and it
 * names a partner's repository. */
const DEV_CI = "c3c3c3c3-0000-4000-8000-00000000000c";
const CI_HOST = "gh-runner-ci-box-4410@acme-partner/secret-repo";
const CI_HOST_LABEL = "ci-box-4410";
const DISPLAY_NAME_A = "Acme Corp lab box";
const OPERATOR_EMAIL = "operator@example.com";
const OPERATOR_ID = "0f0f0f0f-0000-4000-8000-0000000000ff";
const PARTNER_REPO = "acme-partner/secret-repo";

/**
 * Everything that must never reach the document in presentation mode. The
 * "acme" and "secret" fragments catch every repository, path, task and
 * display name built from them.
 */
const MUST_NOT_APPEAR = [
  HOST_A,
  HOST_B,
  HOST_C,
  DEV_A,
  DEV_B,
  DEV_CI,
  CI_HOST_LABEL,
  "gh-runner",
  "Acme",
  "acme",
  "Partner A",
  "secret",
  OPERATOR_EMAIL,
  OPERATOR_ID,
  "tenant-secret",
  "gate-0000",
];

const SCOPE: PresentationScopeState = {
  status: "ready",
  scope: {
    firstPartyOwners: ["qontinui"],
    confidentialTerms: ["Acme Corp", "Partner A"],
  },
};

/** Every caption the page's sections render in presentation mode. */
const DEVOPS_CAPTIONS: CaptionKey[] = [
  "dev-ops.page",
  "dev-ops.health-strip",
  "dev-ops.conditions",
  "dev-ops.machines",
  "dev-ops.roles",
  "dev-ops.resources",
  "dev-ops.worktree-slots",
  "dev-ops.audit",
];

const NOW_ISO = () => new Date().toISOString();
const IN_A_DAY = () => new Date(Date.now() + 86_400_000).toISOString();

function runner(hostname: string) {
  return {
    id: `r-${hostname}`,
    name: `runner-${hostname}`,
    hostname,
    port: 9876,
    os: "linux",
    derivedStatus: "healthy",
    lastHeartbeat: NOW_ISO(),
  };
}

function hostSample(deviceId: string) {
  return {
    device_id: deviceId,
    lane: "host",
    lane_instance: null,
    sampled_at: NOW_ISO(),
    age_secs: 15,
    cpu_cores: 16,
    load_1m: null,
    cpu_temp_c: null,
    mem_total_bytes: 1,
    mem_available_bytes: 1,
    commit_total_bytes: 1,
    commit_available_bytes: 1,
    swap_total_bytes: null,
    swap_used_bytes: null,
    disk_total_bytes: 1,
    disk_free_bytes: 1,
    disk_mount: "/",
    build_slots_total: 4,
    build_slots_busy: 1,
    build_queue_depth: 0,
    ci_jobs_running: null,
    source: "supervisor",
    pressure: { ratio: 0.12, basis: "commit" },
    floor: {
      basis: "commit_available",
      bytes: 4 * 1024 ** 3,
      source: "default",
      verdict: "defer",
    },
    headroom: "ok",
  };
}

/** A CI publisher whose lane instance is "<runner>/<repo>". */
function ciSample(deviceId: string) {
  return {
    ...hostSample(deviceId),
    lane: "wsl",
    lane_instance: `${CI_HOST_LABEL}/secret-repo`,
    ci_jobs_running: 1,
    source: "ci-step",
  };
}

function rolesMachine(
  deviceId: string,
  name: string,
  over: Record<string, unknown> = {}
) {
  return {
    kind: "workstation",
    machine_key: `device:${deviceId}`,
    device_id: deviceId,
    ci_host_name: null,
    name,
    registration: "registered",
    role: {
      dispatch_role: "bench",
      reason: "Acme Corp asked for it",
      version: 2,
      updated_by: OPERATOR_EMAIL,
      updated_at: "2026-10-20T10:00:00Z",
    },
    suggestion: null,
    lanes: {
      agent: {
        effective: "closed_by_role",
        role: "closed",
        drain: {
          state: "drained",
          until: IN_A_DAY(),
          reason: "rebuild for Acme Corp",
          drained_by: OPERATOR_EMAIL,
        },
      },
      ci: { effective: "open", role: "open", drain: { state: "none" } },
    },
    pre_change_sessions: { state: "not_applicable" },
    ...over,
  };
}

interface Fixture {
  /** Reject the worktree-slots poll (the headline's UNKNOWN arm). */
  worktreeSlotsFail?: boolean;
}

function mockRoutes(fixture: Fixture = {}) {
  httpGet.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("resource-samples")) {
      return Promise.resolve({
        latest: [hostSample(DEV_A), ciSample(DEV_B)],
        history: [],
      });
    }
    if (u.includes("worktree-slots")) {
      if (fixture.worktreeSlotsFail) {
        return Promise.reject(new Error("worktree slots unavailable"));
      }
      return Promise.resolve({
        tenant_id: "t-1",
        device_count: 2,
        truncated: false,
        device_cap: 100,
        census_window_secs: 900,
        devices: [
          {
            device_id: DEV_A,
            hostname: HOST_A,
            active_worktrees: 3,
            max_worktrees: 8,
            census_recent_rows: 2,
            occupants: {
              shown: 1,
              total: 1,
              truncated: false,
              rows: [
                {
                  repo: PARTNER_REPO,
                  worktree_path: "agent-worktrees/aaaa/secret-repo",
                  age_secs: 120,
                  building: false,
                },
              ],
            },
          },
          {
            device_id: DEV_B,
            hostname: HOST_B,
            active_worktrees: 1,
            max_worktrees: 8,
            // No recent census: UNKNOWN, never counted.
            census_recent_rows: 0,
            occupants: { shown: 0, total: 0, truncated: false, rows: [] },
          },
        ],
      });
    }
    if (u.includes("ci-runners")) {
      return Promise.resolve({
        runners: [
          {
            device_id: DEV_CI,
            hostname: CI_HOST,
            ci_runner_status: "idle",
            ci_runner_labels: ["self-hosted", "qontinui", CI_HOST_LABEL],
            last_seen_at: NOW_ISO(),
          },
        ],
        as_of: NOW_ISO(),
        freshness_secs: 180,
      });
    }
    if (u.includes("fault-to-visibility")) {
      return Promise.resolve(knownFaultToVisibility);
    }
    if (u.includes("dispatch-roles")) {
      return Promise.resolve({
        state: "known",
        machines: [
          rolesMachine(DEV_A, HOST_A),
          rolesMachine(DEV_B, HOST_B, { role: null }),
          {
            ...rolesMachine("", CI_HOST_LABEL),
            kind: "ci_host",
            machine_key: `host:${CI_HOST_LABEL}`,
            device_id: null,
            ci_host_name: CI_HOST_LABEL,
          },
        ],
        roster_truncated: false,
      });
    }
    if (u.includes("coord/audit")) {
      return Promise.resolve({
        audit: [
          {
            audit_id: "audit-1",
            operator_id: OPERATOR_ID,
            action: "fleet.drain.set",
            resource_kind: "coord.devices",
            resource_key: DEV_A,
            metadata: {
              device_id: DEV_A,
              until: IN_A_DAY(),
              drained: true,
              reason: "rebuild for Acme Corp",
            },
            occurred_at: NOW_ISO(),
          },
          {
            audit_id: "audit-2",
            operator_id: OPERATOR_ID,
            action: "pr_merge.kill_switch",
            resource_kind: "coord.pr_events",
            resource_key: `${PARTNER_REPO}#12`,
            metadata: {
              affected_repos: [PARTNER_REPO],
              affected_tenant_ids: ["tenant-secret-1", "tenant-secret-2"],
              reason: "Partner A requested a freeze",
            },
            occurred_at: NOW_ISO(),
          },
        ],
        count: 2,
      });
    }
    if (u.includes("fleet/health")) {
      return Promise.resolve({
        devices: [
          { device_id: DEV_A, hostname: HOST_A, state: "healthy" },
          { device_id: DEV_B, hostname: HOST_B, state: "degraded" },
          {
            device_id: DEV_CI,
            hostname: CI_HOST,
            state: "healthy",
            ci_runner_status: "idle",
          },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${u}`));
  });

  httpFetch.mockImplementation((url: unknown) => {
    const u = String(url);
    const ok = (json: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(json),
      });
    if (u.includes("/fleet/drain")) {
      return ok({
        drained: {
          [DEV_A]: {
            until: IN_A_DAY(),
            reason: "rebuild for Acme Corp",
            drained_by: OPERATOR_EMAIL,
            drained_at: NOW_ISO(),
          },
        },
      });
    }
    if (u.includes("/devenv/machines")) {
      return ok([
        {
          id: "m-1",
          name: `${HOST_A}-record`,
          hostname: HOST_A,
          description: null,
          key_prefix: "mk_abc",
          enrolled: true,
          last_seen_at: null,
          revoked: false,
          environment_id: null,
          coord_device_id: DEV_A,
          created_at: "2026-08-01T10:00:00Z",
          updated_at: "2026-08-01T10:00:00Z",
        },
      ]);
    }
    if (u.includes("/fleet/tasks")) {
      return ok({
        task_runs: [
          {
            id: "task-1",
            runner_id: "r-1",
            runner_hostname: HOST_A,
            runner_port: 9876,
            status: "running",
            prompt: "secret prompt for Partner A",
            started_at: NOW_ISO(),
            workflow_name: "Acme Corp nightly",
          },
        ],
        total: 1,
      });
    }
    if (u.includes("/fleet/volumes")) return ok({ devices: [] });
    if (u.endsWith("/fleet")) {
      return ok({
        runners: [runner(HOST_A), runner(HOST_C)],
        claude_sessions: {
          [HOST_A]: [
            {
              pid: 4242,
              working_directory: "D:/work/acme-partner/secret-repo",
              started_at: NOW_ISO(),
            },
          ],
        },
        machine_display_names: { [HOST_A]: DISPLAY_NAME_A },
        total_runners: 2,
        total_healthy: 2,
        total_running_tasks: 1,
        total_claude_sessions: 1,
      });
    }
    return ok({});
  });
}

function seedDeviceStatus() {
  deviceStatusRows.set(HOST_A, {
    device_id: DEV_A,
    hostname: HOST_A,
    current_task: "Fix Acme Corp login flow",
    current_repo: PARTNER_REPO,
    current_branch: "fix-acme-login",
    free_text: "waiting on Partner A",
    details: {},
    tenant_id: null,
    updated_at: NOW_ISO(),
    stalled_session_count: 1,
    most_stalled_session: {
      session_id: "s-1",
      device_id: DEV_A,
      kind: "expected_unstarted",
      state: "expected",
      stall_age_secs: 600,
      continuation_gate_id: "gate-0000-secret",
      work_unit_slug: "acme-secret-plan",
    },
  });
}

function resetEnvironment() {
  httpGet.mockReset();
  httpFetch.mockReset();
  routerPush.mockReset();
  deviceStatusRows.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  sessionMachineAliases.reset();
  // The audit panel is collapsed by default; its persisted choice opens it,
  // so its rows are in the document to be checked.
  window.localStorage.setItem("devops:operator-audit", "1");
}

/** Wait until every read the page renders from has landed. */
async function settle() {
  await screen.findByTestId("devops-headline-strip");
  await waitFor(() =>
    expect(
      document.querySelectorAll("[data-operations-machine-card]").length
    ).toBeGreaterThanOrEqual(4)
  );
  await waitFor(() =>
    expect(screen.getAllByTestId("fleet-roles-row").length).toBe(3)
  );
  // The device list is the spine: A and B from the slot read, and the CI
  // device, which the slot read does not list, as an UNKNOWN row.
  await waitFor(() =>
    expect(screen.getAllByTestId("fleet-worktree-slots-row").length).toBe(3)
  );
  await waitFor(() =>
    expect(
      document.querySelectorAll('[data-testid^="audit-row-"]').length
    ).toBe(2)
  );
  await waitFor(() =>
    expect(screen.getAllByTestId("fleet-resource-row").length).toBeGreaterThan(
      0
    )
  );
  await waitFor(() =>
    expect(screen.getAllByTestId("task-run-presented").length).toBe(1)
  );
}

/** The disclosure toggle inside a row or panel (a pure `aria-expanded` one). */
function toggleOf(container: Element): HTMLElement {
  const toggle = container.querySelector("button[aria-expanded]");
  if (!toggle) throw new Error("no disclosure toggle in this container");
  return toggle as HTMLElement;
}

/**
 * Runs `check` on the page as rendered, then again after opening each
 * disclosure that hides content — every role row, every audit row, and the
 * worktree occupants. A record list keeps ONE row open, so they are opened one
 * at a time and checked each time: content behind every disclosure is
 * checked, not just whichever was opened last. Opening a disclosure is itself
 * allowed in presentation mode (a pure `aria-expanded` toggle), so this is
 * what an evaluator clicking around would see.
 */
function checkBehindEveryDisclosure(check: () => void) {
  check();
  for (const row of screen.getAllByTestId("fleet-roles-row")) {
    fireEvent.click(toggleOf(row));
    check();
  }
  for (const row of document.querySelectorAll('[data-testid^="audit-row-"]')) {
    fireEvent.click(toggleOf(row));
    check();
  }
  fireEvent.click(
    toggleOf(screen.getByTestId("worktree-slots-occupants-disclosure"))
  );
  check();
}

describe("/admin/coord/devops?present=1 — no drain control, only aliased machines", () => {
  beforeEach(resetEnvironment);

  it("is safe to show an outsider: no write control, no cost, every section captioned", async () => {
    mockRoutes();
    seedDeviceStatus();
    const view = renderInPresentationMode(<CoordDevOpsPage />, {
      scope: SCOPE,
    });
    await settle();

    checkBehindEveryDisclosure(() =>
      expectPresentationSafe(view, { captions: DEVOPS_CAPTIONS })
    );
  });

  it("shows no drain control, no CI-capacity edit, no rename and no role control", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();
    // A role row's write controls live in its detail: open one.
    fireEvent.click(toggleOf(screen.getAllByTestId("fleet-roles-row")[0]));

    // The lever, its dialog and its target line — gone, not hidden.
    for (const testId of [
      "device-drain",
      "device-drain-open",
      "device-drain-undrain",
      "device-drain-dialog",
      "device-drain-target",
      "ci-capacity-disclosure",
      "ci-runner-drain-scope",
      "fleet-roles-set-workhorse",
      "fleet-roles-set-bench",
      "fleet-roles-set-ci_node",
      "fleet-roles-by-host",
      "fleet-roles-dialog",
      "operator-audit-resource-key",
    ]) {
      expect(screen.queryByTestId(testId), testId).toBeNull();
    }
    // By accessible name too: the lever is "Drain…" / "Undrain", its submit
    // "Drain machine". (An audit row reading "Drained a machine" is a
    // disclosure, not a lever — `\b` keeps it out of the match.)
    expect(
      screen.queryByRole("button", { name: /^(drain|undrain)\b/i })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^rename\b/i })).toBeNull();

    // What remains is the drain STATE, read-only: the drained machine says
    // so, with no actor and no reason.
    const states = screen.getAllByTestId("device-drain-status");
    expect(states.length).toBeGreaterThan(0);
    const drained = states.filter(
      (s) => s.getAttribute("data-device-drain") === "drained"
    );
    expect(drained).toHaveLength(1);
    expect(drained[0]).toHaveTextContent(/out of service/i);
    expect(drained[0]).toHaveTextContent(/drained until/i);
  });

  it("renders no hostname, device id, display name, repository, person or free text — in text or attributes", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();

    checkBehindEveryDisclosure(() => {
      // `innerHTML` is text AND every attribute: a `data-hostname`, a
      // `title`, a row key or an `href` leaks exactly as visible text does.
      const html = document.body.innerHTML;
      const leaked = MUST_NOT_APPEAR.filter((needle) => html.includes(needle));
      expect(leaked, "identifiers that reached the presentation DOM").toEqual(
        []
      );
    });
  });

  it("names machines by alias, and one machine by ONE alias across the machine card, the resources table and the worktree slots", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();

    const aliased = document.querySelectorAll('[data-machine-alias="true"]');
    expect(aliased.length).toBeGreaterThanOrEqual(4);
    for (const el of aliased) {
      expect(el.textContent).toMatch(/^Machine [A-Z]+$/);
    }

    // The registry already holds machine A's letter, linked by device id AND
    // hostname; asking again assigns nothing new.
    const aliasA = sessionMachineAliases.aliasFor({
      deviceId: DEV_A,
      hostname: HOST_A,
    });
    const aliasB = sessionMachineAliases.aliasFor({ deviceId: DEV_B });
    expect(aliasA).not.toBe(aliasB);

    // Machine card: the one carrying the drained state.
    const drainedCard = screen
      .getAllByTestId("device-drain-status")
      .find((s) => s.getAttribute("data-device-drain") === "drained")!
      .closest("[data-operations-machine-card]") as HTMLElement;
    expect(within(drainedCard).getByText(aliasA)).toBeTruthy();

    // Worktree slots: machine A is the row with a live census.
    const slotRows = screen.getAllByTestId("fleet-worktree-slots-row");
    const knownRow = slotRows.find(
      (r) => r.getAttribute("data-worktree-slots-state") === "known"
    )!;
    expect(knownRow).toHaveTextContent(aliasA);
    expect(knownRow).toHaveTextContent("3/8");
    const unknownRow = slotRows.find(
      (r) => r.getAttribute("data-worktree-slots-state") === "unknown"
    )!;
    expect(unknownRow).toHaveTextContent(aliasB);

    // Resources table: machine A's host lane.
    const resourceRows = screen.getAllByTestId("fleet-resource-row");
    expect(resourceRows.some((r) => r.textContent?.includes(aliasA))).toBe(
      true
    );
    // The CI publisher's "<runner>/<repo>" instance reads by position.
    expect(
      resourceRows.some((r) => r.textContent?.includes("instance 1"))
    ).toBe(true);
  });

  it("opens with three headline figures, each with its provenance", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();

    const machines = await screen.findByTestId("devops-headline-machines");
    // Two of the three coord devices report healthy.
    await waitFor(() => expect(machines).toHaveTextContent("2 of 3"));
    expect(machines).toHaveTextContent(/1 degraded/);

    const workspaces = screen.getByTestId("devops-headline-workspaces");
    // Machine A's 3 of 8. Machine B has no recent census and the CI device is
    // not on the slot read at all: neither is counted, and both are named.
    await waitFor(() => expect(workspaces).toHaveTextContent("3 of 8"));
    expect(workspaces).toHaveTextContent(/2 machines not counted/);

    const ci = screen.getByTestId("devops-headline-ci");
    await waitFor(() => expect(ci).toHaveTextContent("1 of 1"));

    for (const id of [
      "devops-headline-machines-provenance",
      "devops-headline-workspaces-provenance",
      "devops-headline-ci-provenance",
    ]) {
      const chip = screen.getByTestId(id);
      expect(chip.getAttribute("data-provenance-known"), id).toBe("true");
      expect(chip).toHaveTextContent(/source: coord/);
      expect(chip).toHaveTextContent(/as of /);
    }
  });

  it("renders a failed poll's figure UNKNOWN with its reason — never zero — and leaves the others standing", async () => {
    mockRoutes({ worktreeSlotsFail: true });
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await screen.findByTestId("devops-headline-strip");

    const workspaces = screen.getByTestId("devops-headline-workspaces");
    await waitFor(() =>
      expect(workspaces.getAttribute("data-headline-known")).toBe("false")
    );
    // The FIGURE is the word UNKNOWN — not a 0, a dash or a blank (the chip
    // saying "as of UNKNOWN" beside it does not count).
    expect(
      workspaces.querySelector('[data-headline-part="value"]')?.textContent
    ).toBe("UNKNOWN");
    expect(workspaces).toHaveTextContent(
      /latest read of agent workspaces failed/
    );
    expect(workspaces).not.toHaveTextContent(/\b0 of\b/);
    const chip = screen.getByTestId("devops-headline-workspaces-provenance");
    expect(chip.getAttribute("data-provenance-known")).toBe("false");

    // The two other polls answered; their figures stand.
    await waitFor(() =>
      expect(screen.getByTestId("devops-headline-machines")).toHaveTextContent(
        "2 of 3"
      )
    );
    expect(
      screen
        .getByTestId("devops-headline-ci")
        .getAttribute("data-headline-known")
    ).toBe("true");
  });
});

describe("/admin/coord/devops for the operator — the console is unchanged", () => {
  beforeEach(resetEnvironment);

  it("still shows the drain lever, the rename, the CI capacity and the real names; no headline, no captions", async () => {
    mockRoutes();
    seedDeviceStatus();
    render(
      <FixedPresentationMode presenting={false}>
        <CoordDevOpsPage />
      </FixedPresentationMode>
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("device-drain").length).toBeGreaterThan(0)
    );
    // Machine A is drained, so its lever offers Undrain; the others Drain.
    await waitFor(() =>
      expect(screen.getAllByTestId("device-drain-undrain")).toHaveLength(1)
    );
    expect(screen.getAllByTestId("device-drain-open").length).toBeGreaterThan(
      0
    );
    expect(screen.getAllByTestId("device-drain-target").length).toBeGreaterThan(
      0
    );
    expect(screen.getAllByTestId("ci-capacity-disclosure")).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: /rename/i }).length
    ).toBeGreaterThan(0);

    // Real names: the operator's alias for machine A, and the hostnames.
    expect(screen.getAllByText(DISPLAY_NAME_A).length).toBeGreaterThan(0);
    expect(document.body.innerHTML).toContain(HOST_B);
    expect(document.querySelector('[data-machine-alias="true"]')).toBeNull();

    expect(screen.queryByTestId("devops-headline-strip")).toBeNull();
    expect(document.querySelector("[data-presentation-caption]")).toBeNull();
    expect(document.querySelector("[data-provenance]")).toBeNull();
  });
});

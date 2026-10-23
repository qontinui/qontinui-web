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
import {
  FAILURE_REASON_WITHHELD,
  FAILURE_SENTENCE_WITHHELD,
} from "@/components/operations/presentedFailure";
import { DEVOPS_SOURCES } from "@/components/operations/devOpsHeadline";

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
/** The stream's failure, when a test makes it fail. */
const deviceStatusState: { error: string | null } = { error: null };
vi.mock("@/components/operations/useDeviceStatusStream", () => ({
  useDeviceStatusStream: () => ({
    byHostname: deviceStatusRows,
    connected: false,
    error: deviceStatusState.error,
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
  NAVIGATION_ONLY_ATTRIBUTE,
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
/** A repository the scope below clears: its name may show. */
const FIRST_PARTY_REPO = "qontinui/qontinui-web";
/** A volume label someone typed, naming a client (MUST_NOT_APPEAR catches it). */
const VOLUME_MOUNT = "/Volumes/Acme Corp share";
/**
 * A machine that appears ONLY inside failure text. The failure is
 * transport-shaped (no HTTP status to parse), the shape every hook on the page
 * passes through as its own words — so absent from the presentation DOM means
 * the failure's own text never reached it.
 */
const ERROR_HOST = "hostname-delta-9001";
const ERROR_DEVICE = "d4d4d4d4-0000-4000-8000-00000000000d";

function readFailure(url: string): Error {
  return new Error(
    `network error reaching ${url}: device ${ERROR_DEVICE} on ${ERROR_HOST} refused the connection`
  );
}

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
  ERROR_HOST,
  ERROR_DEVICE,
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
  /**
   * Reject reads with `readFailure`: every one, or every one but coord's fleet
   * health (so the machine cards render around the failures).
   */
  fail?: "all" | "all-but-fleet-health";
}

function mockRoutes(fixture: Fixture = {}) {
  httpGet.mockImplementation((url: unknown) => {
    const u = String(url);
    if (
      fixture.fail === "all" ||
      (fixture.fail === "all-but-fleet-health" && !u.includes("fleet/health"))
    ) {
      return Promise.reject(readFailure(u));
    }
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
          // A CI-host role set under machine A's own name: machine A's row
          // carries the twin note, which names it.
          {
            ...rolesMachine("", HOST_A),
            kind: "ci_host",
            machine_key: `host:${HOST_A}`,
            device_id: null,
            ci_host_name: HOST_A,
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
          // A kill switch as coord writes it (`rollout_routes.rs`): the
          // resource key AND `metadata.scope` are `repo:<owner>/<name>`.
          {
            audit_id: "audit-3",
            operator_id: OPERATOR_ID,
            action: "pr_merge.kill_switch.activate",
            resource_kind: "coord.tenant_rollout_overrides",
            resource_key: `repo:${PARTNER_REPO}`,
            metadata: {
              previous_merge_enabled: true,
              merge_enabled: false,
              scope: `repo:${PARTNER_REPO}`,
              affected_repos: [PARTNER_REPO],
              reason: "release freeze",
            },
            occurred_at: NOW_ISO(),
          },
          // The same, on a first-party repository: the scope may show.
          {
            audit_id: "audit-4",
            operator_id: OPERATOR_ID,
            action: "pr_merge.kill_switch.activate",
            resource_kind: "coord.tenant_rollout_overrides",
            resource_key: `repo:${FIRST_PARTY_REPO}`,
            metadata: {
              scope: `repo:${FIRST_PARTY_REPO}`,
              affected_repos: [FIRST_PARTY_REPO],
              reason: "release freeze",
            },
            occurred_at: NOW_ISO(),
          },
        ],
        count: 4,
      });
    }
    if (u.includes("fleet/health")) {
      return Promise.resolve({
        devices: [
          {
            device_id: DEV_A,
            hostname: HOST_A,
            state: "healthy",
            // The runner's own reports: an open stall, and a mechanism whose
            // reason quotes a checkout path.
            wedge_incidents: [
              { kind: "backend_wedged", began_at: NOW_ISO(), ended_at: null },
            ],
            capability: [
              {
                mechanism: "cargo_sweep",
                state: "INOPERATIVE-ON-THIS-MACHINE",
                reason:
                  "no cargo target under D:/work/acme-partner/secret-repo",
                written_at: NOW_ISO(),
              },
            ],
            runner_reports: {
              wedge_incidents: {
                absent_reason: null,
                received_at: NOW_ISO(),
                stale: false,
                dropped_entries: 0,
              },
              capability: {
                absent_reason: null,
                received_at: NOW_ISO(),
                stale: false,
                dropped_entries: 0,
              },
              stale_after_secs: 900,
            },
          },
          {
            device_id: DEV_B,
            hostname: HOST_B,
            state: "degraded",
            // Coord's dark scan named it, with a reason naming the host.
            credential_dark: {
              dark: true,
              reason: `device-JWT for ${HOST_B} expired and could not be re-minted`,
            },
          },
          {
            device_id: DEV_CI,
            hostname: CI_HOST,
            state: "healthy",
            ci_runner_status: "idle",
          },
        ],
        credential_dark_scrape_up: true,
        // A question waiting on the operator, and a deliberate setting whose
        // free-text summary names a machine and a person.
        conditions: {
          open: 3,
          claimed: 1,
          unclaimed: 2,
          unclaimed_oldest_age_secs: 600,
          unclaimed_by_domain: {
            merge_train: 1,
            dev_ops: 1,
            cleanup: 0,
            return_to_main: 0,
            pr_fix: 0,
            red_main_fix: 0,
            gate_owner: 0,
            plan_owner: 0,
          },
          awaiting_operator: 1,
          awaiting_operator_question_ids: ["q-1"],
          awaiting_operator_alerts: 1,
          awaiting_operator_unasked: 0,
          awaiting_operator_answered_uncleared: 0,
          settings_in_effect: [
            {
              alert_id: 12,
              kind: "fleet_device_drained",
              since: NOW_ISO(),
              summary: `${HOST_A} drained by ${OPERATOR_EMAIL}: rebuild for Acme Corp`,
            },
          ],
          settings_in_effect_count: 1,
          scrape_up: true,
        },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${u}`));
  });

  httpFetch.mockImplementation((url: unknown) => {
    const u = String(url);
    if (fixture.fail) return Promise.reject(readFailure(u));
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
    if (u.includes("/fleet/volumes")) {
      // Machine A's one volume is mounted under a label naming a client.
      return ok({
        devices: [
          {
            device_id: DEV_A,
            volumes: [
              {
                volume: VOLUME_MOUNT,
                total_bytes: 500 * 1024 ** 3,
                free_bytes: 120 * 1024 ** 3,
                observed_at: NOW_ISO(),
              },
            ],
          },
        ],
        count: 1,
      });
    }
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
  deviceStatusState.error = null;
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
    expect(screen.getAllByTestId("fleet-roles-row").length).toBe(4)
  );
  // The device list is the spine: A and B from the slot read, and the CI
  // device, which the slot read does not list, as an UNKNOWN row.
  await waitFor(() =>
    expect(screen.getAllByTestId("fleet-worktree-slots-row").length).toBe(3)
  );
  await waitFor(() =>
    expect(
      document.querySelectorAll('[data-testid^="audit-row-"]').length
    ).toBe(4)
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

/** The machine section's provenance chips, by the source each one names. */
function machineSectionChips(): Map<string, Element> {
  const section = document.querySelector(
    '[data-presentation-section="dev-ops.machines"]'
  );
  if (!section) throw new Error("the machines section caption did not render");
  const chips = new Map<string, Element>();
  for (const chip of section.querySelectorAll("[data-provenance]")) {
    const source = /source: (.+?) · /.exec(chip.textContent ?? "")?.[1];
    if (source) chips.set(source, chip);
  }
  return chips;
}

/** Every read whose numbers the machine list shows. */
const MACHINE_SECTION_SOURCES = [
  DEVOPS_SOURCES.runnerInventory,
  DEVOPS_SOURCES.fleetHealth,
  DEVOPS_SOURCES.ciRunnerMirror,
  DEVOPS_SOURCES.diskTelemetry,
  DEVOPS_SOURCES.drainState,
  DEVOPS_SOURCES.deviceStatus,
];

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

    // The live controls that ARE on this page are each navigation-only — and
    // they are here, so the check below is not passing on a page that
    // rendered none of them.
    for (const testId of [
      "coord-devops-credential-dark-badge",
      "coord-devops-conditions-awaiting-badge",
      "fleet-resource-refresh",
      "fleet-worktree-slots-refresh",
    ]) {
      // The strip's badges sit inside the button that carries the mark.
      expect(
        screen.getByTestId(testId).closest("button"),
        testId
      ).toHaveAttribute(NAVIGATION_ONLY_ATTRIBUTE);
    }

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
    // `getAllByTestId` throws on none, so the first row exists.
    fireEvent.click(toggleOf(screen.getAllByTestId("fleet-roles-row")[0]!));

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
    // The operator's orientation notes — where to act, what the list is
    // keyed on, the mirror's window — are not rendered for an outsider.
    for (const testId of [
      "coord-devops-hosted-ci-link-line",
      "coord-devops-join-note",
      "coord-devops-computers-note",
      "ci-runner-mirror-freshness",
    ]) {
      expect(screen.queryByTestId(testId), testId).toBeNull();
    }

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

    // Every free-text carrier the fixture feeds IS on the page — so their
    // identifiers' absence below is redaction, not an empty render: the
    // runner's reports (as counts), the dark credential, the setting in
    // effect.
    expect(
      screen.getAllByTestId("devops-runner-wedges-presented")[0]
    ).toHaveTextContent("1 open");
    expect(
      document.querySelector('[data-operations-coord-credential="dark"]')
    ).not.toBeNull();
    expect(
      screen.getByTestId("coord-devops-conditions-setting-12")
    ).toBeTruthy();

    checkBehindEveryDisclosure(() => {
      // `innerHTML` is text AND every attribute: a `data-hostname`, a
      // `title`, a row key or an `href` leaks exactly as visible text does.
      const html = document.body.innerHTML;
      const leaked = MUST_NOT_APPEAR.filter((needle) => html.includes(needle));
      expect(leaked, "identifiers that reached the presentation DOM").toEqual(
        []
      );
    });

    // Machine A's workstation row notes the CI-host role set under its own
    // name — without the name. (The list orders its rows itself, so each one
    // is opened in turn.)
    const twins: string[] = [];
    for (const row of screen.getAllByTestId("fleet-roles-row")) {
      fireEvent.click(toggleOf(row));
      const twin = screen.queryByTestId("fleet-roles-host-row-twin");
      if (twin) twins.push(twin.textContent ?? "");
    }
    expect(twins).toHaveLength(1);
    expect(twins[0]).toContain("this machine's name");
  });

  it("names a kill switch's repository only when the scope clears it — coord's `repo:` scope included", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();

    // The partner's: its resource key and its `metadata.scope` are both
    // `repo:acme-partner/secret-repo`, and neither may reach the page.
    fireEvent.click(toggleOf(screen.getByTestId("audit-row-audit-3")));
    const partner = screen.getByTestId("audit-detail-audit-3");
    expect(partner.textContent).not.toMatch(/acme|secret/i);
    expect(partner).toHaveTextContent(/Repository · /);

    // The tenant's own: the same row shape, and its repository shows — in
    // the row's label and in the blast radius.
    fireEvent.click(toggleOf(screen.getByTestId("audit-row-audit-4")));
    const own = screen.getByTestId("audit-row-audit-4");
    expect(own).toHaveTextContent(`repo:${FIRST_PARTY_REPO}`);
    expect(screen.getByTestId("audit-blast-audit-4")).toHaveTextContent(
      FIRST_PARTY_REPO
    );
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
    // Its disk: the figure, named by its position — never by its mount.
    expect(within(drainedCard).getByText("Volume 1")).toBeTruthy();
    expect(drainedCard.querySelector("[data-operations-volume]")).toBeNull();

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

    // The machine list names EVERY read its numbers come from — disk, drain
    // and device-status times included — and each one answered, so each is
    // dated.
    await waitFor(() => {
      const chips = machineSectionChips();
      expect([...chips.keys()].sort()).toEqual(
        [...MACHINE_SECTION_SOURCES].sort()
      );
      for (const [source, chip] of chips) {
        expect(chip.getAttribute("data-provenance-known"), source).toBe("true");
      }
    });
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

describe("/admin/coord/devops?present=1 — a failed read says it failed, in fixed words", () => {
  beforeEach(resetEnvironment);

  /** Wait for every panel that raises its own failure to have raised it. */
  async function settleFailures(arm: "all" | "all-but-fleet-health") {
    await screen.findByTestId("devops-headline-strip");
    for (const testId of [
      "fleet-roles-unknown",
      "operator-audit-error",
      "fleet-resource-error",
      "ci-run-error",
      "fleet-worktree-slots-error",
    ]) {
      await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy());
    }
    if (arm === "all") {
      await screen.findByText("Backend Unreachable");
    } else {
      await waitFor(() =>
        expect(
          document.querySelectorAll("[data-operations-machine-card]").length
        ).toBeGreaterThan(0)
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-devops-credential-unknown-badge")
        ).toBeTruthy()
      );
    }
  }

  /** What every arm holds: no failure's own text, and each failure stated. */
  function expectFailuresInFixedWords() {
    const html = document.body.innerHTML;
    expect(html).not.toContain(ERROR_HOST);
    expect(html).not.toContain(ERROR_DEVICE);
    expect(screen.getByTestId("fleet-roles-unknown")).toHaveTextContent(
      FAILURE_SENTENCE_WITHHELD
    );
    for (const testId of [
      "operator-audit-error",
      "fleet-resource-error",
      "ci-run-error",
      "fleet-worktree-slots-error",
    ]) {
      expect(screen.getByTestId(testId), testId).toHaveTextContent(
        FAILURE_REASON_WITHHELD
      );
    }
    // UNKNOWN, never zero, at the top too.
    for (const id of ["devops-headline-workspaces", "devops-headline-ci"]) {
      expect(
        screen.getByTestId(id).getAttribute("data-headline-known"),
        id
      ).toBe("false");
    }
  }

  it("every read fails: no failure's own text reaches the page, and every panel says it failed", async () => {
    mockRoutes({ fail: "all" });
    deviceStatusState.error = readFailure("/coord/device-status").message;
    const view = renderInPresentationMode(<CoordDevOpsPage />, {
      scope: SCOPE,
    });
    await settleFailures("all");

    expectFailuresInFixedWords();
    expect(
      screen
        .getByTestId("devops-headline-machines")
        .getAttribute("data-headline-known")
    ).toBe("false");
    // The machine inventory's own failure, and no operator next step.
    expect(document.body).toHaveTextContent(FAILURE_SENTENCE_WITHHELD);
    expect(document.body.textContent).not.toContain("localhost:8000");
    // The health strip's detail and the conditions panel say it in the same
    // fixed words.
    expect(screen.getByTestId("coord-devops-health-strip")).toHaveTextContent(
      FAILURE_REASON_WITHHELD
    );
    expect(
      screen.getByTestId("coord-devops-conditions-panel")
    ).toHaveTextContent(FAILURE_REASON_WITHHELD);
    expectPresentationSafe(view, { captions: DEVOPS_CAPTIONS });
  });

  it("coord's fleet health answers and every other read fails: the machine cards say so in fixed words too", async () => {
    mockRoutes({ fail: "all-but-fleet-health" });
    deviceStatusState.error = readFailure("/coord/device-status").message;
    const view = renderInPresentationMode(<CoordDevOpsPage />, {
      scope: SCOPE,
    });
    await settleFailures("all-but-fleet-health");

    expectFailuresInFixedWords();
    // The credential badge's tooltip quotes the stream's failure.
    expect(
      screen
        .getByTestId("coord-devops-credential-unknown-badge")
        .getAttribute("title")
    ).toContain(FAILURE_REASON_WITHHELD);
    // Every machine's drain is UNKNOWN — said, not guessed.
    const drains = screen.getAllByTestId("device-drain-status");
    expect(drains.length).toBeGreaterThan(0);
    for (const d of drains) {
      if (d.getAttribute("data-device-drain") === "no_device") continue;
      expect(d.getAttribute("data-device-drain")).toBe("unknown");
      expect(d).toHaveTextContent(/drain state has not been read/i);
    }
    // The runner inventory did not answer, so its counts are UNKNOWN — never
    // "Runners 0 · Healthy 0".
    for (const label of [
      "Runners",
      "Healthy",
      "Running Tasks",
      "CC Sessions",
    ]) {
      const stat = screen.getByText(label, { exact: true, selector: "span" })
        .parentElement as HTMLElement;
      expect(stat, label).toHaveTextContent(`${label}unknown`);
    }
    // Each read that failed is dated UNKNOWN — a failed poll never makes the
    // section look current — while coord's fleet health, which answered, is
    // dated.
    const chips = machineSectionChips();
    expect(
      chips
        .get(DEVOPS_SOURCES.fleetHealth)
        ?.getAttribute("data-provenance-known")
    ).toBe("true");
    for (const source of [
      DEVOPS_SOURCES.runnerInventory,
      DEVOPS_SOURCES.ciRunnerMirror,
      DEVOPS_SOURCES.diskTelemetry,
      DEVOPS_SOURCES.drainState,
    ]) {
      expect(
        chips.get(source)?.getAttribute("data-provenance-known"),
        source
      ).toBe("false");
    }
    expectPresentationSafe(view, { captions: DEVOPS_CAPTIONS });
  });

  it("(control) the same failures DO carry their own text for the operator", async () => {
    mockRoutes({ fail: "all-but-fleet-health" });
    deviceStatusState.error = readFailure("/coord/device-status").message;
    render(
      <FixedPresentationMode presenting={false}>
        <CoordDevOpsPage />
      </FixedPresentationMode>
    );
    for (const testId of [
      "fleet-roles-unknown",
      "operator-audit-error",
      "fleet-resource-error",
      "ci-run-error",
      "fleet-worktree-slots-error",
    ]) {
      // So the presentation arms above are not passing on a fixture whose
      // failures never reached the page at all.
      await waitFor(() =>
        expect(screen.getByTestId(testId), testId).toHaveTextContent(ERROR_HOST)
      );
    }
    expect(
      screen
        .getByTestId("coord-devops-credential-unknown-badge")
        .getAttribute("title")
    ).toContain(ERROR_HOST);
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
    // The operator still reads the volume's own mount.
    expect(screen.getAllByText(VOLUME_MOUNT).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-machine-alias="true"]')).toBeNull();

    expect(screen.queryByTestId("devops-headline-strip")).toBeNull();
    expect(document.querySelector("[data-presentation-caption]")).toBeNull();
    expect(document.querySelector("[data-provenance]")).toBeNull();
  });
});

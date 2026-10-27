/**
 * The `/admin/coord/devops` presentation-mode fixture (plan
 * `2026-10-23-console-presentation-spaces` Phase 7): the reads the real page
 * is rendered over by `page.presentation.test.tsx`, and the helpers that wait
 * for them and look behind the page's disclosures.
 *
 * Every identifier is distinctive, so its ABSENCE from a presentation-mode
 * render is checkable, and every free-text carrier the page can render is fed
 * one — hostnames, device ids, an operator's display name, a partner's
 * repository, a person, typed reasons, a volume label, a runner capability's
 * reason, a conditions summary, a stall's gate, plan and topic, and failure
 * text that names a machine.
 *
 * The test file owns the `vi.mock` calls (vitest hoists them per file); this
 * module owns the data and the route table those mocks answer from.
 */

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, type Mock } from "vitest";
import { DEVOPS_SOURCES } from "@/components/operations/devOpsHeadline";
import type {
  CaptionKey,
  PresentationScopeState,
} from "@/components/presentation";
import knownFaultToVisibility from "../../test-fixtures/devops-readout/known-fault-to-visibility.json";

// ---------------------------------------------------------------------------
// The fixture. Every identifier is distinctive so its absence is checkable.
// ---------------------------------------------------------------------------

export const HOST_A = "hostname-alpha-7731";
export const HOST_B = "hostname-bravo-2209";
/** In the runner inventory only — no coord device row. */
export const HOST_C = "hostname-charlie-5517";
export const DEV_A = "a1a1a1a1-0000-4000-8000-00000000000a";
export const DEV_B = "b2b2b2b2-0000-4000-8000-00000000000b";
/** The CI mirror's device: its hostname is coord's synthetic one, and it
 * names a partner's repository. */
export const DEV_CI = "c3c3c3c3-0000-4000-8000-00000000000c";
export const CI_HOST = "gh-runner-ci-box-4410@acme-partner/secret-repo";
export const CI_HOST_LABEL = "ci-box-4410";
export const DISPLAY_NAME_A = "Acme Corp lab box";
export const OPERATOR_EMAIL = "operator@example.com";
export const OPERATOR_ID = "0f0f0f0f-0000-4000-8000-0000000000ff";
export const PARTNER_REPO = "acme-partner/secret-repo";
/** A repository the scope below clears: its name may show. */
export const FIRST_PARTY_REPO = "qontinui/qontinui-web";
/** A volume label someone typed, naming a client (MUST_NOT_APPEAR catches it). */
export const VOLUME_MOUNT = "/Volumes/Acme Corp share";
/**
 * A machine that appears ONLY inside failure text. The failure is
 * transport-shaped (no HTTP status to parse), the shape every hook on the page
 * passes through as its own words — so absent from the presentation DOM means
 * the failure's own text never reached it.
 */
export const ERROR_HOST = "hostname-delta-9001";
export const ERROR_DEVICE = "d4d4d4d4-0000-4000-8000-00000000000d";

export function readFailure(url: string): Error {
  return new Error(
    `network error reaching ${url}: device ${ERROR_DEVICE} on ${ERROR_HOST} refused the connection`
  );
}

/**
 * Everything that must never reach the document in presentation mode. The
 * "acme" and "secret" fragments catch every repository, path, task and
 * display name built from them.
 */
export const MUST_NOT_APPEAR = [
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

export const SCOPE: PresentationScopeState = {
  status: "ready",
  scope: {
    firstPartyOwners: ["qontinui"],
    confidentialTerms: ["Acme Corp", "Partner A"],
  },
};

/** Every caption the page's sections render in presentation mode. */
export const DEVOPS_CAPTIONS: CaptionKey[] = [
  "dev-ops.page",
  "dev-ops.health-strip",
  "dev-ops.conditions",
  "dev-ops.machines",
  "dev-ops.roles",
  "dev-ops.resources",
  "dev-ops.worktree-slots",
  "dev-ops.audit",
];

export const NOW_ISO = () => new Date().toISOString();
export const IN_A_DAY = () => new Date(Date.now() + 86_400_000).toISOString();

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
    // The resources table's disk cell carries the sample's mount: fed the
    // same client-naming label as the volume census, so its absence from a
    // presentation render is redaction rather than a mount that names nobody.
    disk_mount: VOLUME_MOUNT,
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

export interface DevOpsFixture {
  /** Reject the worktree-slots poll (the headline's UNKNOWN arm). */
  worktreeSlotsFail?: boolean;
  /**
   * Reject reads with `readFailure`: every one, or every one but coord's fleet
   * health (so the machine cards render around the failures).
   */
  fail?: "all" | "all-but-fleet-health";
  /**
   * Reject every read whose URL contains one of these, from then on. Read at
   * CALL time, so a test can let a read answer first and push its route here
   * afterwards — the succeed-then-fail sequence a page sees when a poll that
   * worked starts failing.
   */
  failingRoutes?: string[];
}

export function mockDevOpsRoutes(
  httpGet: Mock,
  httpFetch: Mock,
  fixture: DevOpsFixture = {}
): void {
  const failsNow = (u: string) =>
    (fixture.failingRoutes ?? []).some((route) => u.includes(route));
  httpGet.mockImplementation((url: unknown) => {
    const u = String(url);
    if (
      fixture.fail === "all" ||
      (fixture.fail === "all-but-fleet-health" && !u.includes("fleet/health")) ||
      failsNow(u)
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
        // Coord dates the read itself (`dispatch_role_routes.rs`).
        as_of: NOW_ISO(),
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
        // Coord dates the read itself (`fleet_health.rs`).
        as_of: NOW_ISO(),
      });
    }
    return Promise.reject(new Error(`unexpected GET ${u}`));
  });

  httpFetch.mockImplementation((url: unknown) => {
    const u = String(url);
    if (fixture.fail || failsNow(u)) return Promise.reject(readFailure(u));
    const ok = (json: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(json),
      });
    if (u.includes("/fleet/drain")) {
      return ok({
        // Coord dates the read itself (`fleet_drain.rs`).
        as_of: NOW_ISO(),
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

export function seedDeviceStatus(rows: Map<string, unknown>): void {
  rows.set(HOST_A, {
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
  // Machine B: a session heartbeating without progress, whose correlation
  // topic names a client — the stall tooltip's other arm.
  rows.set(HOST_B, {
    device_id: DEV_B,
    hostname: HOST_B,
    current_task: null,
    current_repo: null,
    current_branch: null,
    free_text: null,
    details: {},
    tenant_id: null,
    updated_at: NOW_ISO(),
    stalled_session_count: 1,
    most_stalled_session: {
      session_id: "s-2",
      device_id: DEV_B,
      kind: "stalled",
      state: "active",
      stall_age_secs: 900,
      correlation_topic: "acme-secret-topic",
    },
  });
}

/** Wait until every read the page renders from has landed. */
export async function settle() {
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
export function toggleOf(container: Element): HTMLElement {
  const toggle = container.querySelector("button[aria-expanded]");
  if (!toggle) throw new Error("no disclosure toggle in this container");
  return toggle as HTMLElement;
}

/** A captioned section's provenance chips, by the source each one names. */
export function sectionChips(id: CaptionKey): Map<string, Element> {
  const section = document.querySelector(
    `[data-presentation-section="${id}"]`
  );
  if (!section) throw new Error(`the ${id} section caption did not render`);
  const chips = new Map<string, Element>();
  for (const chip of section.querySelectorAll("[data-provenance]")) {
    const source = /source: (.+?) · /.exec(chip.textContent ?? "")?.[1];
    if (source) chips.set(source, chip);
  }
  return chips;
}

/** The machine section's provenance chips, by the source each one names. */
export function machineSectionChips(): Map<string, Element> {
  return sectionChips("dev-ops.machines");
}

/** Every read whose numbers the health strip counts from. */
export const HEALTH_STRIP_SOURCES = [
  DEVOPS_SOURCES.fleetHealth,
  DEVOPS_SOURCES.faultToVisibility,
  DEVOPS_SOURCES.deviceStatus,
];

/** Every read whose numbers the machine list shows. */
export const MACHINE_SECTION_SOURCES = [
  DEVOPS_SOURCES.runnerInventory,
  DEVOPS_SOURCES.fleetHealth,
  DEVOPS_SOURCES.ciRunnerMirror,
  DEVOPS_SOURCES.diskTelemetry,
  DEVOPS_SOURCES.drainState,
  DEVOPS_SOURCES.deviceStatus,
];

/**
 * Every captioned section of the page and the reads its numbers come from —
 * one provenance chip each. (`dev-ops.page` is the page's caption and states
 * no source of its own.)
 */
export const SECTION_SOURCES: ReadonlyArray<
  readonly [CaptionKey, readonly string[]]
> = [
  ["dev-ops.health-strip", HEALTH_STRIP_SOURCES],
  ["dev-ops.conditions", [DEVOPS_SOURCES.fleetHealth]],
  ["dev-ops.machines", MACHINE_SECTION_SOURCES],
  ["dev-ops.roles", [DEVOPS_SOURCES.dispatchRoles]],
  ["dev-ops.resources", [DEVOPS_SOURCES.resourceSamples]],
  ["dev-ops.worktree-slots", [DEVOPS_SOURCES.worktreeSlots]],
  ["dev-ops.audit", [DEVOPS_SOURCES.operatorAudit]],
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
export function checkBehindEveryDisclosure(check: () => void) {
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

/**
 * maintenanceWindow — the derivations behind `/admin/coord/machine-maintenance`,
 * asserted without a DOM.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place`
 * Phase 7. The negatives are the point:
 *
 *  1. **Nothing unread becomes calm.** A body this build cannot read, a lever
 *     state it has never heard of, and a verdict older than its bound are each
 *     UNKNOWN — never green, never "not paused".
 *  2. **"No CI host linked" is its own state**, never "CI: not paused".
 *  3. **Partial is partial**, and names how many repos still route here.
 *  4. **Idle before the pause is not idle** — it waits for a newer poll.
 *  5. **The dialog names every target by coord's identity**, and requires a
 *     reason and a bounded deadline.
 */

import { describe, expect, it } from "vitest";
import {
  CI_REGISTRATION_ATTENTION_BY_KIND,
  MAINTENANCE_LEVER_ATTENTION_BY_KIND,
  deriveLeverStatus,
  deriveRegistrationStatus,
  seenAfterPauseLabel,
} from "./maintenanceStatus";
import {
  VERDICT_STALE_SECS,
  buildMaintenancePreview,
  ciHostOwners,
  deriveVerdictHealth,
  describeMaintenanceError,
  findMachineEntry,
  formatUntil,
  leverActionPauses,
  machineEntryBadge,
  SCHEMA_PENDING_REASON,
  agentLeverStateWords,
  errorWantsReread,
  labelOutcomeLabel,
  labelRepoDisplay,
  labelRepos,
  labelsSpanHosts,
  maintenanceBadge,
  maintenanceErrorGuidance,
  maintenanceKeyForCiHostname,
  parseMachineParam,
  parseMachines,
  parseMaintenanceWindow,
  parseSyntheticCiHostname,
  parseWindowReadiness,
  registrationsFromMirror,
  resolveMachineMaintenance,
  summarizeLinkedCiHosts,
  validateMaintenanceForm,
  type CiRegistration,
  type MachineEntry,
  type MachineRow,
  type MachinesRead,
  type MaintenanceWindow,
  type WindowReadinessRead,
} from "./maintenanceWindow";
import {
  resolveDeviceDrain,
  toLocalInputValue,
  type DeviceDrainState,
} from "./fleetDrain";
import {
  stillRoutingCount,
  type MaintenanceContext,
} from "./maintenanceWindow";

const DEVICE = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd";
const WINDOW = "7d7d7d7d-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-09-28T12:00:00Z");

function wireWindow(overrides: Record<string, unknown> = {}) {
  return {
    id: WINDOW,
    machine_device_id: DEVICE,
    ci_host: "merytshost",
    state: "open",
    until: "2026-09-28T18:00:00Z",
    reason: "kernel update",
    opened_by: "jan@example.com",
    opened_at: "2026-09-28T11:00:00Z",
    closed_by: null,
    closed_at: null,
    ci_paused_at: "2026-09-28T11:00:05Z",
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
          {
            label: "qontinui",
            repo: "qontinui/qontinui-coord",
            outcome: "removed",
            detail: null,
          },
        ],
      },
    },
    ...overrides,
  };
}

function win(overrides: Record<string, unknown> = {}): MaintenanceWindow {
  const w = parseMaintenanceWindow(wireWindow(overrides));
  if (!w) throw new Error("fixture did not parse");
  return w;
}

function machine(overrides: Partial<MachineRow> = {}): MachineRow {
  return {
    kind: "machine",
    key: DEVICE,
    deviceId: DEVICE,
    hostname: "merytshost",
    state: "healthy",
    ciHosts: ["merytshost"],
    openWindow: null,
    openWindowUnreadable: false,
    openWindowRawId: null,
    ...overrides,
  };
}

function readiness(
  overrides: Record<string, unknown> = {}
): WindowReadinessRead {
  return parseWindowReadiness({
    window_id: WINDOW,
    verdict: "safe",
    reasons: [],
    computed_at: new Date(NOW - 10_000).toISOString(),
    levers_held: { agent_work: true, ci: true },
    planes: {
      agent: {
        verdict: "safe",
        sample_age_secs: 12,
        terminal_sessions: 0,
        ai_sessions: 0,
        detail: "",
      },
      github_ci: {
        verdict: "safe",
        freshness_secs: 180,
        registrations: [],
        missing_repos: [],
        detail: "",
      },
      ci_node: { verdict: "safe", active_dispatches: 0, detail: "" },
    },
    ...overrides,
  });
}

describe("parseMachines", () => {
  it("reads machines and un-linked CI hosts as entries of their own", () => {
    const read = parseMachines({
      machines: [
        {
          device_id: DEVICE,
          hostname: "merytshost",
          state: "healthy",
          ci_hosts: ["merytshost"],
          open_window: wireWindow(),
        },
      ],
      unlinked_ci_hosts: [{ ci_host: "msi-wsl", open_window: null }],
    });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") return;
    expect(read.entries.map((e) => e.key)).toEqual([DEVICE, "ci:msi-wsl"]);
    expect(read.entries[0].openWindow?.id).toBe(WINDOW);
  });

  it("is UNKNOWN for a body it cannot read — not an empty fleet", () => {
    expect(parseMachines({ machine: [] }).state).toBe("unknown");
    expect(parseMachines(null).state).toBe("unknown");
  });

  it("marks an open window it cannot read, rather than calling the machine in service", () => {
    const read = parseMachines({
      machines: [
        { device_id: DEVICE, ci_hosts: [], open_window: { id: WINDOW } },
      ],
    });
    if (read.state !== "ok") throw new Error("expected ok");
    expect(read.entries[0].openWindow).toBeNull();
    expect(read.entries[0].openWindowUnreadable).toBe(true);
  });
});

describe("parseMaintenanceWindow", () => {
  it("keeps an unrecognised lever state as UNKNOWN rather than dropping the window", () => {
    const w = parseMaintenanceWindow(
      wireWindow({
        levers: {
          agent_work: { held: true, state: "brand_new_state" },
          ci: { held: false, state: "released", labels: [] },
        },
      })
    );
    expect(w).not.toBeNull();
    expect(w!.levers.agentWork.state).toBeNull();
  });

  it("refuses a window with no parseable deadline", () => {
    expect(parseMaintenanceWindow(wireWindow({ until: "soon" }))).toBeNull();
  });
});

describe("selection", () => {
  it("parses a device id and a ci: host", () => {
    expect(parseMachineParam(DEVICE.toUpperCase())).toEqual({
      kind: "machine",
      deviceId: DEVICE,
    });
    expect(parseMachineParam("ci:msi-wsl")).toEqual({
      kind: "ci_host",
      ciHost: "msi-wsl",
    });
    expect(parseMachineParam("")).toEqual({ kind: "none" });
    expect(parseMachineParam("ci:")).toEqual({ kind: "none" });
  });

  it("finds a machine through a host it has since claimed", () => {
    const entries: MachineEntry[] = [machine()];
    expect(
      findMachineEntry(entries, { kind: "ci_host", ciHost: "merytshost" })?.key
    ).toBe(DEVICE);
  });
});

describe("parseSyntheticCiHostname", () => {
  it("splits the registrar's per-repo hostname", () => {
    expect(
      parseSyntheticCiHostname("gh-runner-merytshost@qontinui/qontinui-web")
    ).toEqual({
      runnerName: "merytshost",
      repo: "qontinui/qontinui-web",
    });
    expect(parseSyntheticCiHostname("gh-runner-msi-wsl")).toEqual({
      runnerName: "msi-wsl",
      repo: null,
    });
    expect(parseSyntheticCiHostname("spaceship")).toBeNull();
  });
});

describe("deriveVerdictHealth", () => {
  it("is red 'not yet' with no window — nothing is paused", () => {
    const h = deriveVerdictHealth(null, { state: "no_window" }, NOW);
    expect(h.level).toBe("red");
    expect(h.headline).toBe("Not yet safe to restart");
  });

  it("is green only for coord's explicit, recent safe", () => {
    const h = deriveVerdictHealth(win(), readiness(), NOW);
    expect(h.level).toBe("green");
    expect(h.headline).toBe("Safe to restart");
  });

  it("renders a stale verdict as UNKNOWN, never its last answer", () => {
    const stale = readiness({
      computed_at: new Date(
        NOW - (VERDICT_STALE_SECS + 30) * 1000
      ).toISOString(),
    });
    const h = deriveVerdictHealth(win(), stale, NOW);
    expect(h.level).toBe("amber");
    expect(h.headline).toContain("UNKNOWN");
    expect(h.headline).not.toContain("Safe");
  });

  it("renders a failed read as UNKNOWN amber", () => {
    const h = deriveVerdictHealth(
      win(),
      { state: "unknown", reason: "HTTP 502" },
      NOW
    );
    expect(h.level).toBe("amber");
    expect(h.detail).toBe("HTTP 502");
  });

  it("is amber while paused and waiting on self-clearing work, red when a lever is not held", () => {
    const waiting = readiness({
      verdict: "not_yet",
      reasons: ["2 CI jobs running"],
    });
    expect(deriveVerdictHealth(win(), waiting, NOW).level).toBe("amber");
    const notHeld = readiness({
      verdict: "not_yet",
      reasons: ["CI is not paused; a job may start at any moment"],
      levers_held: { agent_work: true, ci: false },
    });
    expect(deriveVerdictHealth(win(), notHeld, NOW).level).toBe("red");
  });

  it("an unrecognised verdict is UNKNOWN, never safe", () => {
    const h = deriveVerdictHealth(
      win(),
      readiness({ verdict: "probably" }),
      NOW
    );
    expect(h.level).toBe("amber");
  });

  it("carries each plane's verdict and age on a badge", () => {
    const h = deriveVerdictHealth(win(), readiness(), NOW);
    expect(h.badges.map((b) => b.label)).toEqual([
      "agent safe · 12 s",
      "GitHub CI safe",
      "CI-node safe · 0 dispatches",
    ]);
  });
});

describe("deriveLeverStatus", () => {
  it("renders 'No CI host linked — link one', never 'not paused'", () => {
    const s = deriveLeverStatus("ci", machine({ ciHosts: [] }), NOW);
    expect(s.kind).toBe("no_ci_host_unpaused");
    expect(s.label).toBe("No CI host linked — link one");
    // Nothing is paused yet — a note, not a red alarm.
    expect(s.attention).toBe("waiting");
  });

  it("says a partial CI pause is partial, with how many repos still route here", () => {
    const w = win({
      levers: {
        agent_work: { held: true, state: "held" },
        ci: {
          held: true,
          state: "partial",
          labels: [
            { label: "qontinui", repo: "a/one", outcome: "removed" },
            { label: "qontinui", repo: "a/two", outcome: "removed" },
            {
              label: "qontinui",
              repo: "a/three",
              outcome: "failed",
              detail: "HTTP 403",
            },
          ],
        },
      },
    });
    const s = deriveLeverStatus("ci", machine({ openWindow: w }), NOW);
    expect(s.kind).toBe("partial");
    expect(s.label).toBe("CI partly paused");
    expect(s.reason).toContain("1 repo still routes here");
  });

  it("renders every CI state coord defines, and UNKNOWN for one it does not", () => {
    for (const [state, kind] of [
      ["held", "held"],
      ["released", "released"],
      ["failed", "failed"],
      ["nothing_to_delabel", "nothing_to_delabel"],
      ["overridden_externally", "overridden_externally"],
      ["left_paused_quarantined", "left_paused_quarantined"],
      ["what_is_this", "unknown"],
    ] as const) {
      const w = win({
        levers: {
          agent_work: { held: true, state: "held" },
          ci: { held: state === "held", state, labels: [] },
        },
      });
      expect(
        deriveLeverStatus("ci", machine({ openWindow: w }), NOW).kind
      ).toBe(kind);
    }
  });

  it("an unreadable window makes both levers UNKNOWN", () => {
    const e = machine({ openWindowUnreadable: true });
    expect(deriveLeverStatus("agent_work", e, NOW).kind).toBe("unknown");
    expect(deriveLeverStatus("ci", e, NOW).kind).toBe("unknown");
  });

  it("a CI host with no workstation has no agent work to pause", () => {
    const e: MachineEntry = {
      kind: "ci_host",
      key: "ci:msi-wsl",
      ciHost: "msi-wsl",
      openWindow: null,
      openWindowUnreadable: false,
      openWindowRawId: null,
    };
    expect(deriveLeverStatus("agent_work", e, NOW).label).toBe(
      "No workstation device"
    );
  });

  it("the attention table is total", () => {
    expect(Object.keys(MAINTENANCE_LEVER_ATTENTION_BY_KIND).sort()).toEqual(
      [
        "failed",
        "held",
        "left_paused_quarantined",
        "no_ci_host",
        "no_ci_host_unpaused",
        "drained_outside_window",
        "window_expired",
        "not_in_window",
        "not_held",
        "nothing_to_delabel",
        "overridden_externally",
        "partial",
        "released",
        "unknown",
      ].sort()
    );
  });
});

describe("leverActionPauses", () => {
  it("offers Pause (the retry) on a partial hold and Resume on a clean one", () => {
    const partial = win({
      levers: {
        agent_work: { held: true, state: "held" },
        ci: { held: true, state: "partial", labels: [] },
      },
    });
    expect(leverActionPauses(machine({ openWindow: partial }), "ci")).toBe(
      true
    );
    expect(
      leverActionPauses(machine({ openWindow: partial }), "agent_work")
    ).toBe(false);
    expect(leverActionPauses(machine(), "ci")).toBe(true);
  });
});

describe("CI registrations", () => {
  const reg = (o: Partial<CiRegistration> = {}): CiRegistration => ({
    repo: "qontinui/qontinui-web",
    runnerName: "merytshost",
    status: "idle",
    lastSeenAt: "2026-09-28T11:59:00Z",
    observedAfterPause: true,
    fresh: true,
    ...o,
  });

  it("an idle reading from BEFORE the pause is not idle — it waits", () => {
    const s = deriveRegistrationStatus(
      reg({ observedAfterPause: false }),
      true
    );
    expect(s.kind).toBe("idle_before_pause");
    expect(s.attention).toBe("waiting");
    expect(seenAfterPauseLabel(reg({ observedAfterPause: false }), true)).toBe(
      "no"
    );
  });

  it("idle after the pause is calm; busy waits; stale is UNKNOWN", () => {
    expect(deriveRegistrationStatus(reg(), true).kind).toBe("idle_after_pause");
    expect(deriveRegistrationStatus(reg({ status: "busy" }), true).kind).toBe(
      "busy"
    );
    expect(deriveRegistrationStatus(reg({ fresh: false }), true).kind).toBe(
      "stale"
    );
  });

  it("with CI not paused, idle says a job may start at any moment", () => {
    expect(deriveRegistrationStatus(reg(), false).reason).toContain(
      "may start"
    );
    expect(seenAfterPauseLabel(reg(), false)).toBe("n/a — CI not paused");
  });

  it("the attention table is total", () => {
    expect(Object.keys(CI_REGISTRATION_ATTENTION_BY_KIND)).toHaveLength(6);
  });

  it("reads a host's registrations from the mirror, and no other host's", () => {
    const rows = registrationsFromMirror(
      [
        {
          device_id: "d1",
          hostname: "gh-runner-merytshost@qontinui/qontinui-web",
          ci_runner_status: "busy",
          ci_runner_labels: [],
          last_seen_at: "2026-09-28T11:59:00Z",
        },
        {
          device_id: "d2",
          hostname: "gh-runner-msi-wsl@qontinui/qontinui-web",
          ci_runner_status: "idle",
          ci_runner_labels: [],
          last_seen_at: null,
        },
      ],
      ["merytshost"]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      repo: "qontinui/qontinui-web",
      status: "busy",
      observedAfterPause: false,
    });
  });
});

describe("validateMaintenanceForm", () => {
  const inAnHour = toLocalInputValue(NOW + 3_600_000);
  const both = { agent_work: true, ci: true };

  it("accepts a reason, a near deadline and a lever", () => {
    const c = validateMaintenanceForm(
      { untilLocal: inAnHour, reason: "kernel", levers: both },
      machine(),
      NOW
    );
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.levers).toEqual(["agent_work", "ci"]);
  });

  it("refuses no lever, a blank reason, no deadline, a past one and one past the cap", () => {
    const e = machine();
    expect(
      validateMaintenanceForm(
        {
          untilLocal: inAnHour,
          reason: "x",
          levers: { agent_work: false, ci: false },
        },
        e,
        NOW
      ).ok
    ).toBe(false);
    expect(
      validateMaintenanceForm(
        { untilLocal: inAnHour, reason: "  ", levers: both },
        e,
        NOW
      ).ok
    ).toBe(false);
    expect(
      validateMaintenanceForm(
        { untilLocal: "", reason: "x", levers: both },
        e,
        NOW
      ).ok
    ).toBe(false);
    expect(
      validateMaintenanceForm(
        {
          untilLocal: toLocalInputValue(NOW - 60_000),
          reason: "x",
          levers: both,
        },
        e,
        NOW
      ).ok
    ).toBe(false);
    expect(
      validateMaintenanceForm(
        {
          untilLocal: toLocalInputValue(NOW + 31 * 86_400_000),
          reason: "x",
          levers: both,
        },
        e,
        NOW
      ).ok
    ).toBe(false);
  });

  it("refuses agent work on a CI host with no workstation", () => {
    const e: MachineEntry = {
      kind: "ci_host",
      key: "ci:h",
      ciHost: "h",
      openWindow: null,
      openWindowUnreadable: false,
      openWindowRawId: null,
    };
    expect(
      validateMaintenanceForm(
        { untilLocal: inAnHour, reason: "x", levers: both },
        e,
        NOW
      ).ok
    ).toBe(false);
  });
});

describe("buildMaintenancePreview", () => {
  it("names the device id, coord's hostname and the host — untruncated", () => {
    const lines = buildMaintenancePreview(
      machine(),
      ["agent_work", "ci"],
      null
    );
    expect(lines.map((l) => l.target)).toEqual([
      `${DEVICE} (merytshost)`,
      "merytshost",
      "merytshost",
    ]);
    expect(lines[0].action).toContain("agent + ci");
  });

  it("lists every (label, repo) outcome after the window opens", () => {
    const lines = buildMaintenancePreview(machine(), ["ci"], win());
    const labels = lines.filter((l) => l.key.startsWith("label-"));
    expect(labels.map((l) => l.target)).toEqual([
      "qontinui/qontinui-web",
      "qontinui/qontinui-coord",
    ]);
  });

  it("says GitHub is not told anything when no host is linked", () => {
    const lines = buildMaintenancePreview(
      machine({ ciHosts: [] }),
      ["ci"],
      null
    );
    expect(lines.some((l) => l.key === "no-host")).toBe(true);
  });
});

describe("describeMaintenanceError", () => {
  it("unwraps coord's typed refusal from the proxy's detail", () => {
    const e = describeMaintenanceError(
      409,
      JSON.stringify({
        detail: {
          error: "last_matching_host",
          message: "last host",
          pool_key: "self-hosted,qontinui",
        },
      })
    );
    expect(e).toEqual({
      code: "last_matching_host",
      message: "last host",
      poolKey: "self-hosted,qontinui",
      machineDeviceId: null,
    });
  });

  it("flattens a validation list and falls back to the body", () => {
    expect(
      describeMaintenanceError(
        422,
        JSON.stringify({ detail: [{ msg: "reason must not be blank" }] })
      ).message
    ).toContain("reason must not be blank");
    expect(describeMaintenanceError(502, "bad gateway").message).toBe(
      "HTTP 502 — bad gateway"
    );
  });
});

describe("maintenanceBadge", () => {
  it("names both levers, one, or neither", () => {
    expect(maintenanceBadge(win(), false, NOW)).toMatchObject({
      state: "in_maintenance",
    });
    const both = maintenanceBadge(win(), false, NOW);
    if (both.state === "in_maintenance")
      expect(both.label).toMatch(/^In maintenance until .+ · CI \+ agents$/);
    const agentOnly = win({
      levers: {
        agent_work: { held: true, state: "held" },
        ci: { held: false, state: "released", labels: [] },
      },
    });
    const a = maintenanceBadge(agentOnly, false, NOW);
    if (a.state === "in_maintenance")
      expect(a.label).toMatch(/^Agent work paused until /);
    expect(maintenanceBadge(null, false, NOW)).toEqual({ state: "in_service" });
    expect(maintenanceBadge(null, true, NOW).state).toBe("unknown");
  });
});

describe("the Overview join", () => {
  const read: MachinesRead = {
    state: "ok",
    refreshError: null,
    entries: [
      machine({ openWindow: win() }),
      {
        kind: "ci_host",
        key: "ci:msi-wsl",
        ciHost: "msi-wsl",
        openWindow: null,
        openWindowUnreadable: false,
      },
    ],
  };

  it("resolves a workstation card by device id, with its declared hosts", () => {
    const v = resolveMachineMaintenance(
      read,
      { deviceId: DEVICE, hostname: "merytshost" },
      {
        "gh-runner-merytshost@a/one": { status: "busy" },
        "gh-runner-merytshost@a/two": { status: "idle" },
        "gh-runner-msi-wsl@a/one": { status: "idle" },
      },
      NOW
    );
    expect(v?.badge.state).toBe("in_maintenance");
    expect(v?.href).toBe(`/admin/coord/machine-maintenance?machine=${DEVICE}`);
    expect(v?.linkedCiHosts).toEqual([
      { host: "merytshost", registrations: 2, busy: 1 },
    ]);
  });

  it("resolves a CI registration card to the machine that declared its host", () => {
    const v = resolveMachineMaintenance(
      read,
      { deviceId: "other", hostname: "gh-runner-merytshost@a/one" },
      {},
      NOW
    );
    expect(v?.href).toBe(`/admin/coord/machine-maintenance?machine=${DEVICE}`);
    expect(v?.badge.state).toBe("in_maintenance");
    expect(
      maintenanceKeyForCiHostname(
        "gh-runner-msi-wsl@a/one",
        ciHostOwners(read.state === "ok" ? read.entries : [])
      )
    ).toBe("ci:msi-wsl");
  });

  it("is UNKNOWN when the read failed, and absent for a row that names no machine", () => {
    const v = resolveMachineMaintenance(
      { state: "unknown", reason: "HTTP 404" },
      { deviceId: DEVICE, hostname: "x" },
      {},
      NOW
    );
    expect(v?.badge.state).toBe("unknown");
    expect(
      resolveMachineMaintenance(
        read,
        { deviceId: undefined, hostname: "laptop" },
        {},
        NOW
      )
    ).toBeNull();
  });

  it("counts no registrations for a host the map does not carry", () => {
    expect(summarizeLinkedCiHosts(["nobody"], {})).toEqual([
      { host: "nobody", registrations: 0, busy: 0 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Review round: raw drains, refresh errors, expiry, partial badges
// ---------------------------------------------------------------------------

const DRAINED: DeviceDrainState = {
  state: "drained",
  entry: {
    until: "2026-09-28T18:00:00Z",
    reason: "agent drained it",
    drainedBy: "agent",
    drainedAt: "2026-09-28T11:00:00Z",
    lanes: ["agent"],
    byLane: null,
  },
};
const ctx = (o: Partial<MaintenanceContext> = {}): MaintenanceContext => ({
  drain: { state: "not_drained" },
  refreshError: null,
  ...o,
});

describe("a raw drain outside any window", () => {
  it("renders the drained lane as author-tone 'Drained outside a maintenance window', never not_held", () => {
    const agent = deriveLeverStatus(
      "agent_work",
      machine(),
      NOW,
      ctx({ drain: DRAINED })
    );
    expect(agent.kind).toBe("drained_outside_window");
    expect(agent.label).toBe("Drained outside a maintenance window");
    expect(agent.reason).toContain("lanes agent work");
    expect(agent.attention).toBe("author");
    // The CI lane is not in this drain.
    expect(
      deriveLeverStatus("ci", machine(), NOW, ctx({ drain: DRAINED })).kind
    ).toBe("not_held");
  });

  it("a legacy lane-less drain holds both lanes", () => {
    const both: DeviceDrainState = {
      state: "drained",
      entry: {
        ...(DRAINED.state === "drained" ? DRAINED.entry : ({} as never)),
        lanes: null,
      },
    };
    expect(
      deriveLeverStatus("ci", machine(), NOW, ctx({ drain: both })).kind
    ).toBe("drained_outside_window");
  });

  it("an unreadable drain is UNKNOWN, not 'running'", () => {
    const s = deriveLeverStatus(
      "agent_work",
      machine(),
      NOW,
      ctx({ drain: { state: "unknown", reason: "HTTP 404" } })
    );
    expect(s.kind).toBe("unknown");
  });

  it("the badge says 'Drained (outside a window)', and the verdict names it", () => {
    expect(maintenanceBadge(null, false, NOW, DRAINED)).toMatchObject({
      state: "drained_outside",
      label: "Drained (outside a window)",
    });
    expect(
      maintenanceBadge(null, false, NOW, { state: "unknown", reason: "x" })
        .state
    ).toBe("unknown");
    const h = deriveVerdictHealth(
      null,
      { state: "no_window" },
      NOW,
      ctx({ drain: DRAINED })
    );
    expect(h.level).toBe("red");
    expect(h.detail).toContain("a drain outside any window holds agent work");
  });
});

describe("a failed machines refresh", () => {
  it("makes 'no window' UNKNOWN in the verdict and the levers", () => {
    const c = ctx({ refreshError: "HTTP 502" });
    const h = deriveVerdictHealth(null, { state: "no_window" }, NOW, c);
    expect(h.headline).toBe("Restart readiness UNKNOWN");
    expect(h.detail).toContain("HTTP 502");
    expect(deriveLeverStatus("ci", machine(), NOW, c).kind).toBe("unknown");
  });
});

describe("an ended window", () => {
  const expired = () => win({ state: "expired" });

  it("renders 'expired — restoring' in the verdict, the levers and the badge", () => {
    expect(deriveVerdictHealth(expired(), readiness(), NOW).headline).toBe(
      "Maintenance window expired — restoring"
    );
    expect(
      deriveLeverStatus("ci", machine({ openWindow: expired() }), NOW).kind
    ).toBe("window_expired");
    expect(maintenanceBadge(expired(), false, NOW).state).toBe("expired");
  });
});

describe("a lever the window does not name", () => {
  it("reads 'Not part of this window' from requested_levers — not from a missing key", () => {
    // Coord always sends both keys under `levers`; only `requested_levers`
    // says which the window pauses.
    const w = win({
      requested_levers: ["ci"],
      levers: {
        agent_work: { held: false, state: "released" },
        ci: { held: true, state: "held", labels: [] },
      },
    });
    const s = deriveLeverStatus("agent_work", machine({ openWindow: w }), NOW);
    expect(s.kind).toBe("not_in_window");
    expect(s.label).toBe("Not part of this window");
    expect(deriveLeverStatus("ci", machine({ openWindow: w }), NOW).kind).toBe(
      "held"
    );
  });

  it("is UNKNOWN for an unheld lever when an older coord sends no requested_levers", () => {
    const w = win({
      requested_levers: undefined,
      levers: {
        agent_work: { held: false, state: "released" },
        ci: { held: true, state: "held", labels: [] },
      },
    });
    expect(w.levers.agentWork.inWindow).toBeNull();
    expect(
      deriveLeverStatus("agent_work", machine({ openWindow: w }), NOW).kind
    ).toBe("unknown");
    // A HELD lever is plainly part of the window — no guess needed.
    expect(deriveLeverStatus("ci", machine({ openWindow: w }), NOW).kind).toBe(
      "held"
    );
  });

  it("drops entries it does not know, and reads a non-list as UNKNOWN", () => {
    expect(
      win({ requested_levers: ["ci", "builds", 7] }).levers.agentWork.inWindow
    ).toBe(false);
    expect(win({ requested_levers: ["ci", "builds"] }).levers.ci.inWindow).toBe(
      true
    );
    expect(win({ requested_levers: "ci" }).levers.ci.inWindow).toBeNull();
  });
});

describe("a stale verdict", () => {
  it("forces every plane badge to UNKNOWN", () => {
    const stale = readiness({
      computed_at: new Date(
        NOW - (VERDICT_STALE_SECS + 30) * 1000
      ).toISOString(),
    });
    const h = deriveVerdictHealth(win(), stale, NOW);
    expect(h.badges.map((b) => b.label)).toEqual([
      "agent UNKNOWN",
      "GitHub CI UNKNOWN",
      "CI-node UNKNOWN",
    ]);
  });
});

describe("the badge branches on the CI state", () => {
  const withCi = (ci: Record<string, unknown>) =>
    win({
      levers: {
        agent_work: { held: true, state: "held" },
        ci: { labels: [], ...ci },
      },
    });

  it("partial, restored by hand, and an unknown state are not the calm line", () => {
    expect(
      maintenanceBadge(withCi({ held: true, state: "partial" }), false, NOW)
    ).toMatchObject({
      state: "attention",
    });
    const partial = maintenanceBadge(
      withCi({ held: true, state: "partial" }),
      false,
      NOW
    );
    if (partial.state === "attention")
      expect(partial.label).toMatch(/^CI partly paused until /);
    const byHand = maintenanceBadge(
      withCi({ held: false, state: "overridden_externally" }),
      false,
      NOW
    );
    if (byHand.state === "attention")
      expect(byHand.label).toMatch(/^CI label restored by hand/);
    expect(byHand.state).toBe("attention");
    expect(
      maintenanceBadge(withCi({ held: true, state: "mystery" }), false, NOW)
        .state
    ).toBe("unknown");
  });
});

describe("stillRoutingCount", () => {
  it("counts distinct repos that failed or whose outcome is UNKNOWN", () => {
    expect(
      stillRoutingCount([
        {
          label: "a",
          repo: "r/one",
          outcome: "failed",
          rawOutcome: "failed",
          detail: null,
        },
        {
          label: "b",
          repo: "r/one",
          outcome: "failed",
          rawOutcome: "failed",
          detail: null,
        },
        {
          label: "a",
          repo: "r/two",
          outcome: null,
          rawOutcome: "weird",
          detail: null,
        },
        {
          label: "a",
          repo: "r/three",
          outcome: "removed",
          rawOutcome: "removed",
          detail: null,
        },
      ])
    ).toBe(2);
  });
});

describe("an unreadable window", () => {
  it("keeps coord's raw id so it can still be returned to service", () => {
    const read = parseMachines({
      machines: [
        { device_id: DEVICE, ci_hosts: [], open_window: { id: WINDOW } },
      ],
    });
    if (read.state !== "ok") throw new Error("expected ok");
    expect(read.entries[0].openWindowRawId).toBe(WINDOW);
  });
});

describe("a CI card coord's list does not name", () => {
  it("is UNKNOWN, not in service", () => {
    const read: MachinesRead = {
      state: "ok",
      refreshError: null,
      entries: [machine()],
    };
    const v = resolveMachineMaintenance(
      read,
      { deviceId: "x", hostname: "gh-runner-stranger@a/b" },
      {},
      NOW
    );
    expect(v?.badge).toMatchObject({
      state: "unknown",
      title: "coord's machine list does not name this CI host",
    });
  });
});

// ---------------------------------------------------------------------------
// Review round 2
// ---------------------------------------------------------------------------

describe("round 2", () => {
  it("a drain read that failed is named in the no-window verdict, never 'nothing is paused'", () => {
    const h = deriveVerdictHealth(
      null,
      { state: "no_window" },
      NOW,
      ctx({ drain: { state: "unknown", reason: "HTTP 404" } })
    );
    expect(h.level).toBe("red");
    expect(h.detail).toContain(
      "whether a drain holds this machine is not known — HTTP 404"
    );
    expect(h.detail).not.toContain("nothing is paused");
  });

  it("a kept machines list after a failed refresh badges 'no window' as UNKNOWN", () => {
    const read: MachinesRead = {
      state: "ok",
      refreshError: "HTTP 502",
      entries: [machine()],
    };
    const v = resolveMachineMaintenance(
      read,
      { deviceId: DEVICE, hostname: "merytshost" },
      {},
      NOW
    );
    expect(v?.badge.state).toBe("unknown");
    if (v?.badge.state === "unknown")
      expect(v.badge.title).toContain("HTTP 502");
    // An open window is still read from the kept list — it is evidence.
    const withWindow: MachinesRead = {
      ...read,
      entries: [machine({ openWindow: win() })],
    };
    expect(
      resolveMachineMaintenance(
        withWindow,
        { deviceId: DEVICE, hostname: "merytshost" },
        {},
        NOW
      )?.badge.state
    ).toBe("in_maintenance");
  });

  it("a raw drain marks the picker entry like the card", () => {
    expect(machineEntryBadge(machine(), NOW, DRAINED, null).state).toBe(
      "drained_outside"
    );
    expect(machineEntryBadge(machine(), NOW, null, null).state).toBe(
      "in_service"
    );
  });

  it("picker and card share one badge rule for a stale 'no window'", () => {
    // Stale list, no raw drain: UNKNOWN, with the refresh error.
    const stale = machineEntryBadge(
      machine(),
      NOW,
      { state: "not_drained" },
      "HTTP 502"
    );
    expect(stale.state).toBe("unknown");
    // A SUCCESSFULLY read raw drain is independent evidence and wins.
    expect(machineEntryBadge(machine(), NOW, DRAINED, "HTTP 502").state).toBe(
      "drained_outside"
    );
    const read: MachinesRead = {
      state: "ok",
      refreshError: "HTTP 502",
      entries: [machine()],
    };
    expect(
      resolveMachineMaintenance(
        read,
        { deviceId: DEVICE, hostname: "merytshost" },
        {},
        NOW,
        DRAINED
      )?.badge.state
    ).toBe("drained_outside");
  });

  it("does not double the period of a drain reason that already ends with one", () => {
    const drain = resolveDeviceDrain({ state: "loading" }, DEVICE, NOW);
    expect(drain.state).toBe("unknown");
    if (drain.state !== "unknown") return;
    expect(drain.reason.endsWith(".")).toBe(true);
    const h = deriveVerdictHealth(
      null,
      { state: "no_window" },
      NOW,
      ctx({ drain })
    );
    expect(h.detail).toContain(
      `not known — ${drain.reason.slice(0, -1)}. Prepare for restart`
    );
    expect(h.detail).not.toContain("..");
  });
});

describe("per-lane drain rendering", () => {
  const PER_LANE: DeviceDrainState = {
    state: "drained",
    entry: {
      // Headline = the lane that ends LAST (ci).
      until: "2026-09-28T20:00:00Z",
      reason: "ci box rebuild",
      drainedBy: "[redacted]",
      drainedAt: "2026-09-28T11:00:00Z",
      lanes: ["agent", "ci"],
      byLane: {
        agent: {
          until: "2026-09-28T14:00:00Z",
          reason: "agent pause",
          drainedBy: "jan@example.com",
          drainedAt: "2026-09-28T10:00:00Z",
        },
        ci: {
          until: "2026-09-28T20:00:00Z",
          reason: "ci box rebuild",
          drainedBy: "[redacted]",
          drainedAt: "2026-09-28T11:00:00Z",
        },
      },
    },
  };

  it("each lever shows its OWN lane's until and reason, not the headline's", () => {
    const agent = deriveLeverStatus(
      "agent_work",
      machine(),
      NOW,
      ctx({ drain: PER_LANE })
    );
    expect(agent.kind).toBe("drained_outside_window");
    expect(agent.reason).toContain(
      `until ${formatUntil("2026-09-28T14:00:00Z", NOW)} — agent pause`
    );
    const ci = deriveLeverStatus(
      "ci",
      machine(),
      NOW,
      ctx({ drain: PER_LANE })
    );
    expect(ci.reason).toContain(
      `until ${formatUntil("2026-09-28T20:00:00Z", NOW)} — ci box rebuild`
    );
  });

  it("a lane whose own deadline passed is no longer drained, while the other holds", () => {
    const later = Date.parse("2026-09-28T15:00:00Z");
    expect(
      deriveLeverStatus(
        "agent_work",
        machine(),
        later,
        ctx({ drain: PER_LANE })
      ).kind
    ).toBe("not_held");
    expect(
      deriveLeverStatus("ci", machine(), later, ctx({ drain: PER_LANE })).kind
    ).toBe("drained_outside_window");
  });

  it("the badge title lists each lane's own hold", () => {
    const b = maintenanceBadge(null, false, NOW, PER_LANE);
    expect(b.state).toBe("drained_outside");
    if (b.state === "drained_outside") {
      expect(b.title).toContain("agent work until");
      expect(b.title).toContain("agent pause");
      expect(b.title).toContain("CI until");
      expect(b.title).toContain("ci box rebuild");
    }
  });
});

describe("per-lane drains — round 5", () => {
  const hold = (until: string, reason: string) => ({
    until,
    reason,
    drainedBy: "jan@example.com",
    drainedAt: "2026-09-28T10:00:00Z",
  });
  const PER: DeviceDrainState = {
    state: "drained",
    entry: {
      ...hold("2026-09-28T20:00:00Z", "ci box rebuild"),
      lanes: ["agent", "ci"],
      byLane: {
        agent: hold("2026-09-28T14:00:00Z", "agent pause"),
        ci: hold("2026-09-28T20:00:00Z", "ci box rebuild"),
      },
    },
  };

  it("the no-window verdict lists only the lanes still held, each by its own hold", () => {
    const later = Date.parse("2026-09-28T15:00:00Z");
    const h = deriveVerdictHealth(
      null,
      { state: "no_window" },
      later,
      ctx({ drain: PER })
    );
    expect(h.detail).toContain(
      `CI until ${formatUntil("2026-09-28T20:00:00Z", later)} — ci box rebuild`
    );
    expect(h.detail).not.toContain("agent pause");
    expect(h.detail).not.toContain("nothing is paused");
  });

  it("a lane whose per-lane entry was dropped is UNKNOWN on the lever and in the badge", () => {
    const dropped: DeviceDrainState = {
      state: "drained",
      entry: { ...PER.entry, byLane: {} },
    };
    expect(
      deriveLeverStatus("agent_work", machine(), NOW, ctx({ drain: dropped }))
        .kind
    ).toBe("unknown");
    expect(maintenanceBadge(null, false, NOW, dropped).state).toBe("unknown");
    const h = deriveVerdictHealth(
      null,
      { state: "no_window" },
      NOW,
      ctx({ drain: dropped })
    );
    expect(h.detail).toContain("agent work UNKNOWN");
    expect(h.detail).not.toContain("nothing is paused");
  });
});

describe("per-lane drains — round 6", () => {
  it("a badge with one readable and one unreadable lane is drained, naming the unknown one", () => {
    const mixed: DeviceDrainState = {
      state: "drained",
      entry: {
        until: "2026-09-28T20:00:00Z",
        reason: "ci box",
        drainedBy: "jan",
        drainedAt: "2026-09-28T10:00:00Z",
        lanes: ["agent", "ci"],
        byLane: {
          ci: {
            until: "2026-09-28T20:00:00Z",
            reason: "ci box",
            drainedBy: "jan",
            drainedAt: "2026-09-28T10:00:00Z",
          },
        },
      },
    };
    const b = maintenanceBadge(null, false, NOW, mixed);
    expect(b.state).toBe("drained_outside");
    if (b.state === "drained_outside") {
      expect(b.title).toContain("CI until");
      expect(b.title).toContain("agent work UNKNOWN");
    }
    const h = deriveVerdictHealth(
      null,
      { state: "no_window" },
      NOW,
      ctx({ drain: mixed })
    );
    expect(h.detail).toContain("a drain outside any window is recorded:");
  });
});

describe("coord Phase 3-5 contract details", () => {
  const withAgent = (state: string, held: boolean) =>
    win({
      levers: {
        agent_work: { held, state },
        ci: { held: true, state: "held", labels: [] },
      },
    });

  it("renders hold_failed and release_failed each with its own label; plain 'failed' is now UNKNOWN", () => {
    const hold = deriveLeverStatus(
      "agent_work",
      machine({ openWindow: withAgent("hold_failed", false) }),
      NOW
    );
    expect(hold.kind).toBe("failed");
    expect(hold.label).toBe("Pause failed");
    const rel = deriveLeverStatus(
      "agent_work",
      machine({ openWindow: withAgent("release_failed", true) }),
      NOW
    );
    expect(rel.kind).toBe("failed");
    expect(rel.label).toBe("Release failed");
    expect(
      deriveLeverStatus(
        "agent_work",
        machine({ openWindow: withAgent("failed", false) }),
        NOW
      ).kind
    ).toBe("unknown");
  });

  it("retries a failed hold as a pause and a failed release as a resume", () => {
    expect(
      leverActionPauses(
        machine({ openWindow: withAgent("hold_failed", false) }),
        "agent_work"
      )
    ).toBe(true);
    expect(
      leverActionPauses(
        machine({ openWindow: withAgent("release_failed", true) }),
        "agent_work"
      )
    ).toBe(false);
  });

  it("badges each agent failure by name", () => {
    const b = maintenanceBadge(withAgent("release_failed", true), false, NOW);
    expect(b.state).toBe("attention");
    if (b.state === "attention")
      expect(b.label).toBe("Agent work release failed");
  });

  it("reads the new refusal codes with a next step, and names the machine for a linked host", () => {
    const linked = describeMaintenanceError(
      409,
      JSON.stringify({
        detail: {
          error: "ci_host_linked_to_machine",
          message: "merytshost is linked to a machine",
          machine_device_id: DEVICE,
        },
      })
    );
    expect(linked.machineDeviceId).toBe(DEVICE);
    expect(maintenanceErrorGuidance(linked)).toContain(
      "open the window on that machine"
    );
    expect(errorWantsReread(linked)).toBe(true);
    for (const code of ["window_busy", "window_changed", "invalid_request"]) {
      const e = describeMaintenanceError(
        409,
        JSON.stringify({ error: code, message: "m" })
      );
      expect(maintenanceErrorGuidance(e)).not.toBeNull();
    }
    expect(
      errorWantsReread({
        code: "window_busy",
        message: "",
        poolKey: null,
        machineDeviceId: null,
      })
    ).toBe(true);
    expect(
      errorWantsReread({
        code: "invalid_request",
        message: "",
        poolKey: null,
        machineDeviceId: null,
      })
    ).toBe(false);
  });

  it("ignores extra lever fields, and reads each label row's host", () => {
    const w = parseMaintenanceWindow({
      id: WINDOW,
      state: "open",
      until: "2026-09-28T18:00:00Z",
      requested_levers: ["ci"],
      levers: {
        agent_work: { held: false, state: "released", rev: 3, placements: [] },
        ci: {
          held: true,
          state: "held",
          rev: 7,
          override_seen_at: null,
          placements: [{ repo: "a/one" }],
          labels: [
            {
              label: "qontinui",
              repo: "a/one",
              host: "merytshost",
              outcome: "removed",
            },
            {
              label: "qontinui",
              repo: "a/one",
              host: "msi-wsl",
              outcome: "removed",
            },
          ],
        },
      },
    });
    expect(w).not.toBeNull();
    expect(w!.levers.ci.labels.map((l) => l.host)).toEqual([
      "merytshost",
      "msi-wsl",
    ]);
    expect(labelsSpanHosts(w!.levers.ci.labels)).toBe(true);
    expect(labelsSpanHosts([w!.levers.ci.labels[0]])).toBe(false);
    const preview = buildMaintenancePreview(
      machine({ ciHosts: ["merytshost", "msi-wsl"] }),
      ["ci"],
      w
    );
    expect(
      preview.filter((l) => l.key.startsWith("label-")).map((l) => l.target)
    ).toEqual(["a/one on merytshost", "a/one on msi-wsl"]);
  });
});

describe("coord contract — round 9", () => {
  it("reads the linked machine from linked_device_id first, the others as fallbacks", () => {
    const both = describeMaintenanceError(
      409,
      JSON.stringify({
        error: "ci_host_linked_to_machine",
        message: "m",
        linked_device_id: DEVICE,
        device_id: "other",
      })
    );
    expect(both.machineDeviceId).toBe(DEVICE);
    const fallback = describeMaintenanceError(
      409,
      JSON.stringify({
        error: "ci_host_linked_to_machine",
        message: "m",
        device_id: "other",
      })
    );
    expect(fallback.machineDeviceId).toBe("other");
  });

  it("words the agent states plainly, and window_changed as a re-read in progress", () => {
    expect(agentLeverStateWords("release_failed")).toBe(
      "coord reports the release failed; the window's drain still holds — retry the resume"
    );
    expect(agentLeverStateWords("hold_failed")).toBe("the pause failed");
    expect(agentLeverStateWords(null)).toBe("UNKNOWN");
    expect(
      maintenanceErrorGuidance({
        code: "window_changed",
        message: "",
        poolKey: null,
        machineDeviceId: null,
      })
    ).toContain("the page is re-reading it");
  });
});

describe("coord's final contract — label rows and error codes", () => {
  const row = (
    o: Partial<{ repo: string; outcome: string; detail: string | null }>
  ) =>
    parseMaintenanceWindow(
      wireWindow({
        levers: {
          agent_work: { held: true, state: "held" },
          ci: {
            held: true,
            state: "partial",
            labels: [
              {
                label: "qontinui",
                repo: "a/one",
                outcome: "removed",
                detail: null,
                ...o,
              },
            ],
          },
        },
      })
    )!.levers.ci.labels[0];

  it("a pending removal reads 'removal in progress' and still routes", () => {
    const l = row({ outcome: "removed", detail: "pending: write sent" });
    expect(labelOutcomeLabel(l)).toBe("removal in progress");
    expect(stillRoutingCount([l])).toBe(1);
  });

  it("a removal GitHub never answered shows coord's words and still routes", () => {
    const l = row({
      outcome: "removed",
      detail: "outcome unknown; will be restored at window end",
    });
    expect(labelOutcomeLabel(l)).toBe(
      "outcome unknown; will be restored at window end"
    );
    expect(stillRoutingCount([l])).toBe(1);
    // …and is not counted among the repos whose label is off.
    const w = win({
      levers: {
        agent_work: { held: true, state: "held" },
        ci: {
          held: true,
          state: "partial",
          labels: [
            {
              label: "qontinui",
              repo: "a/one",
              outcome: "removed",
              detail: "outcome unknown; will be restored",
            },
            {
              label: "qontinui",
              repo: "a/two",
              outcome: "removed",
              detail: null,
            },
          ],
        },
      },
    });
    expect(
      deriveLeverStatus("ci", machine({ openWindow: w }), NOW).reason
    ).toContain("1 repo still routes here");
  });

  it("a label-level refusal with repo '*' reads 'all repos' and names no repo", () => {
    const l = row({
      repo: "*",
      outcome: "failed",
      detail: "github_read_only_label",
    });
    expect(labelRepoDisplay(l)).toBe("all repos");
    expect(labelRepos([l])).toEqual([]);
  });

  it("maps the new refusal codes to a next step", () => {
    const err = (code: string, extra: Record<string, unknown> = {}) =>
      describeMaintenanceError(
        409,
        JSON.stringify({ error: code, message: "m", ...extra })
      );
    expect(maintenanceErrorGuidance(err("window_not_open"))).toContain(
      "already ended"
    );
    expect(errorWantsReread(err("window_not_open"))).toBe(true);
    expect(maintenanceErrorGuidance(err("schema_pending"))).toBe(
      SCHEMA_PENDING_REASON
    );
    expect(maintenanceErrorGuidance(err("admin_required"))).toContain(
      "tenant admin"
    );
    expect(errorWantsReread(err("not_found"))).toBe(true);
    const drain = err("drain_refused", {
      drain: { error: "device_not_in_tenant", message: "not yours" },
    });
    expect(drain.message).toBe("not yours");
    // invalid_request may arrive as 400 or 422.
    for (const status of [400, 422]) {
      const e = describeMaintenanceError(
        status,
        JSON.stringify({
          error: "invalid_request",
          message: "unknown field `x`",
        })
      );
      expect(e.code).toBe("invalid_request");
      expect(e.message).toBe("unknown field `x`");
    }
  });
});

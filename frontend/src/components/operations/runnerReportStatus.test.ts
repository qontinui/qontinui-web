/**
 * The runner-report derivation (plan
 * `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8) and the one rule it holds: a report coord could not serve is
 * UNKNOWN with its reason — never "no incidents", never "no mechanisms".
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  RUNNER_DATABASE_UNKNOWN_REASONS,
  type FleetHealthDevice,
  type FleetHealthPayload,
  type RunnerDatabaseReading,
  type RunnerDatabaseServed,
  type RunnerReportMeta,
  type RunnerReportsMeta,
} from "@/lib/api/operations/coordFleet";
import {
  CAPABILITY_ATTENTION_BY_STATE,
  CAPABILITY_PALETTE,
  DATABASE_ATTENTION_BY_STATE,
  DATABASE_PALETTE,
  WEDGE_ATTENTION_BY_STATE,
  WEDGE_PALETTE,
  capabilityStatus,
  groupCapability,
  presentedUnknownReason,
  resolveRunnerDatabase,
  resolveRunnerReports,
  runnerDatabaseTallyBadge,
  wedgeStatus,
} from "./runnerReportStatus";
import { FAILURE_REASON_WITHHELD } from "./presentedFailure";

const FRESH: RunnerReportMeta = {
  absent_reason: null,
  received_at: "2026-09-30T09:59:00Z",
  stale: false,
  dropped_entries: 0,
  omitted_by_runner: 0,
  error: null,
};

function meta(
  wedge: Partial<RunnerReportMeta>,
  capability: Partial<RunnerReportMeta> = {}
): RunnerReportsMeta {
  return {
    wedge_incidents: { ...FRESH, ...wedge },
    capability: { ...FRESH, ...capability },
    stale_after_secs: 900,
  };
}

describe("palettes agree with their audit tables (§4.2)", () => {
  it("capability", () => {
    expect(
      paletteDisagreements(CAPABILITY_ATTENTION_BY_STATE, CAPABILITY_PALETTE)
    ).toEqual([]);
  });
  it("wedge", () => {
    expect(
      paletteDisagreements(WEDGE_ATTENTION_BY_STATE, WEDGE_PALETTE)
    ).toEqual([]);
  });
  it("database", () => {
    expect(
      paletteDisagreements(DATABASE_ATTENTION_BY_STATE, DATABASE_PALETTE)
    ).toEqual([]);
  });
  it("unknown is never calm", () => {
    expect(CAPABILITY_ATTENTION_BY_STATE.unknown).toBe("waiting");
    expect(DATABASE_ATTENTION_BY_STATE.unknown).toBe("waiting");
  });
});

describe("capabilityStatus / groupCapability", () => {
  it("maps each wire state and names an unrecognised one as unknown", () => {
    expect(
      capabilityStatus({ mechanism: "m", state: "INOPERATIVE-ON-THIS-MACHINE" })
        .kind
    ).toBe("inoperative");
    const odd = capabilityStatus({ mechanism: "m", state: "HALF-WORKING" });
    expect(odd.kind).toBe("unknown");
    expect(odd.reason).toContain('"HALF-WORKING"');
  });

  it("says when coord aged the runner's verdict", () => {
    const aged = capabilityStatus({
      mechanism: "m",
      state: "UNKNOWN",
      reported_state: "OPERATIVE",
    });
    expect(aged.kind).toBe("unknown");
    expect(aged.reason).toContain("(OPERATIVE) to UNKNOWN");
  });

  it("groups INOPERATIVE first, then degraded, unknown, operative; empty groups dropped", () => {
    const groups = groupCapability([
      { mechanism: "z-ok", state: "OPERATIVE" },
      { mechanism: "b-dead", state: "INOPERATIVE-ON-THIS-MACHINE" },
      { mechanism: "a-dead", state: "INOPERATIVE-ON-THIS-MACHINE" },
      { mechanism: "q", state: "UNKNOWN" },
    ]);
    expect(groups.map((g) => g.kind)).toEqual([
      "inoperative",
      "unknown",
      "operative",
    ]);
    expect(groups[0].rows.map((r) => r.mechanism)).toEqual(["a-dead", "b-dead"]);
  });
});

describe("wedgeStatus", () => {
  it("an incident with no end is OPEN and red", () => {
    const w = wedgeStatus({
      kind: "backend_wedged",
      began_at: "2026-09-30T09:00:00Z",
      ended_at: null,
    });
    expect(w.kind).toBe("open");
    expect(w.attention).toBe("author");
    expect(w.label).toBe("wedged: backend_wedged");
  });
});

describe("resolveRunnerReports — null is unknown with a reason, never none", () => {
  it("served lists are reads; an empty list is a measured none", () => {
    const r = resolveRunnerReports({
      wedge_incidents: [],
      capability: [],
      runner_reports: meta({}),
    });
    expect(r.wedge.state).toBe("read");
    expect(r.capability.state).toBe("read");
    if (r.wedge.state === "read") {
      expect(r.wedge.items.open).toEqual([]);
      expect(r.wedge.stale).toBe(false);
    }
  });

  it("carries coord's absent_reason verbatim, with the runner's own error", () => {
    const r = resolveRunnerReports({
      wedge_incidents: null,
      capability: null,
      runner_reports: meta(
        { absent_reason: "build_nameable_key_absent", received_at: null, stale: null },
        {
          absent_reason: "publisher_error",
          error: "capability dir unreadable",
        }
      ),
    });
    expect(r.wedge).toMatchObject({
      state: "unknown",
      reason: "build_nameable_key_absent",
    });
    expect(r.capability).toMatchObject({
      state: "unknown",
      reason: "publisher_error",
    });
    if (r.capability.state === "unknown") {
      expect(r.capability.detail).toContain("capability dir unreadable");
    }
  });

  it("a failed runner-report read is coord's failure, not the runner's silence", () => {
    const r = resolveRunnerReports({
      wedge_incidents: null,
      capability: null,
      runner_reports: null,
      runner_reports_scrape_up: false,
    });
    expect(r.wedge).toMatchObject({
      state: "unknown",
      reason: "runner-report read failed",
    });
  });

  it("a coord predating the fields is unknown, never none", () => {
    const r = resolveRunnerReports({});
    expect(r.wedge).toMatchObject({
      state: "unknown",
      reason: "coord does not serve runner reports",
    });
    expect(r.capability.state).toBe("unknown");
  });

  it("a stale or undated served report is shown but labelled stale", () => {
    const stale = resolveRunnerReports({
      wedge_incidents: [],
      capability: [],
      runner_reports: meta({ stale: true }, { stale: null }),
    });
    expect(stale.wedge.state === "read" && stale.wedge.stale).toBe(true);
    expect(stale.capability.state === "read" && stale.capability.stale).toBe(
      true
    );
  });

  it("splits open from ended incidents", () => {
    const r = resolveRunnerReports({
      wedge_incidents: [
        { kind: "a", began_at: "2026-09-30T09:00:00Z", ended_at: null },
        {
          kind: "b",
          began_at: "2026-09-29T09:00:00Z",
          ended_at: "2026-09-29T09:05:00Z",
          ended_by: "cleared",
        },
      ],
      capability: [],
      runner_reports: meta({}),
    });
    if (r.wedge.state !== "read") throw new Error("expected a read");
    expect(r.wedge.items.open.map((w) => w.incident.kind)).toEqual(["a"]);
    expect(r.wedge.items.ended.map((w) => w.incident.kind)).toEqual(["b"]);
  });
});

// ----------------------------------------------------------------------------
// The runner-database verdict (plan
// `2026-11-27-devops-runner-database-degraded-is-invisible-to-coord` Phase 6).
// Fixtures follow coord's served shape (qontinui-coord, plan Phase 2:
// `runner_reports.rs` `RunnerDatabaseServed`). The degraded one is built from
// nawa's `/health` evidence in that plan ("Evidence", 2026-11-27 03:37:28Z):
// `arm`, the breaker's `state` / `cause` / `since` / `failed_trials` /
// `trips` / `last_error`, and `build_id` are VERBATIM. `cause_class`,
// `reachable`, `schema_ok`, `observed_at`, `embedded_data_root`,
// `reported_at` and the breaker's `open_for_ms` are ILLUSTRATIVE — the
// evidence does not quote them (the data root's username is replaced).
// ----------------------------------------------------------------------------

/** nawa's `breaker.lastError`, verbatim from the plan's evidence. */
const LAST_ERROR =
  "PostgreSQL connection failed: Error occurred while creating a new object: error connecting to server <- Connection refused (os error 111)";

/** nawa on 2026-11-24: booted onto the degraded arm, breaker force-opened at boot. */
const NAWA_READING: RunnerDatabaseReading = {
  arm: "degraded",
  reachable: false,
  schema_ok: null,
  breaker: {
    state: "open",
    cause: "boot",
    cause_class: "connect_refused",
    since: "2026-11-24T16:03:53Z",
    failed_trials: 14786,
    trips: 1,
    last_error: LAST_ERROR,
    open_for_ms: null,
  },
  embedded_data_root:
    "/home/operator/.local/share/com.qontinui.runner/embedded-pg",
  observed_at: "2026-11-24T16:04:58Z",
  stale: false,
  build_id: "4d524e71b",
  reported_at: "2026-11-27T03:37:20Z",
};

const NAWA_DEGRADED: RunnerDatabaseServed = {
  verdict: "degraded",
  reason: "boot_without_database",
  since: "2026-11-24T16:03:53Z",
  reading: NAWA_READING,
};

/** A runner whose breaker CLOSED again: `last_error` survives the close (runner `circuit.rs` `snapshot_locked`). */
const RECOVERED_OK: RunnerDatabaseServed = {
  verdict: "ok",
  reason: null,
  since: null,
  reading: {
    ...NAWA_READING,
    arm: "external",
    reachable: true,
    breaker: {
      state: "closed",
      cause: null,
      cause_class: null,
      since: null,
      failed_trials: 0,
      trips: 3,
      last_error: LAST_ERROR,
      open_for_ms: null,
    },
  },
};

/**
 * The exclusions a current coord serves when it withheld no device. Every
 * tally body a test expects to vouch for the fleet carries it: a body with no
 * `excluded` does not say it withheld none, which is not a whole roster.
 */
const NONE_WITHHELD = {
  excluded: { unbound: 0, bound_to_other_tenant: 0 },
  excluded_error: null,
} satisfies Partial<FleetHealthPayload>;

/**
 * coord's `the_dated_onset_holds_for_the_whole_outage`: the runner's
 * `breaker.since` runs ahead of the onset `open_for_ms` dates
 * (`reported_at - open_for_ms` = 17:04:30 - 4270 s = 15:53:20), by more than
 * coord's 60 s, so coord serves the dated onset as `since`.
 */
const DATED_ONSET: RunnerDatabaseServed = {
  verdict: "degraded",
  reason: "boot_without_database",
  since: "2026-11-24T15:53:20Z",
  reading: {
    ...NAWA_READING,
    arm: "degraded",
    breaker: {
      ...NAWA_READING.breaker!,
      cause: "boot",
      since: "2026-11-24T17:05:00Z",
      open_for_ms: 4_270_000,
    },
    reported_at: "2026-11-24T17:04:30Z",
  },
};

function dbMeta(m: Partial<RunnerReportMeta> = {}): RunnerReportsMeta {
  return { ...meta({}), runner_database: { ...FRESH, ...m } };
}

describe("resolveRunnerDatabase — degraded shows the cause and the since", () => {
  it("nawa: booted without its database is red, with cause, since and last error", () => {
    const v = resolveRunnerDatabase({
      runner_database: NAWA_DEGRADED,
      runner_reports: dbMeta(),
    });
    if (v.state !== "degraded")
      throw new Error(`expected degraded, got ${v.state}`);
    expect(v.status.kind).toBe("no_database");
    expect(v.status.attention).toBe("author");
    expect(v.status.label).toBe("degraded");
    expect(v.cause).toContain("booted without its database");
    // That reason already means the degraded arm; the row does not say it twice.
    expect(v.cause).not.toContain("degraded arm");
    expect(v.cause).toContain("connect_refused");
    expect(v.cause).toContain("14786 failed retries");
    expect(v.since).toBe("2026-11-24T16:03:53Z");
    expect(v.lastError).toBe(LAST_ERROR);
  });

  it("a real-arm open breaker is amber: its own trial closes it", () => {
    const v = resolveRunnerDatabase({
      runner_database: {
        verdict: "degraded",
        reason: "breaker_open",
        since: "2026-11-27T10:00:00Z",
        reading: {
          ...NAWA_READING,
          arm: "external",
          breaker: {
            ...NAWA_READING.breaker!,
            state: "half_open",
            cause: "runtime",
          },
        },
      },
    });
    if (v.state !== "degraded") throw new Error("expected degraded");
    expect(v.status.kind).toBe("breaker_open");
    expect(v.status.attention).toBe("waiting");
    // The head IS the breaker's state: never "breaker open · breaker half_open".
    expect(v.cause.startsWith("breaker half_open · ")).toBe(true);
    expect(v.cause).not.toContain("breaker open");
    expect(v.cause).toContain("external arm");
  });

  it("an open real-arm breaker's head reads breaker open, once", () => {
    const v = resolveRunnerDatabase({
      runner_database: {
        verdict: "degraded",
        reason: "breaker_open",
        since: "2026-11-27T10:00:00Z",
        reading: {
          ...NAWA_READING,
          arm: "external",
          breaker: { ...NAWA_READING.breaker!, cause: "runtime" },
        },
      },
    });
    if (v.state !== "degraded") throw new Error("expected degraded");
    expect(v.cause.match(/breaker/g)).toHaveLength(1);
    expect(v.cause.startsWith("breaker open · ")).toBe(true);
  });

  it("a runtime open breaker on the DEGRADED arm is amber (coord's warning) and names the arm", () => {
    const v = resolveRunnerDatabase({
      runner_database: {
        ...NAWA_DEGRADED,
        reason: "breaker_open",
        reading: {
          ...NAWA_READING,
          breaker: { ...NAWA_READING.breaker!, cause: "runtime" },
        },
      },
    });
    if (v.state !== "degraded") throw new Error("expected degraded");
    // A degraded-arm runner that recovered and failed again at runtime:
    // coord pages critical only on `boot_without_database`.
    expect(v.status.kind).toBe("breaker_open");
    expect(v.status.attention).toBe("waiting");
    // Not mistaken for an external-arm blip: the row names the arm.
    expect(v.cause).toContain("degraded arm");
  });

  it("a degraded reason this build does not know is amber unknown, never red, and says so", () => {
    const v = resolveRunnerDatabase({
      runner_database: { ...NAWA_DEGRADED, reason: "future_reason" },
    });
    if (v.state !== "degraded") throw new Error("expected degraded");
    // Red is coord's critical, which keys on `boot_without_database` alone.
    expect(v.status.kind).toBe("unknown");
    expect(v.status.attention).toBe("waiting");
    expect(v.cause).toContain('"future_reason"');
  });

  it("the dated onset: since is coord's served value, never the runner's breaker.since", () => {
    const v = resolveRunnerDatabase({
      runner_database: DATED_ONSET,
      runner_reports: dbMeta(),
    });
    if (v.state !== "degraded") throw new Error("expected degraded");
    // Coord judged 15:53:20; the runner's own breaker says 17:05:00.
    expect(v.since).toBe("2026-11-24T15:53:20Z");
    expect(v.since).not.toBe(DATED_ONSET.reading!.breaker!.since);
    // Booted without its database, dated, with a sustain source: red.
    expect(v.status.kind).toBe("no_database");
  });

  it("a degraded verdict with no onset says the since is unknown, not now", () => {
    const v = resolveRunnerDatabase({
      runner_database: { ...NAWA_DEGRADED, since: null },
    });
    expect(v.state === "degraded" && v.since).toBeNull();
  });

  it("booted without its database but with no onset is amber unknown: coord holds it and never pages (plan D4)", () => {
    const block: RunnerDatabaseServed = { ...NAWA_DEGRADED, since: null };
    const v = resolveRunnerDatabase({ runner_database: block });
    if (v.state !== "degraded") throw new Error("expected degraded");
    expect(v.status.kind).toBe("unknown");
    expect(v.status.attention).toBe("waiting");
    // The runner's own words still show: this is a reading, not a guess.
    expect(v.cause).toContain("booted without its database");
    // And the strip agrees: amber, not red.
    expect(
      runnerDatabaseTallyBadge(
        {
          ...NONE_WITHHELD,
          devices: [{ device_id: "d-0", runner_database: block }],
          by_runner_database: { degraded: 1 },
        },
        null
      ).tone
    ).toBe("waiting");
  });

  it("booted without its database with an onset but no sustain source is amber unknown: coord cannot fire on it", () => {
    const block: RunnerDatabaseServed = {
      ...NAWA_DEGRADED,
      reading: {
        ...NAWA_READING,
        reported_at: null,
        breaker: { ...NAWA_READING.breaker!, open_for_ms: null },
      },
    };
    const v = resolveRunnerDatabase({ runner_database: block });
    if (v.state !== "degraded") throw new Error("expected degraded");
    expect(v.status.kind).toBe("unknown");
    expect(v.status.attention).toBe("waiting");
    expect(
      runnerDatabaseTallyBadge(
        {
          ...NONE_WITHHELD,
          devices: [{ device_id: "d-0", runner_database: block }],
          by_runner_database: { degraded: 1 },
        },
        null
      ).tone
    ).toBe("waiting");
  });

  it("either sustain source is enough for red: open_for_ms without reported_at", () => {
    const v = resolveRunnerDatabase({
      runner_database: {
        ...NAWA_DEGRADED,
        reading: {
          ...NAWA_READING,
          reported_at: null,
          breaker: { ...NAWA_READING.breaker!, open_for_ms: 214_000_000 },
        },
      },
    });
    expect(v.state === "degraded" && v.status.kind).toBe("no_database");
    // And reported_at without open_for_ms (nawa's fixture as it stands).
    const nawa = resolveRunnerDatabase({ runner_database: NAWA_DEGRADED });
    expect(nawa.state === "degraded" && nawa.status.kind).toBe("no_database");
  });

  it("an amber degraded row of the unknown kind says why it is amber; the red row does not", () => {
    const cause = (block: RunnerDatabaseServed) => {
      const v = resolveRunnerDatabase({ runner_database: block });
      if (v.state !== "degraded") throw new Error("expected degraded");
      return v.cause;
    };
    const wontPage = "coord cannot date or sustain it, so it will not page";
    const cannotRank = "this build cannot rank how serious it is";
    // A boot_without_database coord cannot fire on: no onset, or no sustain source.
    expect(cause({ ...NAWA_DEGRADED, since: null })).toContain(wontPage);
    expect(
      cause({
        ...NAWA_DEGRADED,
        reading: {
          ...NAWA_READING,
          reported_at: null,
          breaker: { ...NAWA_READING.breaker!, open_for_ms: null },
        },
      })
    ).toContain(wontPage);
    // A reason this build cannot name, or none at all.
    expect(cause({ ...NAWA_DEGRADED, reason: "future_reason" })).toContain(
      cannotRank
    );
    expect(cause({ ...NAWA_DEGRADED, reason: null })).toContain(cannotRank);
    // The red row carries neither.
    const red = cause(NAWA_DEGRADED);
    expect(red).not.toContain(wontPage);
    expect(red).not.toContain(cannotRank);
  });

  it("a degraded verdict with no reason says coord named none — never a quoted token", () => {
    const v = resolveRunnerDatabase({
      runner_database: { ...NAWA_DEGRADED, reason: null },
    });
    if (v.state !== "degraded") throw new Error("expected degraded");
    expect(v.status.kind).toBe("unknown");
    expect(v.cause.startsWith("coord named no reason")).toBe(true);
    expect(v.cause).not.toContain('"');
  });
});

describe("resolveRunnerDatabase — ok shows nothing extra", () => {
  it("never carries the closed breaker's surviving last_error", () => {
    const v = resolveRunnerDatabase({
      runner_database: RECOVERED_OK,
      runner_reports: dbMeta(),
    });
    expect(v.state).toBe("ok");
    if (v.state !== "ok") return;
    expect(v.status).toMatchObject({
      kind: "ok",
      label: "ok",
      attention: "none",
    });
    // No field of the view — cause, since, error — reaches the render.
    expect(JSON.stringify(v)).not.toContain("Connection refused");
    expect(Object.keys(v).sort()).toEqual(["state", "status"]);
  });
});

describe("resolveRunnerDatabase — unknown shows its reason, a missing block included", () => {
  it.each([
    ["build_nameable_key_absent", "predates the report"],
    ["no_publisher", "heard nothing"],
    ["stale_report", "freshness bound"],
    ["unstamped", "no receipt time"],
    ["malformed", "could not read"],
    ["breaker_unreported", "never read as closed"],
    ["read_failed", "no measurement"],
    ["runner_unobserved", "could not confirm the database is reachable"],
    ["since_in_future", "Clock skew"],
  ])(
    "coord's %s is unknown, verbatim, with its explanation",
    (reason, words) => {
      const v = resolveRunnerDatabase({
        runner_database: {
          verdict: "unknown",
          reason,
          since: null,
          reading: null,
        },
        runner_reports: dbMeta({ absent_reason: reason }),
      });
      expect(v).toMatchObject({ state: "unknown", reason });
      if (v.state === "unknown") expect(v.detail).toContain(words);
    }
  );

  it("every unknown reason coord serves has its own words, in both modes", () => {
    // The fallbacks a reason this build has no words for would get.
    const noDetail = resolveRunnerDatabase({
      runner_database: {
        verdict: "unknown",
        reason: "a_reason_coord_never_serves",
        since: null,
        reading: null,
      },
    });
    if (noDetail.state !== "unknown") throw new Error("expected unknown");
    const noWords = presentedUnknownReason("a_reason_coord_never_serves");
    for (const reason of RUNNER_DATABASE_UNKNOWN_REASONS) {
      expect(presentedUnknownReason(reason), reason).not.toBe(noWords);
      const v = resolveRunnerDatabase({
        runner_database: {
          verdict: "unknown",
          reason,
          since: null,
          reading: null,
        },
      });
      if (v.state !== "unknown") throw new Error(`${reason}: expected unknown`);
      expect(v.detail, reason).not.toBe(noDetail.detail);
    }
  });

  it("publisher_error carries the runner's own words", () => {
    const v = resolveRunnerDatabase({
      runner_database: {
        verdict: "unknown",
        reason: "publisher_error",
        since: null,
        reading: null,
      },
      runner_reports: dbMeta({
        absent_reason: "publisher_error",
        error: "health snapshot unavailable",
      }),
    });
    expect(v.state === "unknown" && v.detail).toContain(
      "health snapshot unavailable"
    );
  });

  it("a MISSING block (a coord predating the field) is unknown, never ok", () => {
    const v = resolveRunnerDatabase({ runner_reports: meta({}) });
    expect(v).toMatchObject({
      state: "unknown",
      reason: "coord does not serve the database verdict",
    });
  });

  it("a null block is unknown; beside a failed runner-report read it says so", () => {
    expect(resolveRunnerDatabase({ runner_database: null })).toMatchObject({
      state: "unknown",
      reason: "no database verdict",
    });
    expect(
      resolveRunnerDatabase({
        runner_database: null,
        runner_reports_scrape_up: false,
      })
    ).toMatchObject({ state: "unknown", reason: "runner-report read failed" });
  });

  it("the read-failed path explains itself rather than claiming an unknown reason", () => {
    const v = resolveRunnerDatabase({
      runner_database: null,
      runner_reports_scrape_up: false,
    });
    if (v.state !== "unknown") throw new Error("expected unknown");
    expect(v.detail).toContain("runner-report read failed on this poll");
    expect(v.detail).not.toContain("named no reason this build knows");
  });

  it("a stale report's title names its last breaker state and arm, never its last error", () => {
    const v = resolveRunnerDatabase({
      runner_database: {
        verdict: "unknown",
        reason: "stale_report",
        since: null,
        reading: NAWA_READING,
      },
      runner_reports: dbMeta({ stale: true }),
    });
    if (v.state !== "unknown") throw new Error("expected unknown");
    expect(v.reason).toBe("stale_report");
    expect(v.detail).toContain(
      "The last (stale) report said breaker open on the degraded arm."
    );
    expect(v.detail).not.toContain("Connection refused");
  });

  it("a verdict this build has no label for is unknown", () => {
    const v = resolveRunnerDatabase({
      runner_database: {
        verdict: "frozen",
        reason: null,
        since: null,
        reading: null,
      },
    });
    if (v.state !== "unknown") throw new Error("expected unknown");
    // The reason is a fixed one presentation mode has words for; the value
    // coord sent is in the operator's detail.
    expect(v.reason).toBe("coord served a verdict this build has no label for");
    expect(v.detail).toContain('"frozen"');
  });

  it("an unknown verdict with no reason says coord named none, never 'not served'", () => {
    const v = resolveRunnerDatabase({
      runner_database: {
        verdict: "unknown",
        reason: null,
        since: null,
        reading: null,
      },
    });
    if (v.state !== "unknown") throw new Error("expected unknown");
    expect(v.reason).toBe("coord named no reason");
    expect(v.detail).toContain("named no reason");
  });

  it("neither of this build's own unknown reasons presents as 'no report arrived'", () => {
    const noWords = presentedUnknownReason("a_reason_coord_never_serves");
    for (const served of [
      { verdict: "frozen", reason: null, since: null, reading: null },
      { verdict: "unknown", reason: null, since: null, reading: null },
    ]) {
      const v = resolveRunnerDatabase({ runner_database: served });
      if (v.state !== "unknown") throw new Error("expected unknown");
      expect(presentedUnknownReason(v.reason), v.reason).not.toBe(noWords);
    }
  });

  it("resolveRunnerReports carries the database view beside the other two", () => {
    expect(resolveRunnerReports({}).database.state).toBe("unknown");
    expect(
      resolveRunnerReports({ runner_database: NAWA_DEGRADED }).database.state
    ).toBe("degraded");
  });
});

describe("runnerDatabaseTallyBadge — unknown is its own count", () => {
  const body = (
    by: FleetHealthPayload["by_runner_database"]
  ): FleetHealthPayload => ({
    ...NONE_WITHHELD,
    devices: [],
    by_runner_database: by,
  });

  /** A tally whose devices carry the blocks the tone is read from. */
  const withDevices = (
    by: FleetHealthPayload["by_runner_database"],
    blocks: RunnerDatabaseServed[]
  ): FleetHealthPayload => ({
    ...NONE_WITHHELD,
    devices: blocks.map((runner_database, i) => ({
      device_id: `d-${i}`,
      runner_database,
    })),
    by_runner_database: by,
  });

  /** A tally beside explicit device rows, liveness fields included. */
  const withRows = (
    by: FleetHealthPayload["by_runner_database"],
    devices: FleetHealthDevice[]
  ): FleetHealthPayload => ({
    ...NONE_WITHHELD,
    devices,
    by_runner_database: by,
  });

  const NO_PUBLISHER: RunnerDatabaseServed = {
    verdict: "unknown",
    reason: "no_publisher",
    since: null,
    reading: null,
  };

  /** A real-arm breaker that opened at runtime: coord's warning, not critical. */
  const REAL_ARM_OPEN: RunnerDatabaseServed = {
    verdict: "degraded",
    reason: "breaker_open",
    since: "2026-11-27T10:00:00Z",
    reading: {
      ...NAWA_READING,
      arm: "external",
      breaker: { ...NAWA_READING.breaker!, cause: "runtime" },
    },
  };

  it("shows every count, worst first", () => {
    const b = runnerDatabaseTallyBadge(
      body({ ok: 6, degraded: 1, unknown: 2 }),
      null
    );
    expect(b.label).toBe("runner database 1 degraded · 2 unknown · 6 ok");
  });

  it("goes red ONLY when a device's verdict is the no_database kind", () => {
    const blip = runnerDatabaseTallyBadge(
      withDevices({ degraded: 1 }, [REAL_ARM_OPEN]),
      null
    );
    expect(blip.label).toBe("runner database 1 degraded · 0 unknown · 0 ok");
    expect(blip.tone).toBe("waiting");
    const nawa = runnerDatabaseTallyBadge(
      withDevices({ degraded: 1 }, [NAWA_DEGRADED]),
      null
    );
    expect(nawa.tone).toBe("attention");
    // A degraded-arm runner whose breaker opened at RUNTIME is coord's
    // warning, not its critical: amber on the strip too.
    const relapsed = runnerDatabaseTallyBadge(
      withDevices({ degraded: 1 }, [
        {
          ...REAL_ARM_OPEN,
          reading: { ...REAL_ARM_OPEN.reading!, arm: "degraded" },
        },
      ]),
      null
    );
    expect(relapsed.tone).toBe("waiting");
    // A degraded count with no device row to resolve cannot be told red from
    // amber: the ignorance floor, never red and never calm. Coord serves the
    // counted row in the same body, so this is the defensive term on its own.
    expect(runnerDatabaseTallyBadge(body({ degraded: 1 }), null).tone).toBe(
      "waiting"
    );
  });

  it("a sparse tally's absent key is a measured 0, and unknown is never folded into ok", () => {
    const all = runnerDatabaseTallyBadge(
      withDevices({ unknown: 4 }, [NO_PUBLISHER]),
      null
    );
    expect(all.label).toBe("runner database 0 degraded · 4 unknown · 0 ok");
    // A live machine with no verdict is never calm.
    expect(all.tone).toBe("waiting");
    const fine = runnerDatabaseTallyBadge(body({ ok: 3 }), null);
    expect(fine.label).toBe("runner database 0 degraded · 0 unknown · 3 ok");
    expect(fine.tone).toBe("muted");
  });

  it("a placeholder or abandoned row is in neither coord's tally nor the tone", () => {
    const live: FleetHealthDevice = {
      device_id: "d-live",
      state: "healthy",
      dispatch_liveness: "live",
      runner_database: RECOVERED_OK,
    };
    // A placeholder "has never named a running machine" (machineHealth.ts),
    // and an abandoned row's report has aged out: both serve unknown, and
    // coord tallies neither (`in_judged_population`, the same predicate as
    // `isLiveMachine`) — so for this roster coord serves `{ ok: 1 }`.
    const placeholder: FleetHealthDevice = {
      device_id: "d-placeholder",
      state: "healthy",
      dispatch_liveness: "unknown",
      runner_database: NO_PUBLISHER,
    };
    const abandoned: FleetHealthDevice = {
      device_id: "d-abandoned",
      state: "abandoned",
      runner_database: { ...NO_PUBLISHER, reason: "stale_report" },
    };
    const b = runnerDatabaseTallyBadge(
      withRows({ ok: 1 }, [live, placeholder, abandoned]),
      null
    );
    expect(b.label).toBe("runner database 0 degraded · 0 unknown · 1 ok");
    expect(b.tone).toBe("muted");
    // The same unknown on a LIVE machine is amber.
    expect(
      runnerDatabaseTallyBadge(
        withRows({ ok: 1, unknown: 1 }, [
          live,
          { ...placeholder, dispatch_liveness: "live" },
        ]),
        null
      ).tone
    ).toBe("waiting");
    // And a non-live row never raises red, even carrying a degraded block.
    expect(
      runnerDatabaseTallyBadge(
        withRows({ ok: 1 }, [
          live,
          { ...placeholder, runner_database: NAWA_DEGRADED },
        ]),
        null
      ).tone
    ).toBe("muted");
  });

  it("a live machine that is not ok is amber even when coord's tally reads all ok", () => {
    // Coord builds the rows and the tally from one `snaps` in one body, so it
    // never serves this disagreement. The live-row term is defensive, and this
    // pins it on its own.
    const b = runnerDatabaseTallyBadge(
      withDevices({ ok: 1 }, [NO_PUBLISHER]),
      null
    );
    expect(b.label).toBe("runner database 0 degraded · 0 unknown · 1 ok");
    expect(b.tone).toBe("waiting");
  });

  it("a counted unknown is never read calm, even with no device row to resolve", () => {
    // Every counted unknown is a live machine coord could not judge. Coord
    // serves that row as a device in the same body; the counted term is
    // defensive, and this pins it on its own.
    const b = runnerDatabaseTallyBadge(body({ ok: 4, unknown: 2 }), null);
    expect(b.label).toBe("runner database 0 degraded · 2 unknown · 4 ok");
    expect(b.tone).toBe("waiting");
  });

  it("a roster cut that withheld rows which could be degrading is amber, and says so", () => {
    const ok: FleetHealthDevice = {
      device_id: "d-live",
      state: "healthy",
      dispatch_liveness: "live",
      runner_database: RECOVERED_OK,
    };
    // Coord's hard cap dropped 3 rows that could be degrading: they are in
    // neither the device list nor the counts.
    const cut = runnerDatabaseTallyBadge(
      {
        ...withRows({ ok: 1 }, [ok]),
        truncated: true,
        total: 10_004,
        degradable_dropped: 3,
      },
      null
    );
    expect(cut.label).toBe(
      "runner database 0 degraded · 0 unknown · 1 ok — coord's roster cut short"
    );
    expect(cut.tone).toBe("waiting");
    expect(cut.title).toContain("do not cover every machine");
    // The same fixed words while presenting.
    expect(
      runnerDatabaseTallyBadge(
        {
          ...withRows({ ok: 1 }, [ok]),
          truncated: true,
          total: 10_004,
          degradable_dropped: 3,
        },
        null,
        { presenting: true }
      ).label
    ).toBe(cut.label);
    // A cut coord says dropped only rows that cannot be degrading (the dead
    // tail) leaves the badge calm.
    const tailOnly = runnerDatabaseTallyBadge(
      {
        ...withRows({ ok: 1 }, [ok]),
        truncated: true,
        total: 40,
        degradable_dropped: 0,
      },
      null
    );
    expect(tailOnly.tone).toBe("muted");
    expect(tailOnly.label).toBe(
      "runner database 0 degraded · 0 unknown · 1 ok"
    );
    expect(tailOnly.title).not.toContain("do not cover every machine");
    // A roster AT coord's row limit with no `truncated` flag only MAY be cut
    // (`may_be_cut`): amber, and the words say "may", never a cut as fact.
    const atLimit = runnerDatabaseTallyBadge(
      withRows(
        { ok: 1000 },
        Array.from({ length: 1000 }, (_, i) => ({ ...ok, device_id: `d-${i}` }))
      ),
      null
    );
    expect(atLimit.tone).toBe("waiting");
    expect(atLimit.label).toBe(
      "runner database 0 degraded · 0 unknown · 1000 ok — coord's roster may be cut short"
    );
    expect(atLimit.title).toContain("may not cover every machine");
    expect(atLimit.title).not.toContain("do not cover every machine");
    // A binding fault names itself before a cut: one suffix, the withheld
    // one, while the title carries both sentences.
    const both = runnerDatabaseTallyBadge(
      {
        ...withRows({ ok: 1 }, [ok]),
        truncated: true,
        degradable_dropped: 3,
        excluded: { unbound: 2, bound_to_other_tenant: 0 },
      },
      null
    );
    expect(both.label).toBe(
      "runner database 0 degraded · 0 unknown · 1 ok — coord withheld machines"
    );
    expect(both.tone).toBe("waiting");
    expect(both.title).toContain(
      "Coord's roster left out machines that could be degrading, so these counts do not cover every machine."
    );
    expect(both.title).toContain("Coord withheld 2 machines");
  });

  it("a tally that counts nothing names it: no live machine to judge, calm", () => {
    const b = runnerDatabaseTallyBadge(body({}), null);
    expect(b.label).toBe("runner database — no live machine to judge");
    expect(b.tone).toBe("muted");
    expect(
      runnerDatabaseTallyBadge(body({}), null, { presenting: true }).label
    ).toBe("runner database — no live machine to judge");
    // Unless coord's roster withheld rows that could be degrading: there may
    // be live machines it did not serve.
    const cut = runnerDatabaseTallyBadge(
      { ...body({}), truncated: true, degradable_dropped: 2 },
      null
    );
    expect(cut.label).toBe(
      "runner database 0 degraded · 0 unknown · 0 ok — coord's roster cut short"
    );
    expect(cut.tone).toBe("waiting");
    // Stale goes after the roster words.
    expect(
      runnerDatabaseTallyBadge(
        { ...body({}), truncated: true, degradable_dropped: 2 },
        "HTTP 502"
      ).label
    ).toBe(
      "runner database 0 degraded · 0 unknown · 0 ok — coord's roster cut short (stale)"
    );
  });

  it("devices coord withheld are amber like a cut: a binding fault that withholds every device is never calm", () => {
    // Coord could not count what it withheld, so it served no device and
    // tallied nothing.
    const bindingFault: FleetHealthPayload = {
      devices: [],
      by_runner_database: {},
      excluded: null,
      excluded_error:
        "device binding lookup failed: connection reset by peer (os error 104)",
    };
    const b = runnerDatabaseTallyBadge(bindingFault, null);
    expect(b.tone).toBe("waiting");
    expect(b.label).not.toContain("no live machine to judge");
    expect(b.label).toBe(
      "runner database 0 degraded · 0 unknown · 0 ok — coord's withheld machines uncounted"
    );
    expect(b.title).toContain(
      "Coord could not count the machines it withheld from its roster"
    );
    // Coord's own error chain never reaches the badge, operator or not.
    expect(b.title).not.toContain("os error 104");
    expect(b.title).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    const presented = runnerDatabaseTallyBadge(bindingFault, null, {
      presenting: true,
    });
    expect(presented.tone).toBe("waiting");
    expect(presented.label).toBe(b.label);
    // Counted devices withheld beside live ones: amber, and the count named.
    const ok: FleetHealthDevice = {
      device_id: "d-live",
      state: "healthy",
      dispatch_liveness: "live",
      runner_database: RECOVERED_OK,
    };
    const withheld = runnerDatabaseTallyBadge(
      {
        ...withRows({ ok: 1 }, [ok]),
        excluded: { unbound: 2, bound_to_other_tenant: 1 },
      },
      null
    );
    expect(withheld.tone).toBe("waiting");
    expect(withheld.label).toBe(
      "runner database 0 degraded · 0 unknown · 1 ok — coord withheld machines"
    );
    expect(withheld.title).toContain(
      "Coord withheld 3 machines from its roster"
    );
    // A coord that does not say it withheld none cannot vouch either.
    const unstated: FleetHealthPayload = {
      devices: [ok],
      by_runner_database: { ok: 1 },
    };
    const notStated = runnerDatabaseTallyBadge(unstated, null);
    expect(notStated.tone).toBe("waiting");
    expect(notStated.title).toContain(
      "Coord does not say whether it withheld any machines from its roster"
    );
    // And the same roster with nothing withheld is calm.
    expect(runnerDatabaseTallyBadge(withRows({ ok: 1 }, [ok]), null).tone).toBe(
      "muted"
    );
  });

  it("its title names the population and what unknown covers", () => {
    const b = runnerDatabaseTallyBadge(body({ ok: 1 }), null);
    expect(b.title).toContain(
      "coord could not judge that machine's database from a current report"
    );
    expect(b.title).toContain(
      "Counted over live machines; abandoned and never-seen rows are not counted."
    );
  });

  it("a retained tally under a failed latest read is marked stale and says which read it is", () => {
    const retained: FleetHealthPayload = {
      ...body({ ok: 2, unknown: 1 }),
      as_of: "2026-11-27T10:59:00Z",
    };
    const b = runnerDatabaseTallyBadge(retained, "HTTP 502");
    expect(b.label).toBe(
      "runner database 0 degraded · 1 unknown · 2 ok (stale)"
    );
    expect(b.title).toContain(
      "The latest read failed (HTTP 502); these counts are from the last read that answered (as of 2026-11-27T10:59:00Z)."
    );
    const current = runnerDatabaseTallyBadge(retained, null);
    expect(current.label).not.toContain("(stale)");
    expect(current.title).not.toContain("latest read failed");
  });

  it("a retained all-ok tally under a failed read is amber, never as calm as a fresh one; red stays red", () => {
    const allOk = withRows({ ok: 1 }, [
      {
        device_id: "d-live",
        state: "healthy",
        dispatch_liveness: "live",
        runner_database: RECOVERED_OK,
      },
    ]);
    expect(runnerDatabaseTallyBadge(allOk, null).tone).toBe("muted");
    expect(runnerDatabaseTallyBadge(allOk, "HTTP 502").tone).toBe("waiting");
    expect(
      runnerDatabaseTallyBadge(
        withDevices({ degraded: 1 }, [NAWA_DEGRADED]),
        "HTTP 502"
      ).tone
    ).toBe("attention");
  });

  it("counts a verdict newer than this build instead of dropping it", () => {
    const b = runnerDatabaseTallyBadge(body({ ok: 1, frozen: 2 }), null);
    expect(b.label).toBe(
      "runner database 0 degraded · 0 unknown · 1 ok · 2 frozen"
    );
    // A verdict this build cannot read is never calm, even when no device row
    // explains it.
    expect(b.tone).toBe("waiting");
  });

  it("presentation mode folds unknown verdict keys into one other count", () => {
    const b = runnerDatabaseTallyBadge(
      body({ ok: 1, frozen: 2, thawing: 1 }),
      null,
      { presenting: true }
    );
    expect(b.label).toBe(
      "runner database 0 degraded · 0 unknown · 1 ok · 3 other"
    );
    expect(b.label).not.toMatch(/frozen|thawing/);
    expect(
      runnerDatabaseTallyBadge(body({ ok: 1 }), null, { presenting: true })
        .label
    ).toBe("runner database 0 degraded · 0 unknown · 1 ok");
  });

  it("a null tally (coord's read failed), an absent one, and no body are each unknown", () => {
    expect(runnerDatabaseTallyBadge(body(null), null).label).toBe(
      "runner database unknown — the device read failed"
    );
    expect(runnerDatabaseTallyBadge({ devices: [] }, null).label).toBe(
      "runner database unknown — coord does not serve it"
    );
    expect(runnerDatabaseTallyBadge(null, null).label).toBe(
      "runner database unknown — not read yet"
    );
    expect(runnerDatabaseTallyBadge(null, "HTTP 502").label).toBe(
      "runner database unknown — HTTP 502"
    );
    expect(runnerDatabaseTallyBadge(body(null), null).tone).toBe("waiting");
  });

  it("its title carries no coord token, so presentation mode can show it", () => {
    for (const b of [
      runnerDatabaseTallyBadge(body({ ok: 1 }), null),
      runnerDatabaseTallyBadge(body(null), null),
      runnerDatabaseTallyBadge({ devices: [] }, null),
      runnerDatabaseTallyBadge(null, null),
      runnerDatabaseTallyBadge(
        { ...body({ ok: 1 }), as_of: "2026-11-27T10:59:00Z" },
        FAILURE_REASON_WITHHELD
      ),
    ]) {
      expect(b.title).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    }
  });
});

/**
 * computerStatus — the pure half of `/admin/coord/computers`, over fixtures
 * shaped exactly like coord's `computers.rs` output (`__fixtures__/`).
 *
 * Plan `2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-
 * has-no-resource-model` Phase 5 / §3.5. What is pinned, and why each would go
 * red:
 *
 * 1. **Coord's freshness verdict is never upgraded**, and is made worse by the
 *    time since the read landed; no `age_secs` is UNKNOWN.
 * 2. **An unmeasured axis is `unknown`, an unsupported one `not supported`**,
 *    and the publisher's `measured` map wins over a number riding along.
 * 3. **A stale computer never headlines a current fault or a calm verdict**,
 *    and only FRESH lanes count as current pressure.
 * 4. **`services_reported: false` makes coord's `services_failed: 0` UNKNOWN.**
 * 5. **Coord's `down` flag decides a service row**, not a second reading.
 * 6. **The two 404s, the two 403s, and schema_pending are told apart.**
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  COMPUTER_ATTENTION_BY_KIND,
  COMPUTER_PALETTE,
  COMPUTER_STALE_AFTER_SECS,
  FRESHNESS_ATTENTION_BY_KIND,
  FRESHNESS_PALETTE,
  SERVICE_ATTENTION_BY_KIND,
  SERVICE_PALETTE,
  buildComputerRows,
  ciRunnerStatusText,
  classifyComputersError,
  computerFreshness,
  computerStatus,
  deriveComputerDetailHealth,
  deriveComputersHealth,
  emptyLanesText,
  historyByLane,
  historyPoints,
  isSchemaPendingBody,
  laneFreshness,
  laneKey,
  normalizeComputer,
  readIssueHeadline,
  readIssueText,
  readLaneField,
  readingText,
  serviceStatus,
  usageText,
  type ComputerSummaryWire,
} from "./computerStatus";
import {
  computerFx,
  detailFx,
  laneFx,
  listFx,
  serviceFx,
} from "../__fixtures__/coordComputers";

const NOW = Date.parse("2026-09-30T12:00:00Z");

const computer = (
  over: Parameters<typeof computerFx>[0] = {}
): ComputerSummaryWire => computerFx(over, NOW);
const lane = (over: Parameters<typeof laneFx>[0] = {}) => laneFx(over, NOW);

/** An httpClient rejection, spelled exactly as `services/http-client.ts` spells it. */
function rejection(status: number, body: string): Error {
  return new Error(
    `GET /api/v1/operations/computers failed: ${status} - ${body}`
  );
}

const fresh = (age: number) => ({
  last_report_at: "2026-09-30T11:59:00Z",
  age_secs: age,
  state: "fresh",
  stale_after_secs: 900,
});

describe("computerFreshness", () => {
  it("takes coord's `fresh` inside its 900 s window", () => {
    const r = computerFreshness(fresh(120), NOW, NOW);
    expect(r.kind).toBe("fresh");
    expect(r.label).toBe("fresh");
    expect(COMPUTER_STALE_AFTER_SECS).toBe(900);
  });

  it("ages a coord `fresh` by the time since the read landed (a silent coord goes stale by itself)", () => {
    // Read 14 minutes ago at 120 s old: 960 s old now.
    const r = computerFreshness(fresh(120), NOW - 14 * 60 * 1000, NOW);
    expect(r.kind).toBe("stale");
    expect(r.label).toBe("STALE");
    expect(r.ageSecs).toBe(960);
  });

  it("never upgrades coord's own stale or unknown", () => {
    expect(
      computerFreshness({ ...fresh(5), state: "stale" }, NOW, NOW).kind
    ).toBe("stale");
    expect(
      computerFreshness({ ...fresh(5), state: "unknown" }, NOW, NOW).kind
    ).toBe("unknown");
  });

  it("reads a word this build does not know as UNKNOWN — never fresh", () => {
    expect(
      computerFreshness({ ...fresh(10), state: "vibrant" }, NOW, NOW).kind
    ).toBe("unknown");
    expect(computerFreshness(null, NOW, NOW).label).toBe("UNKNOWN");
  });
});

describe("laneFreshness", () => {
  const freshComputer = computerFreshness(fresh(10), NOW, NOW);

  it("takes coord's lane verdict, and makes it worse past 90 s", () => {
    expect(
      laneFreshness(lane({ age_secs: 60 }), freshComputer, NOW, NOW).kind
    ).toBe("fresh");
    // Coord says fresh at 60 s; 31 s after the read it is 91 s old.
    expect(
      laneFreshness(lane({ age_secs: 60 }), freshComputer, NOW - 31_000, NOW)
        .kind
    ).toBe("stale");
    // Coord's own stale stands however young the page thinks it is.
    expect(
      laneFreshness(
        lane({
          age_secs: 5,
          freshness: { age_secs: 5, state: "stale", stale_after_secs: 90 },
        }),
        freshComputer,
        NOW,
        NOW
      ).kind
    ).toBe("stale");
  });

  it("is stale whenever the computer is not fresh, however young the sample", () => {
    const staleComputer = computerFreshness(
      { ...fresh(5000), state: "stale" },
      NOW,
      NOW
    );
    expect(
      laneFreshness(lane({ age_secs: 1 }), staleComputer, NOW, NOW).kind
    ).toBe("stale");
  });
});

describe("readLaneField", () => {
  const l = lane({
    load_1m: 3.25,
    load_5m: null,
    // A number that rode along beside `not_supported` is NOT a reading.
    load_15m: 0,
    psi_cpu_some_avg60: null,
    measured: { load_15m: "not_supported", psi_io: "unavailable" },
  });
  const fmt = (v: number) => v.toFixed(2);

  it("renders a measured value", () => {
    expect(readingText(readLaneField(l, "load_1m"), fmt)).toBe("3.25");
  });

  it("renders a never-measured field as `unknown`, never 0", () => {
    expect(readingText(readLaneField(l, "load_5m"), fmt)).toBe("unknown");
    expect(readingText(readLaneField(l, "psi_cpu_some_avg60"), fmt)).toBe(
      "unknown"
    );
  });

  it("renders `not supported` and `unavailable` from the measured map, over any number sent", () => {
    expect(readingText(readLaneField(l, "load_15m"), fmt)).toBe(
      "not supported"
    );
    expect(readingText(readLaneField(l, "psi_io_some_avg10"), fmt)).toBe(
      "unavailable"
    );
  });
});

describe("usageText", () => {
  it("never fabricates a ratio from a missing side", () => {
    expect(usageText(null, null)).toBe("unknown");
    expect(usageText(null, 1024)).toBe("unknown / 1.0 KB");
    expect(usageText(512, null)).toBe("512 B / unknown");
  });
});

describe("history — coord's HistoryPoint.pressure is a NUMBER, keyed by device and lane", () => {
  it("joins a lane to its own device's series and passes a null point through as a gap", () => {
    const detail = detailFx(
      {
        history: [
          {
            device_id: "11111111-2222-4333-8444-555555555555",
            lane: "host",
            lane_instance: null,
            points: [
              {
                sampled_at: "2026-09-30T11:59:00Z",
                load_1m: 1,
                load_5m: 1,
                load_15m: 1,
                mem_available_bytes: 1,
                swap_ratio: 0.1,
                pressure: 0.42,
                psi_memory_some_avg60: 0,
                psi_cpu_some_avg60: 0,
                psi_io_some_avg60: 0,
              },
              {
                sampled_at: "2026-09-30T11:59:30Z",
                load_1m: null,
                load_5m: null,
                load_15m: null,
                mem_available_bytes: null,
                swap_ratio: null,
                pressure: null,
                psi_memory_some_avg60: null,
                psi_cpu_some_avg60: null,
                psi_io_some_avg60: null,
              },
            ],
          },
        ],
      },
      NOW
    );
    const byLane = historyByLane(detail);
    const series = byLane.get(laneKey(detail.lanes[0]));
    expect(historyPoints(series).map((p) => p.pressure)).toEqual([0.42, null]);
    // Another runner's `host` lane on the same computer does not borrow it.
    expect(
      byLane.get(laneKey({ ...detail.lanes[0], device_id: "other-device" }))
    ).toBeUndefined();
  });
});

describe("computerStatus", () => {
  const status = (c: ComputerSummaryWire, fetchedAt = NOW) => {
    const n = normalizeComputer(c);
    return computerStatus(n, computerFreshness(n.freshness, fetchedAt, NOW), {
      fetchedAtMs: fetchedAt,
      nowMs: NOW,
    });
  };

  it("is healthy only when fresh, services reported with none down, and samples fresh", () => {
    expect(status(computer()).kind).toBe("healthy");
  });

  it("reads coord's `services_failed: 0` as UNKNOWN when `services_reported` is false", () => {
    const c = computer({
      services_reported: false,
      services_total: 0,
      services_failed: 0,
    });
    expect(normalizeComputer(c).servicesFailed).toBeNull();
    const s = status(c);
    expect(s.kind).toBe("services_unknown");
    expect(s.attention).toBe("waiting");
  });

  it("is red for a down watched service on a fresh computer", () => {
    const s = status(computer({ services_failed: 3 }));
    expect(s.kind).toBe("service_failed");
    expect(s.label).toBe("3 services down");
    expect(s.attention).toBe("author");
  });

  it("does not headline a stale computer's failure as current — it is stale, with the last-known count", () => {
    const s = status(computer({ services_failed: 2, report_age_secs: 4000 }));
    expect(s.kind).toBe("stale");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toContain("Last known: 2 services down.");
  });

  it("puts an identity conflict first — it is a fact about the record, not a reading", () => {
    const s = status(
      computer({
        identity_conflict_at: "2026-09-30T10:00:00Z",
        report_age_secs: 9000,
      })
    );
    expect(s.kind).toBe("identity_conflict");
  });

  it("counts pressure only on a FRESH lane", () => {
    const s = status(
      computer({ lanes: [lane({ age_secs: 10, headroom: "breach" })] })
    );
    expect(s.kind).toBe("under_pressure");
    expect(s.reason).toBe(
      "Lane host is past an admission floor — coord is refusing work here."
    );
  });

  it("says a warn lane is NEAR a floor and may be deferring — not refusing", () => {
    const s = status(
      computer({
        lanes: [
          lane({ age_secs: 10, headroom: "breach" }),
          lane({
            lane: "wsl",
            lane_instance: "Ubuntu",
            age_secs: 10,
            headroom: "warn",
          }),
        ],
      })
    );
    expect(s.kind).toBe("under_pressure");
    expect(s.reason).toBe(
      "Lane host is past an admission floor — coord is refusing work here. Lane wsl (Ubuntu) is near an admission floor — coord may be deferring work."
    );
  });

  it("reads a truncated lane list as not fully known, with its own reason", () => {
    // Coord's degrade_for_truncation: fresh -> unknown when truncated.
    const c = computer({ lanes_truncated: true });
    expect(c.samples_state).toBe("unknown");
    const s = status(c);
    expect(s.kind).toBe("lane_stale");
    expect(s.label).toBe("samples not fully known");
    expect(s.reason).toBe(
      "Coord listed only part of this computer's lanes (cap reached), so its sample state is not fully known."
    );
  });

  it("reads stale-only pressure as an amber stale lane, naming it — never as current pressure", () => {
    const s = status(
      computer({
        lanes: [
          lane({ age_secs: 10, headroom: "ok" }),
          lane({
            lane: "wsl",
            lane_instance: "Ubuntu",
            age_secs: 600,
            headroom: "breach",
          }),
        ],
      })
    );
    expect(s.kind).toBe("lane_stale");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toBe(
      "The samples for lane wsl (Ubuntu) are stale or undatable, so current pressure there is unknown. Last known: wsl (Ubuntu) breach — not current."
    );
  });

  it("does not call a fresh lane with an ungraded headroom healthy", () => {
    const s = status(
      computer({ lanes: [lane({ age_secs: 10, headroom: "unknown" })] })
    );
    expect(s.kind).toBe("headroom_unknown");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toBe(
      "Coord could not grade admission headroom for lane host, so whether it is refusing work is unknown."
    );
  });

  it("reads empty lanes with no sample ever as samples unknown — not healthy", () => {
    const s = status(computer({ lanes: [], newest_sample_age_secs: null }));
    expect(s.kind).toBe("lane_stale");
    expect(s.label).toBe("samples unknown");
  });

  it("reads empty lanes with an old sample as samples STALE, naming the newest age", () => {
    // No lane of an attached device, but a sample exists (from a device no
    // longer attached): coord folds to `stale`.
    const c = computer({ lanes: [], newest_sample_age_secs: 2400 });
    expect(c.samples_state).toBe("stale");
    const s = status(c);
    expect(s.kind).toBe("lane_stale");
    expect(s.label).toBe("samples stale");
    expect(s.reason).toBe(
      "Coord reports this computer's samples as stale — newest 40m ago; current usage is unknown."
    );
    expect(emptyLanesText(normalizeComputer(c), NOW, NOW)).toBe(
      "Samples stale, newest 40m ago — no lane of a currently attached device is listed, so current usage is unknown (not idle)."
    );
  });
});

describe("serviceStatus", () => {
  it("is red for coord's `down` — failed and inactive alike", () => {
    const failed = serviceStatus(
      serviceFx({ active_state: "failed", result: "oom-kill" }),
      true
    );
    expect(failed.kind).toBe("down");
    expect(failed.reason).toBe("Failed (result: oom-kill).");
    const stopped = serviceStatus(
      serviceFx({ active_state: "inactive", result: "success" }),
      true
    );
    expect(stopped.kind).toBe("down");
    expect(stopped.reason).toBe("Stopped (result: success).");
  });

  it("follows coord's `down` flag, not its own reading of active_state", () => {
    expect(
      serviceStatus(serviceFx({ active_state: "failed", down: false }), true)
        .kind
    ).toBe("unknown");
  });

  it("shows a stale computer's unit as `last known`, under the ignorance floor", () => {
    const s = serviceStatus(
      serviceFx({ active_state: "active", sub_state: "running" }),
      false
    );
    expect(s.kind).toBe("unknown");
    expect(s.label).toBe("last known: active/running");
    expect(s.attention).toBe("waiting");
  });
});

describe("ciRunnerStatusText", () => {
  it("labels a registrar row outside its freshness window as last known", () => {
    const row = {
      device_id: "d",
      hostname: "gh-runner-merytshost-1@qontinui/qontinui-web",
      runner_name: "merytshost-1",
      host_key: "merytshost-1",
      repo: "qontinui/qontinui-web",
      ci_runner_status: "idle",
      last_seen_at: null,
      registrar_fresh: true,
      service_unit: null,
      service_active_state: null,
    };
    expect(ciRunnerStatusText(row)).toBe("idle");
    expect(ciRunnerStatusText({ ...row, registrar_fresh: false })).toBe(
      "last known: idle (registrar stale)"
    );
  });
});

describe("the three palettes agree with their attention tables", () => {
  it.each([
    ["computer", COMPUTER_ATTENTION_BY_KIND, COMPUTER_PALETTE],
    ["freshness", FRESHNESS_ATTENTION_BY_KIND, FRESHNESS_PALETTE],
    ["service", SERVICE_ATTENTION_BY_KIND, SERVICE_PALETTE],
  ] as const)("%s", (_name, table, palette) => {
    expect(paletteDisagreements(table, palette)).toEqual([]);
  });
});

describe("classifyComputersError", () => {
  it("reads a bare 404 as the route not being deployed (UNKNOWN)", () => {
    expect(classifyComputersError(rejection(404, "")).kind).toBe(
      "route_unavailable"
    );
  });

  it("reads the web's own NOT_FOUND as route-unavailable, not as a missing computer", () => {
    expect(
      classifyComputersError(rejection(404, '{"error":"NOT_FOUND"}'), {
        detail: true,
      }).kind
    ).toBe("route_unavailable");
  });

  it("reads coord's computer_not_found as not-found — on the detail read only", () => {
    const err = rejection(404, '{"error":"computer_not_found"}');
    expect(classifyComputersError(err, { detail: true }).kind).toBe(
      "not_found"
    );
    expect(classifyComputersError(err).kind).toBe("route_unavailable");
  });

  it("recognises coord's 503 schema_pending body", () => {
    expect(
      classifyComputersError(
        rejection(
          503,
          '{"error":"schema_pending","code":"computers_schema_pending","missing":"coord.computers"}'
        )
      ).kind
    ).toBe("schema_pending");
  });

  it("recognises coord's list_body schema_pending flag, and not a normal body", () => {
    expect(isSchemaPendingBody({ schema_pending: true, computers: null })).toBe(
      true
    );
    expect(isSchemaPendingBody(listFx([computer()]))).toBe(false);
  });

  it("keeps a transport failure as an error, and its banner says UNKNOWN", () => {
    const issue = classifyComputersError(new TypeError("Failed to fetch"));
    expect(issue.kind).toBe("error");
    expect(readIssueText(issue)).toBe(
      "Could not read computers from coord (Failed to fetch) — UNKNOWN, not empty."
    );
  });
});

describe("a 403 is its own answer", () => {
  it("classifies not_coord_tenant_admin as forbidden, in both body shapes", () => {
    const shaped = classifyComputersError(
      rejection(403, '{"error":"FORBIDDEN","message":"not_coord_tenant_admin"}')
    );
    const bare = classifyComputersError(
      rejection(403, '{"detail":"not_coord_tenant_admin"}')
    );
    expect(shaped.kind).toBe("forbidden");
    expect(bare.kind).toBe("forbidden");
    expect(readIssueText(shaped)).toBe(
      "Only an admin of the selected project (coord tenant) may read computers — they carry CI-runner and access facts — so this page cannot show them to you."
    );
    expect(readIssueHeadline(shaped, "Computers")).toBe(
      "Coord tenant admins only"
    );
  });

  it("gives tenant_not_resolved its own text, not the admin-only one", () => {
    const issue = classifyComputersError(
      rejection(403, '{"error":"FORBIDDEN","message":"tenant_not_resolved"}')
    );
    expect(issue.kind).toBe("tenant_not_resolved");
    expect(readIssueHeadline(issue, "Computers")).toBe(
      "No project resolved for this read"
    );
  });

  it("does not explain an unrelated 403 as the admin gate", () => {
    expect(
      classifyComputersError(
        rejection(403, '{"error":"FORBIDDEN","message":"csrf_rejected"}')
      ).kind
    ).toBe("error");
  });

  it("headlines a refusal as a refusal on both strips, never as 'did not answer'", () => {
    const list = deriveComputersHealth({
      rows: [],
      loaded: false,
      issue: { kind: "forbidden" },
      unattributed: null,
    });
    expect(list.headline).toBe("Coord tenant admins only");
    const detail = deriveComputerDetailHealth({
      computer: null,
      freshness: null,
      status: null,
      issue: { kind: "forbidden" },
      services: null,
      events: null,
      divergence: null,
      registrarReadOk: false,
    });
    expect(detail.headline).toBe("Coord tenant admins only");
  });
});

describe("deriveComputersHealth", () => {
  it("never says the fleet is empty when coord did not answer", () => {
    const h = deriveComputersHealth({
      rows: [],
      loaded: false,
      issue: { kind: "route_unavailable" },
      unattributed: null,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Computers unknown — coord did not answer this read"
    );
    expect(h.badges.map((b) => b.label)).toEqual(["computers –"]);
  });

  it("reads a measured-empty answer as no report, amber", () => {
    const h = deriveComputersHealth({
      rows: [],
      loaded: true,
      issue: null,
      unattributed: 0,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "No computer has reported — unknown, not an empty fleet"
    );
  });

  it("is green only when every computer is healthy and the read refreshed", () => {
    const rows = buildComputerRows(listFx([computer()]), NOW, NOW);
    expect(
      deriveComputersHealth({
        rows,
        loaded: true,
        issue: null,
        unattributed: 0,
      }).level
    ).toBe("green");
    const failedRefresh = deriveComputersHealth({
      rows,
      loaded: true,
      issue: { kind: "deadline", budgetMs: 4000 },
      unattributed: 0,
    });
    expect(failedRefresh.level).toBe("amber");
    expect(failedRefresh.headline).toBe(
      "Every computer was healthy at the last good read"
    );
  });

  it("makes every computer's CI runners UNKNOWN when coord's registrar read failed", () => {
    const rows = buildComputerRows(
      listFx([computer()], { registrar_read_ok: false }),
      NOW,
      NOW
    );
    expect(rows[0].computer.ciRunners).toBeNull();
  });

  it("treats CI runners as measured only on an explicit registrar_read_ok: true", () => {
    const body = listFx([computer()]);
    expect(buildComputerRows(body, NOW, NOW)[0].computer.ciRunners).toEqual([]);
    // A body that does not SAY the registrar read succeeded is unknown, even
    // if a list rode along.
    const { registrar_read_ok: _ok, ...unconfirmed } = body;
    void _ok;
    expect(
      buildComputerRows(unconfirmed as unknown as typeof body, NOW, NOW)[0]
        .computer.ciRunners
    ).toBeNull();
  });

  it("counts stale and unknown computers", () => {
    const rows = buildComputerRows(
      listFx([
        computer({ computer_id: "a", report_age_secs: 5000 }),
        computer({
          computer_id: "b",
          freshness: { ...fresh(10), state: "unknown" },
        }),
      ]),
      NOW,
      NOW
    );
    const h = deriveComputersHealth({
      rows,
      loaded: true,
      issue: null,
      unattributed: null,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("2 of 2 computers are not reporting current state");
    const labels = h.badges.map((b) => b.label);
    expect(labels).toContain("stale 1");
    expect(labels).toContain("unknown 1");
    expect(labels).toContain("unattributed CI runners –");
  });
});

describe("deriveComputerDetailHealth", () => {
  const n = normalizeComputer(computer({ services_failed: 1 }));
  const f = computerFreshness(n.freshness, NOW, NOW);

  it("counts services down from coord's `down` flag", () => {
    const h = deriveComputerDetailHealth({
      computer: n,
      freshness: f,
      status: computerStatus(n, f, { fetchedAtMs: NOW, nowMs: NOW }),
      issue: null,
      services: [serviceFx({ active_state: "inactive" }), serviceFx()],
      events: [],
      divergence: [],
      registrarReadOk: true,
    });
    const labels = h.badges.map((b) => b.label);
    expect(labels).toContain("services down 1");
    expect(labels).toContain("events 7d 0");
  });

  it("shows the divergence badge as a dash unless the registrar read is confirmed", () => {
    const h = deriveComputerDetailHealth({
      computer: n,
      freshness: f,
      status: computerStatus(n, f, { fetchedAtMs: NOW, nowMs: NOW }),
      issue: null,
      services: [],
      events: [],
      divergence: [],
      registrarReadOk: false,
    });
    expect(h.badges.map((b) => b.label)).toContain("divergence –");
  });

  it("headlines not-found even when a computer from an earlier read is passed in", () => {
    const h = deriveComputerDetailHealth({
      computer: n,
      freshness: f,
      status: computerStatus(n, f, { fetchedAtMs: NOW, nowMs: NOW }),
      issue: { kind: "not_found" },
      services: [],
      events: [],
      divergence: [],
      registrarReadOk: true,
    });
    expect(h.headline).toBe("No such computer in this tenant");
    expect(h.level).toBe("amber");
    expect(h.badges).toEqual([]);
  });
});

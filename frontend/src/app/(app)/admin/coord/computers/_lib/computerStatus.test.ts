/**
 * computerStatus — the pure half of `/admin/coord/computers`.
 *
 * Plan `2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-
 * has-no-resource-model` Phase 5 / §3.5. What is pinned, and why each would go
 * red:
 *
 * 1. **Freshness is aged, and only ever made worse.** A `fresh` verdict whose
 *    age crosses 900 s — including by time passing since the read — is
 *    `stale`; a missing block or a word this build does not know is `unknown`.
 * 2. **An unmeasured axis is `unknown`, an unsupported one `not supported`**,
 *    and the publisher's `measured` map wins over a number riding along.
 * 3. **A stale computer never headlines a current fault or a calm verdict.**
 * 4. **`services_failed: null` is never healthy.**
 * 5. **The two 404s are told apart**, and `schema_pending` is recognised in
 *    both of its shapes.
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
  classifyComputersError,
  computerFreshness,
  computerStatus,
  deriveComputerDetailHealth,
  deriveComputersHealth,
  isSchemaPendingBody,
  laneFreshness,
  normalizeComputer,
  readIssueHeadline,
  readIssueText,
  readLaneField,
  readingText,
  serviceStatus,
  usageText,
  type ComputerLaneWire,
  type ComputerSummaryWire,
} from "./computerStatus";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

function computer(
  over: Partial<ComputerSummaryWire> = {}
): ComputerSummaryWire {
  return {
    computer_id: ID,
    hostname: "merytshost",
    kind: "host",
    freshness: {
      last_report_at: "2026-09-30T11:59:00Z",
      age_secs: 60,
      state: "fresh",
    },
    services_failed: 0,
    lanes: [],
    ...over,
  };
}

/** An httpClient rejection, spelled exactly as `services/http-client.ts` spells it. */
function rejection(status: number, body: string): Error {
  return new Error(
    `GET /api/v1/operations/computers failed: ${status} - ${body}`
  );
}

describe("computerFreshness", () => {
  it("is fresh inside 3 × the 300 s cadence", () => {
    const r = computerFreshness({ age_secs: 120, state: "fresh" }, NOW, NOW);
    expect(r.kind).toBe("fresh");
    expect(r.label).toBe("fresh");
    expect(COMPUTER_STALE_AFTER_SECS).toBe(900);
  });

  it("turns a coord `fresh` stale once its age passes 900 s", () => {
    const r = computerFreshness({ age_secs: 901, state: "fresh" }, NOW, NOW);
    expect(r.kind).toBe("stale");
    expect(r.label).toBe("STALE");
  });

  it("ages a fresh verdict by the time since the read landed (a silent coord goes stale by itself)", () => {
    // Read 14 minutes ago, 120 s old then: 960 s old now.
    const fetchedAt = NOW - 14 * 60 * 1000;
    const r = computerFreshness(
      { age_secs: 120, state: "fresh" },
      fetchedAt,
      NOW
    );
    expect(r.kind).toBe("stale");
    expect(r.ageSecs).toBe(960);
  });

  it("never upgrades coord's own stale or unknown", () => {
    expect(
      computerFreshness({ age_secs: 5, state: "stale" }, NOW, NOW).kind
    ).toBe("stale");
    expect(
      computerFreshness({ age_secs: 5, state: "unknown" }, NOW, NOW).kind
    ).toBe("unknown");
  });

  it("reads an absent block, an undatable report, and an unknown word as UNKNOWN — never fresh", () => {
    expect(computerFreshness(null, NOW, NOW).label).toBe("UNKNOWN");
    expect(computerFreshness({ state: "fresh" }, NOW, NOW).kind).toBe(
      "unknown"
    );
    expect(
      computerFreshness({ age_secs: 10, state: "vibrant" }, NOW, NOW).kind
    ).toBe("unknown");
  });

  it("never dates a report from its timestamp against this browser's clock — no age_secs is UNKNOWN", () => {
    // A timestamp that reads "30 s ago" on this clock: a skewed browser clock
    // would call it fresh. Without coord's own age, freshness is unknown.
    const r = computerFreshness(
      { last_report_at: "2026-09-30T11:59:30Z", state: "fresh" },
      null,
      NOW
    );
    expect(r.kind).toBe("unknown");
    expect(r.ageSecs).toBeNull();
    // Coord's own `stale` still stands without an age.
    expect(
      computerFreshness(
        { last_report_at: "2026-09-30T11:59:30Z", state: "stale" },
        null,
        NOW
      ).kind
    ).toBe("stale");
  });
});

describe("laneFreshness", () => {
  const freshComputer = computerFreshness(
    { age_secs: 10, state: "fresh" },
    NOW,
    NOW
  );

  it("goes stale past 3 × the 30 s sample cadence inside a fresh computer", () => {
    expect(
      laneFreshness({ lane: "host", age_secs: 60 }, freshComputer, NOW, NOW)
        .kind
    ).toBe("fresh");
    expect(
      laneFreshness({ lane: "host", age_secs: 91 }, freshComputer, NOW, NOW)
        .kind
    ).toBe("stale");
  });

  it("is stale whenever the computer is not fresh, however young the sample", () => {
    const staleComputer = computerFreshness(
      { age_secs: 5000, state: "stale" },
      NOW,
      NOW
    );
    expect(
      laneFreshness({ lane: "host", age_secs: 1 }, staleComputer, NOW, NOW).kind
    ).toBe("stale");
  });

  it("is UNKNOWN with no sample time", () => {
    expect(laneFreshness({ lane: "wsl" }, freshComputer, NOW, NOW).kind).toBe(
      "unknown"
    );
  });
});

describe("readLaneField", () => {
  const lane: ComputerLaneWire = {
    lane: "host",
    load_1m: 3.25,
    load_5m: null,
    // A proxy number that rode along beside `not_supported` is NOT a reading.
    load_15m: 0,
    psi_memory_some_avg60: 12.5,
    measured: { load_15m: "not_supported", psi_io: "unavailable" },
  };
  const fmt = (v: number) => v.toFixed(2);

  it("renders a measured value", () => {
    expect(readingText(readLaneField(lane, "load_1m"), fmt)).toBe("3.25");
  });

  it("renders a never-measured field as `unknown`, never 0", () => {
    expect(readingText(readLaneField(lane, "load_5m"), fmt)).toBe("unknown");
    expect(readingText(readLaneField(lane, "psi_cpu_some_avg60"), fmt)).toBe(
      "unknown"
    );
  });

  it("renders `not supported` and `unavailable` from the measured map, over any number sent", () => {
    expect(readingText(readLaneField(lane, "load_15m"), fmt)).toBe(
      "not supported"
    );
    expect(readingText(readLaneField(lane, "psi_io_some_avg10"), fmt)).toBe(
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

describe("computerStatus", () => {
  const status = (c: ComputerSummaryWire, fetchedAt = NOW) => {
    const n = normalizeComputer(c);
    return computerStatus(n, computerFreshness(n.freshness, fetchedAt, NOW), {
      fetchedAtMs: fetchedAt,
      nowMs: NOW,
    });
  };

  it("counts pressure only on a FRESH lane", () => {
    const s = status(
      computer({ lanes: [{ lane: "host", age_secs: 10, headroom: "breach" }] })
    );
    expect(s.kind).toBe("under_pressure");
    expect(s.reason).toBe(
      "Lane host is at or below an admission floor, so coord is deferring or refusing work here until it recovers."
    );
  });

  it("reads stale-only pressure as an amber stale lane, naming it — never as current pressure", () => {
    const s = status(
      computer({
        lanes: [
          { lane: "host", age_secs: 10, headroom: "ok" },
          {
            lane: "wsl",
            lane_instance: "Ubuntu",
            age_secs: 600,
            headroom: "breach",
          },
        ],
      })
    );
    expect(s.kind).toBe("lane_stale");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toBe(
      "The samples for lane wsl (Ubuntu) are stale or undatable, so current pressure there is unknown. Last known: wsl (Ubuntu) breach — not current."
    );
  });

  it("does not call a computer healthy while one of its lanes cannot be dated", () => {
    const s = status(computer({ lanes: [{ lane: "host", headroom: "ok" }] }));
    expect(s.kind).toBe("lane_stale");
    expect(s.reason).toBe(
      "The samples for lane host are stale or undatable, so current pressure there is unknown."
    );
  });

  it("is healthy only when fresh, every service counted and none failed", () => {
    expect(status(computer()).kind).toBe("healthy");
  });

  it("is `services unknown` (amber), never healthy, when coord sent no service count", () => {
    const s = status(computer({ services_failed: null }));
    expect(s.kind).toBe("services_unknown");
    expect(s.attention).toBe("waiting");
  });

  it("is red for a failed watched service on a fresh computer", () => {
    const s = status(computer({ services_failed: 3 }));
    expect(s.kind).toBe("service_failed");
    expect(s.label).toBe("3 services failed");
    expect(s.attention).toBe("author");
  });

  it("does not headline a stale computer's failure as current — it is stale, with the last-known count", () => {
    const s = status(
      computer({
        services_failed: 2,
        freshness: { age_secs: 4000, state: "stale" },
      })
    );
    expect(s.kind).toBe("stale");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toContain("Last known: 2 failed services.");
  });

  it("puts an identity conflict first — it is a fact about the record, not a reading", () => {
    const s = status(
      computer({
        identity_conflict_at: "2026-09-30T10:00:00Z",
        freshness: { age_secs: 9000, state: "stale" },
      })
    );
    expect(s.kind).toBe("identity_conflict");
  });

  it("reads the nested identity/capacity spelling the same as the flat one", () => {
    const n = normalizeComputer({
      computer_id: ID,
      identity: { hostname: "msi-wsl", kind: "wsl_guest" },
      capacity: { cpu_cores: 16, memory_total_bytes: 1024 },
    });
    expect(n.hostname).toBe("msi-wsl");
    expect(n.kind).toBe("wsl_guest");
    expect(n.capacity.cpuCores).toBe(16);
    expect(n.capacity.swapTotalBytes).toBeNull();
  });
});

describe("serviceStatus", () => {
  it("is red for failed, with the result", () => {
    const s = serviceStatus(
      { unit: "a.service", active_state: "failed", result: "oom-kill" },
      true
    );
    expect(s.kind).toBe("failed");
    expect(s.reason).toBe("Failed (result: oom-kill).");
  });

  it("shows a stale computer's unit as `last known`, under the ignorance floor", () => {
    const s = serviceStatus(
      { unit: "a.service", active_state: "active", sub_state: "running" },
      false
    );
    expect(s.kind).toBe("unknown");
    expect(s.label).toBe("last known: active/running");
    expect(s.attention).toBe("waiting");
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
    expect(
      classifyComputersError(
        rejection(404, '{"error":"coord returned HTTP 404"}'),
        { detail: true }
      ).kind
    ).toBe("route_unavailable");
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

  it("recognises schema_pending on any status", () => {
    expect(
      classifyComputersError(rejection(503, '{"error":"schema_pending"}')).kind
    ).toBe("schema_pending");
    expect(
      classifyComputersError(rejection(409, '{"error":"schema_pending"}')).kind
    ).toBe("schema_pending");
  });

  it("recognises a 2xx schema_pending body in either flag shape", () => {
    expect(isSchemaPendingBody({ schema_pending: true, computers: [] })).toBe(
      true
    );
    expect(isSchemaPendingBody({ state: "schema_pending" })).toBe(true);
    expect(isSchemaPendingBody({ computers: [] })).toBe(false);
  });

  it("keeps a transport failure as an error, and its banner says UNKNOWN", () => {
    const issue = classifyComputersError(new TypeError("Failed to fetch"));
    expect(issue.kind).toBe("error");
    expect(readIssueText(issue)).toBe(
      "Could not read computers from coord (Failed to fetch) — UNKNOWN, not empty."
    );
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

  it("is green only when every computer is fresh and healthy and the read refreshed", () => {
    const rows = buildComputerRows({ computers: [computer()] }, NOW, NOW);
    const ok = deriveComputersHealth({
      rows,
      loaded: true,
      issue: null,
      unattributed: 0,
    });
    expect(ok.level).toBe("green");
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

  it("counts stale and unknown computers, and renders an unserved unattributed count as a dash", () => {
    const rows = buildComputerRows(
      {
        computers: [
          computer({
            computer_id: "a",
            freshness: { age_secs: 5000, state: "stale" },
          }),
          computer({ computer_id: "b", freshness: null }),
        ],
      },
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
  it("renders an unstated service list as a dash, not zero failed", () => {
    const n = normalizeComputer(computer());
    const f = computerFreshness(n.freshness, NOW, NOW);
    const h = deriveComputerDetailHealth({
      computer: n,
      freshness: f,
      status: computerStatus(n, f, { fetchedAtMs: NOW, nowMs: NOW }),
      issue: null,
      services: null,
      events: [],
      divergence: null,
    });
    const labels = h.badges.map((b) => b.label);
    expect(labels).toContain("failed services –");
    expect(labels).toContain("divergence –");
    expect(labels).toContain("events 7d 0");
  });
});

describe("not_found supersedes retained data", () => {
  it("headlines not-found even when a computer from an earlier read is passed in", () => {
    const n = normalizeComputer(computer({ services_failed: 2 }));
    const f = computerFreshness(n.freshness, NOW, NOW);
    const h = deriveComputerDetailHealth({
      computer: n,
      freshness: f,
      status: computerStatus(n, f, { fetchedAtMs: NOW, nowMs: NOW }),
      issue: { kind: "not_found" },
      services: [],
      events: [],
      divergence: [],
    });
    expect(h.headline).toBe("No such computer in this tenant");
    expect(h.level).toBe("amber");
    expect(h.badges).toEqual([]);
  });
});

describe("last_event: absent is unknown, null is none", () => {
  it("keeps the two apart", () => {
    const absent = computer();
    expect(normalizeComputer(absent).lastEvent).toBeUndefined();
    expect(
      normalizeComputer(computer({ last_event: null })).lastEvent
    ).toBeNull();
  });
});

describe("a 403 is its own answer", () => {
  it("classifies not_coord_tenant_admin as forbidden, in both body shapes", () => {
    // The app's error middleware shape, and a bare FastAPI detail.
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
    const issue = classifyComputersError(
      rejection(403, '{"error":"FORBIDDEN","message":"csrf_rejected"}')
    );
    expect(issue.kind).toBe("error");
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
    });
    expect(detail.headline).toBe("Coord tenant admins only");
  });
});

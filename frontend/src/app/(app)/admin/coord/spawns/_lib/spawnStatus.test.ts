/**
 * spawnStatus — the derivations behind `/admin/coord/spawns`.
 *
 * Pinned, and why each would go red:
 *
 * 1. **The outcome vocabulary is the gates page's.** `spawned` is not
 *    success; only `finished` reads `work_completed`; an `unknown` outcome is
 *    `work_unreported`, never finished. Every shared kind takes the
 *    continuation table's own attention and class.
 * 2. **Waiting is judged by time since the first attempt**, not by the
 *    deferral count: calm under 10 minutes, amber past it, red past a day — so
 *    a request deferred 30 times in an hour is late, not stuck.
 * 3. **`{available: false}` is its own reading**, never an empty ledger, and a
 *    stats body for another window is refused.
 * 4. **A null aggregate is the word `unknown`**, never `0` or `0%`, on every
 *    badge that carries one; a stale read is never green; UNKNOWN outcomes are
 *    never counted as finished.
 * 5. **The per-device list names each device's role**, keeps a device with no
 *    wait sample as `unknown`, and leaves an unreadable `placed` out of the
 *    total.
 * 6. **The hourly series counts only requests made in its span**, and a
 *    truncated list starts at the next full hour.
 * 7. **The tabs partition the rows the way their titles say**, and each has
 *    its own empty sentence.
 */

import { describe, expect, it } from "vitest";
import {
  CONTINUATION_ATTENTION_BY_KIND,
  CONTINUATION_KIND_CLASS,
} from "../../gates/continuationStatus";
import {
  AS_OF,
  DEVICE_A,
  DEVICE_B,
  ROSTER,
  listFx,
  rowFx,
  statsFx,
} from "../__fixtures__/coordSpawns";
import {
  SPAWN_ATTENTION_BY_KIND,
  SPAWN_KIND_CLASS,
  classifySpawnError,
  deriveSpawnStatus,
  deriveSpawnsHealth,
  deviceName,
  deviceRoleText,
  formatBps,
  formatDuration,
  formatRate,
  hourlyRates,
  matchesSpawnFilter,
  mergeSpawnRows,
  perDeviceShares,
  readSpawnList,
  readSpawnStats,
  spawnFilterCounts,
  spawnFilterEmptyText,
  spawnFilterUnknownText,
  timeToSpawnText,
  type DeviceNaming,
  type DeviceRoles,
  type SpawnKind,
} from "./spawnStatus";

const NOW = Date.parse(AS_OF);
const clock = (iso: string) => iso;
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const ROLES: DeviceRoles = {
  kind: "known",
  byDevice: new Map([[DEVICE_A, "Workhorse"]]),
};
/** The operator's naming: the roster's hostnames, ids in titles. */
const operatorNaming = (
  roster: ReadonlyArray<{ device_id: string; hostname?: string }>
): DeviceNaming => ({
  nameOf: (id) => deviceName(id, roster),
  showIds: true,
});

describe("deriveSpawnStatus — the continuation vocabulary", () => {
  it("reads only a finished session as success", () => {
    expect(
      deriveSpawnStatus(rowFx({ session_outcome: "finished" }), NOW).kind
    ).toBe("work_completed");
    for (const outcome of [null, "working"]) {
      const s = deriveSpawnStatus(rowFx({ session_outcome: outcome }), NOW);
      expect(s.kind).toBe("spawned");
      expect(s.attention).toBe("waiting");
    }
  });

  it("never reads an unknown outcome as finished", () => {
    const s = deriveSpawnStatus(rowFx({ session_outcome: "unknown" }), NOW);
    expect(s.kind).toBe("work_unreported");
    expect(s.label).not.toMatch(/finished/i);
  });

  it("maps every terminal state onto its continuation word", () => {
    const cases: [Parameters<typeof rowFx>[0], SpawnKind][] = [
      [{ session_outcome: "closed_unfinished" }, "work_abandoned"],
      [{ state: "failed", spawned_at: null }, "spawn_failed"],
      [{ state: "expired", spawned_at: null }, "expired"],
      [{ state: "cancelled", spawned_at: null }, "cancelled"],
      [{ state: "superseded", spawned_at: null }, "superseded"],
      [{ state: "brand_new_state" }, "unknown"],
      [{ session_outcome: "brand_new_outcome" }, "unknown"],
    ];
    for (const [overrides, kind] of cases) {
      expect(deriveSpawnStatus(rowFx(overrides), NOW).kind).toBe(kind);
    }
  });

  it("paints every shared word exactly as the gates page does", () => {
    const ledgerOnly = new Set([
      "queued",
      "waiting_late",
      "waiting_stuck",
      "superseded",
    ]);
    for (const kind of Object.keys(SPAWN_ATTENTION_BY_KIND) as SpawnKind[]) {
      if (ledgerOnly.has(kind)) continue;
      const shared = kind as Exclude<
        SpawnKind,
        "queued" | "waiting_late" | "waiting_stuck" | "superseded"
      >;
      expect(SPAWN_ATTENTION_BY_KIND[shared]).toBe(
        CONTINUATION_ATTENTION_BY_KIND[shared]
      );
      expect(SPAWN_KIND_CLASS[shared]).toBe(CONTINUATION_KIND_CLASS[shared]);
    }
  });
});

describe("deriveSpawnStatus — waiting is judged by time", () => {
  const pending = (state: string, minutes: number, extra = {}) =>
    rowFx({
      state,
      requested_at: minutesAgo(minutes),
      updated_at: minutesAgo(1),
      spawned_at: null,
      session_outcome: null,
      ...extra,
    });

  it("is calm under the 10-minute target, amber past it, red past a day", () => {
    expect(deriveSpawnStatus(pending("queued", 5), NOW).kind).toBe("queued");
    expect(deriveSpawnStatus(pending("queued", 5), NOW).attention).toBe("none");
    expect(deriveSpawnStatus(pending("queued", 30), NOW).kind).toBe(
      "waiting_late"
    );
    expect(deriveSpawnStatus(pending("queued", 30), NOW).attention).toBe(
      "waiting"
    );
    const stuck = deriveSpawnStatus(pending("queued", 25 * 60), NOW);
    expect(stuck.kind).toBe("waiting_stuck");
    expect(stuck.attention).toBe("author");
  });

  it("does not turn a request red for its deferral count alone", () => {
    // 30 deferrals in an hour is two-and-a-half hours of 5-minute stamps at
    // most — late, not a day stuck.
    const row = pending("deferred", 60, { deferrals: 30 });
    expect(deriveSpawnStatus(row, NOW).kind).toBe("waiting_late");
    expect(
      deriveSpawnStatus(pending("deferred", 5, { deferrals: 2 }), NOW).kind
    ).toBe("deferred");
    expect(
      deriveSpawnStatus(
        pending("deferred", 3 * 24 * 60, { deferrals: 43 }),
        NOW
      ).kind
    ).toBe("waiting_stuck");
  });

  it("keeps the dispatch-silence reading, with the gates page's threshold", () => {
    const silent = pending("dispatched", 20, { updated_at: minutesAgo(16) });
    expect(deriveSpawnStatus(silent, NOW).kind).toBe("dispatch_stalled");
    const fresh = pending("dispatched", 3, { updated_at: minutesAgo(1) });
    expect(deriveSpawnStatus(fresh, NOW).kind).toBe("dispatched");
  });

  it("reads an unreadable request time as unknown, never calm", () => {
    const s = deriveSpawnStatus(
      pending("queued", 5, { requested_at: "nope" }),
      NOW
    );
    expect(s.kind).toBe("unknown");
  });
});

describe("timeToSpawnText", () => {
  it("states coord's wait for a started request and never a 0 for one that did not start", () => {
    expect(timeToSpawnText(rowFx({ wait_seconds: 12 }), NOW)).toBe(
      "started after 12 s"
    );
    expect(timeToSpawnText(rowFx({ wait_seconds: null }), NOW)).toBe(
      "started; wait unknown"
    );
    expect(
      timeToSpawnText(rowFx({ state: "expired", wait_seconds: null }), NOW)
    ).toBe("never started");
    expect(
      timeToSpawnText(
        rowFx({ state: "queued", requested_at: minutesAgo(30) }),
        NOW
      )
    ).toBe("waiting 30 min so far");
  });
});

describe("reading a body", () => {
  it("reads {available: false} as the ledger not deployed, not as an empty list", () => {
    expect(
      readSpawnList({ available: false, reason: "schema_missing" })
    ).toEqual({
      kind: "issue",
      issue: { kind: "ledger_not_deployed", reason: "schema_missing" },
    });
    expect(readSpawnStats({ available: false }).kind).toBe("issue");
  });

  it("refuses a 2xx body that is not the contract's shape", () => {
    expect(readSpawnList({ available: true, items: "nope" })).toEqual({
      kind: "issue",
      issue: { kind: "malformed" },
    });
    expect(readSpawnList(listFx([rowFx()])).kind).toBe("ok");
  });

  it("refuses a stats body that answers another window", () => {
    expect(readSpawnStats(statsFx({}, { window: "30d" }), "7d")).toEqual({
      kind: "issue",
      issue: { kind: "window_mismatch", asked: "7d", answered: "30d" },
    });
    expect(readSpawnStats(statsFx(), "7d").kind).toBe("ok");
  });
});

describe("classifySpawnError", () => {
  const err = (status: number, body: string) =>
    new Error(`GET /api/v1/operations/spawns failed: ${status} - ${body}`);

  it("reads the web admin gate", () => {
    expect(
      classifySpawnError(
        err(403, '{"error":"FORBIDDEN","message":"not_coord_tenant_admin"}')
      )
    ).toEqual({ kind: "forbidden" });
  });

  it("reads a coord that does not serve the route — on the detail read too", () => {
    expect(classifySpawnError(err(404, '{"error":"no_such_route"}'))).toEqual({
      kind: "route_unavailable",
    });
    expect(
      classifySpawnError(err(404, '{"error":"no_such_route"}'), {
        detail: true,
      })
    ).toEqual({ kind: "route_unavailable" });
  });

  it("reads only coord's spawn_not_found as no such request", () => {
    expect(
      classifySpawnError(err(404, '{"error":"spawn_not_found"}'), {
        detail: true,
      })
    ).toEqual({ kind: "not_found" });
  });

  it("names a route an operator switched off", () => {
    expect(classifySpawnError(err(404, '{"error":"route_disabled"}'))).toEqual({
      kind: "route_disabled",
    });
  });

  it("words any other failure as the operator sentence, not the raw request", () => {
    const issue = classifySpawnError(err(502, '{"detail":"Bad gateway"}'));
    expect(issue.kind).toBe("error");
    expect(issue.kind === "error" && issue.message).not.toContain("GET /api");
  });
});

describe("formatting", () => {
  it("never renders a null as zero", () => {
    expect(formatBps(null)).toBe("unknown");
    expect(formatBps(0)).toBe("0%");
    expect(formatBps(10000)).toBe("100%");
    expect(formatRate(null)).toBe("unknown");
    expect(formatRate(0)).toBe("0/h");
    expect(formatDuration(190)).toBe("3.2 min");
  });

  it("keeps two close rates distinguishable — two significant figures", () => {
    expect(formatRate(0.24)).toBe("0.24/h");
    expect(formatRate(0.22)).toBe("0.22/h");
    expect(formatRate(0.0012)).toBe("0.0012/h");
    expect(formatRate(3.84)).toBe("3.8/h");
    expect(formatRate(12.4)).toBe("12/h");
  });
});

describe("deriveSpawnsHealth", () => {
  const label = (h: ReturnType<typeof deriveSpawnsHealth>, key: string) =>
    String(h.badges.find((b) => b.key === key)?.label);

  it("renders every null aggregate as unknown, and never as 0", () => {
    const h = deriveSpawnsHealth({
      stats: statsFx({
        terminal: 0,
        spawned: 0,
        cancelled: 0,
        started_share_bps: null,
        wait_p50_secs: null,
        wait_p90_secs: null,
        first_attempt_share_bps: null,
      }),
      issue: null,
      window: "7d",
      rows: null,
      nowMs: NOW,
      clock,
    });
    expect(label(h, "started-share")).toBe(
      "started share unknown (0 ended requests)"
    );
    expect(label(h, "time-to-spawn")).toBe(
      "time to spawn p50 unknown · p90 unknown"
    );
    expect(label(h, "first-attempt")).toBe(
      "first attempt unknown (none started)"
    );
    for (const b of h.badges) expect(String(b.label)).not.toMatch(/\b0%/);
  });

  it("says a null first-attempt share is unknown — not 'none started' — when some started", () => {
    const h = deriveSpawnsHealth({
      stats: statsFx({ first_attempt_share_bps: null }),
      issue: null,
      window: "7d",
      rows: null,
      nowMs: NOW,
      clock,
    });
    expect(label(h, "first-attempt")).toBe("first attempt unknown");
  });

  it("shows the rates beside the window's counts", () => {
    const h = deriveSpawnsHealth({
      stats: statsFx(),
      issue: null,
      window: "7d",
      rows: null,
      nowMs: NOW,
      clock,
    });
    expect(label(h, "rates")).toBe(
      "requested 0.24/h · started 0.22/h (40 requested · 37 started)"
    );
  });

  it("shows the session outcomes, and never counts unknown as finished", () => {
    const h = deriveSpawnsHealth({
      stats: statsFx(),
      issue: null,
      window: "7d",
      rows: null,
      nowMs: NOW,
      clock,
    });
    expect(label(h, "outcomes")).toBe(
      "outcomes 30 finished · 4 working · 0 closed unfinished · 3 unknown"
    );
  });

  it("names its window and its as-of time", () => {
    const h = deriveSpawnsHealth({
      stats: statsFx(),
      issue: null,
      window: "7d",
      rows: null,
      nowMs: NOW,
      clock,
    });
    expect(h.detail).toBe(
      "last 7 days (since 2026-10-14T12:00:00Z) · as of 2026-10-21T12:00:00Z"
    );
  });

  it("is red when a spawn failed or expired, amber while some wait, green otherwise", () => {
    const at = (overall: Parameters<typeof statsFx>[0]) =>
      deriveSpawnsHealth({
        stats: statsFx(overall),
        issue: null,
        window: "7d",
        rows: null,
        nowMs: NOW,
        clock,
      });
    expect(at({ failed: 1 }).level).toBe("red");
    expect(at({ queued_now: 2 }).level).toBe("amber");
    expect(at({ queued_now: 0 }).level).toBe("green");
    expect(at({ queued_now: null }).level).toBe("amber");
  });

  it("is red when a row on screen is red, naming what is stuck", () => {
    const stuck = rowFx({
      state: "deferred",
      requested_at: minutesAgo(3 * 24 * 60),
      spawned_at: null,
      session_outcome: null,
    });
    const h = deriveSpawnsHealth({
      stats: statsFx({ failed: 0, expired: 0, queued_now: 1 }),
      issue: null,
      window: "7d",
      rows: [stuck, rowFx()],
      nowMs: NOW,
      clock,
    });
    expect(h.level).toBe("red");
    expect(h.headline).toBe("1 spawn stuck for 3 d");
    // Every clause, most actionable first.
    const all = deriveSpawnsHealth({
      stats: statsFx({
        failed: 2,
        expired: 0,
        finished: {
          finished: 30,
          working: 4,
          closed_unfinished: 1,
          unknown: 2,
        },
      }),
      issue: null,
      window: "7d",
      rows: [stuck, rowFx({ session_outcome: "closed_unfinished" })],
      nowMs: NOW,
      clock,
    });
    expect(all.headline).toBe(
      "1 spawn stuck for 3 d; 2 failed or expired in the last 7 days; 1 session closed unfinished"
    );
  });

  it("calls a stalled dispatch stalled, never stuck", () => {
    const stalled = rowFx({
      state: "dispatched",
      requested_at: minutesAgo(20),
      updated_at: minutesAgo(16),
      spawned_at: null,
      session_outcome: null,
    });
    const h = deriveSpawnsHealth({
      stats: statsFx({ queued_now: 1 }),
      issue: null,
      window: "7d",
      rows: [stalled],
      nowMs: NOW,
      clock,
    });
    expect(h.level).toBe("red");
    expect(h.headline).toBe("1 dispatch stalled");
    expect(h.headline).not.toContain("stuck");
  });

  it("counts closed-unfinished sessions from coord's window figure, the badge's number", () => {
    const abandoned = rowFx({ session_outcome: "closed_unfinished" });
    const outcomes = {
      finished: 30,
      working: 4,
      closed_unfinished: 3,
      unknown: 0,
    };
    // A truncated list shows one of the three; the headline says three, as
    // the outcomes badge beside it does.
    const h = deriveSpawnsHealth({
      stats: statsFx({ finished: outcomes }),
      issue: null,
      window: "7d",
      rows: [abandoned],
      nowMs: NOW,
      clock,
    });
    expect(h.headline).toBe("3 sessions closed unfinished");
    expect(String(h.badges.find((b) => b.key === "outcomes")?.label)).toContain(
      "3 closed unfinished"
    );
    // With no stats, the rows on screen are all there is to count.
    const fromRows = deriveSpawnsHealth({
      stats: null,
      issue: { kind: "error", message: "boom" },
      window: "7d",
      rows: [abandoned],
      nowMs: NOW,
      clock,
    });
    expect(fromRows.headline).toBe("1 session closed unfinished");
  });

  it("is red from the rows even when the stats read did not answer", () => {
    const stuck = rowFx({
      state: "queued",
      requested_at: minutesAgo(26 * 60),
      spawned_at: null,
      session_outcome: null,
    });
    const h = deriveSpawnsHealth({
      stats: null,
      issue: { kind: "error", message: "boom" },
      window: "7d",
      rows: [stuck],
      nowMs: NOW,
      clock,
    });
    expect(h.level).toBe("red");
    expect(h.headline).toBe("1 spawn stuck for 26 h");
  });

  it("never paints a stale all-clear green", () => {
    const h = deriveSpawnsHealth({
      stats: statsFx({ queued_now: 0 }),
      issue: { kind: "error", message: "boom" },
      window: "7d",
      rows: null,
      nowMs: NOW,
      clock,
    });
    expect(h.level).toBe("amber");
    expect(h.verdict).toBe("stale");
    expect(h.headline).toMatch(/^At the last good read/);
  });

  it("says the ledger is not deployed when coord says so", () => {
    const h = deriveSpawnsHealth({
      stats: null,
      issue: { kind: "ledger_not_deployed", reason: "schema_missing" },
      window: "7d",
      rows: null,
      nowMs: NOW,
      clock,
    });
    expect(h.headline).toBe("Spawn ledger not deployed yet");
    expect(h.badges).toEqual([]);
    expect(h.verdict).toBe("unknown");
  });
});

describe("perDeviceShares", () => {
  it("names devices and their roles, and keeps an unsampled device as unknown", () => {
    const { items, total } = perDeviceShares(statsFx(), ROLES, operatorNaming(ROSTER.devices));
    expect(total).toBe(38);
    expect(items.map((i) => i.label)).toEqual([
      "msi-wsl · Workhorse",
      "spaceship · role unknown",
    ]);
    // The wait leads the detail, so a truncated line keeps it.
    expect(String(items[1]?.detail)).toBe(
      "p50 unknown · 8/0/0 started/refused/deferred"
    );
    expect(items[1]?.title).toContain("Reserve and ceilings: not served yet");
    expect(items[1]?.title).not.toContain("Role, reserve");
    // The detail's hover is the whole sentence too.
    expect(items[1]?.detailTitle).toBe(items[1]?.title);
  });

  it("says every role is unknown, with the reason, when the role read failed", () => {
    const roles: DeviceRoles = { kind: "unknown", reason: "HTTP 404" };
    expect(deviceRoleText(DEVICE_A, roles)).toBe("role unknown");
    const { items } = perDeviceShares(statsFx(), roles, operatorNaming(ROSTER.devices));
    expect(items[0]?.title).toContain("Role unknown: HTTP 404");
  });

  it("reads an unreadable placed as unknown and leaves it out of the total", () => {
    const stats = statsFx();
    stats.per_device = [
      {
        device_id: DEVICE_A,
        placed: 4,
        started: 4,
        refused: 0,
        deferred: 0,
        wait_p50_secs: 9,
      },
      {
        device_id: DEVICE_B,
        placed: null as unknown as number,
        started: 1,
        refused: 0,
        deferred: 0,
        wait_p50_secs: null,
      },
    ];
    const { items, total } = perDeviceShares(stats, ROLES, operatorNaming([]));
    expect(total).toBe(4);
    expect(items[1]?.count).toBeNull();
  });

  it("states no share when nothing was placed", () => {
    const stats = statsFx();
    stats.per_device = [
      {
        device_id: DEVICE_A,
        placed: 0,
        started: 0,
        refused: 2,
        deferred: 0,
        wait_p50_secs: null,
      },
    ];
    expect(perDeviceShares(stats, ROLES, operatorNaming([])).total).toBeNull();
  });

  it("names every device by the naming it is handed, with no id and no role reason while presenting", () => {
    const presented: DeviceNaming = {
      nameOf: (id) => (id === DEVICE_A ? "Machine A" : "Machine B"),
      showIds: false,
    };
    const roles: DeviceRoles = { kind: "unknown", reason: "HTTP 404 from /coord/fleet" };
    const { items } = perDeviceShares(statsFx(), roles, presented);
    expect(items.map((i) => i.label)).toEqual([
      "Machine A · role unknown",
      "Machine B · role unknown",
    ]);
    for (const item of items) {
      expect(item.title).not.toContain(DEVICE_A);
      expect(item.title).not.toContain(DEVICE_B);
      expect(item.title).not.toContain("HTTP 404");
    }
  });

  it("falls back to the id's first block for a device the roster does not name", () => {
    expect(deviceName(DEVICE_B, [])).toBe(`device ${DEVICE_B.slice(0, 8)}`);
  });
});

describe("hourlyRates", () => {
  it("counts the requests made in each hour, and when those requests started", () => {
    const series = hourlyRates(
      listFx([
        rowFx({
          requested_at: "2026-10-21T10:10:00Z",
          spawned_at: "2026-10-21T11:05:00Z",
        }),
        rowFx({
          requested_at: "2026-10-21T10:20:00Z",
          spawned_at: null,
          state: "queued",
        }),
      ]),
      24 * 3600_000
    );
    expect(series?.partial).toBe(false);
    const at = (iso: string) =>
      series?.points.find((p) => p.hourMs === Date.parse(iso));
    expect(at("2026-10-21T10:00:00Z")).toMatchObject({
      requested: 2,
      started: 0,
    });
    expect(at("2026-10-21T11:00:00Z")).toMatchObject({
      requested: 0,
      started: 1,
    });
    expect(series?.points).toHaveLength(25);
  });

  it("starts at the first full hour after the window's start, never before it", () => {
    const series = hourlyRates(
      listFx(
        [
          rowFx({
            requested_at: "2026-10-20T12:40:00Z",
            spawned_at: null,
            state: "queued",
          }),
        ],
        {
          as_of: "2026-10-21T12:30:00Z",
        }
      ),
      24 * 3600_000
    );
    // The window starts 2026-10-20T12:30; its 12:00 hour was only half read.
    expect(series?.points[0]?.hourMs).toBe(Date.parse("2026-10-20T13:00:00Z"));
    expect(series?.points.some((p) => p.requested > 0)).toBe(false);
  });

  it("starts a truncated list at the next full hour after its oldest row", () => {
    const series = hourlyRates(
      listFx(
        [
          rowFx({
            requested_at: "2026-10-21T09:30:00Z",
            spawned_at: "2026-10-21T10:15:00Z",
          }),
          rowFx({
            requested_at: "2026-10-21T10:30:00Z",
            spawned_at: "2026-10-21T10:40:00Z",
          }),
        ],
        { truncated: true, total: 900 }
      ),
      7 * 24 * 3600_000
    );
    expect(series?.partial).toBe(true);
    expect(series?.points[0]?.hourMs).toBe(Date.parse("2026-10-21T10:00:00Z"));
    // The 09:30 request is outside the span, so neither its request nor its
    // 10:15 start is drawn; only the 10:30 request and its start are.
    expect(series?.points[0]).toMatchObject({ requested: 1, started: 1 });
  });
});

describe("the rows on screen", () => {
  it("adds every waiting request, whatever its age, to the window's rows — once", () => {
    const shared = rowFx({ state: "queued", requested_at: minutesAgo(5) });
    const old = rowFx({
      state: "deferred",
      requested_at: minutesAgo(3 * 24 * 60),
    });
    const recent = rowFx({ requested_at: minutesAgo(1) });
    const merged = mergeSpawnRows([recent, shared], [shared, old]);
    expect(merged?.map((r) => r.id)).toEqual([recent.id, shared.id, old.id]);
    expect(mergeSpawnRows(null, null)).toBeNull();
  });
});

describe("filter tabs", () => {
  it("partitions rows the way the tab titles say", () => {
    const rows = [
      rowFx({ state: "queued" }),
      rowFx({ state: "deferred" }),
      rowFx({ state: "failed" }),
      rowFx({ state: "expired" }),
      rowFx({ state: "superseded" }),
      rowFx({ session_outcome: "finished" }),
      rowFx({ session_outcome: "unknown" }),
    ];
    expect(spawnFilterCounts(rows, { list: true, pending: true })).toEqual({
      all: 7,
      queued: 2,
      failed: 1,
      never_ran: 2,
      finished: 1,
    });
    expect(
      matchesSpawnFilter(rowFx({ session_outcome: "unknown" }), "finished")
    ).toBe(false);
  });

  it("counts nothing — a dash, not a zero — before the list is read", () => {
    expect(spawnFilterCounts(null, { list: true, pending: true })).toEqual({
      all: null,
      queued: null,
      failed: null,
      never_ran: null,
      finished: null,
    });
  });

  it("gives a tab no count when the read it rests on did not answer", () => {
    const waiting = [rowFx({ state: "queued" })];
    // The window's list failed; only the waiting read answered.
    expect(spawnFilterCounts(waiting, { list: false, pending: true })).toEqual({
      all: null,
      queued: 1,
      failed: null,
      never_ran: null,
      finished: null,
    });
    // The waiting read failed; the window's list answered.
    expect(spawnFilterCounts(waiting, { list: true, pending: false })).toEqual({
      all: null,
      queued: null,
      failed: 0,
      never_ran: 0,
      finished: 0,
    });
    expect(
      spawnFilterUnknownText("failed", "last 7 days", {
        list: false,
        pending: true,
      })
    ).toBe(
      "Coord's list of the requests in the last 7 days could not be read — which of them failed to start is unknown, not none."
    );
  });

  it("gives each tab its own empty sentence, scoped to what was read", () => {
    const opts = { scope: "window" as const, stale: false };
    expect(spawnFilterEmptyText("failed", "last 7 days", opts)).toBe(
      "No request in the last 7 days failed to start."
    );
    expect(spawnFilterEmptyText("queued", "last 7 days", opts)).toBe(
      "No request was waiting to start — none queued, dispatched or deferred, of any age."
    );
    expect(
      spawnFilterEmptyText("finished", "last 7 days", {
        scope: "loaded",
        stale: true,
      })
    ).toBe(
      "No request in the rows loaded started and reported its work finished at the last good read."
    );
  });
});

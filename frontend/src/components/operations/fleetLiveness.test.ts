/**
 * `summarizeFleetLiveness` — the Dev Ops Overview's opening verdict.
 *
 * The rules under test are honesty rules, not cosmetics: every one of them
 * exists to stop an absence of signal rendering as an all-clear.
 */

import { describe, expect, it } from "vitest";
import { fleetRosterCut, summarizeFleetLiveness } from "./fleetLiveness";
import type {
  FleetHealthDevice,
  FleetHealthPayload,
} from "@/lib/api/operations/coordFleet";

const device = (id: string, state?: string): FleetHealthDevice => ({
  device_id: id,
  hostname: id,
  state,
});

const summarize = (
  devices: FleetHealthDevice[],
  over: {
    loading?: boolean;
    error?: string | null;
    answered?: boolean;
    body?: Partial<FleetHealthPayload>;
  } = {}
) =>
  summarizeFleetLiveness({
    devices,
    loading: over.loading ?? false,
    error: over.error ?? null,
    answered: over.answered ?? true,
    cut: fleetRosterCut({ devices, ...over.body }),
  });

describe("summarizeFleetLiveness", () => {
  it("is green only when every device reports healthy", () => {
    const s = summarize([device("a", "healthy"), device("b", "healthy")]);
    expect(s.level).toBe("green");
    expect(s.healthy).toBe(2);
    expect(s.unknown).toBe(0);
  });

  it("counts a device with NO reported state as unknown, never healthy", () => {
    const s = summarize([device("a", "healthy"), device("b")]);
    expect(s.unknown).toBe(1);
    expect(s.healthy).toBe(1);
    // Amber, not green: one machine's state is simply not known.
    expect(s.level).toBe("amber");
    expect(s.headline).toContain("no reported state");
  });

  it("counts an unrecognised state as unknown rather than guessing", () => {
    const s = summarize([device("a", "quiescing")]);
    expect(s.unknown).toBe(1);
    expect(s.healthy).toBe(0);
    expect(s.level).toBe("amber");
  });

  it("goes red only for a device coord cannot reach", () => {
    for (const state of ["partitioned", "abandoned"]) {
      const s = summarize([device("a", "healthy"), device("b", state)]);
      expect(s.level).toBe("red");
      expect(s.unreachable).toBe(1);
    }
    expect(summarize([device("a", "degraded")]).level).toBe("amber");
  });

  it("counts coord's `stale` apart from degraded, unknown AND unreachable", () => {
    // Phase 4's fifth DeviceState: the heartbeat is fine, the resource SAMPLER
    // has gone quiet. Three wrong homes, each a different lie —
    //   healthy     hides a publisher that stopped;
    //   unreachable reports a network partition that is not happening;
    //   unknown     says coord had nothing to say, when it made an observation.
    const s = summarize([device("a", "healthy"), device("b", "stale")]);
    expect(s.stale).toBe(1);
    expect(s.unknown).toBe(0);
    expect(s.degraded).toBe(0);
    expect(s.unreachable).toBe(0);
    expect(s.healthy).toBe(1);
    // Amber: not green, and not the red reserved for a device coord cannot
    // reach at all.
    expect(s.level).toBe("amber");
    expect(s.headline).toContain("silent sampler");
    expect(s.detail).toMatch(/not healthy and not unreachable/i);
  });

  it("keeps a stale sampler amber even beside a partitioned device's red", () => {
    // The 2026-08-27 shape is the first, never the second, and the boundary is
    // the whole reason coord added a fifth variant rather than reusing the
    // fourth.
    const s = summarize([device("a", "stale"), device("b", "partitioned")]);
    expect(s.stale).toBe(1);
    expect(s.unreachable).toBe(1);
    expect(s.level).toBe("red");
    // Still counted, not absorbed into the red one.
    expect(summarize([device("a", "stale")]).level).toBe("amber");
  });

  it("renders an EMPTY device list as amber, not as an all-clear", () => {
    const s = summarize([]);
    expect(s.level).toBe("amber");
    expect(s.total).toBe(0);
    expect(s.detail).toContain("not");
    expect(s.headline).toBe("No devices reporting health");
  });

  it("reports total as null, not 0, while the first read is in flight", () => {
    const s = summarize([], { loading: true, answered: false });
    expect(s.total).toBeNull();
    expect(s.headline).toBe("Reading fleet health");
  });

  it("reports total as null, not 0, when the read failed before any answer", () => {
    expect(
      summarize([], { error: "coord unreachable", answered: false }).total
    ).toBeNull();
    // A failure after an answer keeps the last-read count, empty included.
    expect(
      summarize([device("a", "healthy")], { error: "coord unreachable" }).total
    ).toBe(1);
    expect(summarize([], { error: "coord unreachable" }).total).toBe(0);
  });

  it("renders a failed read as amber and says it is about the read", () => {
    // A transport failure is evidence about the network, not about the
    // machines: red would invent an incident, green would hide one.
    const s = summarize([device("a", "healthy")], { error: "502 Bad Gateway" });
    expect(s.level).toBe("amber");
    expect(s.headline).toBe("Fleet health unavailable");
    expect(s.detail).toContain("502 Bad Gateway");
    expect(s.detail).toContain("last read");
  });

  it("distinguishes 'not read yet' from 'nothing to report'", () => {
    const loading = summarize([], { loading: true, answered: false });
    expect(loading.headline).toBe("Reading fleet health");
    expect(loading.headline).not.toBe(summarize([]).headline);
  });

  describe("when coord's row cap cut the roster", () => {
    const healthy = [device("a", "healthy"), device("b", "healthy")];
    const tailOnly = {
      truncated: true,
      total: 4647,
      degradable_dropped: 0,
    };

    it("reads a whole roster exactly as before", () => {
      const s = summarize(healthy, {
        body: { truncated: false, total: 2, degradable_dropped: 0 },
      });
      expect(s.level).toBe("green");
      expect(s.headline).toBe("All 2 machines healthy");
      expect(s.detail).toBe("Coord reaches every device it knows about.");
      expect(s.rosterNote).toBeNull();
    });

    it("stays green on a cut of abandoned rows, and counts only what it listed", () => {
      const s = summarize(healthy, { body: tailOnly });
      expect(s.level).toBe("green");
      expect(s.headline).toBe("All 2 listed machines healthy");
      expect(s.detail).toContain("every device it listed");
      expect(s.detail).toContain("lists 2 rows of 4647");
      expect(s.detail).not.toContain("knows about");
      expect(s.total).toBe(2);
      expect(s.rosterNote).toBe("4647 roster rows");
    });

    it("is never green when coord withheld a machine that could be degrading", () => {
      const s = summarize(healthy, {
        body: { truncated: true, total: 10_002, degradable_dropped: 2 },
      });
      expect(s.level).toBe("amber");
      expect(s.headline).toBe("2 listed machines healthy, any others unknown");
      expect(s.detail).toContain("2 machines that could be degrading");
      expect(s.rosterNote).toBe("10002 roster rows, some health unknown");
    });

    it("is never green on a list at the limit from a coord that says nothing", () => {
      const s = summarize(
        Array.from({ length: 1000 }, (_, i) => device(`d${i}`, "healthy"))
      );
      expect(s.level).toBe("amber");
      expect(s.detail).toContain("1000");
      expect(s.rosterNote).toBe("list may be cut");
    });

    it("keeps red and says what the count leaves out", () => {
      const s = summarize([device("a", "abandoned"), device("b", "healthy")], {
        body: tailOnly,
      });
      expect(s.level).toBe("red");
      expect(s.headline).toBe("1 of 2 listed machines unreachable");
      expect(s.detail).toContain("lists 2 rows of 4647");
      expect(s.rosterNote).toBe("4647 roster rows");
    });

    it("reads the shape coord really serves: a capped list of mostly dead rows", () => {
      const rows = Array.from({ length: 1000 }, (_, i) =>
        device(`d${i}`, i < 50 ? "healthy" : i < 67 ? "degraded" : "abandoned")
      );
      const s = summarize(rows, { body: tailOnly });
      expect(s.level).toBe("red");
      expect(s.headline).toBe("933 of 1000 listed machines unreachable");
      expect(s.detail).toContain("lists 1000 rows of 4647");
      expect(s.detail).toContain("none of them could be degrading");
    });

    it("says the list was cut when coord gives no figure for it", () => {
      const s = summarize(healthy, { body: { truncated: true } });
      expect(s.level).toBe("amber");
      expect(s.rosterNote).toBe("list cut, some health unknown");
    });

    it("says it about the last read when a later read failed", () => {
      const s = summarize(healthy, { error: "502", body: tailOnly });
      expect(s.level).toBe("amber");
      expect(s.headline).toBe("Fleet health unavailable");
      expect(s.detail).toContain("lists 2 rows of 4647");
    });

    it("reads a body not read yet as whole, so nothing is claimed about it", () => {
      expect(fleetRosterCut(null)).toEqual({ kind: "whole" });
    });
  });
});

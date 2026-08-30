/**
 * `summarizeFleetLiveness` — the Dev Ops Overview's opening verdict.
 *
 * The rules under test are honesty rules, not cosmetics: every one of them
 * exists to stop an absence of signal rendering as an all-clear.
 */

import { describe, expect, it } from "vitest";
import { summarizeFleetLiveness } from "./fleetLiveness";
import type { FleetHealthDevice } from "./useFleetHealth";

const device = (id: string, state?: string): FleetHealthDevice => ({
  device_id: id,
  hostname: id,
  state,
});

const summarize = (
  devices: FleetHealthDevice[],
  over: { loading?: boolean; error?: string | null } = {}
) =>
  summarizeFleetLiveness({
    devices,
    loading: over.loading ?? false,
    error: over.error ?? null,
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
    const loading = summarize([], { loading: true });
    expect(loading.headline).toBe("Reading fleet health");
    expect(loading.headline).not.toBe(summarize([]).headline);
  });
});

/**
 * `fleetDrain.ts` — the rules a drain control rests on, asserted without a DOM.
 *
 * Plan `2026-09-01-device-drain-does-not-reach-agent-session-spawning` Phase
 * 4b. Every test here is a regression guard on a claim the surface makes to an
 * operator, and the ones that matter most are the negatives:
 *
 *  1. **No failure becomes "not drained".** A 404, an unrecognised body, a
 *     null container and an unparseable entry are each UNKNOWN, for the whole
 *     read or for the one device it concerns. There is no input in this file
 *     that turns an absent answer into a calm one.
 *  2. **A row that cannot name a coord device has no drainable identity**, and
 *     `resolveDrainTarget` says which of the ways it failed.
 *  3. **The expiry is mandatory and bounded**, mirroring coord's own
 *     `validate_drain` so the operator is told before a round trip.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_DRAIN_DAYS,
  canActOnDrain,
  describeDrainError,
  formatDrainRemaining,
  parseDrainEntry,
  parseFleetDrain,
  resolveDeviceDrain,
  resolveDrainTarget,
  toLocalInputValue,
  validateDrainForm,
  type FleetDrainRead,
} from "./fleetDrain";

const DEVICE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const NOW = Date.parse("2026-09-01T12:00:00Z");

/** One entry exactly as coord's `DrainEntry` serialises it. */
function wireEntry(overrides: Record<string, unknown> = {}) {
  return {
    until: "2026-09-01T18:00:00Z",
    reason: "rebuilding the runner",
    drained_by: "jspinak@gmail.com",
    drained_at: "2026-09-01T11:00:00Z",
    ...overrides,
  };
}

function okRead(): FleetDrainRead {
  const parsed = parseFleetDrain({ drained: { [DEVICE]: wireEntry() } });
  return parsed;
}

describe("parseDrainEntry", () => {
  it("reads coord's four fields", () => {
    expect(parseDrainEntry(wireEntry())).toEqual({
      until: "2026-09-01T18:00:00Z",
      reason: "rebuilding the runner",
      drainedBy: "jspinak@gmail.com",
      drainedAt: "2026-09-01T11:00:00Z",
    });
  });

  it("keeps coord's [redacted] actor as a VALUE, not an absence", () => {
    // "someone drained this and you are not being told who" is a different
    // fact from "nobody is recorded", and coord ships the placeholder for
    // exactly that reason.
    const entry = parseDrainEntry(wireEntry({ drained_by: "[redacted]" }));
    expect(entry?.drainedBy).toBe("[redacted]");
  });

  it("rejects an entry with no usable `until`", () => {
    // A drain whose end cannot be read is not something to render as a drain.
    expect(parseDrainEntry(wireEntry({ until: undefined }))).toBeNull();
    expect(parseDrainEntry(wireEntry({ until: "" }))).toBeNull();
    expect(parseDrainEntry(wireEntry({ until: "whenever" }))).toBeNull();
    expect(parseDrainEntry(wireEntry({ until: 1234 }))).toBeNull();
  });

  it("tolerates a missing reason/actor rather than inventing one", () => {
    const entry = parseDrainEntry({ until: "2026-09-01T18:00:00Z" });
    expect(entry).toEqual({
      until: "2026-09-01T18:00:00Z",
      reason: null,
      drainedBy: null,
      drainedAt: null,
    });
  });
});

describe("parseFleetDrain — the shapes it accepts", () => {
  it("reads the wrapped map", () => {
    const read = parseFleetDrain({ drained: { [DEVICE]: wireEntry() } });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") return;
    expect(read.entries.get(DEVICE)?.reason).toBe("rebuilding the runner");
  });

  it("reads a list of entries that name their own device", () => {
    const read = parseFleetDrain({
      drained: [{ device_id: DEVICE, ...wireEntry() }],
    });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") return;
    expect(read.entries.has(DEVICE)).toBe(true);
  });

  it("reads the bare device-keyed map the column itself stores", () => {
    const read = parseFleetDrain({ [DEVICE]: wireEntry() });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") return;
    expect(read.entries.has(DEVICE)).toBe(true);
  });

  it("reads an EMPTY container as a measured 'none drained'", () => {
    // The one case where empty really is empty: coord answered.
    const read = parseFleetDrain({ drained: {} });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") return;
    expect(read.entries.size).toBe(0);
    expect(read.unreadableDevices.size).toBe(0);
  });

  it("matches a device id case-insensitively", () => {
    const read = parseFleetDrain({ drained: { [DEVICE.toUpperCase()]: wireEntry() } });
    expect(
      resolveDeviceDrain(read, DEVICE, NOW).state
    ).toBe("drained");
  });
});

describe("parseFleetDrain — nothing unreadable becomes 'none drained'", () => {
  const unknownCases: Array<[string, unknown]> = [
    ["a null body", null],
    ["an undefined body", undefined],
    ["a number", 7],
    ["an unrecognised envelope", { status: "fine", machines: 3 }],
    ["an explicit state: unknown", { state: "unknown", reason: "pool timeout" }],
    ["coord's bare Unknown variant", "Unknown"],
    ["a serde-tagged Unknown", { Unknown: null }],
    ["known: false", { known: false, drained: { [DEVICE]: wireEntry() } }],
    ["readable: false", { readable: false }],
    ["unknown: true", { unknown: true }],
    ["an error field", { error: "pg pool acquire failed" }],
    ["a null container", { drained: null }],
    ["a container that is a scalar", { drained: 3 }],
    ["an empty object with no container key", {}],
  ];

  for (const [label, payload] of unknownCases) {
    it(`renders UNKNOWN for ${label}`, () => {
      const read = parseFleetDrain(payload);
      expect(read.state).toBe("unknown");
      if (read.state !== "unknown") return;
      expect(read.reason.length).toBeGreaterThan(0);
    });
  }

  it("lets an explicit unknown WIN over a map served beside it", () => {
    // `DrainSet::Unknown` means "I could not determine the drained set". A
    // stale or partial map riding along must not be read off.
    const read = parseFleetDrain({
      state: "unknown",
      reason: "PG pool acquire failed",
      drained: { [DEVICE]: wireEntry() },
    });
    expect(read.state).toBe("unknown");
    if (read.state !== "unknown") return;
    expect(read.reason).toContain("PG pool acquire failed");
  });

  it("marks ONE unparseable entry's device unknown and keeps the rest", () => {
    const read = parseFleetDrain({
      drained: { [DEVICE]: wireEntry(), [OTHER]: { until: "not a time" } },
    });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") return;
    expect(read.entries.has(DEVICE)).toBe(true);
    expect(read.unreadableDevices.has(OTHER)).toBe(true);
    expect(resolveDeviceDrain(read, OTHER, NOW).state).toBe("unknown");
    expect(resolveDeviceDrain(read, DEVICE, NOW).state).toBe("drained");
  });
});

describe("resolveDeviceDrain", () => {
  it("reports an active drain with its provenance", () => {
    const state = resolveDeviceDrain(okRead(), DEVICE, NOW);
    expect(state.state).toBe("drained");
    if (state.state !== "drained") return;
    expect(state.entry.drainedBy).toBe("jspinak@gmail.com");
    expect(state.entry.reason).toBe("rebuilding the runner");
    expect(state.entry.until).toBe("2026-09-01T18:00:00Z");
  });

  it("reports a device the read does not name as not drained", () => {
    expect(resolveDeviceDrain(okRead(), OTHER, NOW).state).toBe("not_drained");
  });

  it("distinguishes an EXPIRED drain from an undrain", () => {
    // Coord has no sweeper; a lapsed entry simply stops matching on its next
    // read. Folding that into `not_drained` would let "it expired" be misread
    // as "my undrain worked".
    const later = Date.parse("2026-09-02T00:00:00Z");
    const state = resolveDeviceDrain(okRead(), DEVICE, later);
    expect(state.state).toBe("expired");
  });

  it("is UNKNOWN while the read is still in flight", () => {
    expect(resolveDeviceDrain({ state: "loading" }, DEVICE, NOW).state).toBe(
      "unknown"
    );
  });

  it("carries the read's own reason through to the row", () => {
    const state = resolveDeviceDrain(
      { state: "unknown", reason: "coord answered 404" },
      DEVICE,
      NOW
    );
    expect(state.state).toBe("unknown");
    if (state.state !== "unknown") return;
    expect(state.reason).toContain("404");
  });

  it("short-circuits on a missing device id, before consulting the read", () => {
    // Same rule `resolveCiCapacity` applies: with no id there is nothing to
    // look up, so reporting the read's health would be a non-sequitur.
    const state = resolveDeviceDrain(okRead(), undefined, NOW);
    expect(state.state).toBe("unknown");
    if (state.state !== "unknown") return;
    expect(state.reason).toContain("no coord device id");
  });
});

describe("resolveDrainTarget — the keying, which is the phase's real work", () => {
  it("identifies the coord device and carries coord's OWN hostname", () => {
    const target = resolveDrainTarget({
      matched: true,
      device_id: DEVICE,
      hostname: "gh-runner-spaceship-wsl",
    });
    expect(target).toEqual({
      state: "identified",
      deviceId: DEVICE,
      coordHostname: "gh-runner-spaceship-wsl",
    });
  });

  it("keeps a device with no coord hostname drainable, with a null label", () => {
    const target = resolveDrainTarget({ matched: true, device_id: DEVICE });
    expect(target.state).toBe("identified");
    if (target.state !== "identified") return;
    expect(target.coordHostname).toBeNull();
  });

  it("gives a row coord names no device for NO drainable identity", () => {
    const target = resolveDrainTarget({ matched: false });
    expect(target.state).toBe("no_device");
    if (target.state !== "no_device") return;
    expect(target.reason).toContain("no device row for this host");
  });

  it("gives a list built without the coord read no drainable identity either", () => {
    const target = resolveDrainTarget(undefined);
    expect(target.state).toBe("no_device");
    if (target.state !== "no_device") return;
    expect(target.reason).toContain("without coord's device read");
  });

  it("refuses a matched device that carries no id", () => {
    const target = resolveDrainTarget({ matched: true, device_id: "  " });
    expect(target.state).toBe("no_device");
  });
});

describe("canActOnDrain", () => {
  const identified = resolveDrainTarget({ matched: true, device_id: DEVICE });
  const noDevice = resolveDrainTarget({ matched: false });

  it("permits acting only on an identified target with a READ state", () => {
    expect(
      canActOnDrain(identified, resolveDeviceDrain(okRead(), DEVICE, NOW))
    ).toBe(true);
    expect(canActOnDrain(identified, { state: "not_drained" })).toBe(true);
  });

  it("never permits acting on an unnamed target — the silent-inertness guard", () => {
    expect(canActOnDrain(noDevice, { state: "not_drained" })).toBe(false);
  });

  it("never permits acting on an UNKNOWN state", () => {
    expect(
      canActOnDrain(identified, { state: "unknown", reason: "read failed" })
    ).toBe(false);
  });
});

describe("validateDrainForm — the expiry is mandatory, and bounded", () => {
  const inAnHour = toLocalInputValue(NOW + 3_600_000);

  it("accepts a near-future deadline with a reason", () => {
    const check = validateDrainForm(inAnHour, "rebuild", NOW);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(Date.parse(check.untilIso)).toBeGreaterThan(NOW);
  });

  it("refuses a blank reason", () => {
    expect(validateDrainForm(inAnHour, "   ", NOW)).toMatchObject({
      ok: false,
    });
  });

  it("refuses an EMPTY expiry and says there is no 'no expiry' option", () => {
    const check = validateDrainForm("", "rebuild", NOW);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toContain("no deadline");
  });

  it("refuses a past deadline", () => {
    const check = validateDrainForm(
      toLocalInputValue(NOW - 60_000),
      "rebuild",
      NOW
    );
    expect(check.ok).toBe(false);
  });

  it(`refuses a deadline beyond ${MAX_DRAIN_DAYS} days, as coord does`, () => {
    const check = validateDrainForm(
      toLocalInputValue(NOW + (MAX_DRAIN_DAYS + 1) * 86_400_000),
      "rebuild",
      NOW
    );
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toContain(String(MAX_DRAIN_DAYS));
  });

  it("refuses an unreadable expiry", () => {
    expect(validateDrainForm("tomorrow-ish", "rebuild", NOW).ok).toBe(false);
  });
});

describe("formatDrainRemaining", () => {
  it("renders a FUTURE deadline as a remaining duration", () => {
    // `relativeTime` renders every future stamp as "just now"; "Drained until
    // just now" is the opposite of what a six-hour deadline means.
    expect(formatDrainRemaining("2026-09-01T18:00:00Z", NOW)).toBe("in 6h");
  });

  it("renders a lapsed deadline as elapsed", () => {
    expect(formatDrainRemaining("2026-09-01T11:30:00Z", NOW)).toBe("30m ago");
  });

  it("renders days for a long drain", () => {
    expect(formatDrainRemaining("2026-09-04T13:00:00Z", NOW)).toBe("in 3d 1h");
  });

  it("says so rather than guessing when the stamp will not parse", () => {
    expect(formatDrainRemaining("whenever", NOW)).toBe("an unknown time");
  });
});

describe("describeDrainError", () => {
  it("names coord's typed refusal rather than a bare status", () => {
    const line = describeDrainError(
      403,
      JSON.stringify({
        detail: {
          error: "device_not_in_tenant",
          detail: "this device is not bound to your tenant",
        },
      })
    );
    expect(line).toContain("403");
    expect(line).toContain("device_not_in_tenant");
    expect(line).toContain("not bound to your tenant");
  });

  it("falls back to the raw body when it is not JSON", () => {
    expect(describeDrainError(502, "bad gateway")).toBe("HTTP 502 — bad gateway");
  });

  it("falls back to the bare status on an empty body", () => {
    expect(describeDrainError(500, "")).toBe("HTTP 500");
  });
});

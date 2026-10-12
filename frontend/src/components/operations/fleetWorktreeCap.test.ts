/**
 * Unit tests for the per-device worktree-cap READING rules.
 *
 * Amendment A3 / Phase 4 of plan
 * `2026-09-18-coord-allocation-budgets-ignore-the-machine-they-gate`. Every
 * rule that decides what a body MEANS lives in `./fleetWorktreeCap.ts`, so it
 * can be pinned here without a DOM or a network — which is the point: the
 * failure this feature must not have is an unreadable cap rendering as an
 * absent one, and that is a pure-function property.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_WORKTREE_CAP,
  normalizeDeviceId,
  parseFleetWorktreeCap,
  parseWorktreeCapEntry,
  parseWorktreeCapInput,
  resolveDeviceWorktreeCap,
  validateWorktreeCap,
  type FleetWorktreeCapRead,
} from "./fleetWorktreeCap";

const DEV = "EB2155ED-4152-4B8E-9A3A-000000000001";
const dev = DEV.toLowerCase();

function row(overrides: Record<string, unknown> = {}) {
  return {
    device_id: DEV,
    max_worktrees: 40,
    reason: "holding this box down while the sweep runs",
    set_by: "op@example.com",
    set_at: "2026-09-30T12:00:00Z",
    ...overrides,
  };
}

describe("parseFleetWorktreeCap", () => {
  it("reads a known body into entries keyed by normalized device id", () => {
    const read = parseFleetWorktreeCap({
      state: "known",
      count: 1,
      overrides: [row()],
      detail: null,
    });
    expect(read.state).toBe("known");
    if (read.state !== "known") throw new Error("unreachable");
    // The key is LOWERCASED: coord emits canonical UUIDs but this console's
    // ids come from several joins, and a case mismatch would render a capped
    // machine as uncapped — a false negative on the one surface whose job is
    // to say what the cap is.
    expect([...read.entries.keys()]).toEqual([dev]);
    expect(read.entries.get(dev)?.maxWorktrees).toBe(40);
    expect(read.entries.get(dev)?.setBy).toBe("op@example.com");
    expect(read.unreadableDevices.size).toBe(0);
  });

  it("reads an EMPTY known body as known-and-empty, never as unknown", () => {
    // The distinction the whole module exists for, from the safe side: coord
    // DID answer, and the answer is that nothing is capped.
    const read = parseFleetWorktreeCap({
      state: "known",
      count: 0,
      overrides: [],
      detail: null,
    });
    expect(read.state).toBe("known");
    if (read.state !== "known") throw new Error("unreachable");
    expect(read.entries.size).toBe(0);
  });

  it("reads an unknown body as unknown and carries coord's own detail", () => {
    const read = parseFleetWorktreeCap({
      state: "unknown",
      overrides: null,
      count: null,
      detail:
        "coord could not read coord.fleet_runtime_policy.max_worktrees_by_device",
    });
    expect(read.state).toBe("unknown");
    if (read.state !== "unknown") throw new Error("unreachable");
    expect(read.reason).toContain("max_worktrees_by_device");
  });

  it("treats a `known` body with no overrides array as UNKNOWN, not empty", () => {
    // Coord's contract says `overrides` is null only in the unknown state, so
    // this body is self-contradictory. The one thing it cannot safely be read
    // as is the empty list it superficially resembles.
    const read = parseFleetWorktreeCap({ state: "known", count: 0 });
    expect(read.state).toBe("unknown");
  });

  it("treats a body it does not recognise as UNKNOWN", () => {
    for (const payload of [null, 7, "known", [], { state: "weird" }, {}]) {
      expect(parseFleetWorktreeCap(payload).state).toBe("unknown");
    }
  });

  it("puts an unparseable row in unreadableDevices, NOT in the uncapped set", () => {
    const read = parseFleetWorktreeCap({
      state: "known",
      overrides: [row({ max_worktrees: "forty" }), row({ device_id: "dev-2" })],
    });
    if (read.state !== "known") throw new Error("unreachable");
    // The first row names a device whose cap cannot be read — that device is
    // UNKNOWN, not uncapped. The second is a well-formed row under a different
    // id and survives.
    expect(read.unreadableDevices.has(dev)).toBe(true);
    expect(read.entries.has(dev)).toBe(false);
    expect(read.entries.get("dev-2")?.maxWorktrees).toBe(40);
  });

  it("degrades the WHOLE read when `count` disagrees with the list served", () => {
    // A TRUNCATED list is the one silent-empty route neither `unreadableDevices`
    // nor the unattributable-row arm can cover: a dropped device is simply
    // absent, and absence resolves `derived`, so the page would state "no
    // operator cap" for a machine coord says is capped.
    const read = parseFleetWorktreeCap({
      state: "known",
      count: 3,
      overrides: [row()],
    });
    expect(read.state).toBe("unknown");
    if (read.state !== "unknown") throw new Error("unreachable");
    expect(read.reason).toContain("reported 3");
    expect(read.reason).toContain("served 1");
  });

  it("does not degrade when `count` agrees, or is absent or unusable", () => {
    // The guard must not fire on the ordinary case, nor turn a coord that omits
    // `count` (or serves a non-number) into a permanent UNKNOWN — that would be
    // a self-inflicted outage on a field this console does not depend on.
    for (const extra of [{ count: 1 }, {}, { count: null }, { count: "1" }]) {
      const read = parseFleetWorktreeCap({
        state: "known",
        overrides: [row()],
        ...extra,
      });
      expect(read.state).toBe("known");
    }
  });

  it("degrades the WHOLE read when a row cannot be attributed to a device", () => {
    // The one silent-empty route `unreadableDevices` cannot cover: that set is
    // keyed by the device id, and here the device id is the missing part.
    // Skipping the row would leave the read `known`, every device would
    // resolve `derived`, and the page would state "no operator cap" while
    // coord's own answer contained one. Any device could be the one it belongs
    // to, so all of them are UNKNOWN.
    for (const bad of [{ max_worktrees: 4 }, { device_id: "  " }, null, 7]) {
      const read = parseFleetWorktreeCap({
        state: "known",
        overrides: [bad, row()],
      });
      expect(read.state).toBe("unknown");
      if (read.state !== "unknown") throw new Error("unreachable");
      expect(read.reason).toContain("could not attribute");
    }
  });

  it("still reports a well-formed device as capped when every row is attributable", () => {
    // The other side of the rule above: degrading is for an UNATTRIBUTABLE
    // row, not for one whose cap merely failed to parse — that one is handled
    // per-device by `unreadableDevices`, and must not take the whole read down
    // with it.
    const read = parseFleetWorktreeCap({
      state: "known",
      overrides: [row({ device_id: "dev-2", max_worktrees: "x" }), row()],
    });
    expect(read.state).toBe("known");
    if (read.state !== "known") throw new Error("unreachable");
    expect(read.entries.get(dev)?.maxWorktrees).toBe(40);
    expect(read.unreadableDevices.has("dev-2")).toBe(true);
  });
});

describe("parseWorktreeCapEntry", () => {
  it("refuses a value below the floor rather than rounding it up", () => {
    // Justified from THIS side, not by a claim about what coord did: a value
    // below the floor means this build and coord disagree about the contract,
    // and UNKNOWN is the honest reading of a disagreement. Silently reading 0
    // as "capped at 0" would render a machine as deliberately refusing
    // everything.
    for (const n of [0, -1, MIN_WORKTREE_CAP - 1]) {
      expect(parseWorktreeCapEntry(row({ max_worktrees: n }))).toBeNull();
    }
    expect(parseWorktreeCapEntry(row({ max_worktrees: 1.5 }))).toBeNull();
    expect(parseWorktreeCapEntry(row({ max_worktrees: "4" }))).toBeNull();
  });

  it("parses the floor itself — the refusal is `< 1`, not `<= 1`", () => {
    // The other side of the boundary above, and the reason it is pinned: every
    // accepting case in this file uses 4 or 40, so turning that comparison into
    // `<=` would render a device legitimately capped at 1 as UNKNOWN — a read
    // failure reported for a machine whose cap coord served perfectly well.
    const e = parseWorktreeCapEntry(row({ max_worktrees: MIN_WORKTREE_CAP }));
    expect(e?.maxWorktrees).toBe(MIN_WORKTREE_CAP);
    expect(MIN_WORKTREE_CAP).toBe(1);
  });

  it("is lenient about provenance and says so on the wire", () => {
    const e = parseWorktreeCapEntry({ device_id: DEV, max_worktrees: 4 });
    expect(e?.maxWorktrees).toBe(4);
    // A missing reason costs context, not the cap. But it must not render as
    // an empty string a reader would mistake for "no reason was needed".
    expect(e?.reason).toBe("(no reason recorded)");
    expect(e?.setBy).toBe("(unrecorded)");
    expect(e?.setAt).toBe("");
  });
});

describe("parseFleetWorktreeCap — the two accepted containers", () => {
  const row = (id: string, n: number) => ({
    device_id: id,
    max_worktrees: n,
    reason: "r",
    set_by: "op@example.com",
    set_at: "2026-09-30T12:00:00Z",
  });

  it("reads a device-keyed MAP, folding the key in as the device id", () => {
    // The list is the declared contract; the map is tolerated because it is the
    // shape coord STORES, and the cost of guessing wrong is total — a container
    // mismatch leaves every device UNKNOWN *and*, because the control only acts
    // on a known read, disables both write levers. Untested, this tolerance
    // could have been deleted with the suite still green.
    const read = parseFleetWorktreeCap({
      state: "known",
      overrides: { [DEV]: { n: 4, max_worktrees: 4, reason: "r", set_by: "o" } },
    });
    expect(read.state).toBe("known");
    if (read.state !== "known") throw new Error("unreachable");
    expect(read.entries.get(dev)?.maxWorktrees).toBe(4);
    expect(read.unreadableDevices.size).toBe(0);
  });

  it("lets the map KEY win over a blank device_id inside the value", () => {
    // In a map the key IS the identity. Spreading it first let a `null` or `""`
    // in the value override it, which then failed attribution and degraded the
    // WHOLE read to UNKNOWN even though the key was perfectly good.
    const read = parseFleetWorktreeCap({
      state: "known",
      overrides: { [DEV]: { device_id: "", max_worktrees: 7, reason: "r" } },
    });
    expect(read.state).toBe("known");
    if (read.state !== "known") throw new Error("unreachable");
    expect(read.entries.get(dev)?.maxWorktrees).toBe(7);
  });

  it("reads an EMPTY map as a successful 'nothing capped', not UNKNOWN", () => {
    // The one non-UNKNOWN absence on this surface, and it must hold for both
    // containers or the ordinary uncapped fleet reports as unreadable.
    for (const overrides of [{}, []]) {
      const read = parseFleetWorktreeCap({ state: "known", overrides });
      expect(read.state).toBe("known");
      if (read.state !== "known") throw new Error("unreachable");
      expect(read.entries.size).toBe(0);
      expect(resolveDeviceWorktreeCap(read, DEV).state).toBe("derived");
    }
  });

  it("still refuses a container that is neither", () => {
    for (const overrides of ["nope", 4, true]) {
      expect(parseFleetWorktreeCap({ state: "known", overrides }).state).toBe(
        "unknown"
      );
    }
  });

  it("degrades a DUPLICATED device to unknown rather than last-write-wins", () => {
    // Two rows for one device is a contract violation, and picking by list order
    // would choose a cap silently — and differently from any other reader of the
    // same body. Which one is in force is exactly what cannot be determined.
    // `count` is omitted here on purpose: the count guard runs BEFORE the loop
    // and compares against the pre-dedup row count, so a body with a duplicate
    // and a distinct-device `count` degrades on the count instead, and this
    // branch would never execute.
    const read = parseFleetWorktreeCap({
      state: "known",
      overrides: [row(DEV, 4), row(DEV, 40)],
    });
    expect(read.state).toBe("known");
    if (read.state !== "known") throw new Error("unreachable");
    // Not 4, not 40 — and no stale entry left behind.
    expect(read.entries.has(dev)).toBe(false);
    expect(read.unreadableDevices.has(dev)).toBe(true);
    expect(resolveDeviceWorktreeCap(read, DEV).state).toBe("unknown");
  });

  it("keeps a duplicate unknown even when the FIRST row was unparseable", () => {
    // The order the two sub-cases arrive in must not matter, and a later good
    // row must not rescue a device whose cap is already in dispute.
    const read = parseFleetWorktreeCap({
      state: "known",
      overrides: [row(DEV, 0), row(DEV, 4), row(DEV, 9)],
    });
    if (read.state !== "known") throw new Error("unreachable");
    expect(read.entries.has(dev)).toBe(false);
    expect(read.unreadableDevices.has(dev)).toBe(true);
  });

  it("leaves OTHER devices readable when one is duplicated", () => {
    const other = "eb2155ed-4152-4b8e-9a3a-000000000002";
    const read = parseFleetWorktreeCap({
      state: "known",
      overrides: [row(DEV, 4), row(DEV, 40), row(other, 12)],
    });
    if (read.state !== "known") throw new Error("unreachable");
    // Each device's cap is an independent fact; one disputed row must not cost
    // the others theirs.
    expect(read.entries.get(other)?.maxWorktrees).toBe(12);
    expect(read.unreadableDevices.has(dev)).toBe(true);
  });
});

describe("validateWorktreeCap", () => {
  it("accepts any whole number at or above the floor", () => {
    for (const v of ["1", "4", " 40 ", "1000"]) {
      expect(validateWorktreeCap(v)).toBeNull();
    }
  });

  it("refuses zero, and the message says what a zero would DO", () => {
    const msg = validateWorktreeCap("0");
    expect(msg).not.toBeNull();
    // Not merely "must be >= 1": the trap is that a zero locks the operator
    // out of undoing it, and a bound restated as a bound does not say that.
    expect(msg).toContain("set it back");
    expect(msg).toContain("drain");
  });

  it("refuses blanks, non-integers and negatives", () => {
    for (const v of ["", "   ", "abc", "1.5", "-1", "1e3.5", "0x10"]) {
      expect(validateWorktreeCap(v)).not.toBeNull();
    }
  });

  it("accepts the floor itself — the bound is `< 1`, not `<= 1`", () => {
    // Pinned because every other accepting case in this file uses 4 or 40, so
    // an off-by-one here would refuse a legitimate cap of 1 and no test would
    // notice. 1 is a real operator choice: "let this box hold exactly one
    // worktree" is how you wind a machine down without draining it.
    expect(validateWorktreeCap("1")).toBeNull();
    expect(validateWorktreeCap("0")).not.toBeNull();
  });

  it("accepts the forms a number input really emits, rather than calling them fractions", () => {
    // `+5` and `1e3` both come back verbatim from `<input type="number">` and
    // both ARE whole numbers (`1e3` is 1000). Refusing them with "coord stores
    // a count, not a fraction" describes a mistake the operator did not make.
    expect(validateWorktreeCap("1e3")).toBeNull();
    expect(validateWorktreeCap("+5")).toBeNull();
    expect(validateWorktreeCap("1E3")).toBeNull();
  });

  it("returns the NUMBER each accepted spelling denotes", () => {
    // The headline of the parse: one pass, and the value it yields is what the
    // caller both SENDS and REPORTS. Asserted on `parseWorktreeCapInput`
    // directly, because `validateWorktreeCap` discards `n` — so a regression
    // that normalised `1e3` to 1 would be invisible through the verdict alone.
    const n = (raw: string) => {
      const p = parseWorktreeCapInput(raw);
      if (!p.ok) throw new Error(`expected ${raw} to parse: ${p.message}`);
      return p.n;
    };
    expect(n("1")).toBe(1);
    expect(n(" 40 ")).toBe(40);
    expect(n("+5")).toBe(5);
    expect(n("1e3")).toBe(1000);
    expect(n("1E3")).toBe(1000);
    expect(n("5.0")).toBe(5);
    expect(n("1.5e3")).toBe(1500);
    expect(n(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("calls an OVERFLOWING spelling an arithmetic limit, never a fraction", () => {
    // `Number("1e400")` is `Infinity`, and `Number.isInteger(Infinity)` is
    // false — so without a finite check these fell to "coord stores a count,
    // not a fraction", which is the one message this module forbids: `1e400`
    // is a whole-number spelling. It also made the arithmetic-limit message
    // unreachable for everything from about `1e309` up, i.e. for exactly the
    // inputs that most need it.
    for (const v of ["1e400", "-1e400", "1e309", "-1e309"]) {
      const msg = validateWorktreeCap(v);
      expect(msg, v).not.toBeNull();
      expect(msg, v).not.toContain("fraction");
      expect(msg, v).toContain("not a ceiling on the cap");
    }
  });

  it("says a too-large number is an ARITHMETIC limit, not a policy ceiling", () => {
    // There is deliberately no upper bound on the cap (disk is carried by
    // coord's disk gate), so a bare "too large" invites an operator to believe
    // in a ceiling this feature does not have.
    const msg = validateWorktreeCap("99999999999999999999");
    expect(msg).not.toBeNull();
    expect(msg).toContain("not a ceiling on the cap");
    expect(msg).toContain("no upper bound");
  });

  it("tells a negative it is under the floor, not that it is not a number", () => {
    // `-5` IS a whole number, so "enter a whole number" is a correct
    // description of a mistake the operator did not make — and an operator
    // reading one looks for a different mistake than the one they made. What
    // is wrong with `-5` is what is wrong with `0`: it is under the floor.
    for (const v of ["-1", "-5", " -40 "]) {
      const msg = validateWorktreeCap(v);
      expect(msg).not.toBeNull();
      expect(msg).toContain("set it back");
      expect(msg).toContain("drain");
      expect(msg).not.toContain("whole number");
    }
    // And the message quotes what was typed, so it reads as a statement about
    // this value rather than a generic one about zero.
    expect(validateWorktreeCap("-5")).toContain("A cap of -5");
  });
});

describe("resolveDeviceWorktreeCap", () => {
  const known: FleetWorktreeCapRead = parseFleetWorktreeCap({
    state: "known",
    overrides: [row()],
  });

  it("returns the entry for a capped device", () => {
    const s = resolveDeviceWorktreeCap(known, DEV);
    expect(s.state).toBe("capped");
    if (s.state !== "capped") throw new Error("unreachable");
    expect(s.entry.maxWorktrees).toBe(40);
  });

  it("returns `derived` only when the read SUCCEEDED and the device is absent", () => {
    expect(resolveDeviceWorktreeCap(known, "other-device").state).toBe(
      "derived"
    );
  });

  it("never returns `derived` for loading, unknown, or a missing device id", () => {
    // The three UNKNOWNs, each with its own remediation. None of them may
    // render as "no cap is set"
    // [policy: unknown-must-not-render-as-a-default].
    expect(resolveDeviceWorktreeCap({ state: "loading" }, DEV).state).toBe(
      "unknown"
    );
    expect(
      resolveDeviceWorktreeCap({ state: "unknown", reason: "coord down" }, DEV)
        .state
    ).toBe("unknown");
    expect(resolveDeviceWorktreeCap(known, undefined).state).toBe("unknown");
    expect(resolveDeviceWorktreeCap(known, "").state).toBe("unknown");
  });

  it("returns unknown for a device coord named but this build could not read", () => {
    const read = parseFleetWorktreeCap({
      state: "known",
      overrides: [row({ max_worktrees: null })],
    });
    const s = resolveDeviceWorktreeCap(read, DEV);
    expect(s.state).toBe("unknown");
    if (s.state !== "unknown") throw new Error("unreachable");
    expect(s.reason).toContain("could not read the entry");
  });

  it("matches a device id whatever its case or surrounding space", () => {
    expect(
      resolveDeviceWorktreeCap(known, `  ${dev.toUpperCase()} `).state
    ).toBe("capped");
    expect(normalizeDeviceId(`  ${DEV} `)).toBe(dev);
  });
});

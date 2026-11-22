/**
 * `parseFleetCapacity` — coord's capacity read, parsed without ever turning an
 * UNKNOWN (or a field coord did not send) into a number (plan
 * `2026-11-05-one-free-resource-model-places-sessions-builds-and-ci`
 * Phase 11).
 */

import { describe, expect, it } from "vitest";
import {
  formatGib,
  parityTally,
  parseCapacityModelView,
  parseFleetCapacity,
  parseKnownNumber,
} from "./fleetCapacity";
import { capacityBody, capacityDevice } from "./fleetCapacity.fixture";

describe("parseKnownNumber", () => {
  it("keeps a known value and an unknown reason", () => {
    expect(parseKnownNumber({ state: "known", value: 2.5 }, "x")).toEqual({
      state: "known",
      value: 2.5,
    });
    expect(
      parseKnownNumber({ state: "unknown", reason: "no sample" }, "x")
    ).toEqual({ state: "unknown", reason: "no sample" });
  });

  it("reads a missing or malformed field as UNKNOWN naming the field, never 0", () => {
    for (const raw of [undefined, null, 0, { state: "known" }, { value: 3 }]) {
      expect(parseKnownNumber(raw, "free CPU")).toEqual({
        state: "unknown",
        reason: "coord sent no readable free CPU",
      });
    }
  });
});

describe("parseFleetCapacity", () => {
  it("parses a device's free capacity, binding, slots and cost bases", () => {
    const read = parseFleetCapacity(capacityBody([capacityDevice()]));
    expect(read.state).toBe("known");
    if (read.state !== "known") return;
    expect(read.modelVersion).toBe(3);
    expect(read.planAgeSecs).toBe(120);
    const d = read.devices[0];
    expect(d.label).toBe("nilan");
    expect(d.freeCpuCores).toEqual({ state: "known", value: 6.5 });
    expect(d.sessionBinding).toBe("cpu");
    expect(d.classes.S.slots).toEqual({ state: "known", value: 3 });
    expect(d.classes.S.memBasis).toBe("device_p90");
    expect(d.classes.C1.cpuBasis).toBe("seed");
    expect(d.parity).toHaveLength(3);
  });

  it("keeps a device's UNKNOWN slot counts and their reasons", () => {
    const read = parseFleetCapacity(
      capacityBody([
        capacityDevice({
          free_mem_bytes: { state: "unknown", reason: "no runner sample" },
          slots: Object.fromEntries(
            ["S", "C3", "C1", "C2", "B"].map((c) => [
              c,
              { state: "unknown", reason: "no runner sample" },
            ])
          ),
          unknown_reason: ["no runner sample"],
        }),
      ])
    );
    if (read.state !== "known") throw new Error(read.state);
    const d = read.devices[0];
    expect(d.freeMemBytes.state).toBe("unknown");
    expect(d.classes.S.slots).toEqual({
      state: "unknown",
      reason: "no runner sample",
    });
    expect(d.unknownReasons).toEqual(["no runner sample"]);
  });

  it("reports coord's no_plan_yet as its own state, not an empty fleet", () => {
    const read = parseFleetCapacity({
      state: "no_plan_yet",
      note: "the 300 s worker writes one per tick",
      devices: null,
    });
    expect(read).toEqual({
      state: "no_plan_yet",
      note: "the 300 s worker writes one per tick",
    });
  });

  it("reads a body with no device list as unreadable, never as zero machines", () => {
    expect(parseFleetCapacity({}).state).toBe("unreadable");
    expect(parseFleetCapacity(null).state).toBe("unreadable");
    expect(parseFleetCapacity({ state: "known" }).state).toBe("unreadable");
  });

  it("names a parity answer it cannot read as unreadable", () => {
    const read = parseFleetCapacity(
      capacityBody([capacityDevice({ parity: [{ row: 4, decider: "x" }] })])
    );
    if (read.state !== "known") throw new Error(read.state);
    expect(read.devices[0].parity).toEqual([
      {
        row: 4,
        decider: "x",
        state: "unreadable",
        text: "coord sent no readable answer",
      },
    ]);
  });
});

describe("formatting", () => {
  it("keeps the sign of free memory below the floor", () => {
    expect(formatGib(-2 * 1024 ** 3)).toBe("-2.0 GiB");
  });

  it("tallies parity rows by state", () => {
    expect(
      parityTally([
        { row: 1, decider: "a", state: "known", text: "" },
        { row: 2, decider: "b", state: "known", text: "" },
        { row: 3, decider: "c", state: "runner_local", text: "" },
      ])
    ).toEqual({ known: 2, runner_local: 1 });
  });
});

describe("parseCapacityModelView", () => {
  it("reads a well-formed dial", () => {
    const view = parseCapacityModelView({
      dial: {
        mode: "off",
        mode_source: "stored",
        off_consumers: [],
        ignored_off_consumers: [],
        permitted_consumers: [],
        consumers: ["merge_train"],
      },
      unknown_reason: null,
      can_edit: true,
    });
    expect(view.dial?.mode).toBe("off");
    expect(view.can_edit).toBe(true);
  });

  it("reads an unreadable body as an UNKNOWN dial with no editor, never enforce", () => {
    for (const body of [
      {},
      null,
      { dial: { mode: "enforce" }, can_edit: true },
    ]) {
      const view = parseCapacityModelView(body);
      expect(view.dial).toBeNull();
      expect(view.unknown_reason).toBeTruthy();
      expect(view.can_edit).toBe(false);
    }
  });

  it("keeps the backend's own reason for an UNKNOWN dial", () => {
    expect(
      parseCapacityModelView({
        dial: null,
        unknown_reason: "columns not projected",
        can_edit: true,
      })
    ).toEqual({
      dial: null,
      unknown_reason: "columns not projected",
      can_edit: true,
    });
  });
});

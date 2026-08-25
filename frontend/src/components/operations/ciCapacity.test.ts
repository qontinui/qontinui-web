import { describe, expect, it } from "vitest";
import {
  indexMachinesByCoordDevice,
  resolveCiCapacity,
  type DevenvMachinesRead,
} from "./ciCapacity";
import type { Machine } from "@/services/devenv-api";

/**
 * The soft-pointer join behind CI capacity on the Dev Ops page (plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 2).
 *
 * Every assertion here is about the same property: the four ways this join can
 * fail are four DIFFERENT facts, and none of them may collapse into "no
 * machine is linked". That sentence is a claim about the tenant's records; a
 * failed read, an unlisted device and an ambiguous pointer are not.
 */

function machine(overrides: Partial<Machine> = {}): Machine {
  return {
    id: "m-1",
    name: "workshop",
    hostname: "workshop.local",
    description: null,
    key_prefix: "mk_abc",
    enrolled: true,
    last_seen_at: null,
    revoked: false,
    environment_id: null,
    coord_device_id: "d-1",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

function okRead(machines: Machine[]): DevenvMachinesRead {
  return { state: "ok", byCoordDevice: indexMachinesByCoordDevice(machines) };
}

describe("indexMachinesByCoordDevice", () => {
  it("skips machines with no coord device link rather than bucketing them", () => {
    // A machine with a null pointer belongs to no device — and must not end up
    // under some placeholder key that a lookup could accidentally hit.
    const index = indexMachinesByCoordDevice([
      machine({ id: "m-1", coord_device_id: "d-1" }),
      machine({ id: "m-2", coord_device_id: null }),
      machine({ id: "m-3", coord_device_id: undefined }),
    ]);
    expect([...index.keys()]).toEqual(["d-1"]);
    expect(index.get("d-1")).toHaveLength(1);
  });

  it("keeps every machine that names one device, rather than the first", () => {
    // The pointer is a nullable column two writers populate, not a unique
    // constraint. Collapsing a duplicate here would hide the ambiguity from
    // the one person who can resolve it.
    const index = indexMachinesByCoordDevice([
      machine({ id: "m-1", name: "left", coord_device_id: "d-1" }),
      machine({ id: "m-2", name: "right", coord_device_id: "d-1" }),
    ]);
    expect(index.get("d-1")?.map((m) => m.id)).toEqual(["m-1", "m-2"]);
  });
});

describe("resolveCiCapacity", () => {
  it("links a device that exactly one machine record names", () => {
    const linked = resolveCiCapacity(okRead([machine()]), "d-1");
    expect(linked.state).toBe("linked");
    expect(linked.state === "linked" && linked.machine.id).toBe("m-1");
  });

  it("keeps 'the read did not answer' apart from 'nothing is linked'", () => {
    // The distinction this whole module exists for. An unanswered read says
    // nothing about the tenant's records (`silent-empty-is-unknown`).
    const loading = resolveCiCapacity({ state: "loading" }, "d-1");
    const failed = resolveCiCapacity(
      { state: "unavailable", reason: "HTTP 502" },
      "d-1"
    );
    const empty = resolveCiCapacity(okRead([]), "d-1");

    expect(loading.state).toBe("unknown");
    expect(failed.state).toBe("unknown");
    expect(failed.state === "unknown" && failed.reason).toContain("502");
    expect(empty.state).toBe("no_machine");
  });

  it("refuses to pick one of two machines naming the same device", () => {
    const ambiguous = resolveCiCapacity(
      okRead([
        machine({ id: "m-1", name: "left" }),
        machine({ id: "m-2", name: "right" }),
      ]),
      "d-1"
    );
    // Not `linked`: offering one would write CI settings for a machine the
    // reader did not choose.
    expect(ambiguous.state).toBe("ambiguous");
    expect(ambiguous.state === "ambiguous" && ambiguous.machines).toHaveLength(
      2
    );
  });

  it("reports a row with no device id as such, whatever the read is doing", () => {
    // Nothing was looked up, so the read's health is not the story and
    // reporting it would be a non-sequitur.
    for (const read of [
      { state: "loading" } as const,
      { state: "unavailable", reason: "HTTP 502" } as const,
      okRead([machine()]),
    ]) {
      expect(resolveCiCapacity(read, undefined).state).toBe("no_device");
    }
  });

  it("does not fall back to a hostname match", () => {
    // The backend already runs an unambiguous-hostname backfill INTO
    // `coord_device_id`. A second, client-side hostname join would have
    // different ambiguity rules and would write CI settings on the strength
    // of it. A machine whose only correspondence is its hostname stays
    // unlinked here.
    const read = okRead([
      machine({ hostname: "msi", coord_device_id: null }),
      machine({ id: "m-2", hostname: "msi", coord_device_id: "d-other" }),
    ]);
    expect(resolveCiCapacity(read, "d-1").state).toBe("no_machine");
  });
});

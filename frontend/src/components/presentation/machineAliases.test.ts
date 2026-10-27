/**
 * Machine aliases (plan `2026-10-23-console-presentation-spaces` D3.3): one
 * stable letter per machine, whichever identifier a panel holds; never one
 * letter for two machines; persisted across a reload WITHOUT storing an
 * identifier. Hostnames here are placeholders.
 */

import { describe, expect, it, vi } from "vitest";
import {
  MACHINE_ALIAS_STORAGE_KEY,
  MachineAliasRegistry,
  UNIDENTIFIED_MACHINE,
  aliasLetters,
  machineIdentityKeys,
} from "./machineAliases";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

const DEVICE_1 = "0b9d6a54-0000-4000-8000-000000000001";
const DEVICE_2 = "0b9d6a54-0000-4000-8000-000000000002";

describe("aliasLetters", () => {
  it("counts A…Z, then AA, AB …", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(aliasLetters)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });
});

describe("MachineAliasRegistry", () => {
  it("gives a machine the same alias every time it is named", () => {
    const r = new MachineAliasRegistry();
    expect(r.aliasFor({ deviceId: DEVICE_1 })).toBe("Machine A");
    expect(r.aliasFor({ deviceId: DEVICE_2 })).toBe("Machine B");
    expect(r.aliasFor({ deviceId: DEVICE_1 })).toBe("Machine A");
  });

  it("links a device id and a hostname, so panels holding either agree", () => {
    const r = new MachineAliasRegistry();
    // The machine list knows both; a UI Bridge panel knows only the host.
    expect(r.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" })).toBe(
      "Machine A"
    );
    expect(r.aliasFor({ hostname: "BUILD-HOST-1" })).toBe("Machine A");
    // …and a spawn row that knows only the device id.
    expect(r.aliasFor({ deviceId: DEVICE_1.toUpperCase() })).toBe("Machine A");
  });

  it("links in either order of discovery", () => {
    const r = new MachineAliasRegistry();
    expect(r.aliasFor({ hostname: "build-host-1" })).toBe("Machine A");
    expect(r.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" })).toBe(
      "Machine A"
    );
    expect(r.aliasFor({ deviceId: DEVICE_1 })).toBe("Machine A");
  });

  it("merges two letters when an identity proves they are one machine (device first, then host)", () => {
    const r = new MachineAliasRegistry();
    // A spawn row knows only the device id; a UI Bridge panel only the host.
    expect(r.aliasFor({ deviceId: DEVICE_1 })).toBe("Machine A");
    expect(r.aliasFor({ hostname: "build-host-1" })).toBe("Machine B");
    // The machine list knows both: one computer, so one letter — the earlier.
    expect(r.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" })).toBe(
      "Machine A"
    );
    expect(r.aliasFor({ hostname: "build-host-1" })).toBe("Machine A");
    expect(r.aliasFor({ deviceId: DEVICE_1 })).toBe("Machine A");
    // The retired letter is never handed to another machine.
    expect(r.aliasFor({ hostname: "laptop-7" })).toBe("Machine C");
    expect(r.mergeCount()).toBe(1);
  });

  it("moves EVERY identifier of the retired letter, not only those of the identity that linked them", () => {
    const r = new MachineAliasRegistry();
    expect(r.aliasFor({ deviceId: DEVICE_1 })).toBe("Machine A");
    // A second coord device on the build host, seen with its host.
    expect(r.aliasFor({ deviceId: DEVICE_2, hostname: "build-host-1" })).toBe(
      "Machine B"
    );
    // DEVICE_1 turns out to run on the build host too: one computer.
    expect(r.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" })).toBe(
      "Machine A"
    );
    // DEVICE_2 was never named in that identity, and still follows the merge.
    expect(r.aliasFor({ deviceId: DEVICE_2 })).toBe("Machine A");
  });

  it("keeps the earlier letter whichever side was seen first", () => {
    const r = new MachineAliasRegistry();
    expect(r.aliasFor({ hostname: "build-host-1" })).toBe("Machine A");
    expect(r.aliasFor({ deviceId: DEVICE_1 })).toBe("Machine B");
    expect(r.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" })).toBe(
      "Machine A"
    );
    expect(r.aliasFor({ deviceId: DEVICE_1 })).toBe("Machine A");
  });

  it("tells its subscribers about a merge, after the render that found it", async () => {
    const r = new MachineAliasRegistry();
    const listener = vi.fn();
    r.subscribe(listener);
    r.aliasFor({ deviceId: DEVICE_1 });
    r.aliasFor({ hostname: "build-host-1" });
    r.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" });
    // Deferred: a merge is found mid-render, and React must not be told then.
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    // Naming known machines again is no merge, and notifies nobody.
    r.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps a merge across a reload", () => {
    const storage = memoryStorage();
    const first = new MachineAliasRegistry({ storage: () => storage });
    first.aliasFor({ deviceId: DEVICE_1 });
    first.aliasFor({ hostname: "build-host-1" });
    first.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" });
    const reloaded = new MachineAliasRegistry({ storage: () => storage });
    expect(reloaded.aliasFor({ hostname: "build-host-1" })).toBe("Machine A");
    expect(reloaded.aliasFor({ hostname: "laptop-7" })).toBe("Machine C");
  });

  it("gives two coord devices on one host that host's letter — a machine is a computer", () => {
    const r = new MachineAliasRegistry();
    expect(r.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" })).toBe(
      "Machine A"
    );
    expect(r.aliasFor({ deviceId: DEVICE_2, hostname: "build-host-1" })).toBe(
      "Machine A"
    );
  });

  it("never lets a shared display name merge two machines", () => {
    const r = new MachineAliasRegistry();
    expect(
      r.aliasFor({
        deviceId: DEVICE_1,
        hostname: "laptop-7",
        displayName: "Workstation",
      })
    ).toBe("Machine A");
    expect(
      r.aliasFor({
        deviceId: DEVICE_2,
        hostname: "laptop-9",
        displayName: "Workstation",
      })
    ).toBe("Machine B");
  });

  it("falls back to the display name only when nothing stronger is known", () => {
    const r = new MachineAliasRegistry();
    expect(machineIdentityKeys({ displayName: "Workstation" })).toEqual([
      "name:workstation",
    ]);
    expect(
      machineIdentityKeys({ hostname: "h", displayName: "Workstation" })
    ).toEqual(["host:h"]);
    expect(r.aliasFor({ displayName: "Workstation" })).toBe("Machine A");
    expect(r.aliasFor({ displayName: " workstation " })).toBe("Machine A");
  });

  it("calls a machine with nothing to key on unidentified, never a letter", () => {
    const r = new MachineAliasRegistry();
    expect(r.aliasFor({})).toBe(UNIDENTIFIED_MACHINE);
    expect(r.aliasFor({ deviceId: " ", hostname: null, displayName: "" })).toBe(
      UNIDENTIFIED_MACHINE
    );
    // …and it consumed no letter.
    expect(r.aliasFor({ hostname: "build-host-1" })).toBe("Machine A");
  });

  it("keeps every letter across a reload, storing no identifier", () => {
    const storage = memoryStorage();
    const first = new MachineAliasRegistry({ storage: () => storage });
    first.aliasFor({ deviceId: DEVICE_1, hostname: "build-host-1" });
    first.aliasFor({ hostname: "build-host-2" });

    const raw = storage.getItem(MACHINE_ALIAS_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("build-host");
    expect(raw).not.toContain(DEVICE_1);

    const reloaded = new MachineAliasRegistry({ storage: () => storage });
    expect(reloaded.aliasFor({ hostname: "build-host-2" })).toBe("Machine B");
    expect(reloaded.aliasFor({ deviceId: DEVICE_1 })).toBe("Machine A");
    expect(reloaded.aliasFor({ hostname: "build-host-3" })).toBe("Machine C");
  });

  it("never re-issues a letter, even when the stored counter is behind", () => {
    const storage = memoryStorage();
    const first = new MachineAliasRegistry({ storage: () => storage });
    first.aliasFor({ hostname: "build-host-1" });
    first.aliasFor({ hostname: "build-host-2" });
    const body = JSON.parse(storage.getItem(MACHINE_ALIAS_STORAGE_KEY) ?? "{}");
    storage.setItem(
      MACHINE_ALIAS_STORAGE_KEY,
      JSON.stringify({ ...body, next: 0 })
    );

    const reloaded = new MachineAliasRegistry({ storage: () => storage });
    expect(reloaded.aliasFor({ hostname: "build-host-3" })).toBe("Machine C");
  });

  it("starts empty from corrupt storage, and works when storage refuses", () => {
    const corrupt = memoryStorage();
    corrupt.setItem(MACHINE_ALIAS_STORAGE_KEY, "{not json");
    expect(
      new MachineAliasRegistry({ storage: () => corrupt }).aliasFor({
        hostname: "h",
      })
    ).toBe("Machine A");

    const refusing: Storage = {
      ...memoryStorage(),
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    const r = new MachineAliasRegistry({ storage: () => refusing });
    expect(r.aliasFor({ hostname: "h1" })).toBe("Machine A");
    expect(r.aliasFor({ hostname: "h2" })).toBe("Machine B");
    expect(r.aliasFor({ hostname: "h1" })).toBe("Machine A");
  });

  it("forgets everything on reset", () => {
    const storage = memoryStorage();
    const r = new MachineAliasRegistry({ storage: () => storage });
    r.aliasFor({ hostname: "h1" });
    r.aliasFor({ hostname: "h2" });
    r.reset();
    expect(storage.getItem(MACHINE_ALIAS_STORAGE_KEY)).toBeNull();
    expect(r.aliasFor({ hostname: "h2" })).toBe("Machine A");
  });
});

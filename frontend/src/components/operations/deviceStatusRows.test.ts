/**
 * The device-status map keeps each join key's NEWEST row.
 *
 * Coord serves the seed `ORDER BY updated_at DESC`, and a re-paired box leaves
 * two rows under one hostname. Keeping the wrong one hides the live device's
 * runner report behind the retired device's stale one.
 */

import { describe, expect, it } from "vitest";
import {
  indexDeviceStatusRows,
  mergeDeviceStatusRow,
} from "./deviceStatusRows";

function row(deviceId: string, hostname: string | null, updatedAt: string) {
  return { device_id: deviceId, hostname, updated_at: updatedAt };
}

describe("indexDeviceStatusRows", () => {
  it("keeps the newest row when two share a hostname in coord's newest-first order", () => {
    const map = indexDeviceStatusRows([
      row("d-new", "msi", "2026-09-14T10:00:00Z"),
      row("d-old", "msi", "2026-09-01T10:00:00Z"),
    ]);
    expect(map.get("msi")?.device_id).toBe("d-new");
    expect(map.size).toBe(1);
  });

  it("does not rely on server order: a later row that is newer by stamp wins", () => {
    const map = indexDeviceStatusRows([
      row("d-old", "msi", "2026-09-01T10:00:00Z"),
      row("d-new", "msi", "2026-09-14T10:00:00Z"),
    ]);
    expect(map.get("msi")?.device_id).toBe("d-new");
  });

  it("falls back to first-seen (newest-first) when a stamp is missing or unparseable", () => {
    const map = indexDeviceStatusRows([
      row("d-first", "msi", ""),
      row("d-second", "msi", "2026-09-14T10:00:00Z"),
    ]);
    expect(map.get("msi")?.device_id).toBe("d-first");
    const map2 = indexDeviceStatusRows([
      row("d-first", "msi", "2026-09-01T10:00:00Z"),
      row("d-second", "msi", "not a date"),
    ]);
    expect(map2.get("msi")?.device_id).toBe("d-first");
  });

  it("keys a row with no hostname by its device id", () => {
    const map = indexDeviceStatusRows([
      row("d-1", null, "2026-09-14T10:00:00Z"),
    ]);
    expect(map.get("d-1")?.device_id).toBe("d-1");
  });
});

describe("mergeDeviceStatusRow", () => {
  const seed = () =>
    indexDeviceStatusRows([row("d-new", "msi", "2026-09-14T10:00:00Z")]);

  it("never replaces a newer row with an older one from a different device", () => {
    const prev = seed();
    const next = mergeDeviceStatusRow(
      prev,
      row("d-old", "msi", "2026-09-01T10:00:00Z")
    );
    // Not applied: the same Map comes back, so a state updater skips the render.
    expect(next).toBe(prev);
    expect(next.get("msi")?.device_id).toBe("d-new");
  });

  it("always applies an update for the same device, whatever its stamp", () => {
    const prev = seed();
    const older = row("d-new", "msi", "2026-09-13T10:00:00Z");
    const next = mergeDeviceStatusRow(prev, older);
    expect(next).not.toBe(prev);
    expect(next.get("msi")).toBe(older);
  });

  it("applies a newer row from a different device, as a NEW Map", () => {
    const prev = seed();
    const newer = row("d-newer", "msi", "2026-09-15T10:00:00Z");
    const next = mergeDeviceStatusRow(prev, newer);
    expect(next).not.toBe(prev);
    expect(next.get("msi")).toBe(newer);
    // `prev` is untouched — never mutated in place.
    expect(prev.get("msi")?.device_id).toBe("d-new");
  });

  it("applies a different device's row when either stamp is unparseable", () => {
    const next = mergeDeviceStatusRow(seed(), row("d-x", "msi", ""));
    expect(next.get("msi")?.device_id).toBe("d-x");
  });

  it("adds a row under a key nothing holds yet", () => {
    const next = mergeDeviceStatusRow(
      seed(),
      row("d-2", "spaceship", "2026-09-14T10:00:00Z")
    );
    expect(next.size).toBe(2);
  });
});

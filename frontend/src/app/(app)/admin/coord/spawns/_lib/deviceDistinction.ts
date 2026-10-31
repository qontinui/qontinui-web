/**
 * deviceDistinction — what tells apart two device lines that would otherwise
 * read the same.
 *
 * The page lists DEVICES, one line per coord device id. Two devices can carry
 * one name: the operator sees the host's name twice (two devices registered
 * from one computer, or two computers given one hostname), and while
 * presenting both read as their computer's letter, since the alias registry
 * gives a computer one letter on every panel (`machineAliases.ts`). One label
 * for two referents is what served policy `ux-priorities`
 * `a-label-names-one-referent-and-a-quantity-names-its-unit` rules out, so a
 * line whose name another line shares carries a distinguisher:
 *
 * - **operator** — the device id's first eight characters;
 * - **presenting** — no id at all (D3.3): "device 1", "device 2", ranked by
 *   the order the session's registry first saw each device id, so the numbers
 *   hold while the page re-renders and every other panel's letter is untouched.
 *
 * A name no other line shares gets nothing: the distinguisher is the exception,
 * not chrome on every line.
 */

export interface DeviceNameEntry {
  /** The coord device id — what the line is keyed on. */
  deviceId: string;
  /** The name the line shows (hostname, or the presented alias). */
  name: string;
}

/** The device id's short form, for the operator. */
export function shortDeviceId(deviceId: string): string {
  return deviceId.slice(0, 8);
}

/** For each device id whose name another line shares, what tells it apart. */
export function distinguishDevices(
  entries: readonly DeviceNameEntry[],
  presenting: boolean,
  ordinalOf: (deviceId: string) => number | null
): Map<string, string> {
  const byName = new Map<string, DeviceNameEntry[]>();
  for (const entry of entries) {
    const key = entry.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), entry]);
  }
  const out = new Map<string, string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    if (!presenting) {
      for (const e of group) out.set(e.deviceId, shortDeviceId(e.deviceId));
      continue;
    }
    const ranked = group
      .map((e, index) => ({ e, index, ordinal: ordinalOf(e.deviceId) }))
      .sort(
        (a, b) =>
          (a.ordinal ?? Number.MAX_SAFE_INTEGER) -
            (b.ordinal ?? Number.MAX_SAFE_INTEGER) || a.index - b.index
      );
    ranked.forEach(({ e }, i) => out.set(e.deviceId, `device ${i + 1}`));
  }
  return out;
}

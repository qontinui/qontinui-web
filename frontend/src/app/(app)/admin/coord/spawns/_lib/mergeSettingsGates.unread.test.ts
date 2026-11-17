/**
 * The merge settings' unread arm says "still being read" only while a read is
 * out. An answered read with no profile is a different fact, and presenting
 * must not turn it back into "still being read" (review round 6, finding 11).
 */

import { describe, expect, it } from "vitest";
import { fixerDialGate } from "./mergeSettingsGates";
import type { MergeSettingsRead } from "./spawnPathGates";

const read = (loading: boolean): MergeSettingsRead => ({
  loading,
  error: null,
  dial: null,
  profile: null,
});

describe("fixerDialGate — no profile", () => {
  it.each([true, false])(
    "presenting=%s: an answered read with no profile is not still being read",
    (presenting) => {
      const cell = fixerDialGate(read(false), undefined, presenting).effective;
      expect(cell.state).toBe("unknown");
      expect(cell.title).not.toMatch(/still being read/);
      expect(cell.title).toMatch(/answered with no/);
    }
  );

  it.each([true, false])(
    "presenting=%s: a read still out says so",
    (presenting) => {
      const cell = fixerDialGate(read(true), undefined, presenting).effective;
      expect(cell.title).toMatch(/still being read/);
    }
  );
});

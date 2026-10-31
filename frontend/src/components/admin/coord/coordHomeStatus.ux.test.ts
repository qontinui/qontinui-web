/**
 * coordHomeStatus — the derivations the 2026-10-31 UX pass on
 * `/admin/coord/home` added or changed (plan
 * `2026-10-23-console-presentation-spaces` Phase 2 follow-up). The page-level
 * half is `app/(app)/admin/coord/home/page.ux.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import { unitCountText } from "./coordHomeStatus";

describe("unitCountText", () => {
  it("names one unit in the singular", () => {
    expect(unitCountText(1)).toBe("1 unit");
    expect(unitCountText(1, "work unit")).toBe("1 work unit");
  });

  it("names every other count in the plural", () => {
    expect(unitCountText(0)).toBe("0 units");
    expect(unitCountText(2)).toBe("2 units");
    expect(unitCountText(11, "work unit")).toBe("11 work units");
  });

  it("writes a count coord did not serve as a dash, never a zero", () => {
    expect(unitCountText(null)).toBe("– units");
    expect(unitCountText(null, "work unit")).toBe("– work units");
  });
});

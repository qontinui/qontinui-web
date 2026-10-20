import { describe, expect, it } from "vitest";
import { ACCOUNT_SELECTION_LEVELS } from "../../../admin/coord/tenant-policy/types";
import { LOCAL_MODES } from "./ClaudeCliSettings";

describe("LOCAL_MODES", () => {
  it("offers every runner mode the fleet dial offers (all but `off`)", () => {
    expect(LOCAL_MODES.map((m) => m.value)).toEqual(
      ACCOUNT_SELECTION_LEVELS.filter((level) => level !== "off")
    );
  });

  it("labels weighted_random and alternating_handoff", () => {
    const labels = Object.fromEntries(
      LOCAL_MODES.map((m) => [m.value, m.label])
    );
    expect(labels.weighted_random).toBe("Weighted random");
    expect(labels.alternating_handoff).toBe("Alternating handoff");
  });
});

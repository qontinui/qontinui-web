/**
 * The runner's SDK and trust posture, read from a WHOLE `/health` body:
 * `sdkFeatures` lives at the top level, beside `data`, and an absent block is
 * UNKNOWN, never "none" or "off".
 */

import { describe, expect, it } from "vitest";
import { BUILD_ID, GIT_SHA, HEALTH_BODY } from "../__fixtures__/runnerBodies";
import {
  bindingModeLabel,
  buildReadingOf,
  readRunnerPosture,
  totalOf,
} from "./runnerHealth";

describe("readRunnerPosture", () => {
  it("reads the build, the top-level feature inventory and the binding", () => {
    const p = readRunnerPosture(HEALTH_BODY);
    expect(p?.buildId).toBe(BUILD_ID);
    expect(p?.gitSha).toBe(GIT_SHA);
    expect(p?.unstamped).toBe(false);
    expect(p?.sdkFeatures).toEqual(["softNavigate", "snapshotF3", "componentTree"]);
    expect(p?.binding?.mode).toBe("shadow");
    expect(p?.binding?.activeMode).toBe("shadow");
    expect(p?.binding?.registryFullRefusals).toBe(0);
  });

  it("orders the rules naturally, R2 before R10", () => {
    expect(readRunnerPosture(HEALTH_BODY)?.binding?.rules.map((r) => r.rule)).toEqual([
      "R1",
      "R2",
      "R10",
    ]);
  });

  it("reads a body whose envelope was unwrapped as carrying no inventory — UNKNOWN", () => {
    // What `runnerProxyGet` hands back WITHOUT `envelope: "keep"`: the inner
    // `data` alone. The inventory is gone, and the posture says so.
    const p = readRunnerPosture(HEALTH_BODY.data);
    expect(p?.sdkFeatures).toBeNull();
    expect(p?.buildId).toBe(BUILD_ID);
  });

  it("reads a build with no binding block as UNKNOWN binding", () => {
    const { uiBridgeBinding: _binding, ...data } = HEALTH_BODY.data;
    void _binding;
    expect(readRunnerPosture({ ...HEALTH_BODY, data })?.binding).toBeNull();
  });

  it("keeps an absent counter absent rather than zero", () => {
    const p = readRunnerPosture({
      data: { uiBridgeBinding: { binding: "enforce", rules: { R1: {} } } },
    });
    expect(p?.binding?.rules).toEqual([
      { rule: "R1", wouldRefuse: null, refused: null },
    ]);
    expect(totalOf(p?.binding?.rules ?? [], "refused")).toBeNull();
  });

  it("is null for a body that is not a health answer", () => {
    expect(readRunnerPosture("ok")).toBeNull();
    expect(readRunnerPosture(null)).toBeNull();
  });
});

describe("totalOf", () => {
  it("sums the counters the rules carry", () => {
    const rules = readRunnerPosture(HEALTH_BODY)?.binding?.rules ?? [];
    expect(totalOf(rules, "wouldRefuse")).toBe(5);
    expect(totalOf(rules, "refused")).toBe(0);
  });
});

describe("bindingModeLabel", () => {
  it("names each mode and dashes an absent one", () => {
    expect(bindingModeLabel("enforce")).toBe("enforcing");
    expect(bindingModeLabel("shadow")).toBe("shadow (counting, not refusing)");
    expect(bindingModeLabel("off")).toBe("off");
    expect(bindingModeLabel(null)).toBe("–");
  });
});

describe("buildReadingOf", () => {
  it("is known from a posture and unknown, with its reason, without one", () => {
    expect(buildReadingOf(readRunnerPosture(HEALTH_BODY), "x")).toEqual({
      state: "known",
      buildId: BUILD_ID,
      gitSha: GIT_SHA,
    });
    expect(buildReadingOf(null, "its health did not answer")).toEqual({
      state: "unknown",
      reason: "its health did not answer",
    });
  });
});

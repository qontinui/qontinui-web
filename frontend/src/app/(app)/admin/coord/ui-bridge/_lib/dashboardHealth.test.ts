/**
 * The page's opening verdict: green only on a measured "every action declares
 * its effect", amber for anything unread or undeclared, red only for a broken
 * page or hidden text.
 */

import { describe, expect, it } from "vitest";
import type { EffectCounts } from "./componentEffectStatus";
import {
  deriveDashboardHealth,
  type DashboardHealthInput,
} from "./dashboardHealth";
import { RUNNER_ROUTES } from "./relayReads";

const COUNTS: EffectCounts = {
  read: 4,
  write: 2,
  destructive: 1,
  undeclared: 0,
  actions: 7,
  components: 3,
};

function input(over: Partial<DashboardHealthInput> = {}): DashboardHealthInput {
  return {
    machine: "Machine A",
    noRunner: null,
    health: { state: "ok", value: {}, stale: false, asOf: 1 },
    components: { state: "ok", value: COUNTS, stale: false, asOf: 1 },
    pageHealth: { state: "idle" },
    occlusion: { state: "idle" },
    apps: 2,
    sdkFeatures: 3,
    componentsRoute: RUNNER_ROUTES.components,
    ...over,
  };
}

const badge = (h: ReturnType<typeof deriveDashboardHealth>, key: string) =>
  h.badges.find((b) => b.key === key);

describe("deriveDashboardHealth", () => {
  it("is green only when every registered action declares its effect", () => {
    const h = deriveDashboardHealth(input());
    expect(h.level).toBe("green");
    expect(h.headline).toBe(
      "Machine A: every one of its 7 actions declares its effect."
    );
    expect(badge(h, "undeclared")?.label).toBe("undeclared 0");
  });

  it("is amber, naming the count, when any action declares none", () => {
    const h = deriveDashboardHealth(
      input({
        components: {
          state: "ok",
          value: { ...COUNTS, undeclared: 2 },
          stale: false,
          asOf: 1,
        },
      })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Machine A: 2 of 7 actions declare no effect.");
    expect(badge(h, "undeclared")?.tone).toBe("waiting");
  });

  it("is not green over no actions at all", () => {
    const h = deriveDashboardHealth(
      input({
        components: {
          state: "ok",
          value: { ...COUNTS, read: 0, write: 0, destructive: 0, actions: 0 },
          stale: false,
          asOf: 1,
        },
      })
    );
    expect(h.level).toBe("amber");
  });

  it("is amber with dashes, not zeros, when the components were not read", () => {
    const h = deriveDashboardHealth(
      input({ components: { state: "failed", issue: { kind: "not-carried" } } })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/component actions are UNKNOWN/);
    expect(h.headline).toMatch(/predates the relay entries/);
    expect(badge(h, "undeclared")?.label).toBe("undeclared –");
    expect(badge(h, "actions")?.label).toBe("actions –");
  });

  it("is amber when the runner did not answer, and when there is no runner", () => {
    expect(
      deriveDashboardHealth(
        input({
          health: {
            state: "failed",
            issue: { kind: "failed", cause: "x", requestId: null },
          },
        })
      ).headline
    ).toBe("Machine A did not answer, so every runner panel is UNKNOWN.");
    const none = deriveDashboardHealth(
      input({ noRunner: "the runner list has not answered yet" })
    );
    expect(none.level).toBe("amber");
    expect(none.headline).toMatch(/^No runner to read/);
  });

  it("is red for a page reported broken, or for hidden text", () => {
    expect(
      deriveDashboardHealth(
        input({ pageHealth: { state: "ok", value: "critical", stale: false, asOf: 1 } })
      ).level
    ).toBe("red");
    expect(
      deriveDashboardHealth(
        input({ occlusion: { state: "ok", value: "hides-text", stale: false, asOf: 1 } })
      ).level
    ).toBe("red");
  });

  it("never folds an UNKNOWN occlusion into a green — nor reads it as hidden text", () => {
    const h = deriveDashboardHealth(
      input({ occlusion: { state: "ok", value: "unknown", stale: false, asOf: 1 } })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Machine A: every one of its 7 actions declares its effect, but its occlusion is UNKNOWN."
    );
    expect(h.headline).not.toMatch(/hidden/);
  });

  it("keeps a sweep the relay refused amber, beside an unreadable page health", () => {
    const h = deriveDashboardHealth(
      input({
        pageHealth: { state: "ok", value: "unknown", stale: false, asOf: 1 },
        occlusion: { state: "failed", issue: { kind: "not-carried" } },
      })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/page health and occlusion are UNKNOWN/);
  });

  it("stays green when the checks were not asked for", () => {
    expect(deriveDashboardHealth(input()).level).toBe("green");
  });
});

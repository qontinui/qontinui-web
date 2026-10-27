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
  unreadable: 0,
};

function input(over: Partial<DashboardHealthInput> = {}): DashboardHealthInput {
  return {
    machine: "Machine A",
    noRunner: null,
    health: { state: "ok", value: {}, stale: false, asOf: 1 },
    components: { state: "ok", value: COUNTS, stale: false, asOf: 1 },
    pageHealth: { state: "idle" },
    occlusion: { state: "idle" },
    apps: { kind: "exact", count: 2 },
    appsStale: false,
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

  const FAILED = {
    state: "failed",
    issue: { kind: "failed", cause: "x", requestId: null, quotes: true },
  } as const;

  it("says only what a failed health read leaves unknown — the components it did read stand", () => {
    const h = deriveDashboardHealth(input({ health: FAILED }));
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Machine A's health did not answer, so its build and SDK features are UNKNOWN."
    );
    // The component counts answered and are on the strip: no sentence may
    // call every runner panel UNKNOWN beside them.
    expect(h.headline).not.toMatch(/every runner panel/);
    expect(badge(h, "actions")?.label).toBe("actions 7");
  });

  it("names the component actions too when they failed beside the health", () => {
    const h = deriveDashboardHealth(
      input({ health: FAILED, components: FAILED })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Machine A's health did not answer, so its build and SDK features are UNKNOWN. Its component actions are UNKNOWN too — the read failed."
    );
  });

  it("is amber when there is no runner", () => {
    const none = deriveDashboardHealth(
      input({ noRunner: "the runner list has not answered yet" })
    );
    expect(none.level).toBe("amber");
    expect(none.headline).toMatch(/^No runner to read/);
  });

  it("is red for a page reported broken, or for hidden text", () => {
    expect(
      deriveDashboardHealth(
        input({
          pageHealth: { state: "ok", value: "critical", stale: false, asOf: 1 },
        })
      ).level
    ).toBe("red");
    expect(
      deriveDashboardHealth(
        input({
          occlusion: {
            state: "ok",
            value: "hides-text",
            stale: false,
            asOf: 1,
          },
        })
      ).level
    ).toBe("red");
  });

  it("never folds an UNKNOWN occlusion into a green — nor reads it as hidden text", () => {
    const h = deriveDashboardHealth(
      input({
        occlusion: { state: "ok", value: "unknown", stale: false, asOf: 1 },
      })
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

  it("states the app total exactly, as a floor, or as a dash — never a zero nobody counted", () => {
    expect(badge(deriveDashboardHealth(input()), "apps")?.label).toBe("apps 2");
    const floor = badge(
      deriveDashboardHealth(
        input({ apps: { kind: "floor", count: 2, unread: "runner" } })
      ),
      "apps"
    );
    expect(floor?.label).toBe("apps ≥2");
    expect(floor?.title).toBe(
      "At least 2: this runner's app list was not read, so an app only it records is not counted"
    );
    const unknown = badge(
      deriveDashboardHealth(
        input({ apps: { kind: "unknown", unread: "runner" } })
      ),
      "apps"
    );
    expect(unknown?.label).toBe("apps –");
    expect(unknown?.title).toBe(
      "The web registry records none and this runner's app list was not read, so how many apps exist is unknown — not none"
    );
  });
});

/**
 * A STALE read — its latest refresh failed, so the page keeps an earlier
 * read's value. The figures stay, labelled; the verdict is about now, and the
 * earlier read is not now (style guide R6), so a stale read is never green —
 * and never red either.
 */
describe("deriveDashboardHealth — a stale read", () => {
  const stale = <T,>(value: T) =>
    ({ state: "ok", value, stale: true, asOf: 1 }) as const;
  const fresh = <T,>(value: T) =>
    ({ state: "ok", value, stale: false, asOf: 1 }) as const;

  it.each([
    ["health", { health: stale({}) }, "health"],
    ["component actions", { components: stale(COUNTS) }, "component actions"],
    ["page health", { pageHealth: stale("ok" as const) }, "page health"],
    ["occlusion", { occlusion: stale("clear" as const) }, "occlusion check"],
  ] as const)(
    "holds the strip at amber when the %s read is from an earlier read — never green",
    (_name, over, named) => {
      // Every other input is the green one.
      expect(deriveDashboardHealth(input()).level).toBe("green");
      const h = deriveDashboardHealth(input(over));
      expect(h.level).toBe("amber");
      expect(h.headline).toBe(
        `Machine A: the last refresh of its ${named} failed, so what this page shows of it is from an earlier read.`
      );
    }
  );

  it("names every stale read at once", () => {
    const h = deriveDashboardHealth(
      input({ health: stale({}), components: stale(COUNTS) })
    );
    expect(h.headline).toBe(
      "Machine A: the last refresh of its health and component actions failed, so what this page shows of them is from an earlier read."
    );
  });

  it("keeps the earlier figures on the badges — kept, not dashed", () => {
    const h = deriveDashboardHealth(input({ components: stale(COUNTS) }));
    expect(badge(h, "actions")?.label).toBe("actions 7");
    expect(badge(h, "undeclared")?.label).toBe("undeclared 0");
  });

  it("does not paint red off an earlier read — it says what that read found", () => {
    const page = deriveDashboardHealth(
      input({ pageHealth: stale("critical" as const) })
    );
    expect(page.level).toBe("amber");
    expect(page.headline).toBe(
      "Machine A: the last refresh of its page health failed, so what this page shows of it is from an earlier read. That earlier read reported its page as broken."
    );
    const hidden = deriveDashboardHealth(
      input({ occlusion: stale("hides-text" as const) })
    );
    expect(hidden.level).toBe("amber");
    expect(hidden.headline).toMatch(
      /That earlier read found text on its screen hidden behind an overlay\.$/
    );
  });

  it("is still red for a CURRENT broken page beside a stale read", () => {
    const h = deriveDashboardHealth(
      input({
        components: stale(COUNTS),
        pageHealth: fresh("critical" as const),
      })
    );
    expect(h.level).toBe("red");
  });

  it("labels the app total when a registry behind it is from an earlier read", () => {
    expect(badge(deriveDashboardHealth(input()), "apps")?.title).toBe(
      "Applications across the web and runner registries"
    );
    expect(
      badge(deriveDashboardHealth(input({ appsStale: true })), "apps")?.title
    ).toBe(
      "Applications across the web and runner registries — from an earlier read: the last refresh of an app registry failed"
    );
  });
});

/**
 * Registry entries that could not be read are in no count, so every count is
 * a floor — and "every action declares its effect" is not measured.
 */
describe("deriveDashboardHealth — registry entries that could not be read", () => {
  const ok = (value: EffectCounts) =>
    ({ state: "ok", value, stale: false, asOf: 1 }) as const;

  it("is never green while an entry could not be read, and says why", () => {
    const h = deriveDashboardHealth(
      input({ components: ok({ ...COUNTS, unreadable: 2 }) })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Machine A: 2 entries in its component registry could not be read, so whether every action declares its effect is UNKNOWN."
    );
  });

  it("states the counts as floors on the badges", () => {
    const h = deriveDashboardHealth(
      input({ components: ok({ ...COUNTS, unreadable: 1 }) })
    );
    expect(badge(h, "components")?.label).toBe("components ≥3");
    expect(badge(h, "actions")?.label).toBe("actions ≥7");
    expect(badge(h, "undeclared")?.label).toBe("undeclared ≥0");
    expect(badge(h, "undeclared")?.tone).toBe("waiting");
    expect(badge(h, "actions")?.title).toBe(
      "Actions across those components — at least: 1 registry entry could not be read and is not counted"
    );
  });

  it("calls both counts floors beside undeclared actions", () => {
    const h = deriveDashboardHealth(
      input({ components: ok({ ...COUNTS, undeclared: 2, unreadable: 1 }) })
    );
    expect(h.headline).toBe(
      "Machine A: 2 of 7 actions declare no effect. 1 entry in its component registry could not be read, so both counts are floors."
    );
  });
});

/**
 * The merged app registry: presence is a cross-registry claim, so it is
 * stated only when BOTH registries answered — an unread side is UNKNOWN,
 * never "web only".
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import { FLEET_APPS } from "../__fixtures__/runnerBodies";
import {
  APP_PRESENCE_ATTENTION_BY_KIND,
  APP_PRESENCE_PALETTE,
  appTotalMeaning,
  appTotalOf,
  appTotalValue,
  mergeAppRegistries,
  presenceCounts,
  updateStrategyLabel,
} from "./appRegistryStatus";

const RUNNER_APPS = [
  {
    app_id: "qontinui-runner",
    display_name: "Qontinui Runner (runner row)",
    ui_bridge_url: "http://127.0.0.1:9876",
    last_seen_at_ms: 1761209000000,
  },
  { app_id: "local-only", display_name: "Local only", last_seen_at_ms: 0 },
];

describe("mergeAppRegistries", () => {
  it("says where each app is recorded when both registries answered", () => {
    const rows = mergeAppRegistries(FLEET_APPS, RUNNER_APPS);
    expect(rows?.map((r) => [r.appId, r.presence])).toEqual([
      ["example-portal", "web-only"],
      ["local-only", "runner-only"],
      ["qontinui-runner", "both"],
    ]);
  });

  it("prefers the web registry's name and keeps the runner's last-seen time", () => {
    const runner = mergeAppRegistries(FLEET_APPS, RUNNER_APPS)?.find(
      (r) => r.appId === "qontinui-runner"
    );
    expect(runner?.displayName).toBe("Qontinui Runner");
    expect(runner?.lastSeenAtMs).toBe(1761209000000);
    expect(runner?.uiBridgeUrl).toBe("http://127.0.0.1:9876");
    expect(runner?.updateStrategy).toBe("pull_build");
  });

  it("reads a zero last-seen as never seen, not as 1970", () => {
    const local = mergeAppRegistries(FLEET_APPS, RUNNER_APPS)?.find(
      (r) => r.appId === "local-only"
    );
    expect(local?.lastSeenAtMs).toBeNull();
  });

  it("makes presence UNKNOWN for every row when the runner was not read", () => {
    const rows = mergeAppRegistries(FLEET_APPS, null);
    expect(rows?.map((r) => r.presence)).toEqual(["unknown", "unknown"]);
    expect(rows?.every((r) => r.inWeb === true && r.onRunner === null)).toBe(
      true
    );
  });

  it("makes presence UNKNOWN when the web was not read", () => {
    const rows = mergeAppRegistries(null, RUNNER_APPS);
    expect(rows?.map((r) => r.presence)).toEqual(["unknown", "unknown"]);
    expect(rows?.every((r) => r.inWeb === null)).toBe(true);
  });

  it("is null — not an empty registry — when neither answered", () => {
    expect(mergeAppRegistries(null, null)).toBeNull();
  });

  it("is an empty list when both answered with nothing", () => {
    expect(mergeAppRegistries([], [])).toEqual([]);
  });

  it("drops a row with no app id and keeps the first of a duplicate", () => {
    const rows = mergeAppRegistries(
      [
        { ...FLEET_APPS[0], display_name: "First" },
        { ...FLEET_APPS[0], display_name: "Second" },
        { ...FLEET_APPS[1], app_id: "  " },
      ],
      []
    );
    expect(rows?.map((r) => [r.appId, r.displayName])).toEqual([
      ["qontinui-runner", "First"],
    ]);
  });

  it("counts each presence", () => {
    const rows = mergeAppRegistries(FLEET_APPS, RUNNER_APPS) ?? [];
    expect(presenceCounts(rows)).toEqual({
      both: 1,
      "web-only": 1,
      "runner-only": 1,
      unknown: 0,
    });
  });
});

describe("appTotalOf — the apps across both registries", () => {
  const both = { web: true, runner: true };

  it("is exact when both registries answered, zero included", () => {
    const rows = mergeAppRegistries(FLEET_APPS, RUNNER_APPS);
    const total = appTotalOf(rows, both);
    expect(total).toEqual({ kind: "exact", count: 3 });
    expect(appTotalValue(total)).toBe(3);
    expect(appTotalMeaning(total)).toBe(
      "Applications across the web and runner registries"
    );
    // Both answered with nothing: a measured zero.
    const none = appTotalOf(mergeAppRegistries([], []), both);
    expect(none).toEqual({ kind: "exact", count: 0 });
    expect(appTotalValue(none)).toBe(0);
  });

  it("is a floor, written ≥N, when one registry did not answer", () => {
    const total = appTotalOf(mergeAppRegistries(FLEET_APPS, null), {
      web: true,
      runner: false,
    });
    expect(total).toEqual({ kind: "floor", count: 2, unread: "runner" });
    expect(appTotalValue(total)).toBe("≥2");
    expect(appTotalMeaning(total)).toBe(
      "At least 2: this runner's app list was not read, so an app only it records is not counted"
    );
    const webUnread = appTotalOf(mergeAppRegistries(null, RUNNER_APPS), {
      web: false,
      runner: true,
    });
    expect(appTotalValue(webUnread)).toBe("≥2");
    expect(appTotalMeaning(webUnread)).toMatch(/^At least 2: the web registry/);
  });

  it("is UNKNOWN — a dash, not 0 — when the one registry that answered records none", () => {
    const total = appTotalOf(mergeAppRegistries([], null), {
      web: true,
      runner: false,
    });
    expect(total).toEqual({ kind: "unknown", unread: "runner" });
    expect(appTotalValue(total)).toBeNull();
    expect(appTotalMeaning(total)).toBe(
      "The web registry records none and this runner's app list was not read, so how many apps exist is unknown — not none"
    );
  });

  it("is UNKNOWN when neither registry answered", () => {
    const total = appTotalOf(null, { web: false, runner: false });
    expect(total).toEqual({ kind: "unknown", unread: "both" });
    expect(appTotalValue(total)).toBeNull();
    expect(appTotalMeaning(total)).toBe(
      "Neither registry answered, so how many apps exist is unknown"
    );
  });
});

describe("updateStrategyLabel", () => {
  it("names the two strategies and dashes an unknown one", () => {
    expect(updateStrategyLabel("pull_only")).toBe("pull only");
    expect(updateStrategyLabel("pull_build")).toBe("pull and build");
    expect(updateStrategyLabel(null)).toBe("–");
  });
});

describe("the presence palette (R3)", () => {
  it("agrees with its attention table, amber only for UNKNOWN", () => {
    expect(
      paletteDisagreements(APP_PRESENCE_ATTENTION_BY_KIND, APP_PRESENCE_PALETTE)
    ).toEqual([]);
    expect(APP_PRESENCE_ATTENTION_BY_KIND.unknown).toBe("waiting");
    expect(APP_PRESENCE_ATTENTION_BY_KIND["web-only"]).toBe("none");
  });
});

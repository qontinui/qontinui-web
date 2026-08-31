import { describe, expect, it } from "vitest";
import {
  CI_ROUTING_LABELS,
  describeMirrorFreshness,
  indexCiRunners,
  matchesFleetRouting,
  mergeCiRunners,
  missingRoutingLabels,
  normalizeCiRunnerStatus,
  parseCiRunnersPayload,
  type CiRunnerMirrorRead,
} from "./ciRunnerMirror";
import type { CiRunnersByHost } from "./types";

/**
 * Coord's CI-runner mirror — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 2.
 *
 * The fixtures are the pool as it actually was, measured with `gh api` on
 * 2026-08-31: three hosts, `merytshost` carrying no per-machine label at all.
 * That third host is the one every written description of the pool in the tree
 * has missed, so it is in every fixture here on purpose.
 */

const MERYTSHOST = {
  device_id: "d-meryts",
  hostname: "merytshost",
  ci_runner_status: "idle",
  ci_runner_labels: ["self-hosted", "Linux", "X64", "qontinui"],
  last_seen_at: "2026-08-31T12:00:00Z",
};
const MSI = {
  device_id: "d-msi",
  hostname: "msi-wsl",
  ci_runner_status: "busy",
  ci_runner_labels: ["self-hosted", "Linux", "X64", "qontinui", "msi"],
  last_seen_at: "2026-08-31T12:00:00Z",
};
/** The delabelled shape — what `DELETE .../runners/22/labels/qontinui` leaves. */
const SPACESHIP_DELABELLED = {
  device_id: "d-spaceship",
  hostname: "spaceship-wsl",
  ci_runner_status: "idle",
  ci_runner_labels: ["self-hosted", "Linux", "X64", "spaceship"],
  last_seen_at: "2026-08-31T12:00:00Z",
};

describe("routing labels", () => {
  it("names the routing contract, not a host list", () => {
    expect([...CI_ROUTING_LABELS]).toEqual(["self-hosted", "qontinui"]);
  });

  it("matches the three real hosts' label sets, case-insensitively", () => {
    expect(matchesFleetRouting(MERYTSHOST.ci_runner_labels)).toBe(true);
    expect(matchesFleetRouting(MSI.ci_runner_labels)).toBe(true);
    // GitHub compares labels case-insensitively; the real sets carry `Linux`
    // and `X64` capitalised, so a case-sensitive check would be a live bug.
    expect(matchesFleetRouting(["Self-Hosted", "QONTINUI"])).toBe(true);
  });

  it("reports a delabelled host as unroutable, naming what is missing", () => {
    expect(matchesFleetRouting(SPACESHIP_DELABELLED.ci_runner_labels)).toBe(
      false
    );
    expect(missingRoutingLabels(SPACESHIP_DELABELLED.ci_runner_labels)).toEqual(
      ["qontinui"]
    );
  });

  it("treats an empty label set as unroutable, not as routable", () => {
    expect(missingRoutingLabels([])).toEqual(["self-hosted", "qontinui"]);
  });
});

describe("normalizeCiRunnerStatus", () => {
  it("narrows the three known values", () => {
    expect(normalizeCiRunnerStatus("idle")).toBe("idle");
    expect(normalizeCiRunnerStatus("BUSY")).toBe("busy");
    expect(normalizeCiRunnerStatus(" offline ")).toBe("offline");
  });

  it("does NOT fold an absent or unrecognised status into offline", () => {
    // "coord says offline" and "nobody said" are different facts, and the
    // second is the one that gets acted on wrongly.
    expect(normalizeCiRunnerStatus(null)).toBe("unknown");
    expect(normalizeCiRunnerStatus(undefined)).toBe("unknown");
    expect(normalizeCiRunnerStatus("quiescing")).toBe("unknown");
  });
});

describe("parseCiRunnersPayload", () => {
  it("indexes the three hosts by hostname", () => {
    const read = parseCiRunnersPayload({
      runners: [MERYTSHOST, MSI, SPACESHIP_DELABELLED],
      as_of: "2026-08-31T12:00:30Z",
      freshness_secs: 42,
    });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") return;
    expect([...read.byHostname.keys()].sort()).toEqual([
      "merytshost",
      "msi-wsl",
      "spaceship-wsl",
    ]);
    expect(read.freshnessSecs).toBe(42);
    expect(read.asOf).toBe("2026-08-31T12:00:30Z");
  });

  it("an EMPTY runners list is a real measurement, not a failure", () => {
    const read = parseCiRunnersPayload({ runners: [] });
    expect(read.state).toBe("ok");
  });

  it("a non-object body is UNAVAILABLE, never an empty fleet", () => {
    expect(parseCiRunnersPayload(null).state).toBe("unavailable");
    expect(parseCiRunnersPayload("nope").state).toBe("unavailable");
  });

  it("a non-list `runners` is UNAVAILABLE", () => {
    expect(parseCiRunnersPayload({ runners: {} }).state).toBe("unavailable");
  });

  it("reports missing freshness as unknown rather than picking a number", () => {
    const read = parseCiRunnersPayload({ runners: [MSI] });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") return;
    expect(read.freshnessSecs).toBeNull();
    expect(read.asOf).toBeNull();
  });

  it("drops a row with no hostname rather than guessing one", () => {
    const { byHostname, skippedRows } = indexCiRunners({
      runners: [MSI, { ...MSI, hostname: "" }],
    });
    expect(byHostname.size).toBe(1);
    expect(skippedRows).toBe(1);
  });
});

describe("mergeCiRunners", () => {
  const registry: CiRunnersByHost = {
    "my-workstation": {
      status: "idle",
      labels: ["self-hosted"],
      lastJobAt: "2026-08-30T00:00:00Z",
    },
    "msi-wsl": {
      status: "offline",
      labels: [],
      lastJobAt: "2026-08-29T00:00:00Z",
    },
  };
  const mirror = parseCiRunnersPayload({
    runners: [MERYTSHOST, MSI, SPACESHIP_DELABELLED],
    freshness_secs: 10,
  });

  it("adds the GitHub fleet's hosts, which the device read cannot see at all", () => {
    const merged = mergeCiRunners(registry, mirror);
    expect(Object.keys(merged).sort()).toEqual([
      "merytshost",
      "msi-wsl",
      "my-workstation",
      "spaceship-wsl",
    ]);
  });

  it("lets the mirror win for status and labels where both carry a host", () => {
    const merged = mergeCiRunners(registry, mirror);
    expect(merged["msi-wsl"]?.status).toBe("busy");
    expect(merged["msi-wsl"]?.labels).toContain("qontinui");
    expect(merged["msi-wsl"]?.source).toBe("coord-mirror");
  });

  it("keeps lastJobAt from the device registry, which the mirror does not carry", () => {
    const merged = mergeCiRunners(registry, mirror);
    expect(merged["msi-wsl"]?.lastJobAt).toBe("2026-08-29T00:00:00Z");
    expect(merged["merytshost"]?.lastJobAt).toBeNull();
  });

  it("marks device-registry rows as such, so no routing verdict is claimed", () => {
    const merged = mergeCiRunners(registry, mirror);
    expect(merged["my-workstation"]?.source).toBe("device-registry");
  });

  it("a failed mirror read removes nothing and claims nothing", () => {
    const failed: CiRunnerMirrorRead = {
      state: "unavailable",
      reason: "coord is not reachable",
    };
    const merged = mergeCiRunners(registry, failed);
    expect(Object.keys(merged).sort()).toEqual(["msi-wsl", "my-workstation"]);
    expect(merged["msi-wsl"]?.source).toBe("device-registry");
  });
});

describe("describeMirrorFreshness", () => {
  it("says the labels are a mirror, with coord's own age", () => {
    const read = parseCiRunnersPayload({
      runners: [MSI],
      as_of: "2026-08-31T12:00:30Z",
      freshness_secs: 42,
    });
    const text = describeMirrorFreshness(read);
    expect(text).toContain("42s old");
    expect(text).toContain("2026-08-31T12:00:30Z");
    expect(text).toMatch(/not a live read of GitHub/);
  });

  it("says the age is unknown rather than picking a reassuring number", () => {
    const text = describeMirrorFreshness(
      parseCiRunnersPayload({ runners: [] })
    );
    expect(text).toContain("unknown age");
  });

  it("reports a failed read as UNKNOWN label state, with the reason", () => {
    const text = describeMirrorFreshness({
      state: "unavailable",
      reason: "coord is not reachable",
    });
    expect(text).toMatch(/^Label state unknown/);
    expect(text).toContain("coord is not reachable");
  });
});

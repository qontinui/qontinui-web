import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MachineCard, runnerHealthState } from "./MachineCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { MachineGroup, SymbolClaim } from "./types";
import type { Runner } from "@qontinui/shared-types";

/**
 * MachineCard — device-hardware-only after Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`. The
 * `currentActivity` + `currentlyEditing` sub-lines moved to
 * `/sessions`; these tests now lock in their absence so a future
 * refactor doesn't accidentally re-render them.
 */

function symbolClaim(resource_key: string, ttl: number): SymbolClaim {
  return {
    kind: "symbol",
    machine_id: "00000000-0000-0000-0000-000000000001",
    resource_key,
    ttl_seconds: ttl,
  };
}

function mockRunner(id = "r1"): Runner {
  // Minimal Runner shape — only the props MachineCard reads. The
  // canonical Runner type from `@qontinui/shared-types` has many
  // optional fields; cast through unknown to keep the test fixture
  // tight.
  return {
    id,
    name: `runner-${id}`,
    hostname: "test-host",
    port: 9876,
    derivedStatus: "healthy",
    lastHeartbeat: new Date().toISOString(),
    os: "linux",
    osVersion: "ubuntu-22.04",
  } as unknown as Runner;
}

function baseGroup(overrides: Partial<MachineGroup> = {}): MachineGroup {
  return {
    hostname: "test-host",
    runners: [mockRunner()],
    claudeSessions: [],
    currentActivity: undefined,
    currentlyEditing: undefined,
    // Disk telemetry is REQUIRED on `MachineGroup` — the default fixture is
    // deliberately the honest "we could not look it up" state, not an empty
    // volume list.
    volumes: {
      state: "unknown",
      reason: "test fixture: no telemetry configured",
    },
    ...overrides,
  };
}

function renderCard(group: MachineGroup) {
  return render(
    <TooltipProvider>
      <MachineCard machine={group} />
    </TooltipProvider>
  );
}

describe("MachineCard — device-hardware-only render", () => {
  it("renders the hostname and runner row", () => {
    const { getByText, container } = renderCard(baseGroup());
    expect(getByText("test-host")).not.toBeNull();
    expect(
      container.querySelector("[data-operations-machine-card]")
    ).not.toBeNull();
  });

  it("does NOT render the Phase 1.3 current-activity sub-line", () => {
    // currentActivity now ignored even when present — surface lives at /sessions.
    renderCard(
      baseGroup({
        currentActivity: {
          device_id: "00000000-0000-0000-0000-000000000001",
          hostname: "test-host",
          current_task: "phase X work",
          current_repo: "qontinui-web",
          current_branch: "main",
          free_text: null,
          details: {},
          tenant_id: null,
          updated_at: new Date().toISOString(),
        },
      })
    );
    expect(
      document.querySelector("[data-operations-current-activity]")
    ).toBeNull();
  });

  it("does NOT render the Phase 4.4 currently-editing sub-line", () => {
    renderCard(
      baseGroup({
        currentlyEditing: [
          symbolClaim("repo:src/main.rs:foo", 290),
          symbolClaim("repo:src/lib.rs:bar", 280),
        ],
      })
    );
    expect(
      document.querySelector("[data-operations-currently-editing]")
    ).toBeNull();
  });

  it("renders the Claude Code session list", () => {
    const { getByText } = renderCard(
      baseGroup({
        claudeSessions: [
          {
            pid: 12345,
            working_directory: "/home/user/qontinui-root",
            started_at: new Date().toISOString(),
          },
        ],
      })
    );
    expect(getByText(/PID 12345/)).not.toBeNull();
  });

  it("shows the empty-state copy when no Claude sessions are present", () => {
    const { getByText } = renderCard(baseGroup());
    expect(getByText(/No active sessions/i)).not.toBeNull();
  });
});

/**
 * Disk monitoring Phase 1 (plan
 * `2026-08-07-product-disk-monitoring-and-cleanup.md` steps 10-11).
 *
 * These tests are the honesty rules, not decoration: a device with no
 * telemetry must render UNKNOWN — never `0`, never green — and a stale
 * reading must render its age.
 */
describe("MachineCard — free disk space", () => {
  it("renders per-volume free/total, percent free, and a relative age", () => {
    const { container, getByText } = renderCard(
      baseGroup({
        volumes: {
          state: "reported",
          deviceId: "00000000-0000-0000-0000-000000000001",
          volumes: [
            {
              volume: "D:",
              total_bytes: 4 * 1024 ** 4, // 4 TiB
              free_bytes: 1024 ** 3, // 1 GiB — critical band
              observed_at: new Date(Date.now() - 30_000).toISOString(),
            },
          ],
        },
      })
    );

    const section = container.querySelector("[data-operations-machine-disk]");
    expect(section).not.toBeNull();
    expect(section?.getAttribute("data-disk-state")).toBe("reported");
    expect(
      container.querySelector('[data-operations-volume="D:"]')
    ).not.toBeNull();
    expect(getByText(/1\.0 GiB free/)).not.toBeNull();
    expect(getByText(/4\.0 TiB/)).not.toBeNull();
    // 1 GiB of 4 TiB → 0.0 % free (rounded), and it must be LABELLED as a
    // percentage of a known total, not silently omitted.
    expect(getByText(/% free/)).not.toBeNull();
    expect(getByText(/measured .* ago/)).not.toBeNull();
  });

  it("marks a stale reading STALE and still shows its age", () => {
    const { getByText } = renderCard(
      baseGroup({
        volumes: {
          state: "reported",
          deviceId: "00000000-0000-0000-0000-000000000001",
          volumes: [
            {
              volume: "C:",
              total_bytes: 512 * 1024 ** 3,
              free_bytes: 400 * 1024 ** 3,
              observed_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
            },
          ],
        },
      })
    );
    expect(getByText(/stale/i)).not.toBeNull();
    expect(getByText(/measured 6h ago/)).not.toBeNull();
  });

  it("renders UNKNOWN — never 0, never green — for a device that never reported", () => {
    const { container, getByText } = renderCard(
      baseGroup({
        volumes: {
          state: "never_reported",
          deviceId: "00000000-0000-0000-0000-000000000001",
        },
      })
    );
    const section = container.querySelector("[data-operations-machine-disk]");
    expect(section?.getAttribute("data-disk-state")).toBe("never_reported");
    expect(getByText(/^Unknown$/i)).not.toBeNull();
    expect(getByText(/never reported disk telemetry/i)).not.toBeNull();
    // The fabricated-zero regression: no byte figure at all is rendered.
    expect(section?.textContent ?? "").not.toMatch(/0 B|0 GiB|0% free/);
    expect(section?.querySelector(".bg-green-500")).toBeNull();
  });

  it("renders UNKNOWN with the READ's reason when the telemetry read failed", () => {
    const { container, getByText } = renderCard(
      baseGroup({
        volumes: {
          state: "unknown",
          reason: "The fleet-volumes read returned HTTP 502.",
        },
      })
    );
    const section = container.querySelector("[data-operations-machine-disk]");
    expect(section?.getAttribute("data-disk-state")).toBe("unknown");
    expect(getByText(/HTTP 502/)).not.toBeNull();
    // A failed read must NOT be worded as a fact about the device.
    expect(section?.textContent ?? "").not.toMatch(/never reported/i);
  });

  it("never renders a non-numeric free-space figure as green", () => {
    const { container, getByText } = renderCard(
      baseGroup({
        volumes: {
          state: "reported",
          deviceId: "00000000-0000-0000-0000-000000000001",
          volumes: [
            {
              volume: "F:",
              total_bytes: 512 * 1024 ** 3,
              // Coord served no numeric free_bytes — the parser keeps it NaN
              // rather than coercing it to 0.
              free_bytes: Number.NaN,
              observed_at: new Date().toISOString(),
            },
          ],
        },
      })
    );
    const row = container.querySelector('[data-operations-volume="F:"]');
    expect(getByText(/unknown free/)).not.toBeNull();
    expect(row?.querySelector(".bg-green-500")).toBeNull();
    expect(row?.innerHTML ?? "").not.toMatch(/text-green-500/);
    expect(row?.textContent ?? "").not.toMatch(/0 B free/);
  });

  it("says so when the total is unusable instead of rendering a 0% bar", () => {
    const { container, getByText } = renderCard(
      baseGroup({
        volumes: {
          state: "reported",
          deviceId: "00000000-0000-0000-0000-000000000001",
          volumes: [
            {
              volume: "E:",
              total_bytes: 0,
              free_bytes: 0,
              observed_at: null,
            },
          ],
        },
      })
    );
    expect(getByText(/Capacity unknown/i)).not.toBeNull();
    expect(getByText(/percent free: unknown/i)).not.toBeNull();
    expect(getByText(/measurement time unknown/i)).not.toBeNull();
    expect(
      container.querySelector('[data-operations-volume="E:"] .bg-green-500')
    ).toBeNull();
  });
});

describe("MachineCard — HealthDot third state", () => {
  it("renders healthy and unhealthy runners as distinct filled dots", () => {
    const { container } = renderCard(
      baseGroup({
        runners: [
          mockRunner("r-healthy"),
          {
            ...mockRunner("r-bad"),
            derivedStatus: "unhealthy",
          } as unknown as Runner,
        ],
      })
    );
    expect(
      container.querySelector('[data-operations-health-dot="healthy"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-operations-health-dot="unhealthy"]')
    ).not.toBeNull();
  });

  it("renders a runner that has NEVER reported as unknown, not unhealthy", () => {
    const { container } = renderCard(
      baseGroup({
        runners: [
          {
            ...mockRunner("r-never"),
            derivedStatus: undefined,
            lastHeartbeat: null,
          } as unknown as Runner,
        ],
      })
    );
    const dot = container.querySelector(
      '[data-operations-health-dot="unknown"]'
    );
    expect(dot).not.toBeNull();
    expect(
      container.querySelector('[data-operations-health-dot="unhealthy"]')
    ).toBeNull();
    // Visually distinct from unhealthy: no red fill, and the tooltip label
    // says never-reported explicitly.
    expect(dot?.getAttribute("class") ?? "").not.toMatch(/text-red-500/);
    expect(dot?.getAttribute("aria-label") ?? "").toMatch(/NEVER reported/);
  });

  // The per-runner dot and the machine-card HEADER dot must agree, and the
  // header is the one the eye lands on. Before this, a machine whose only
  // runner had never heartbeated rendered a muted per-runner dot AND a solid
  // red header labelled "No runners healthy" — announcing a problem that
  // nothing had reported.
  it("renders the HEADER dot as muted-unknown when every runner has never reported", () => {
    const { container } = renderCard(
      baseGroup({
        runners: [
          {
            ...mockRunner("r-never"),
            derivedStatus: undefined,
            lastHeartbeat: null,
          } as unknown as Runner,
        ],
      })
    );
    const header = container.querySelector("[data-operations-machine-health]");
    expect(header).not.toBeNull();
    expect(header?.getAttribute("data-operations-machine-health")).toBe(
      "unknown"
    );
    expect(header?.getAttribute("class") ?? "").not.toMatch(/bg-red-500/);
    expect(header?.getAttribute("class") ?? "").toMatch(/bg-muted-foreground/);
    const label = header?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/never-reported is NOT unhealthy/i);
    expect(label).toMatch(/has ever reported its health/i);
    expect(label).not.toBe("No runners healthy");
  });

  it("still renders the HEADER dot red when a runner is genuinely unhealthy", () => {
    const { container } = renderCard(
      baseGroup({
        runners: [
          {
            ...mockRunner("r-bad"),
            derivedStatus: "unhealthy",
          } as unknown as Runner,
        ],
      })
    );
    const header = container.querySelector("[data-operations-machine-health]");
    expect(header?.getAttribute("data-operations-machine-health")).toBe(
      "unhealthy"
    );
    expect(header?.getAttribute("class") ?? "").toMatch(/bg-red-500/);
  });

  it("names the never-reported runners when only SOME are unhealthy", () => {
    const { container } = renderCard(
      baseGroup({
        runners: [
          {
            ...mockRunner("r-bad"),
            derivedStatus: "unhealthy",
          } as unknown as Runner,
          {
            ...mockRunner("r-never"),
            derivedStatus: undefined,
            lastHeartbeat: null,
          } as unknown as Runner,
        ],
      })
    );
    const header = container.querySelector("[data-operations-machine-health]");
    expect(header?.getAttribute("data-operations-machine-health")).toBe(
      "unhealthy"
    );
    expect(header?.getAttribute("aria-label") ?? "").toMatch(
      /1 of 2 unhealthy, the rest have never reported/i
    );
  });

  it("renders the HEADER dot green only when every runner is healthy", () => {
    const { container } = renderCard(baseGroup());
    const header = container.querySelector("[data-operations-machine-health]");
    expect(header?.getAttribute("data-operations-machine-health")).toBe(
      "healthy"
    );
    expect(header?.getAttribute("class") ?? "").toMatch(/bg-green-500/);
  });

  it("renders the HEADER dot muted for a machine with NO runners", () => {
    const { container } = renderCard(baseGroup({ runners: [] }));
    const header = container.querySelector("[data-operations-machine-health]");
    expect(header?.getAttribute("data-operations-machine-health")).toBe(
      "empty"
    );
    expect(header?.getAttribute("class") ?? "").toMatch(/bg-muted-foreground/);
  });

  it("classifies runner health states", () => {
    expect(runnerHealthState(mockRunner())).toBe("healthy");
    expect(
      runnerHealthState({
        ...mockRunner(),
        derivedStatus: "offline",
      } as unknown as Runner)
    ).toBe("unhealthy");
    expect(
      runnerHealthState({
        ...mockRunner(),
        lastHeartbeat: null,
        derivedStatus: "offline",
      } as unknown as Runner)
    ).toBe("unknown");
    expect(
      runnerHealthState({
        ...mockRunner(),
        derivedStatus: "unknown",
      } as unknown as Runner)
    ).toBe("unknown");
  });
});

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MachineCard } from "./MachineCard";
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
    expect(container.querySelector("[data-operations-machine-card]")).not.toBeNull();
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

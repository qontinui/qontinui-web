import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MachineCard } from "./MachineCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { MachineGroup, SymbolClaim } from "./types";
import type { Runner } from "@qontinui/shared-types";

/**
 * Phase 4.4 — `currentlyEditing` sub-line render tests.
 *
 * Smoke-tests the new sub-line without rebuilding the whole runner +
 * Claude-session tile (those are covered by the Phase 1.3 tests
 * elsewhere). Asserts on the stable `data-operations-currently-editing*`
 * dataset attributes the sub-line emits — the visual styling is free
 * to evolve.
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

function baseGroup(
  overrides: Partial<MachineGroup> = {},
): MachineGroup {
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
    </TooltipProvider>,
  );
}

describe("MachineCard — Phase 4.4 currentlyEditing sub-line", () => {
  it("renders nothing when currentlyEditing is undefined", () => {
    renderCard(baseGroup());
    expect(
      document.querySelector("[data-operations-currently-editing]"),
    ).toBeNull();
  });

  it("renders nothing when currentlyEditing is an empty list", () => {
    renderCard(baseGroup({ currentlyEditing: [] }));
    expect(
      document.querySelector("[data-operations-currently-editing]"),
    ).toBeNull();
  });

  it("renders 'Editing: foo, bar' for a small claim list", () => {
    renderCard(
      baseGroup({
        currentlyEditing: [
          symbolClaim("repo:src/main.rs:foo", 290),
          symbolClaim("repo:src/lib.rs:bar", 280),
        ],
      }),
    );
    const line = document.querySelector(
      "[data-operations-currently-editing-line]",
    );
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain("Editing:");
    expect(line!.textContent).toContain("foo");
    expect(line!.textContent).toContain("bar");
  });

  it("appends '+N more' when more than 5 claims are held", () => {
    const claims: SymbolClaim[] = Array.from({ length: 7 }, (_, i) =>
      symbolClaim(`repo:src/file${i}.rs:sym${i}`, 200 - i),
    );
    renderCard(baseGroup({ currentlyEditing: claims }));
    const line = document.querySelector(
      "[data-operations-currently-editing-line]",
    );
    expect(line).not.toBeNull();
    // 7 claims, top-5 rendered, 2 in overflow.
    expect(line!.textContent).toContain("+2 more");
    // Stamps the total count for telemetry / UI-Bridge assertions.
    const wrapper = document.querySelector(
      "[data-operations-currently-editing]",
    );
    expect(wrapper?.getAttribute("data-claim-count")).toBe("7");
  });

  it("renders the truncated symbol when the name exceeds 30 chars", () => {
    const longName = "very_long_symbol_name_indeed_x_y_z";
    renderCard(
      baseGroup({
        currentlyEditing: [symbolClaim(`repo:src/x.rs:${longName}`, 200)],
      }),
    );
    const line = document.querySelector(
      "[data-operations-currently-editing-line]",
    );
    expect(line).not.toBeNull();
    // The full string isn't present; the truncated form ends in U+2026.
    expect(line!.textContent).toContain("…");
    expect(line!.textContent).not.toContain(longName);
  });

  it("sub-line coexists with the Phase 1.3 currentActivity tile", () => {
    renderCard(
      baseGroup({
        currentActivity: {
          device_id: "00000000-0000-0000-0000-000000000001",
          hostname: "test-host",
          current_task: "phase 4.4 implementation",
          current_repo: "qontinui-web",
          current_branch: "main",
          free_text: null,
          details: {},
          tenant_id: null,
          updated_at: new Date().toISOString(),
        },
        currentlyEditing: [symbolClaim("repo:src/main.rs:run", 270)],
      }),
    );
    expect(
      document.querySelector("[data-operations-current-activity]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-operations-currently-editing]"),
    ).not.toBeNull();
  });
});

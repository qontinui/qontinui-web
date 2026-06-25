import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DeviceStatusTile } from "./DeviceStatusTile";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DeviceStatus, StalledSession } from "./types";
import type { UseDeviceStatusStreamResult } from "./useDeviceStatusStream";

/**
 * Phase 5 (plan `2026-06-24-coord-session-progress-and-stall-detection`) —
 * the device tile surfaces a stalled badge + age when coord's enriched
 * device-status payload reports a stalled session, with a distinct
 * "dispatched, never started" indicator for expected-unstarted continuations.
 */

const STALL_SELECTOR = "[data-ui-bridge-id='operations.device-status-stalled']";

function baseRow(overrides: Partial<DeviceStatus> = {}): DeviceStatus {
  return {
    device_id: "00000000-0000-0000-0000-000000000001",
    hostname: "test-host",
    current_task: "finish deploy",
    current_repo: "qontinui-coord",
    current_branch: "main",
    free_text: null,
    details: {},
    tenant_id: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockStream(rows: DeviceStatus[]): UseDeviceStatusStreamResult {
  const byHostname = new Map<string, DeviceStatus>();
  for (const r of rows) byHostname.set(r.hostname ?? r.device_id, r);
  return {
    byHostname,
    connected: true,
    error: null,
    seeded: true,
    refetch: async () => {},
  } as unknown as UseDeviceStatusStreamResult;
}

function renderTile(rows: DeviceStatus[]) {
  return render(
    <TooltipProvider>
      <DeviceStatusTile stream={mockStream(rows)} />
    </TooltipProvider>,
  );
}

describe("DeviceStatusTile stalled badge", () => {
  it("renders no stalled badge for a healthy device", () => {
    const { container } = renderTile([
      baseRow({ stalled_session_count: 0, most_stalled_session: null }),
    ]);
    expect(container.querySelector(STALL_SELECTOR)).toBeNull();
  });

  it("renders an amber 'stalled <age>' badge for an active stall", () => {
    const stall: StalledSession = {
      session_id: "00000000-0000-0000-0000-0000000000aa",
      device_id: "00000000-0000-0000-0000-000000000001",
      kind: "stalled",
      state: "active",
      session_status: "stalled",
      stall_age_secs: 720,
      last_progress_at: new Date().toISOString(),
      correlation_topic: "plan-42",
    };
    const { container } = renderTile([
      baseRow({ stalled_session_count: 1, most_stalled_session: stall }),
    ]);
    const badge = container.querySelector(STALL_SELECTOR);
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-stall-kind")).toBe("stalled");
    // 720s → "12m"; the active-stall label is "stalled <age>".
    expect(badge?.textContent).toContain("stalled 12m");
  });

  it("renders a 'never started' indicator for an expected-unstarted continuation", () => {
    const stall: StalledSession = {
      session_id: "00000000-0000-0000-0000-0000000000bb",
      device_id: "00000000-0000-0000-0000-000000000001",
      kind: "expected_unstarted",
      state: "expected",
      session_status: "stalled",
      stall_age_secs: 1800,
      expected_at: new Date().toISOString(),
      continuation_gate_id: "fec1da6e",
      plan_slug: "coord-workunit-authz-graduated-trust",
    };
    const { container } = renderTile([
      baseRow({ stalled_session_count: 2, most_stalled_session: stall }),
    ]);
    const badge = container.querySelector(STALL_SELECTOR);
    expect(badge?.getAttribute("data-stall-kind")).toBe("expected_unstarted");
    // 1800s → "30m"; the distinct dispatched-but-never-started label.
    expect(badge?.textContent).toContain("never started 30m");
    // count=2 ⇒ a "+1" suffix for the other stalled session on the device.
    expect(badge?.textContent).toContain("+1");
  });
});

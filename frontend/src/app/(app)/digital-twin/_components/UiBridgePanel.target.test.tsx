/**
 * The UI Bridge tab reads WHICH runner from the resolved target, not from the
 * web list's `activeRunner` (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3).
 *
 * Coord may resolve a device the web list has filtered out (or not caught up
 * with). It is still a real runner — reachable over the relay by its device
 * id — so the panel must query it rather than render "no runner".
 */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";

const UNLISTED = "99999999-9999-4999-8999-999999999999";

const state = vi.hoisted(() => ({
  target: { kind: "pending" } as RunnerTarget,
  deviceIds: [] as Array<string | null>,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useRunnerTarget: () => state.target,
  // The list knows no runner: `activeRunner` is null.
  useActiveRunner: () => ({ activeRunner: null, runners: [] }),
}));

vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));

vi.mock("../_hooks/useUiBridge", () => {
  const idle = {
    data: undefined,
    isError: false,
    isLoading: false,
    error: null,
  };
  return {
    useRunnerSpecList: (deviceId: string | null) => {
      state.deviceIds.push(deviceId);
      return idle;
    },
    useRunnerSpecGraph: () => idle,
    useRunnerSnapshot: () => idle,
  };
});

import { UiBridgePanel } from "./UiBridgePanel";

describe("UiBridgePanel runner", () => {
  it("queries a coord-resolved device the web list does not carry", () => {
    state.target = {
      kind: "runner",
      runner: { id: UNLISTED },
      locality: "unknown",
    };
    state.deviceIds = [];
    render(<UiBridgePanel />);
    expect(state.deviceIds.at(-1)).toBe(UNLISTED);
  });

  it("queries nothing when the target addresses no runner", () => {
    state.target = { kind: "unavailable", reason: "resolver_unavailable" };
    state.deviceIds = [];
    render(<UiBridgePanel />);
    expect(state.deviceIds.at(-1)).toBeNull();
  });
});

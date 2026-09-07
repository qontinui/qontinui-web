import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunnerOfflineState } from "./RunnerOfflineState";

// The origin gate is the whole subject of these tests; stub it rather than
// mutating window.location, which jsdom makes awkward and which would couple
// the test to the gate's internals instead of its contract.
vi.mock("@/lib/ui-bridge/discovered-specs", () => ({
  isRunnerReachable: vi.fn(),
}));
import { isRunnerReachable } from "@/lib/ui-bridge/discovered-specs";
const reachable = vi.mocked(isRunnerReachable);

describe("RunnerOfflineState", () => {
  beforeEach(() => reachable.mockReset());

  it("on a LOCAL origin, keeps the actionable start-the-runner copy", async () => {
    reachable.mockReturnValue(true);
    render(<RunnerOfflineState />);
    expect(await screen.findByText("Runner Not Connected")).toBeTruthy();
    expect(screen.getByText(/Start the Qontinui Runner desktop app/)).toBeTruthy();
  });

  it("on a LOCAL origin, still honours a caller's task-specific message", async () => {
    reachable.mockReturnValue(true);
    render(<RunnerOfflineState message="Start the runner to configure log sources." />);
    expect(
      await screen.findByText("Start the runner to configure log sources."),
    ).toBeTruthy();
  });

  it("on a PUBLIC origin, never tells the user to start a runner", async () => {
    reachable.mockReturnValue(false);
    render(<RunnerOfflineState />);
    expect(
      await screen.findByText("Runner Not Reachable From This Page"),
    ).toBeTruthy();
    // The regression: a live runner + this advice is an instruction that
    // cannot succeed.
    expect(screen.queryByText(/Start the Qontinui Runner desktop app/)).toBeNull();
  });

  it("on a PUBLIC origin, overrides a caller's message rather than half-fixing it", async () => {
    reachable.mockReturnValue(false);
    render(<RunnerOfflineState message="Start the runner to configure log sources." />);
    expect(
      await screen.findByText("Runner Not Reachable From This Page"),
    ).toBeTruthy();
    expect(screen.queryByText(/configure log sources/)).toBeNull();
  });
});

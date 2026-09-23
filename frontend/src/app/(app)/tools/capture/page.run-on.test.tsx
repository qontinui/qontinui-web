/**
 * Starting a recording is NEW, MACHINE-BOUND work (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 4): it
 * records one machine's screen, mouse and keyboard, so the page asks for the
 * machine-bound target and carries the Run-on picker for it. A refusal
 * disables Start and is shown. A STARTED recording keeps a handle to the
 * device it started on: status polling and Stop go there, whatever the
 * new-work or read target does meanwhile.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";

const DESK = "11111111-1111-4111-8111-111111111111";
const LAPTOP = "22222222-2222-4222-8222-222222222222";

const on = (id: string): RunnerTarget => ({
  kind: "runner",
  runner: { id },
  locality: "unknown",
});

const state = vi.hoisted(() => ({
  readOffline: false,
  statusFails: false,
  options: [] as unknown[],
  dispatch: null as unknown,
  read: null as unknown,
  calls: [] as Array<{ call: string; runner: string | null }>,
  poll: null as null | {
    target: RunnerTarget;
    enabled: boolean;
    tick: () => Promise<unknown>;
  },
}));

function setDispatch(target: RunnerTarget, refusal: string | null = null) {
  state.dispatch = {
    target,
    runnerId: target.kind === "runner" ? target.runner.id : null,
    refusal: refusal ? { reason: "pin_ineligible", message: refusal } : null,
    notice: null,
  };
}

vi.mock("@/contexts/active-runner-context", () => ({
  useDispatchRunnerTarget: (options: unknown) => {
    state.options.push(options);
    return state.dispatch;
  },
}));
vi.mock("@/lib/runner-api", () => {
  const idOf = (t: RunnerTarget) => (t.kind === "runner" ? t.runner.id : null);
  return {
    useRunnerHealth: () => ({ isOffline: state.readOffline, isLoading: false }),
    createRunnerApi: (target: RunnerTarget) => ({
      startInteractionRecording: async () => {
        state.calls.push({ call: "start", runner: idOf(target) });
        return { session_id: "s1" };
      },
      getInteractionRecordingStatus: async () => {
        state.calls.push({ call: "status", runner: idOf(target) });
        if (state.statusFails) throw new Error("unreachable");
        return { duration: 3, events_count: 2, is_recording: true };
      },
      stopInteractionRecording: async () => {
        state.calls.push({ call: "stop", runner: idOf(target) });
        return { duration: 3, events_count: 2, status: "stopped" };
      },
    }),
    useRunnerTarget: () => state.read,
    useRunnerPoll: (
      target: RunnerTarget,
      options: {
        enabled: boolean;
        tick: () => Promise<unknown>;
        onError?: (e: unknown) => void;
      }
    ) => {
      state.poll = {
        target,
        enabled: options.enabled,
        tick: () => options.tick().catch((e) => options.onError?.(e)),
      };
    },
    runnerPollInterval: () => 1000,
  };
});
vi.mock("@/components/runner/RunOnPicker", () => ({
  RunOnPicker: ({ workClass }: { workClass: string }) => (
    <div data-testid="run-on-picker" data-work-class={workClass} />
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import CapturePage from "./page";

beforeEach(() => {
  state.readOffline = false;
  state.statusFails = false;
  state.options = [];
  state.calls = [];
  state.poll = null;
  state.read = on(DESK);
  setDispatch(on(DESK));
});

describe("Capture page places recordings as machine-bound work", () => {
  it("asks for the machine-bound target and shows the Run-on picker for it", () => {
    render(<CapturePage />);
    expect(state.options).toContainEqual({ workClass: "machine_bound" });
    expect(state.options).not.toContainEqual(undefined);
    expect(screen.getByTestId("run-on-picker")).toHaveAttribute(
      "data-work-class",
      "machine_bound"
    );
  });

  it("a refused pick disables Start and says why", () => {
    setDispatch(
      { kind: "unavailable", reason: "no_eligible_runner" },
      "Your pick Laptop can't run this: it is offline."
    );
    render(<CapturePage />);
    const start = screen.getByRole("button", { name: /Start Recording/ });
    expect(start).toBeDisabled();
    expect(screen.getByTestId("capture-start-refusal")).toHaveTextContent(
      /can't run this: it is offline/
    );
    fireEvent.click(start);
    expect(state.calls).toEqual([]);
  });

  it("a started recording keeps its device: after the pick moves, status and Stop still go to it", async () => {
    const { rerender } = render(<CapturePage />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start Recording/ }));
    });
    expect(state.calls).toEqual([{ call: "start", runner: DESK }]);

    // Mid-recording, the pick is released: new work AND reads move to LAPTOP.
    setDispatch(on(LAPTOP));
    state.read = on(LAPTOP);
    rerender(<CapturePage />);

    expect(state.poll!.enabled).toBe(true);
    expect(state.poll!.target).toMatchObject({ runner: { id: DESK } });
    await act(async () => {
      await state.poll!.tick();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
    });
    expect(state.calls.slice(1)).toEqual([
      { call: "status", runner: DESK },
      { call: "stop", runner: DESK },
    ]);
  });

  it("while recording, the offline banner reports the RECORDING device, not the read target", async () => {
    const { rerender } = render(<CapturePage />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start Recording/ }));
    });
    // The read target goes offline; the recording device still answers.
    state.read = on(LAPTOP);
    state.readOffline = true;
    rerender(<CapturePage />);
    await act(async () => {
      await state.poll!.tick();
    });
    expect(screen.queryByText(/Runner offline/)).not.toBeInTheDocument();
    expect(screen.queryByText(/not answering/)).not.toBeInTheDocument();

    // The recording device stops answering: that is what is reported.
    state.statusFails = true;
    await act(async () => {
      await state.poll!.tick();
    });
    expect(
      screen.getByText(/The runner recording this capture is not answering/)
    ).toBeInTheDocument();
  });

  it("not recording: the banner follows the read target's health", () => {
    state.readOffline = true;
    render(<CapturePage />);
    expect(screen.getByText(/Runner offline/)).toBeInTheDocument();
  });
});

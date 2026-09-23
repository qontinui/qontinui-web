/**
 * The sidebar's runner line is STATUS ONLY (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 4): the
 * measured state of the runner reads address, plus the resolver's state. The
 * picker lives on the execution surfaces ("Run on:"), never here.
 *
 * Its dot reports MEASURED locality, never `port != null` (Phase 1): a runner
 * on another machine is exactly the case where a listed port is unreachable.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RunnerPin } from "@/contexts/active-runner-context";
import type { RunnerLocality } from "@/lib/runner/locality";
import type { ResolvedRunnerState } from "@/lib/runner/resolve";
import { RunnerStatusLine } from "./RunnerStatusLine";

const DESK = { id: "r1", name: "Desk runner", port: 9876 };
const LAPTOP = { id: "r2", name: "Laptop runner", port: 9876 };

const ctx = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  selectRunner: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useActiveRunner: () => ctx.value,
}));

function setContext(
  active: typeof DESK | null,
  runners: (typeof DESK)[],
  localities: [string, RunnerLocality][],
  listState: "loading" | "failed" | "loaded" = "loaded",
  resolver: {
    pin?: RunnerPin | null;
    resolution?: ResolvedRunnerState;
  } = {}
) {
  ctx.selectRunner = vi.fn();
  ctx.value = {
    activeRunner: active,
    runners,
    selectRunner: ctx.selectRunner,
    pin: resolver.pin ?? null,
    isMultiRunner: runners.length > 1,
    listState,
    localityById: new Map(localities),
    selection: resolver.pin ? "explicit" : "auto",
    resolution: resolver.resolution ?? {
      status: "resolved",
      deviceId: active?.id ?? "r1",
      via: "pool",
      pinReleased: null,
    },
  };
}

const RESOLVER_DOWN: ResolvedRunnerState = {
  status: "unavailable",
  reason: "not_deployed",
  httpStatus: 404,
  code: null,
};

function renderLine(isCollapsed = false) {
  return render(
    <TooltipProvider>
      <RunnerStatusLine isCollapsed={isCollapsed} />
    </TooltipProvider>
  );
}

describe("RunnerStatusLine is status only", () => {
  it.each([false, true])(
    "offers no control to change the runner, even with several (collapsed=%s)",
    (isCollapsed) => {
      setContext(DESK, [DESK, LAPTOP], [[DESK.id, "local"]]);
      renderLine(isCollapsed);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(ctx.selectRunner).not.toHaveBeenCalled();
    }
  );

  it("names the runner reads address with its measured locality", () => {
    setContext(DESK, [DESK, LAPTOP], [[DESK.id, "local"]]);
    renderLine();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Runner: Desk runner · on this machine"
    );
  });

  it("the collapsed rail carries the same status as text inside its live region", () => {
    setContext(LAPTOP, [DESK, LAPTOP], [[LAPTOP.id, "not_local"]], "loaded", {
      resolution: RESOLVER_DOWN,
    });
    renderLine(true);
    const status = screen.getByRole("status");
    // Content of the live region (announced on change), not only a label.
    expect(status).not.toHaveAttribute("aria-label");
    expect(status.querySelector(".sr-only")).toHaveTextContent(
      "Runner: Laptop runner · on another machine. Resolver unavailable — showing Laptop runner's data"
    );
  });
});

describe("RunnerStatusLine measured state", () => {
  it("a runner on another machine is not shown as reachable, although it has a port", () => {
    setContext(LAPTOP, [LAPTOP], [[LAPTOP.id, "not_local"]]);
    renderLine();
    expect(
      screen.getByRole("img", {
        name: "On another machine — not reachable from this browser",
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "On this machine" })
    ).not.toBeInTheDocument();
  });

  it("an unmeasured runner reads as unknown, never as local", () => {
    setContext(DESK, [DESK], []);
    renderLine();
    expect(
      screen.getByRole("img", { name: "Not confirmed on this machine yet" })
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "not confirmed on this machine"
    );
  });

  it("a FAILED runner-list load reads as unavailable, not as 'No runner'", () => {
    setContext(null, [], [], "failed");
    renderLine();
    expect(screen.getByText("Runner list unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/No runner/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Runner list unavailable — it could not be loaded",
      })
    ).toBeInTheDocument();
  });

  it("a runner list still loading reads as loading, not as 'No runner'", () => {
    setContext(null, [], [], "loading");
    renderLine();
    expect(screen.getByText("Loading runners")).toBeInTheDocument();
    expect(screen.queryByText(/No runner/)).not.toBeInTheDocument();
  });

  it("a loaded, empty list reads as 'No runner paired'", () => {
    setContext(null, [], [], "loaded");
    renderLine();
    expect(screen.getByText("No runner paired")).toBeInTheDocument();
  });
});

describe("RunnerStatusLine resolver state", () => {
  it("coord UNKNOWN: says whose data reads show, not a fresh pick", () => {
    setContext(DESK, [DESK, LAPTOP], [[DESK.id, "local"]], "loaded", {
      resolution: RESOLVER_DOWN,
    });
    renderLine();
    expect(
      screen.getByText("Resolver unavailable — showing Desk runner's data")
    ).toBeInTheDocument();
  });

  it("coord UNKNOWN with the user's pick on screen: says it is the pick", () => {
    setContext(DESK, [DESK, LAPTOP], [[DESK.id, "local"]], "loaded", {
      pin: { id: DESK.id, name: DESK.name },
      resolution: RESOLVER_DOWN,
    });
    renderLine();
    expect(
      screen.getByText("Resolver unavailable — using your pick")
    ).toBeInTheDocument();
  });

  it("coord UNKNOWN with no runner to keep: 'Runner unknown', naming none", () => {
    setContext(null, [DESK, LAPTOP], [], "loaded", {
      resolution: RESOLVER_DOWN,
    });
    renderLine();
    expect(screen.getByText("Runner unknown")).toBeInTheDocument();
    expect(screen.getByText("Resolver unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Desk runner/)).not.toBeInTheDocument();
  });

  it("coord's 'nothing eligible' keeps the runner for reads and says so", () => {
    setContext(DESK, [DESK, LAPTOP], [[DESK.id, "local"]], "loaded", {
      resolution: { status: "all_drained", pinReleased: null },
    });
    renderLine();
    expect(
      screen.getByText("Not eligible for new work — showing its data")
    ).toBeInTheDocument();
  });

  it("coord moved off the user's pick: says so", () => {
    setContext(DESK, [DESK, LAPTOP], [[DESK.id, "local"]], "loaded", {
      pin: { id: LAPTOP.id, name: LAPTOP.name },
      resolution: {
        status: "resolved",
        deviceId: DESK.id,
        via: "pool",
        pinReleased: { reason: "offline", detail: null },
      },
    });
    renderLine();
    expect(
      screen.getByText("Your pick is unavailable — coord chose this runner")
    ).toBeInTheDocument();
  });

  it("coord honouring the pick: no notice", () => {
    setContext(DESK, [DESK, LAPTOP], [[DESK.id, "local"]], "loaded", {
      pin: { id: DESK.id, name: DESK.name },
      resolution: {
        status: "resolved",
        deviceId: DESK.id,
        via: "pin",
        pinReleased: null,
      },
    });
    renderLine();
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Runner: Desk runner · on this machine$/
    );
  });
});

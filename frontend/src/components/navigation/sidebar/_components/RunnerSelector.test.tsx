/**
 * The runner selector's dots report MEASURED locality, never `port != null`
 * (plan 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 1).
 *
 * BUG: both the trigger dot and each item's dot rendered "connected" for any
 * runner with a port — including a runner on another machine, which is exactly
 * the case where every runner call from this browser fails or reaches the
 * wrong box.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RunnerLocality } from "@/lib/runner/locality";
import { RunnerSelector } from "./RunnerSelector";

const DESK = { id: "r1", name: "Desk runner", port: 9876 };
const LAPTOP = { id: "r2", name: "Laptop runner", port: 9876 };
const SPARE = { id: "r3", name: "Spare runner", port: 9877 };

const ctx = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useActiveRunner: () => ctx.value,
}));

function setContext(
  active: typeof DESK | null,
  runners: (typeof DESK)[],
  localities: [string, RunnerLocality][],
  listState: "loading" | "failed" | "loaded" = "loaded"
) {
  ctx.value = {
    activeRunner: active,
    runners,
    selectRunner: vi.fn(),
    isMultiRunner: runners.length > 1,
    listState,
    localityById: new Map(localities),
  };
}

function renderSelector(isCollapsed = false) {
  return render(
    <TooltipProvider>
      <RunnerSelector isCollapsed={isCollapsed} />
    </TooltipProvider>
  );
}

describe("RunnerSelector status dots", () => {
  it("a runner on another machine is not shown as reachable, although it has a port", () => {
    setContext(LAPTOP, [LAPTOP], [[LAPTOP.id, "not_local"]]);
    renderSelector();
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
    renderSelector();
    expect(
      screen.getByRole("img", { name: "Not confirmed on this machine yet" })
    ).toBeInTheDocument();
  });

  it("a FAILED runner-list load reads as unavailable, not as 'No runner'", () => {
    setContext(null, [], [], "failed");
    renderSelector();
    expect(screen.getByText("Runner list unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No runner")).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Runner list unavailable — it could not be loaded",
      })
    ).toBeInTheDocument();
  });

  it("a runner list still loading reads as loading, not as 'No runner'", () => {
    setContext(null, [], [], "loading");
    renderSelector();
    expect(screen.getByText("Loading runners")).toBeInTheDocument();
    expect(screen.queryByText("No runner")).not.toBeInTheDocument();
  });

  it("a loaded, empty list reads as 'No runner'", () => {
    setContext(null, [], [], "loaded");
    renderSelector();
    expect(screen.getByText("No runner")).toBeInTheDocument();
  });

  it("a runner proven local reads as on this machine", () => {
    setContext(DESK, [DESK], [[DESK.id, "local"]]);
    renderSelector();
    expect(
      screen.getByRole("img", { name: "On this machine" })
    ).toBeInTheDocument();
  });

  it("the trigger dot follows the ACTIVE runner, and each item dot its own runner", async () => {
    // The active runner is remote while another listed runner is local: the
    // old `runners.some(port != null)` trigger rendered "connected" here.
    setContext(
      LAPTOP,
      [DESK, LAPTOP, SPARE],
      [
        [DESK.id, "local"],
        [LAPTOP.id, "not_local"],
      ]
    );
    renderSelector();

    const trigger = screen.getByRole("button", { name: /Laptop runner/ });
    expect(
      trigger.querySelector('[aria-label^="On another machine"]')
    ).not.toBeNull();

    await userEvent.setup().click(trigger);
    const items = await screen.findAllByRole("menuitem");
    const dotOf = (name: string) =>
      items
        .find((item) => item.textContent?.includes(name))
        ?.querySelector('[role="img"]')
        ?.getAttribute("aria-label");

    expect(dotOf("Desk runner")).toBe("On this machine");
    expect(dotOf("Laptop runner")).toBe(
      "On another machine — not reachable from this browser"
    );
    expect(dotOf("Spare runner")).toBe("Not confirmed on this machine yet");
  });
});

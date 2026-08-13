/**
 * CiStatusPanel — "Notify when green" arm-outcome reporting.
 *
 * Follow-up to plan `2026-08-03-gate-class-producers-and-clearance-rules-inert`
 * Phase 3. P3 stopped the backend from swallowing `gate_class` and declared
 * `warnings` on the response so coord's signal stayed reachable — but nothing
 * downstream read it, and the panel reported every 200 as a successfully armed
 * gate.
 *
 * The load-bearing contract here is that a 200 is NOT success on its own.
 * coord evaluates the CiGreen predicate once at registration and reports
 * `initial_verdict`; only `open` means "armed, waiting". `cleared` means the
 * repo was already green (no notification is coming) and `failed` /
 * `misconfigured` mean the gate will never fire. An unrecognized or absent
 * verdict must read as unknown, never as success.
 *
 * `useCiStatusStream` and `httpClient` are stubbed so the render is isolated
 * to the panel itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
const useCiStatusStreamMock = vi.fn();
vi.mock("./useCiStatusStream", () => ({
  useCiStatusStream: (...args: unknown[]) => useCiStatusStreamMock(...args),
}));

import { CiStatusPanel } from "./CiStatusPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RepoCiRow } from "./types";

const GATE_ID = "77777777-7777-7777-7777-777777777777";

function ciRow(overrides: Partial<RepoCiRow> = {}): RepoCiRow {
  return {
    repo: "qontinui/qontinui-web",
    // Not green, so the "Notify when green" action is enabled.
    main_verdict: "red",
    open_pr_checks: { success: 0, failure: 0, pending: 0 },
    latest_details_url: null,
    main_head_sha: "abc123",
    ...overrides,
  };
}

/** Render the panel with one repo row and coord's register response stubbed. */
function renderWithCoordResponse(body: Record<string, unknown>) {
  useCiStatusStreamMock.mockReturnValue({
    byRepo: new Map([["qontinui/qontinui-web", ciRow()]]),
    connected: true,
    error: null,
  });
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  // The app mounts a TooltipProvider higher up; supply one here so the
  // panel's tooltips (including the arm-outcome detail) can render.
  return render(
    <TooltipProvider>
      <CiStatusPanel />
    </TooltipProvider>
  );
}

async function clickNotify(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(
    "[data-action='notify-when-green']"
  );
  expect(button).not.toBeNull();
  await userEvent.click(button!);
  await waitFor(() =>
    expect(container.querySelector("[data-arm-tone]")).not.toBeNull()
  );
  return container.querySelector("[data-arm-tone]")!;
}

describe("CiStatusPanel notify-when-green arm outcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports an `open` verdict as armed", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: [],
      initial_verdict: "open",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("armed");
    expect(chip.textContent).toContain("gate armed");
    expect(chip.getAttribute("data-gate-id")).toBe(GATE_ID);
  });

  it("does NOT report `cleared` as armed — the repo was already green", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: [],
      initial_verdict: "cleared",
      initial_verdict_reason: "main is green at abc123",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("cleared");
    expect(chip.textContent).toContain("already green");
    expect(chip.textContent).not.toContain("gate armed");
  });

  it("does NOT report `misconfigured` as armed — the gate will never fire", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: ["initial evaluation could not be completed"],
      initial_verdict: "misconfigured",
      initial_verdict_reason: "repo qontinui/qontinui-web not found",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("dead");
    expect(chip.textContent).toContain("will not fire");
  });

  it("treats `failed` as a gate that will never fire", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: [],
      initial_verdict: "failed",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("dead");
  });

  it("treats an ABSENT verdict as unknown, never as armed", async () => {
    // A coord that reports no verdict. Claiming "armed" on absent evidence is
    // the false-success this reporting exists to close.
    const { container } = renderWithCoordResponse({ gate_id: GATE_ID });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("unknown");
    expect(chip.textContent).not.toContain("gate armed");
  });

  it("treats an UNRECOGNIZED verdict as unknown, never as armed", async () => {
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      initial_verdict: "some-future-coord-verdict",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("unknown");
    expect(chip.textContent).not.toContain("gate armed");
  });

  it("surfaces coord's warnings on an otherwise-armed gate", async () => {
    // `warnings` already carries coord's `steer` string when one applies, so
    // this is also the steer path.
    const steer = "this repo's PRs are orchestrated; prefer the merge train";
    const { container } = renderWithCoordResponse({
      gate_id: GATE_ID,
      warnings: [steer],
      initial_verdict: "open",
    });
    const chip = await clickNotify(container);
    expect(chip.getAttribute("data-arm-tone")).toBe("armed");
    // The warning rides the tooltip, which mounts on hover.
    await userEvent.hover(chip);
    await waitFor(() => expect(screen.getAllByText(steer).length).toBeGreaterThan(0));
  });
});

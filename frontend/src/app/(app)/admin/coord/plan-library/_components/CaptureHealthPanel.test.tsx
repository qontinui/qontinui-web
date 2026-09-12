/**
 * CaptureHealthPanel — the re-read it carries.
 *
 * `useCaptureHealth` returned a `reload` that nothing called: the panel could
 * be re-asked only by reloading the whole page, while `Scan sources` beside it
 * — the other half of the same question — carried its own Refresh. These pin
 * the wiring, and that a click cannot issue a second read while the first is
 * still out.
 *
 * The hook is mocked. What a reload does to the data (keeping the last counts
 * on a failure, and not letting a late response overwrite a newer one) is a
 * property of `useCaptureHealth`, covered in `../_hooks/usePlanLibrary.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useCaptureHealthMock = vi.fn();
vi.mock("../_hooks/usePlanLibrary", () => ({
  useCaptureHealth: () => useCaptureHealthMock(),
}));

import { CaptureHealthPanel } from "./CaptureHealthPanel";
import type { CaptureHealthResponse } from "../types";

const HEALTH: CaptureHealthResponse = {
  total: 3,
  doors: [
    {
      captured_by: "runner_scan",
      count: 3,
      known: true,
      first_at: "2026-09-01T00:00:00Z",
      last_touched_at: "2026-09-12T00:00:00Z",
    },
  ],
};

function hookState(overrides: Record<string, unknown> = {}) {
  return {
    data: HEALTH,
    loading: false,
    error: null,
    reload: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  useCaptureHealthMock.mockReset();
});

describe("CaptureHealthPanel — Refresh", () => {
  it("re-reads through the hook's reload", () => {
    const reload = vi.fn();
    useCaptureHealthMock.mockReturnValue(hookState({ reload }));
    render(<CaptureHealthPanel />);

    screen.getByTestId("capture-health-refresh").click();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("is disabled while a read is in flight", () => {
    useCaptureHealthMock.mockReturnValue(hookState({ loading: true }));
    render(<CaptureHealthPanel />);

    expect(
      screen.getByTestId("capture-health-refresh").hasAttribute("disabled")
    ).toBe(true);
  });

  it("MUTATION: and enabled once it has landed", () => {
    useCaptureHealthMock.mockReturnValue(hookState({ loading: false }));
    render(<CaptureHealthPanel />);

    expect(
      screen.getByTestId("capture-health-refresh").hasAttribute("disabled")
    ).toBe(false);
  });

  it("is offered after a failed first read too — that is when it is needed", () => {
    const reload = vi.fn();
    useCaptureHealthMock.mockReturnValue(
      hookState({ data: null, error: "backend down", reload })
    );
    render(<CaptureHealthPanel />);

    expect(screen.getByTestId("capture-health-error").textContent).toContain(
      "unknown, not zero"
    );
    screen.getByTestId("capture-health-refresh").click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

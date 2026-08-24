/**
 * Component test for /admin/coord/gate-clearance — the failed-read arm only.
 *
 * The page already refused to render the effective-authority matrix from a
 * failed read (an empty rule set would state a confident, wrong authority for
 * every gate class). What it could not do was RECOVER: the panel told the
 * operator to reload, while the hook's `reload` — the in-place refetch — was
 * returned by `useGateClearanceRules` and called by nobody. A browser reload
 * re-mounts the whole console to retry one side-fetch.
 *
 * Only the Retry case pins NEW behaviour. The panel-vs-matrix split predates
 * this file and passes against the old code — it is kept as a regression pin
 * on the arm that must not change, and is labelled so rather than dressed up
 * as a fix.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const hooks = vi.hoisted(() => ({
  reload: vi.fn(),
  loadFailed: true,
}));

// The write controls are `CoordAdminOnly`-gated, which reads the auth context.
// Admin here so the success arm renders its full body — this file is about the
// failed-read arm, and the gate itself is pinned where it is exercised.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("./_hooks/useGateClearanceRules", () => ({
  useGateClearanceRules: () => ({
    rules: [],
    loading: false,
    saving: false,
    loadFailed: hooks.loadFailed,
    reload: hooks.reload,
    create: vi.fn(),
    patchRule: vi.fn(),
    deleteRule: vi.fn(),
    replaceRule: vi.fn(),
  }),
}));

import GateClearancePage from "./page";

beforeEach(() => {
  hooks.reload.mockReset();
  // `reload` is a promise by contract (`UseCoordPoliciesResult.reload`) and the
  // button chains `.finally` off it — a bare `vi.fn()` would mock away the very
  // shape under test.
  hooks.reload.mockResolvedValue(undefined);
  hooks.loadFailed = true;
});

describe("gate-clearance failed read", () => {
  it("renders the unknown-authority panel, not the matrix", () => {
    render(<GateClearancePage />);

    expect(screen.getByTestId("gate-clearance-load-failed")).toBeTruthy();
    expect(screen.queryAllByText("Effective authority")).toHaveLength(0);
  });

  it("retries in place instead of asking for a browser reload", () => {
    render(<GateClearancePage />);

    fireEvent.click(screen.getByTestId("gate-clearance-retry"));

    expect(hooks.reload).toHaveBeenCalledTimes(1);
  });

  it("holds the retry button while the refetch is in flight", async () => {
    let settle: () => void = () => {};
    hooks.reload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    );
    render(<GateClearancePage />);

    const button = screen.getByTestId("gate-clearance-retry");
    fireEvent.click(button);
    expect(button).toHaveProperty("disabled", true);

    // A second press must not start a second overlapping read.
    fireEvent.click(button);
    expect(hooks.reload).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle();
    });
    expect(screen.getByTestId("gate-clearance-retry")).toHaveProperty(
      "disabled",
      false
    );
  });

  it("announces the panel to assistive tech", () => {
    render(<GateClearancePage />);

    expect(screen.getByTestId("gate-clearance-load-failed")).toHaveProperty(
      "role",
      "alert"
    );
  });

  it("shows no panel once the read succeeds", () => {
    hooks.loadFailed = false;
    render(<GateClearancePage />);

    expect(screen.queryByTestId("gate-clearance-load-failed")).toBeNull();
    expect(screen.getAllByText("Effective authority").length).toBeGreaterThan(
      0
    );
  });
});

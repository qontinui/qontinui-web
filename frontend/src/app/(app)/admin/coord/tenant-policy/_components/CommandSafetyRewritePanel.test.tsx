/**
 * CommandSafetyRewritePanel — the states that must not collapse into on/off.
 *
 * The hook is mocked; its read/write honesty is covered in
 * `../_hooks/useCommandSafetyRewritePolicy.test.ts` and the shared
 * `useTenantFleetPolicyDial.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const usePolicyMock = vi.fn();
vi.mock("../_hooks/useCommandSafetyRewritePolicy", () => ({
  useCommandSafetyRewritePolicy: () => usePolicyMock(),
}));

import { CommandSafetyRewritePanel } from "./CommandSafetyRewritePanel";

function hookState(
  policy: Record<string, unknown> | null,
  overrides: Record<string, unknown> = {}
) {
  return {
    policy,
    loading: false,
    saving: false,
    error: null,
    readbackError: null,
    lastWrite: null,
    reload: vi.fn(),
    setLevel: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const ON_TENANT = {
  domain: "command_safety_rewrite",
  effective_level: "on",
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CommandSafetyRewritePanel", () => {
  it("says what it does, that off restores prompts, and when a change applies", () => {
    usePolicyMock.mockReturnValue(hookState(ON_TENANT));
    render(<CommandSafetyRewritePanel />);

    const text =
      screen.getByTestId("command-safety-rewrite-policy").textContent ?? "";
    expect(text).toMatch(
      /When Claude Code would stop to ask about a risky shell command, the agent is told how to rewrite it instead/
    );
    expect(text).toMatch(/Turning this off restores Claude Code.s prompts/);
    expect(text).toMatch(
      /applies to terminals and agent sessions started after it/
    );
  });

  it("shows the resolved level and writes the other one", () => {
    const state = hookState(ON_TENANT);
    usePolicyMock.mockReturnValue(state);
    render(<CommandSafetyRewritePanel />);

    expect(
      screen.getByTestId("command-safety-rewrite-effective").textContent
    ).toBe("on");
    expect(screen.getByTestId("command-safety-rewrite-scope").textContent).toBe(
      "tenant"
    );
    fireEvent.click(screen.getByTestId("command-safety-rewrite-off"));
    expect(state.setLevel).toHaveBeenCalledWith("off");
  });

  it("a fresh tenant (no row, resolving on) shows on with no-row copy", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, resolved_scope: "none" })
    );
    render(<CommandSafetyRewritePanel />);

    expect(
      screen.getByTestId("command-safety-rewrite-effective").textContent
    ).toBe("on");
    const copy = screen.getByTestId("command-safety-rewrite-no-row");
    expect(copy.querySelector("code")?.textContent).toBe("on");
    expect(copy.textContent).toMatch(/nobody chose this level/);
    expect(copy.textContent).not.toMatch(/runners themselves default/);
  });

  it("does not attribute a no-row `off` to coord — it may be the display floor", () => {
    usePolicyMock.mockReturnValue(
      hookState({
        ...ON_TENANT,
        effective_level: "off",
        resolved_scope: "none",
      })
    );
    render(<CommandSafetyRewritePanel />);

    const copy = screen.getByTestId("command-safety-rewrite-no-row");
    expect(copy.querySelector("code")?.textContent).toBe("off");
    expect(copy.textContent).not.toMatch(/coord reports as/);
    expect(copy.textContent).toMatch(/runners themselves default to on/);
  });

  it("explains that a system-band answer means a tenant write takes effect", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, resolved_scope: "system" })
    );
    render(<CommandSafetyRewritePanel />);

    expect(
      screen.getByTestId("command-safety-rewrite-system-fallback").textContent
    ).toMatch(/takes effect immediately/);
    expect(
      screen.queryByTestId("command-safety-rewrite-overridden-by-repo")
    ).toBeNull();
  });

  it("names the fleet_resources keys it does not show", () => {
    usePolicyMock.mockReturnValue(
      hookState({
        ...ON_TENANT,
        keys_not_shown: ["controls", "drain"],
        keys_not_shown_source: "fleet_resources_row",
      })
    );
    render(<CommandSafetyRewritePanel />);

    expect(
      screen.getByTestId("command-safety-rewrite-keys-not-shown").textContent
    ).toMatch(/controls, drain.*fleet_resources row/);
  });

  it("fills the badge for an unrecognised level, which runners read as on", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: "maybe" })
    );
    render(<CommandSafetyRewritePanel />);
    const filled = screen
      .getByTestId("command-safety-rewrite-effective")
      .getAttribute("class");
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: "on" })
    );
    const { getAllByTestId } = render(<CommandSafetyRewritePanel />);
    expect(
      getAllByTestId("command-safety-rewrite-effective")[1].getAttribute(
        "class"
      )
    ).toBe(filled);
  });

  it("does not render the no-row copy once a real band answers", () => {
    usePolicyMock.mockReturnValue(hookState(ON_TENANT));
    render(<CommandSafetyRewritePanel />);
    expect(screen.queryByTestId("command-safety-rewrite-no-row")).toBeNull();
  });

  it("warns when a repo-band row overrides the tenant row", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, resolved_scope: "repo" })
    );
    render(<CommandSafetyRewritePanel />);
    expect(
      screen.getByTestId("command-safety-rewrite-overridden-by-repo")
    ).toBeTruthy();
  });

  it("reports an unrecognised level as such, and how runners read it", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: "maybe" })
    );
    render(<CommandSafetyRewritePanel />);

    expect(
      screen.getByTestId("command-safety-rewrite-effective").textContent
    ).toBe("maybe");
    expect(
      screen.getByTestId("command-safety-rewrite-blurb").textContent
    ).toMatch(/neither on nor off.*treat .* as on/);
  });

  it("disables the write for a non-admin and says why", () => {
    usePolicyMock.mockReturnValue(hookState({ ...ON_TENANT, can_edit: false }));
    render(<CommandSafetyRewritePanel />);

    expect(
      (screen.getByTestId("command-safety-rewrite-off") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getByTestId("command-safety-rewrite-readonly").textContent
    ).toMatch(/not an admin/);
  });

  it("renders a failed read as unknown, never as off", () => {
    usePolicyMock.mockReturnValue(hookState(null, { error: "HTTP 502" }));
    render(<CommandSafetyRewritePanel />);

    expect(
      screen.getByTestId("command-safety-rewrite-effective").textContent
    ).toBe("unknown");
    expect(
      screen.getByTestId("command-safety-rewrite-readonly").textContent
    ).toMatch(/could not be read/);
    expect(
      screen.getByTestId("command-safety-rewrite-error").textContent
    ).toMatch(/unknown/);
    expect(
      screen.getByTestId("command-safety-rewrite-blurb").textContent
    ).toMatch(/could not be read/);
  });

  it("surfaces a missing read-back instead of the written level", () => {
    usePolicyMock.mockReturnValue(
      hookState(ON_TENANT, {
        readbackError: "read-back failed: coord returned 502",
        lastWrite: { written_level: "off" },
      })
    );
    render(<CommandSafetyRewritePanel />);

    expect(
      screen.getByTestId("command-safety-rewrite-effective").textContent
    ).toBe("on");
    expect(
      screen.getByTestId("command-safety-rewrite-readback-error").textContent
    ).toMatch(/502/);
  });
});

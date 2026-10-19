/**
 * PermissionPromptCapturePanel — the consent copy, and the states that must
 * not collapse into on/off.
 *
 * The hook is mocked; its read/write honesty is covered in
 * `../_hooks/usePermissionPromptCapturePolicy.test.ts` and the shared
 * `useTenantFleetPolicyDial.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const usePolicyMock = vi.fn();
vi.mock("../_hooks/usePermissionPromptCapturePolicy", () => ({
  usePermissionPromptCapturePolicy: () => usePolicyMock(),
}));

import { PermissionPromptCapturePanel } from "./PermissionPromptCapturePanel";

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
  domain: "permission_prompt_capture",
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

describe("PermissionPromptCapturePanel", () => {
  it("says what is sent, where it goes, and when a change applies", () => {
    usePolicyMock.mockReturnValue(hookState(ON_TENANT));
    render(<PermissionPromptCapturePanel />);

    const sent =
      screen.getByTestId("permission-prompt-capture-what-is-sent")
        .textContent ?? "";
    expect(sent).toMatch(/reason text/);
    expect(sent).toMatch(/the tool it was raised for/);
    expect(sent).toMatch(/redacted excerpt of the command/);
    expect(sent).toMatch(/secrets and the values of VAR=value assignments/);
    expect(sent).toMatch(/at most 300\s+characters/);
    expect(sent).toMatch(/last two\s+path components/);
    expect(sent).toMatch(/this tenant.s coord findings/);
    expect(sent).toMatch(/dossier/);

    const text =
      screen.getByTestId("permission-prompt-capture-policy").textContent ?? "";
    expect(text).toMatch(
      /applies to terminals and agent sessions started after it/
    );
    // Capture observes; it never changes the prompt (plan D1).
    expect(text).toMatch(/Recording never\s+changes the prompt/);
  });

  it("shows the resolved level and writes the other one", () => {
    const state = hookState(ON_TENANT);
    usePolicyMock.mockReturnValue(state);
    render(<PermissionPromptCapturePanel />);

    expect(
      screen.getByTestId("permission-prompt-capture-effective").textContent
    ).toBe("on");
    expect(
      screen.getByTestId("permission-prompt-capture-scope").textContent
    ).toBe("tenant");
    fireEvent.click(screen.getByTestId("permission-prompt-capture-off"));
    expect(state.setLevel).toHaveBeenCalledWith("off");
  });

  it("a fresh tenant (no row, resolving on) shows on with no-row copy", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, resolved_scope: "none" })
    );
    render(<PermissionPromptCapturePanel />);

    expect(
      screen.getByTestId("permission-prompt-capture-effective").textContent
    ).toBe("on");
    const copy = screen.getByTestId("permission-prompt-capture-no-row");
    expect(copy.querySelector("code")?.textContent).toBe("on");
    expect(copy.textContent).toMatch(/nobody chose this level/);
    expect(copy.textContent).not.toMatch(/default for a tenant with no row/);
  });

  it("does not attribute a no-row `off` to coord — it may be the display floor", () => {
    usePolicyMock.mockReturnValue(
      hookState({
        ...ON_TENANT,
        effective_level: "off",
        resolved_scope: "none",
      })
    );
    render(<PermissionPromptCapturePanel />);

    const copy = screen.getByTestId("permission-prompt-capture-no-row");
    expect(copy.querySelector("code")?.textContent).toBe("off");
    expect(copy.textContent).not.toMatch(/coord reports as/);
    expect(copy.textContent).toMatch(/default for a tenant with no row is on/);
  });

  it("explains that a system-band answer means a tenant write takes effect", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, resolved_scope: "system" })
    );
    render(<PermissionPromptCapturePanel />);

    expect(
      screen.getByTestId("permission-prompt-capture-system-fallback")
        .textContent
    ).toMatch(/takes effect immediately/);
    expect(
      screen.queryByTestId("permission-prompt-capture-overridden-by-repo")
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
    render(<PermissionPromptCapturePanel />);

    expect(
      screen.getByTestId("permission-prompt-capture-keys-not-shown").textContent
    ).toMatch(/controls, drain.*fleet_resources row/);
  });

  it("does not render the no-row copy once a real band answers", () => {
    usePolicyMock.mockReturnValue(hookState(ON_TENANT));
    render(<PermissionPromptCapturePanel />);
    expect(screen.queryByTestId("permission-prompt-capture-no-row")).toBeNull();
  });

  it("warns when a repo-band row overrides the tenant row", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, resolved_scope: "repo" })
    );
    render(<PermissionPromptCapturePanel />);
    expect(
      screen.getByTestId("permission-prompt-capture-overridden-by-repo")
    ).toBeTruthy();
  });

  it("reports an unrecognised level as unknown, never as on or off", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: "maybe" })
    );
    render(<PermissionPromptCapturePanel />);

    expect(
      screen.getByTestId("permission-prompt-capture-effective").textContent
    ).toBe("maybe");
    expect(
      screen.getByTestId("permission-prompt-capture-blurb").textContent
    ).toMatch(/neither on nor off.*unknown/);
    // Neither button is shown as the current level.
    for (const level of ["on", "off"]) {
      expect(
        screen
          .getByTestId(`permission-prompt-capture-${level}`)
          .getAttribute("class")
      ).toBe(
        screen
          .getByTestId(
            `permission-prompt-capture-${level === "on" ? "off" : "on"}`
          )
          .getAttribute("class")
      );
    }
  });

  it("disables the write for a non-admin and says why", () => {
    usePolicyMock.mockReturnValue(hookState({ ...ON_TENANT, can_edit: false }));
    render(<PermissionPromptCapturePanel />);

    expect(
      (screen.getByTestId("permission-prompt-capture-off") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getByTestId("permission-prompt-capture-readonly").textContent
    ).toMatch(/not an admin/);
  });

  it("renders a failed read as unknown, never as off", () => {
    usePolicyMock.mockReturnValue(hookState(null, { error: "HTTP 502" }));
    render(<PermissionPromptCapturePanel />);

    expect(
      screen.getByTestId("permission-prompt-capture-effective").textContent
    ).toBe("unknown");
    expect(
      screen.getByTestId("permission-prompt-capture-readonly").textContent
    ).toMatch(/could not be read/);
    expect(
      screen.getByTestId("permission-prompt-capture-error").textContent
    ).toMatch(/unknown/);
    expect(
      screen.getByTestId("permission-prompt-capture-blurb").textContent
    ).toMatch(/could not be read/);
  });

  it("surfaces a missing read-back instead of the written level", () => {
    usePolicyMock.mockReturnValue(
      hookState(ON_TENANT, {
        readbackError: "read-back failed: coord returned 502",
        lastWrite: { written_level: "off" },
      })
    );
    render(<PermissionPromptCapturePanel />);

    expect(
      screen.getByTestId("permission-prompt-capture-effective").textContent
    ).toBe("on");
    expect(
      screen.getByTestId("permission-prompt-capture-readback-error").textContent
    ).toMatch(/502/);
  });
});

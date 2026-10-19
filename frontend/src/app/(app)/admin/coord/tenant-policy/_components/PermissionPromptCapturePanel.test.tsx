/**
 * PermissionPromptCapturePanel — the consent copy, and the states that must
 * not collapse into on/off.
 *
 * The hook is mocked; its read/write honesty is covered in
 * `../_hooks/usePermissionPromptCapturePolicy.test.ts` and the shared
 * `useTenantFleetPolicyDial.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { UNKNOWN_AMBER } from "@/components/console";

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
    expect(sent).toMatch(
      /at most once an hour per kind of prompt and per\s+machine/
    );
    // Phase 0: no hook payload carries the prompt's reason text, so the
    // panel must not claim to send it.
    expect(sent).not.toMatch(/reason text/);
    expect(sent).toMatch(/the tool and the command.s first word/);
    expect(sent).toMatch(
      /how often it happened, when it was first and last seen, and\s+the permission modes it was seen under/
    );
    expect(sent).toMatch(
      /up to 3 redacted command excerpts, at most 300 characters\s+each/
    );
    // Redaction is pattern-based, and the copy must not promise more.
    expect(sent).toMatch(
      /known secret patterns \(keys, tokens, bearer values\)/
    );
    expect(sent).toMatch(/values of\s+VAR=value assignments/);
    expect(sent).toMatch(/a secret of an unusual shape can get through/);
    expect(sent).toMatch(
      /working directory, reduced to its last two\s+path\s+components/
    );
    expect(sent).toMatch(
      /own wording is not visible to the runner.*\/permission-prompts record/
    );
    expect(sent).toMatch(/this tenant.s coord findings/);
    expect(sent).toMatch(/dossier/);

    const text =
      screen.getByTestId("permission-prompt-capture-policy").textContent ?? "";
    expect(text).toMatch(
      /applies to terminals and agent sessions started after it/
    );
    expect(
      screen.getByTestId("permission-prompt-capture-blurb").textContent
    ).toMatch(/Runner builds without capture support ignore this setting/);
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
    expect(copy.textContent).not.toMatch(/default this setting to on/);
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
    expect(copy.textContent).toMatch(
      /coord builds carrying this plan's Phase 1 change default this setting to on/
    );
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
    // The selected variant's class, read off a recognised `on` render.
    usePolicyMock.mockReturnValue(hookState(ON_TENANT));
    const first = render(<PermissionPromptCapturePanel />);
    const selectedClass = screen
      .getByTestId("permission-prompt-capture-on")
      .getAttribute("class");
    const calmOffBadgeClass = (() => {
      first.unmount();
      usePolicyMock.mockReturnValue(
        hookState({ ...ON_TENANT, effective_level: "off" })
      );
      const off = render(<PermissionPromptCapturePanel />);
      const cls = screen
        .getByTestId("permission-prompt-capture-effective")
        .getAttribute("class");
      off.unmount();
      return cls;
    })();

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
    // Neither button carries the selected variant's class.
    for (const level of ["on", "off"]) {
      expect(
        screen
          .getByTestId(`permission-prompt-capture-${level}`)
          .getAttribute("class")
      ).not.toBe(selectedClass);
    }
    // Unknown takes R3's ignorance floor, never the calm `off` look.
    const badge = screen.getByTestId("permission-prompt-capture-effective");
    expect(badge.getAttribute("data-unknown")).toBe("true");
    expect(badge.getAttribute("class")).not.toBe(calmOffBadgeClass);
    for (const cls of UNKNOWN_AMBER.split(" ")) {
      expect(badge.className).toContain(cls);
    }
  });

  it("paints a recognised level calm, with no unknown marker", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: "off" })
    );
    render(<PermissionPromptCapturePanel />);
    const badge = screen.getByTestId("permission-prompt-capture-effective");
    expect(badge.getAttribute("data-unknown")).toBeNull();
    expect(badge.className).not.toContain("bg-amber-");
  });

  it("spins only the button whose write is in flight", async () => {
    let finish: (v: boolean) => void = () => {};
    const setLevel = vi.fn(
      () => new Promise<boolean>((resolve) => (finish = resolve))
    );
    usePolicyMock.mockReturnValue(hookState(ON_TENANT, { setLevel }));
    const view = render(<PermissionPromptCapturePanel />);

    fireEvent.click(screen.getByTestId("permission-prompt-capture-off"));
    expect(setLevel).toHaveBeenCalledWith("off");
    // The hook now reports the write in flight.
    usePolicyMock.mockReturnValue(
      hookState(ON_TENANT, { setLevel, saving: true })
    );
    view.rerender(<PermissionPromptCapturePanel />);

    const spinnerIn = (level: string) =>
      screen
        .getByTestId(`permission-prompt-capture-${level}`)
        .querySelector(".animate-spin");
    expect(spinnerIn("off")).not.toBeNull();
    expect(spinnerIn("on")).toBeNull();

    await act(async () => {
      finish(true);
    });
    expect(spinnerIn("off")).toBeNull();
  });

  it("renders an unread level with the unknown floor too", () => {
    usePolicyMock.mockReturnValue(hookState(null, { error: "HTTP 502" }));
    render(<PermissionPromptCapturePanel />);
    const badge = screen.getByTestId("permission-prompt-capture-effective");
    expect(badge.getAttribute("data-unknown")).toBe("true");
    for (const cls of UNKNOWN_AMBER.split(" ")) {
      expect(badge.className).toContain(cls);
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

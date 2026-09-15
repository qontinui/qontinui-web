/**
 * `/settings/coordination` — placement of the tenant fixer-spawn switch.
 *
 * Served policy `agent-spawn-authorization` v11 requires the off-switch to be
 * REACHABLE in the product. So it must render without opening the Advanced
 * disclosure, and must not disappear when the unrelated next-step settings
 * request fails. PrioritySetsSection has its own fetches and is stubbed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();
const put = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    patch: vi.fn(),
    post: vi.fn(),
    put: (...args: unknown[]) => put(...args),
    delete: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("./_components/PrioritySetsSection", () => ({
  PrioritySetsSection: () => null,
}));

import CoordinationSettingsPage from "./page";

const DIAL = {
  tenant_id: "t1",
  profile: {
    auto_fix_pr_tenant: null,
    auto_fix_pr: true,
    auto_fix_pr_source: "default",
  },
};

function nextStepSettings(
  effectiveState: "effective" | "not_effective" | "unknown"
) {
  return {
    master_enabled: true,
    can_edit: true,
    domains: [
      {
        decision_domain: "pr_fix",
        label: "Automatic fixer for stuck PRs",
        description: "d",
        autonomy_level: "guidance_only",
        default_autonomy_level: "auto_decide",
        mode: "guidance",
        resolved_from: "system",
        requires_master: true,
        // coord's `effective` is only the `effective` arm of effective_state.
        effective: effectiveState === "effective",
        effective_state: effectiveState,
      },
    ],
  };
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
});

function checkedAttr(value: "default" | "on" | "off"): string | null {
  return screen
    .getByTestId(`fixer-spawn-${value}`)
    .getAttribute("aria-checked");
}

describe("CoordinationSettingsPage — fixer spawn switch placement", () => {
  it("renders the switch without opening Advanced; no false 'off' note for unknown", async () => {
    get.mockImplementation((url: unknown) =>
      String(url ?? "").includes("next-step-settings")
        ? Promise.resolve(nextStepSettings("unknown"))
        : String(url ?? "").includes("pr-merge/settings")
          ? Promise.resolve(DIAL)
          : Promise.resolve({})
    );
    render(<CoordinationSettingsPage />);
    const toggle = await screen.findByTestId("fixer-spawn-toggle");
    expect(toggle.textContent).toContain("Spawn fixer sessions for stuck PRs");
    // Advanced is closed: the per-domain rows are not rendered.
    expect(
      screen.queryByText("Automatic fixer for stuck PRs", { selector: "span" })
    ).toBeNull();
    await waitFor(() =>
      expect(
        (screen.getByTestId("fixer-spawn-off") as HTMLButtonElement).disabled
      ).toBe(false)
    );
    // pr_fix's normal verdict is `unknown` (unobserved conjunct): no "off" note.
    expect(screen.queryByTestId("fixer-spawn-autonomy-off")).toBeNull();
    expect(screen.queryByTestId("fixer-spawn-rights-unknown")).toBeNull();
  });

  it("keeps the switch visible when next-step settings fail to load", async () => {
    get.mockImplementation((url: unknown) =>
      String(url ?? "").includes("next-step-settings")
        ? Promise.reject(new Error("GET failed: 500"))
        : String(url ?? "").includes("pr-merge/settings")
          ? Promise.resolve(DIAL)
          : Promise.resolve({})
    );
    render(<CoordinationSettingsPage />);
    expect(await screen.findByTestId("fixer-spawn-toggle")).toBeTruthy();
    // Without the next-step load there is no can_edit, so it is read-only,
    // and no autonomy verdict is invented.
    expect(screen.queryByTestId("fixer-spawn-autonomy-off")).toBeNull();
    // Wait for the dial to finish loading — while loading every position is
    // disabled anyway, which would make the read-only assertion vacuous.
    await waitFor(() =>
      expect(
        screen.getByTestId("fixer-spawn-tenant-setting").textContent
      ).not.toMatch(/Loading/)
    );
    expect(checkedAttr("default")).toBe("true");
    expect(
      (screen.getByTestId("fixer-spawn-off") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByTestId("fixer-spawn-rights-unknown")).toBeTruthy();
  });
});

describe("CoordinationSettingsPage — a code-fallback domain can be saved", () => {
  it("clicking the already-highlighted level enables Save and PUTs the domain", async () => {
    const fallback = {
      master_enabled: true,
      can_edit: true,
      domains: [
        {
          ...nextStepSettings("not_effective").domains[0],
          autonomy_level: "auto_decide",
          autonomy_level_source: "code_fallback",
          effective: false,
        },
      ],
    };
    get.mockImplementation((url: unknown) =>
      String(url ?? "").includes("next-step-settings")
        ? Promise.resolve(fallback)
        : String(url ?? "").includes("pr-merge/settings")
          ? Promise.resolve(DIAL)
          : Promise.resolve({})
    );
    put.mockResolvedValue({
      ...fallback,
      domains: [
        { ...fallback.domains[0], autonomy_level_source: "policy_row" },
      ],
    });
    const user = userEvent.setup();
    render(<CoordinationSettingsPage />);

    await user.click(
      await screen.findByText("Advanced: per-decision behavior")
    );
    expect(await screen.findByTestId("domain-fallback-pr_fix")).toBeTruthy();
    const save = screen.getByRole("button", { name: /Save changes/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    const row = screen
      .getByText("Automatic fixer for stuck PRs", { selector: "span" })
      .closest("div.flex.items-start") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Auto" }));
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false)
    );

    await user.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith(
      "/api/v1/operations/coord/next-step-settings",
      {
        domains: [{ decision_domain: "pr_fix", autonomy_level: "auto_decide" }],
      }
    );
  });
});

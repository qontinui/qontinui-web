/**
 * `/settings/coordination` — placement of the tenant fixer-spawn switch.
 *
 * Served policy `agent-spawn-authorization` v11 requires the off-switch to be
 * REACHABLE in the product. So it must render without opening the Advanced
 * disclosure, and must not disappear when the unrelated next-step settings
 * request fails. PrioritySetsSection has its own fetches and is stubbed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
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

function nextStepSettings(prFixEffective: boolean) {
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
        effective: prFixEffective,
      },
    ],
  };
}

beforeEach(() => get.mockReset());

describe("CoordinationSettingsPage — fixer spawn switch placement", () => {
  it("renders the switch without opening Advanced, with the autonomy-off note", async () => {
    get.mockImplementation((url: unknown) =>
      String(url ?? "").includes("next-step-settings")
        ? Promise.resolve(nextStepSettings(false))
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
      expect(screen.getByTestId("fixer-spawn-autonomy-off")).toBeTruthy()
    );
    await waitFor(() =>
      expect(
        (screen.getByTestId("fixer-spawn-off") as HTMLButtonElement).disabled
      ).toBe(false)
    );
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
    await waitFor(() =>
      expect(
        (screen.getByTestId("fixer-spawn-off") as HTMLButtonElement).disabled
      ).toBe(true)
    );
  });
});

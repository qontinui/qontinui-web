/**
 * AiSettingsPage — the page entry point: an unedited Save sends none of the
 * roster keys, and a failed load leaves Save disabled with an inline message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const getAiSettings = vi.fn();
const saveAiSettings = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/runner-api", () => {
  const api = {
    getAiSettings: (...a: unknown[]) => getAiSettings(...a),
    saveAiSettings: (...a: unknown[]) => saveAiSettings(...a),
    hasAiApiKey: () => Promise.resolve({ has_key: false }),
  };
  return {
    useRunnerApi: () => api,
    useRunnerHealth: () => ({ isLoading: false, isOffline: false }),
    runnerFailureMessage: (_e: unknown, fallback: string) => fallback,
  };
});
const auth = vi.hoisted(() => ({ isCoordAdmin: false }));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: auth.isCoordAdmin }),
}));
vi.mock("@/hooks/usePageSpecs", () => ({ usePageSpecs: () => {} }));
vi.mock("@/lib/ui-bridge/use-discovered-specs", () => ({
  useDiscoveredSpec: () => null,
}));
vi.mock("@/components/runner/RunnerOfflineState", () => ({
  RunnerOfflineState: () => null,
}));
vi.mock("./_components/ProviderHealthStatus", () => ({
  ProviderHealthStatus: () => null,
}));
vi.mock("./_components/TestConnection", () => ({ TestConnection: () => null }));

import AiSettingsPage from "./page";

// Called as a function inside a component so the page's hooks run in this
// wrapper's render: the test enters through AiSettingsPage itself.
function PageUnderTest() {
  return AiSettingsPage();
}

const VIEW = {
  provider: "claude_cli",
  claude_cli: {
    execution_mode: "auto",
    custom_path: null,
    timeout_seconds: 600,
    config_dir: "/cfg",
    account_selection_mode: "least_usage",
    account_selection_pinned: false,
  },
  claude_api: { model: "m", max_tokens: 1 },
  gemini_cli: {
    execution_mode: "auto",
    custom_path: null,
    timeout_seconds: 1,
    auth_method: "oauth",
    model: "g",
  },
  gemini_api: { model: "g", max_output_tokens: 1, temperature: 0.1 },
  auto_refine_video_after_iterations: 3,
  interactive_sessions_enabled: true,
  effective_account_selection_mode: "manual",
  account_selection_source: "fleet",
  fleet_account_selection_mode: "manual",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.isCoordAdmin = false;
  saveAiSettings.mockResolvedValue(undefined);
});

describe("AiSettingsPage", () => {
  it("page save without edits sends none of the roster keys", async () => {
    getAiSettings.mockResolvedValue(VIEW);
    render(<PageUnderTest />);
    const save = await screen.findByRole("button", { name: /save settings/i });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() => expect(saveAiSettings).toHaveBeenCalledTimes(1));
    const body = saveAiSettings.mock.calls[0][0];
    for (const k of [
      "config_dir",
      "account_selection_mode",
      "account_selection_pinned",
    ])
      expect(k in body.claude_cli).toBe(false);
    const json = JSON.stringify(body);
    for (const k of [
      "effective_account_selection_mode",
      "account_selection_source",
      "fleet_account_selection_mode",
    ])
      expect(json).not.toContain(k);
  });

  it("page save is disabled after a failed load", async () => {
    getAiSettings.mockRejectedValue(new Error("boom"));
    render(<PageUnderTest />);
    const save = await screen.findByRole("button", { name: /save settings/i });
    expect(save).toBeDisabled();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /failed to load/i
    );
    fireEvent.click(save);
    expect(saveAiSettings).not.toHaveBeenCalled();
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    "fleet source link for isCoordAdmin=%s renders an anchor: %s",
    async (isAdmin, anchor) => {
      auth.isCoordAdmin = isAdmin;
      getAiSettings.mockResolvedValue(VIEW);
      render(<AiSettingsPage />);
      const src = await screen.findByTestId("source");
      expect(src.textContent).toBe("Managed by fleet policy");
      const a = src.querySelector("a");
      if (anchor) {
        expect(a?.getAttribute("href")).toBe("/admin/coord/tenant-policy");
      } else {
        expect(a).toBeNull();
      }
    }
  );
});

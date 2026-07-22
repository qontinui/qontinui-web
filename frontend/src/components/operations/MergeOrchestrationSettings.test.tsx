/**
 * Tests for the auto_fix_red_main tenant toggle round-trip.
 *
 * Red-main auto-remediation Phase 3 / D6 (plan
 * `2026-07-06-coord-red-main-auto-remediation-and-dashboard-alert`): the
 * tenant-defaults card exposes an "Auto-spawn fix session when main goes red"
 * switch that mirrors coord's `EffectiveProfile.auto_fix_red_main`. Under test:
 *   - the switch reflects the resolved profile value on load;
 *   - saving PATCHes `/pr-merge/settings` with `auto_fix_red_main` in the body
 *     carrying the toggled value.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

// Render admin-gated mutation controls in the test (Developer-tier gating is
// exercised elsewhere; here we test the control itself).
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

import { MergeOrchestrationSettings } from "./MergeOrchestrationSettings";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: "00000000-0000-0000-0000-000000000001",
    repo: "",
    line_budget: 500,
    min_green_dwell: 60,
    confidence_threshold: 0.85,
    auto_merge_enabled: false,
    dry_run: true,
    rulebook_overrides: null,
    escalate_paths: [],
    audit_confidence_shadow_floor: 0.85,
    preferred_auditor_device_id: null,
    auto_merge_label_budget: null,
    framework_signals: [],
    profile_source: null,
    auto_fix_red_main: false,
    ...overrides,
  };
}

/** Route the component's Promise.all([settings, repos, slo]) fetches. */
function routeGet(url: string, profileOverrides: Record<string, unknown>) {
  if (url.includes("/pr-merge/settings")) {
    return jsonResponse({
      tenant_id: "00000000-0000-0000-0000-000000000001",
      profile: makeProfile(profileOverrides),
    });
  }
  if (url.includes("/pr-merge/repos")) {
    return jsonResponse({ repos: [], total: 0 });
  }
  if (url.includes("/pr-merge/slo")) {
    return jsonResponse({
      tenant_id: "00000000-0000-0000-0000-000000000001",
      repos: [],
      kill_switch_history_last_30d: [],
      generated_at: "2026-07-06T00:00:00Z",
    });
  }
  return jsonResponse({});
}

describe("<MergeOrchestrationSettings> auto_fix_red_main toggle", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("reflects the resolved profile value (ON) on load", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, { auto_fix_red_main: true }))
    );
    render(<MergeOrchestrationSettings />);

    const toggle = await screen.findByTestId("settings-auto-fix-red-main");
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true")
    );
  });

  it("PATCHes /pr-merge/settings with the toggled auto_fix_red_main value", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({
            tenant_id: "00000000-0000-0000-0000-000000000001",
            profile: makeProfile({ auto_fix_red_main: true }),
          })
        );
      }
      return Promise.resolve(routeGet(url, { auto_fix_red_main: false }));
    });
    render(<MergeOrchestrationSettings />);

    const toggle = await screen.findByTestId("settings-auto-fix-red-main");
    // Starts OFF; flip it ON.
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true")
    );

    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH"
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as RequestInit).body as string);
      expect(body.auto_fix_red_main).toBe(true);
    });
  });

  // Regression: coord returns an EffectiveProfile WITHOUT `escalate_paths` for a
  // freshly-onboarded / unconfigured tenant (e.g. a brand-new customer tenant).
  // The settings form used to call `profile.escalate_paths.join("\n")`
  // unconditionally, throwing `Cannot read properties of undefined (reading
  // 'join')` and taking the whole merge-settings page down via the error
  // boundary. Passing `escalate_paths: undefined` drops the key on the wire
  // (JSON.stringify), reproducing coord's default-profile shape.
  it("renders (no crash) when coord omits escalate_paths on a default profile", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, { escalate_paths: undefined }))
    );
    render(<MergeOrchestrationSettings />);

    // The form mounts instead of throwing to the error boundary, and the
    // escalate-paths editor degrades to empty rather than crashing.
    const toggle = await screen.findByTestId("settings-auto-fix-red-main");
    expect(toggle).toBeTruthy();
  });
});

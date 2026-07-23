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
    min_green_dwell: 60,
    confidence_threshold: 0.85,
    auto_merge_enabled: false,
    // Derived mirror of rollout_state (true iff dry_run) — read-only.
    dry_run: true,
    rollout_state: "dry_run",
    rulebook_overrides: null,
    // coord's resolved EffectiveProfile reads escalate config back as typed
    // policies (glob + category + disposition), NOT the raw `escalate_paths`
    // string[] the PATCH body writes. Mirror the real wire shape here.
    escalate_policies: [],
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
      // The legacy dry_run boolean is retired: coord's PatchTenantSettings
      // is deny_unknown_fields, so sending it would 400 the whole PATCH.
      expect("dry_run" in body).toBe(false);
    });
  });

  // Regression: coord's resolved EffectiveProfile carries escalate config in
  // `escalate_policies` (typed), never a raw `escalate_paths` string[]. A
  // default/unconfigured tenant can also omit the key entirely. The settings
  // form must degrade to an empty editor rather than throwing `Cannot read
  // properties of undefined (reading 'map')` to the error boundary.
  it("renders (no crash) when coord omits escalate_policies on a default profile", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, { escalate_policies: undefined }))
    );
    render(<MergeOrchestrationSettings />);

    // The form mounts instead of throwing to the error boundary, and the
    // escalate-paths editor degrades to empty rather than crashing.
    const toggle = await screen.findByTestId("settings-auto-fix-red-main");
    expect(toggle).toBeTruthy();
    expect(
      (screen.getByTestId("settings-escalate-paths") as HTMLTextAreaElement)
        .value
    ).toBe("");
  });

  // The escalate-paths editor loads the tenant's CONFIGURED globs from coord's
  // `escalate_policies` read shape (one glob per line). Before this wiring the
  // editor read a phantom `escalate_paths` field that coord never sends, so it
  // was always blank — and saving then PATCHed an empty `escalate_paths`,
  // silently WIPING the tenant's configured escalate set. This test proves the
  // globs render and that a no-op save round-trips them back unchanged.
  it("loads configured globs from escalate_policies and round-trips them on save", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({
            tenant_id: "00000000-0000-0000-0000-000000000001",
            profile: makeProfile(),
          })
        );
      }
      return Promise.resolve(
        routeGet(url, {
          escalate_policies: [
            {
              glob: "alembic/**",
              category: "migrations",
              disposition: "auto_if_provably_safe",
            },
            {
              glob: "**/credentials*",
              category: "secrets",
              disposition: "block_hard",
            },
          ],
        })
      );
    });
    render(<MergeOrchestrationSettings />);

    const textarea = (await screen.findByTestId(
      "settings-escalate-paths"
    )) as HTMLTextAreaElement;
    // Globs render one-per-line, from escalate_policies[].glob.
    await waitFor(() =>
      expect(textarea.value).toBe("alembic/**\n**/credentials*")
    );

    // A no-op save must re-send exactly those globs — NOT an empty array that
    // would wipe the tenant's configured escalate set.
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH"
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as RequestInit).body as string);
      expect(body.escalate_paths).toEqual(["alembic/**", "**/credentials*"]);
    });
  });
});

describe("<MergeOrchestrationSettings> tenant rollout_state select", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("reflects the resolved rollout_state on load", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, { rollout_state: "shadow" }))
    );
    render(<MergeOrchestrationSettings />);

    const select = (await screen.findByTestId(
      "settings-rollout-state"
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("shadow"));
  });

  it("POSTs /pr-merge/rollout (scope=tenant) when the state changed on save", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH" || init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            scope: "tenant",
            state: "shadow",
            affected_repos: [],
          })
        );
      }
      return Promise.resolve(routeGet(url, { rollout_state: "dry_run" }));
    });
    render(<MergeOrchestrationSettings />);

    const select = (await screen.findByTestId(
      "settings-rollout-state"
    )) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "shadow" } });
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const rollout = fetchMock.mock.calls.find(
        (c) =>
          (c[1] as RequestInit | undefined)?.method === "POST" &&
          String(c[0]).includes("/pr-merge/rollout")
      );
      expect(rollout).toBeTruthy();
      const body = JSON.parse((rollout![1] as RequestInit).body as string);
      expect(body.scope).toBe("tenant");
      expect(body.state).toBe("shadow");
    });
  });

  it("does NOT POST the rollout route when the state is unchanged", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({
            tenant_id: "00000000-0000-0000-0000-000000000001",
            profile: makeProfile(),
          })
        );
      }
      return Promise.resolve(routeGet(url, {}));
    });
    render(<MergeOrchestrationSettings />);

    await screen.findByTestId("settings-rollout-state");
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH"
      );
      expect(patch).toBeTruthy();
    });
    const rollout = fetchMock.mock.calls.find(
      (c) =>
        (c[1] as RequestInit | undefined)?.method === "POST" &&
        String(c[0]).includes("/pr-merge/rollout")
    );
    expect(rollout).toBeFalsy();
  });
});

describe("<MergeOrchestrationSettings> RepoOverrideCard save", () => {
  const REPO = "acme/app";

  beforeEach(() => {
    fetchMock.mockReset();
  });

  /** Route the top-level fetches PLUS the per-repo profile fetch + PATCH. */
  function routeRepoCard(url: string, init?: RequestInit) {
    if (init?.method === "PATCH") {
      return jsonResponse({
        tenant_id: "00000000-0000-0000-0000-000000000001",
        repo: REPO,
        profile: makeProfile({ repo: REPO }),
      });
    }
    // The per-repo profile fetch — must be matched BEFORE the repos-list URL.
    if (url.includes(`/pr-merge/repos/${REPO}/profile`)) {
      return jsonResponse({
        tenant_id: "00000000-0000-0000-0000-000000000001",
        repo: REPO,
        profile: makeProfile({ repo: REPO }),
      });
    }
    if (url.includes("/pr-merge/repos")) {
      return jsonResponse({
        repos: [
          {
            repo: REPO,
            role: "owner",
            framework_signals: [],
            profile_source: null,
            profile_version: null,
          },
        ],
        total: 1,
      });
    }
    return routeGet(url, {});
  }

  function patchBody(): Record<string, unknown> {
    const patch = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patch).toBeTruthy();
    return JSON.parse((patch![1] as RequestInit).body as string);
  }

  it("never renders a line-budget-override input (coord rejects the field)", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeRepoCard(url, init))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);
    // The `line_budget_override` input is gone — sending it trips coord's
    // PatchRepoProfile `deny_unknown_fields` and 400s the whole save.
    expect(screen.queryByTestId(`repo-line-budget-${REPO}`)).toBeNull();
  });

  it("PATCHes ONLY the edited field, and never sends line_budget_override", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeRepoCard(url, init))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);

    // Edit ONLY the confidence override; leave every other field untouched.
    fireEvent.change(screen.getByTestId(`repo-confidence-${REPO}`), {
      target: { value: "0.9" },
    });
    fireEvent.click(screen.getByTestId(`repo-save-${REPO}`));

    await waitFor(() => {
      const body = patchBody();
      // Only the edited field is present...
      expect(body.confidence_threshold_override).toBe(0.9);
      expect(Object.keys(body)).toEqual(["confidence_threshold_override"]);
      // ...and the untouched overrides are NOT reset/wiped, and the
      // coord-rejected line_budget_override is never sent.
      expect("line_budget_override" in body).toBe(false);
      expect("escalate_paths_extra" in body).toBe(false);
      expect("auto_merge_label_budget" in body).toBe(false);
      // The legacy per-repo dry_run_override boolean is retired — coord's
      // PatchRepoProfile is deny_unknown_fields, so it must never be sent.
      expect("dry_run_override" in body).toBe(false);
      expect("rollout_state" in body).toBe(false);
      expect("auto_fix_red_main" in body).toBe(false);
    });
  });

  it("POSTs /pr-merge/rollout (scope=repo:<repo>) for a rollout-state selection", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("/pr-merge/rollout")) {
        return Promise.resolve(
          jsonResponse({
            scope: `repo:${REPO}`,
            state: "shadow",
            affected_repos: [REPO],
          })
        );
      }
      return Promise.resolve(routeRepoCard(url, init));
    });
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);

    fireEvent.change(screen.getByTestId(`repo-rollout-state-${REPO}`), {
      target: { value: "shadow" },
    });
    fireEvent.click(screen.getByTestId(`repo-save-${REPO}`));

    await waitFor(() => {
      const rollout = fetchMock.mock.calls.find(
        (c) =>
          (c[1] as RequestInit | undefined)?.method === "POST" &&
          String(c[0]).includes("/pr-merge/rollout")
      );
      expect(rollout).toBeTruthy();
      const body = JSON.parse((rollout![1] as RequestInit).body as string);
      expect(body.scope).toBe(`repo:${REPO}`);
      expect(body.state).toBe("shadow");
      // The profile PATCH must NOT carry any rollout/dry-run field.
      expect(patchBody()).toEqual({});
    });
  });

  it("sends an EMPTY body on a no-op save (touches nothing, wipes nothing)", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeRepoCard(url, init))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);

    // Save without editing anything — the old form sent every field
    // (resetting untouched overrides + wiping escalate_paths_extra to []).
    fireEvent.click(screen.getByTestId(`repo-save-${REPO}`));

    await waitFor(() => {
      expect(Object.keys(patchBody())).toEqual([]);
    });
  });
});

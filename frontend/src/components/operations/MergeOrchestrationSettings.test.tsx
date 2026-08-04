/**
 * MergeOrchestrationSettings — the merge calibration console.
 *
 * Two things under test here:
 *
 * 1. The auto_fix_red_main tenant toggle round-trip (red-main auto-remediation
 *    Phase 3 / D6, plan
 *    `2026-07-06-coord-red-main-auto-remediation-and-dashboard-alert`): the
 *    switch reflects the resolved profile value on load, and saving PATCHes
 *    `/pr-merge/settings` with the toggled value.
 *
 * 2. Merge enablement (plan
 *    `2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch`,
 *    Phase 4). The `dry_run`/`shadow`/`live` tri-state and its route are gone;
 *    what replaces them is a boolean written through
 *    `POST /pr-merge/merge-enabled`. The load-bearing assertions are the ones
 *    about PINNED vs INHERITED: the old card rendered only the resolved value,
 *    so every per-repo control read "inherit" whatever was actually stored.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    // The RESOLVED merge-enablement boolean. Whether it is PINNED lives in
    // `merge_enabled_override` on the per-repo reads, never here.
    merge_enabled: true,
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

describe("<MergeOrchestrationSettings> tenant merge pause latch", () => {
  let promptSpy: ReturnType<typeof vi.spyOn>;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock.mockReset();
    promptSpy = vi.spyOn(window, "prompt").mockReturnValue("because incident");
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("reflects the resolved merge_enabled on load", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, { merge_enabled: false }))
    );
    render(<MergeOrchestrationSettings />);

    const toggle = await screen.findByTestId("settings-merge-enabled");
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("false")
    );
  });

  // coord has NO tenant-tier `merge_enabled` column: a tenant-scoped write
  // sets `merge_paused`, which dominates every per-repo pin. So switching this
  // off IS the emergency stop, and it must fire through the audited door that
  // writes the `coord.alerts` row — not the quieter merge-enabled route.
  it("fires the kill-switch door (not merge-enabled) when switched OFF", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            scope: "tenant",
            previous_merge_enabled: true,
            merge_enabled: false,
            affected_repos: [],
          })
        );
      }
      return Promise.resolve(routeGet(url, { merge_enabled: true }));
    });
    render(<MergeOrchestrationSettings />);

    const toggle = await screen.findByTestId("settings-merge-enabled");
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true")
    );
    fireEvent.click(toggle);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      );
      expect(post).toBeTruthy();
      expect(String(post![0])).toContain("/pr-merge/kill-switch");
      expect(String(post![0])).not.toContain("/pr-merge/merge-enabled");
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.scope).toBe("tenant");
      // The operator's own words, never a canned string.
      expect(body.reason).toBe("because incident");
    });
    // ...and the confirm named the real blast radius, pins included.
    expect(confirmSpy.mock.calls[0]?.[0]).toMatch(
      /INCLUDING repos[\s\S]*pinned ON/
    );
  });

  it("lifts the latch through the merge-enabled door when switched ON", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            scope: "tenant",
            previous_merge_enabled: false,
            merge_enabled: true,
            affected_repos: [],
          })
        );
      }
      return Promise.resolve(routeGet(url, { merge_enabled: false }));
    });
    render(<MergeOrchestrationSettings />);

    const toggle = await screen.findByTestId("settings-merge-enabled");
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("false")
    );
    fireEvent.click(toggle);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      );
      expect(post).toBeTruthy();
      expect(String(post![0])).toContain("/pr-merge/merge-enabled");
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.scope).toBe("tenant");
      expect(body.enabled).toBe(true);
    });
  });

  it("writes nothing when the reason prompt is cancelled", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, { merge_enabled: true }))
    );
    promptSpy.mockReturnValue(null);
    render(<MergeOrchestrationSettings />);

    fireEvent.click(await screen.findByTestId("settings-merge-enabled"));
    await waitFor(() => expect(promptSpy).toHaveBeenCalled());
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      )
    ).toEqual([]);
  });

  it("writes nothing when the confirm is declined", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, { merge_enabled: true }))
    );
    confirmSpy.mockReturnValue(false);
    render(<MergeOrchestrationSettings />);

    fireEvent.click(await screen.findByTestId("settings-merge-enabled"));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      )
    ).toEqual([]);
  });

  // The latch must never ride along on an unrelated calibration edit.
  it("is NOT batched into the Save tenant defaults button", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({
            tenant_id: "00000000-0000-0000-0000-000000000001",
            profile: makeProfile(),
          })
        );
      }
      return Promise.resolve(routeGet(url, { merge_enabled: true }));
    });
    render(<MergeOrchestrationSettings />);

    await screen.findByTestId("settings-merge-enabled");
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH"
      );
      expect(patch).toBeTruthy();
      // The PATCH body carries calibration fields only — enablement is not
      // one of them, and no enablement POST rode along.
      const body = JSON.parse((patch![1] as RequestInit).body as string);
      expect("merge_enabled" in body).toBe(false);
    });
    expect(
      fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST"
      )
    ).toEqual([]);
  });

  // A latched pause with no indicator is how an operator concludes their stop
  // did not take: the per-repo switches keep showing their PINS, which the
  // pause outranks.
  it("banners the tenant pause, and stays silent when merges are on", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, { merge_enabled: false }))
    );
    const { unmount } = render(<MergeOrchestrationSettings />);
    const banner = await screen.findByTestId("tenant-paused-banner");
    expect(banner).toHaveTextContent(/paused tenant-wide/i);
    expect(banner).toHaveTextContent(/including repos pinned on/i);
    unmount();

    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, { merge_enabled: true }))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId("settings-merge-enabled");
    expect(screen.queryByTestId("tenant-paused-banner")).toBeNull();
  });

  // The retired tri-state must be gone from the surface entirely — not
  // hidden, not disabled. A `dry_run`/`shadow`/`live` control here would
  // write to a coord route that no longer exists.
  it("no longer renders the rollout-state control", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, {}))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId("settings-merge-enabled");
    expect(screen.queryByTestId("settings-rollout-state")).toBeNull();
  });

  // The per-repo emergency stop moved to the merge-train incident view. A red
  // tenant-wide button at the top of a calibration page was the wrong blast
  // radius in the wrong place.
  it("no longer renders the emergency stop card", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routeGet(url, {}))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId("settings-merge-enabled");
    expect(screen.queryByTestId("kill-switch-card")).toBeNull();
    expect(screen.queryByTestId("kill-switch-fire")).toBeNull();
  });
});

describe("<MergeOrchestrationSettings> RepoOverrideCard save", () => {
  const REPO = "acme/app";

  beforeEach(() => {
    fetchMock.mockReset();
  });

  /**
   * Route the top-level fetches PLUS the per-repo profile fetch + PATCH.
   *
   * `pin` is coord's RAW `merge_enabled_override`; `resolved` is what the
   * profile resolves to. They are deliberately independent here — the whole
   * point of the fix is that the card stops conflating them.
   */
  function routeRepoCard(
    url: string,
    init?: RequestInit,
    pin: boolean | null = null,
    resolved = true
  ) {
    if (init?.method === "PATCH") {
      return jsonResponse({
        tenant_id: "00000000-0000-0000-0000-000000000001",
        repo: REPO,
        profile: makeProfile({ repo: REPO, merge_enabled: resolved }),
        merge_enabled_override: pin,
      });
    }
    // The per-repo profile fetch — must be matched BEFORE the repos-list URL.
    if (url.includes(`/pr-merge/repos/${REPO}/profile`)) {
      return jsonResponse({
        tenant_id: "00000000-0000-0000-0000-000000000001",
        repo: REPO,
        profile: makeProfile({ repo: REPO, merge_enabled: resolved }),
        merge_enabled_override: pin,
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
            merge_enabled: resolved,
            merge_enabled_override: pin,
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
      expect("merge_enabled" in body).toBe(false);
      expect("auto_fix_red_main" in body).toBe(false);
    });
  });

  // THE write-only-card bug. The card used to render the RESOLVED value for
  // every repo, so a repo pinned OFF and a repo merely inheriting an ON
  // tenant both displayed "inherit" — a control whose position never matched
  // what was stored. coord now serves the raw pin; render THAT.
  it("renders the PINNED state, not the resolved one", async () => {
    // Pinned OFF while the tenant tier resolves ON: the two disagree, and the
    // pin is what the operator set.
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeRepoCard(url, init, false, false))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);

    const select = (await screen.findByTestId(
      `repo-merge-enabled-${REPO}`
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("false"));
    const badge = screen.getByTestId(`repo-merge-enabled-badge-${REPO}`);
    expect(badge).toHaveAttribute("data-pin", "false");
    expect(badge).toHaveTextContent(/pinned/i);
  });

  it("marks an unpinned repo as INHERITING rather than as its resolved value", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeRepoCard(url, init, null, true))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);

    const select = (await screen.findByTestId(
      `repo-merge-enabled-${REPO}`
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("inherit"));
    const badge = screen.getByTestId(`repo-merge-enabled-badge-${REPO}`);
    expect(badge).toHaveAttribute("data-pin", "inherit");
    // Resolved ON, but said to be inherited — never presented as a pin.
    expect(badge).toHaveTextContent(/merges on/i);
    expect(badge).toHaveTextContent(/inherited/i);
  });

  it("POSTs /pr-merge/merge-enabled (scope=repo:<repo>) for a pin", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("/pr-merge/merge-enabled")) {
        return Promise.resolve(
          jsonResponse({
            scope: `repo:${REPO}`,
            previous_merge_enabled: true,
            merge_enabled: false,
            affected_repos: [REPO],
          })
        );
      }
      return Promise.resolve(routeRepoCard(url, init));
    });
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);

    fireEvent.change(screen.getByTestId(`repo-merge-enabled-${REPO}`), {
      target: { value: "false" },
    });
    fireEvent.click(screen.getByTestId(`repo-save-${REPO}`));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) =>
          (c[1] as RequestInit | undefined)?.method === "POST" &&
          String(c[0]).includes("/pr-merge/merge-enabled")
      );
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.scope).toBe(`repo:${REPO}`);
      expect(body.enabled).toBe(false);
      // An enablement-only save must not fire the profile PATCH at all —
      // no profile field changed, so an empty-body PATCH would be a
      // wasted round-trip.
      const patch = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH"
      );
      expect(patch).toBeFalsy();
    });
  });

  // Clear-to-inherit is a REAL action now (`enabled: null`), where the old
  // rollout route had no such form and "inherit" silently did nothing.
  it("clears a pin with an explicit null", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("/pr-merge/merge-enabled")) {
        return Promise.resolve(
          jsonResponse({
            scope: `repo:${REPO}`,
            previous_merge_enabled: false,
            merge_enabled: true,
            affected_repos: [REPO],
          })
        );
      }
      return Promise.resolve(routeRepoCard(url, init, false, false));
    });
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);
    const select = (await screen.findByTestId(
      `repo-merge-enabled-${REPO}`
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("false"));

    fireEvent.change(select, { target: { value: "inherit" } });
    fireEvent.click(screen.getByTestId(`repo-save-${REPO}`));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) =>
          (c[1] as RequestInit | undefined)?.method === "POST" &&
          String(c[0]).includes("/pr-merge/merge-enabled")
      );
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect("enabled" in body).toBe(true);
      expect(body.enabled).toBeNull();
    });
  });

  // A control that keeps showing the pre-save pin is the SAME lie as one that
  // showed the resolved value — just one release later. After a save the
  // parent re-reads /pr-merge/repos, and the card must follow it.
  it("follows coord's stored pin after a save, not the pre-save one", async () => {
    let storedPin: boolean | null = null;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("/pr-merge/merge-enabled")) {
        storedPin = false;
        return Promise.resolve(
          jsonResponse({
            scope: `repo:${REPO}`,
            previous_merge_enabled: true,
            merge_enabled: false,
            affected_repos: [REPO],
          })
        );
      }
      return Promise.resolve(routeRepoCard(url, init, storedPin, true));
    });
    render(<MergeOrchestrationSettings />);
    const select = (await screen.findByTestId(
      `repo-merge-enabled-${REPO}`
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("inherit"));

    fireEvent.change(select, { target: { value: "false" } });
    fireEvent.click(screen.getByTestId(`repo-save-${REPO}`));

    // The reload lands and the badge/select now report the PINNED state.
    await waitFor(() =>
      expect(
        screen.getByTestId(`repo-merge-enabled-badge-${REPO}`)
      ).toHaveAttribute("data-pin", "false")
    );
    expect(
      (screen.getByTestId(`repo-merge-enabled-${REPO}`) as HTMLSelectElement)
        .value
    ).toBe("false");
  });

  it("makes NO requests on a no-op save (touches nothing, wipes nothing)", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeRepoCard(url, init, false, false))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);
    // Wait for the pin to load, so the no-op save is measured against the
    // STORED value rather than against a pre-fetch placeholder.
    await waitFor(() =>
      expect(
        (screen.getByTestId(`repo-merge-enabled-${REPO}`) as HTMLSelectElement)
          .value
      ).toBe("false")
    );

    // Save without editing anything — the old form sent every field
    // (resetting untouched overrides + wiping escalate_paths_extra to []);
    // now an untouched save skips both the PATCH and the enablement POST,
    // including for a repo that already carries a pin.
    fireEvent.click(screen.getByTestId(`repo-save-${REPO}`));

    await waitFor(() => {
      const writes = fetchMock.mock.calls.filter((c) => {
        const m = (c[1] as RequestInit | undefined)?.method;
        return m === "PATCH" || m === "POST";
      });
      expect(writes).toEqual([]);
    });
  });

  it("no longer renders the per-repo rollout-state control", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeRepoCard(url, init))
    );
    render(<MergeOrchestrationSettings />);
    await screen.findByTestId(`repo-card-${REPO}`);
    expect(screen.queryByTestId(`repo-rollout-state-${REPO}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SLO dashboard — per-repo merge-enabled switch
// ---------------------------------------------------------------------------
//
// This is where the retired `["dry_run","shadow","live"]` three-button control
// lived. It is now ONE switch plus a clear-the-pin action, and the card states
// whether the value it shows is pinned here or inherited.

describe("<MergeOrchestrationSettings> SLO per-repo merge-enabled control", () => {
  const REPO = "acme/app";

  beforeEach(() => {
    fetchMock.mockReset();
  });

  function emptyWindow() {
    return {
      auto_merge_success_rate: null,
      escalation_rate: null,
      post_merge_verification_lag_p95_seconds: null,
      author_feedback_latency_p95_seconds: null,
      operator_override_rate: null,
      shadow_vs_live_agreement_rate: null,
      total_decisions: 0,
      shadow_decisions: 0,
    };
  }

  function routeSlo(
    url: string,
    init: RequestInit | undefined,
    pin: boolean | null,
    resolved: boolean
  ) {
    if (init?.method === "POST" && url.includes("/pr-merge/merge-enabled")) {
      return jsonResponse({
        scope: `repo:${REPO}`,
        previous_merge_enabled: resolved,
        merge_enabled: !resolved,
        affected_repos: [REPO],
      });
    }
    if (url.includes("/pr-merge/slo")) {
      return jsonResponse({
        tenant_id: "00000000-0000-0000-0000-000000000001",
        repos: [
          {
            repo: REPO,
            // coord still serves the legacy tri-state; nothing renders it.
            current_rollout_state: "dry_run",
            merge_enabled: resolved,
            merge_enabled_override: pin,
            windows: { last_7d: emptyWindow(), last_30d: emptyWindow() },
          },
        ],
        kill_switch_history_last_30d: [],
        generated_at: "2026-08-04T00:00:00Z",
      });
    }
    return routeGet(url, {});
  }

  it("renders ONE switch, never the dry_run/shadow/live buttons", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeSlo(url, init, null, true))
    );
    render(<MergeOrchestrationSettings />);

    await screen.findByTestId(`merge-enabled-switch-${REPO}`);
    expect(screen.queryByTestId(`rollout-set-dry_run-${REPO}`)).toBeNull();
    expect(screen.queryByTestId(`rollout-set-shadow-${REPO}`)).toBeNull();
    expect(screen.queryByTestId(`rollout-set-live-${REPO}`)).toBeNull();
  });

  it("says the value is inherited when nothing is pinned", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeSlo(url, init, null, false))
    );
    render(<MergeOrchestrationSettings />);

    const provenance = await screen.findByTestId(
      `merge-enabled-provenance-${REPO}`
    );
    expect(provenance).toHaveTextContent(/not pinned/i);
    expect(provenance).toHaveTextContent(/currently paused/i);
    // Nothing to clear when nothing is pinned.
    expect(screen.queryByTestId(`merge-enabled-clear-${REPO}`)).toBeNull();
  });

  it("names the pin, and offers to clear it", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeSlo(url, init, true, true))
    );
    render(<MergeOrchestrationSettings />);

    const provenance = await screen.findByTestId(
      `merge-enabled-provenance-${REPO}`
    );
    expect(provenance).toHaveTextContent(/pinned on/i);
    expect(
      screen.getByTestId(`merge-enabled-clear-${REPO}`)
    ).toBeInTheDocument();
  });

  it("POSTs enabled=false with the operator's reason when switched off", async () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue("runaway merges");
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeSlo(url, init, true, true))
    );
    render(<MergeOrchestrationSettings />);

    const toggle = await screen.findByTestId(`merge-enabled-switch-${REPO}`);
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true")
    );
    fireEvent.click(toggle);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) =>
          (c[1] as RequestInit | undefined)?.method === "POST" &&
          String(c[0]).includes("/pr-merge/merge-enabled")
      );
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.scope).toBe(`repo:${REPO}`);
      expect(body.enabled).toBe(false);
      expect(body.reason).toBe("runaway merges");
    });
    promptSpy.mockRestore();
  });

  it("clearing the pin sends enabled=null", async () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue("back to default");
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeSlo(url, init, false, false))
    );
    render(<MergeOrchestrationSettings />);

    fireEvent.click(await screen.findByTestId(`merge-enabled-clear-${REPO}`));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) =>
          (c[1] as RequestInit | undefined)?.method === "POST" &&
          String(c[0]).includes("/pr-merge/merge-enabled")
      );
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.enabled).toBeNull();
    });
    promptSpy.mockRestore();
  });

  it("aborts without writing when the reason prompt is cancelled", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(routeSlo(url, init, false, false))
    );
    render(<MergeOrchestrationSettings />);

    fireEvent.click(await screen.findByTestId(`merge-enabled-switch-${REPO}`));

    await waitFor(() => expect(promptSpy).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(post).toBeFalsy();
    promptSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Pin vs reality under a tenant-wide pause
// ---------------------------------------------------------------------------
//
// The one combination where every honest-rendering rule has to hold at once:
// the repo is pinned ON, the tenant pause outranks it, so the repo resolves
// OFF. The switch shows the PIN (it is the pin's editor), the badge shows
// REALITY, and the sentence reconciles them by naming the pause. Get this
// wrong and an operator who has just stopped the fleet reads a page full of
// ON switches as proof the stop did not take.

describe("<MergeOrchestrationSettings> pinned-ON repo under a tenant pause", () => {
  const REPO = "acme/app";

  beforeEach(() => {
    fetchMock.mockReset();
  });

  function emptyWindow() {
    return {
      auto_merge_success_rate: null,
      escalation_rate: null,
      post_merge_verification_lag_p95_seconds: null,
      author_feedback_latency_p95_seconds: null,
      operator_override_rate: null,
      shadow_vs_live_agreement_rate: null,
      total_decisions: 0,
      shadow_decisions: 0,
    };
  }

  /** Tenant paused (tenant profile resolves OFF); repo pinned ON, resolves OFF. */
  function routePaused(url: string) {
    if (url.includes("/pr-merge/slo")) {
      return jsonResponse({
        tenant_id: "00000000-0000-0000-0000-000000000001",
        repos: [
          {
            repo: REPO,
            current_rollout_state: "live",
            merge_enabled: false,
            merge_enabled_override: true,
            windows: { last_7d: emptyWindow(), last_30d: emptyWindow() },
          },
        ],
        kill_switch_history_last_30d: [],
        generated_at: "2026-08-04T00:00:00Z",
      });
    }
    if (url.includes(`/pr-merge/repos/${REPO}/profile`)) {
      return jsonResponse({
        tenant_id: "00000000-0000-0000-0000-000000000001",
        repo: REPO,
        profile: makeProfile({ repo: REPO, merge_enabled: false }),
        merge_enabled_override: true,
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
            merge_enabled: false,
            merge_enabled_override: true,
          },
        ],
        total: 1,
      });
    }
    // The tenant profile itself resolves OFF — the only way that happens is
    // `merge_paused`, since coord has no tenant-tier merge_enabled column.
    return routeGet(url, { merge_enabled: false });
  }

  it("shows the pin on the switch, reality on the badge, and reconciles them", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routePaused(url))
    );
    render(<MergeOrchestrationSettings />);

    // Badge: resolved OFF, and still honest that a pin exists.
    const badge = await screen.findByTestId(`slo-merge-enabled-badge-${REPO}`);
    expect(badge).toHaveTextContent(/merges off/i);
    expect(badge).toHaveAttribute("data-pin", "true");

    // Switch: the PIN, because this control edits the pin.
    const toggle = screen.getByTestId(`merge-enabled-switch-${REPO}`);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    // The sentence is what stops those two from reading as a contradiction.
    const provenance = screen.getByTestId(`merge-enabled-provenance-${REPO}`);
    expect(provenance).toHaveTextContent(/pinned on/i);
    expect(provenance).toHaveTextContent(/merges are off here/i);
    expect(provenance).toHaveTextContent(/tenant is paused/i);
  });

  it("banners the pause above the per-repo cards", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routePaused(url))
    );
    render(<MergeOrchestrationSettings />);
    expect(await screen.findByTestId("tenant-paused-banner")).toBeTruthy();
  });

  it("says the same thing on the per-repo override card", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(routePaused(url))
    );
    render(<MergeOrchestrationSettings />);

    const badge = await screen.findByTestId(`repo-merge-enabled-badge-${REPO}`);
    expect(badge).toHaveTextContent(/merges off/i);
    expect(badge).toHaveAttribute("data-pin", "true");
    // The select still edits the pin, so it still shows the pin.
    expect(
      (screen.getByTestId(`repo-merge-enabled-${REPO}`) as HTMLSelectElement)
        .value
    ).toBe("true");
    expect(screen.getByTestId(`repo-card-${REPO}`)).toHaveTextContent(
      /tenant is paused/i
    );
  });
});

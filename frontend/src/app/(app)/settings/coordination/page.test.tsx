/**
 * `/settings/coordination` — placement of the tenant fixer-spawn switch.
 *
 * Served policy `agent-spawn-authorization` v11 requires the off-switch to be
 * REACHABLE in the product. So it must render without opening the Advanced
 * disclosure, and must not disappear when the unrelated next-step settings
 * request fails. PrioritySetsSection has its own fetches and is stubbed.
 *
 * It also shows no position as the saved one while a write's outcome is open:
 * until the re-read settles, the value on hand is the one from before it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();
const put = vi.fn();

// Both the fixer dial (`lib/api/operations/prMerge`) and the next-step
// settings (`lib/api/operations/coordSettings`) go through the typed
// `/operations` client, which calls `httpClient.fetch`. This adapter routes a
// GET onto the `get` spy, the next-step save (PUT) onto `put`, and the dial's
// PATCH onto `patchViaFetch`; any other verb throws. Each test keeps stating
// its transport as "the GET answers X" / "the PUT receives Y".
const patchViaFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      let body: unknown;
      if (method === "GET") body = await get(url);
      else if (method === "PUT")
        body = await put(url, JSON.parse(String(init?.body)));
      else if (method === "PATCH")
        body = await patchViaFetch(url, JSON.parse(String(init?.body)));
      else throw new Error(`fetch mock: unexpected ${method} ${url}`);
      return new Response(JSON.stringify(body), { status: 200 });
    },
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

describe("CoordinationSettingsPage — the next_step master-flag note", () => {
  it("names the domain's own autodispatch flag, not a platform master", async () => {
    get.mockImplementation((url: unknown) =>
      String(url ?? "").includes("next-step-settings")
        ? Promise.resolve({
            master_enabled: false,
            can_edit: true,
            domains: [
              {
                ...nextStepSettings("not_effective").domains[0],
                decision_domain: "next_step",
                label: "Next step after your session goes stale",
                master_flag: "COORD_NEXT_STEP_AUTODISPATCH_ENABLED",
                master_flag_enabled: false,
              },
            ],
          })
        : String(url ?? "").includes("pr-merge/settings")
          ? Promise.resolve(DIAL)
          : Promise.resolve({})
    );
    render(<CoordinationSettingsPage />);
    const note = await screen.findByTestId("next-step-master-flag-note");
    expect(note.textContent).toContain(
      "this domain's own autodispatch flag (COORD_NEXT_STEP_AUTODISPATCH_ENABLED, currently off)"
    );
    expect(note.textContent).toContain("there is no platform-wide switch");
    expect(note.textContent).not.toContain("platform master");
  });
});

describe("CoordinationSettingsPage — each domain reads its OWN autodispatch flag", () => {
  function settingsWith(
    domains: Record<string, unknown>[],
    masterEnabled: boolean
  ) {
    return {
      master_enabled: masterEnabled,
      can_edit: true,
      domains: domains.map((d) => ({
        ...nextStepSettings("not_effective").domains[0],
        ...d,
      })),
    };
  }

  function serveSettings(body: unknown) {
    get.mockImplementation((url: unknown) =>
      String(url ?? "").includes("next-step-settings")
        ? Promise.resolve(body)
        : String(url ?? "").includes("pr-merge/settings")
          ? Promise.resolve(DIAL)
          : Promise.resolve({})
    );
  }

  it("a pr_fix row reads its own flag, not next_step's", async () => {
    // next_step's flag (master_enabled) is OFF, pr_fix's own flag is ON:
    // pr_fix must not read "master off".
    serveSettings(
      settingsWith(
        [
          {
            decision_domain: "pr_fix",
            master_flag: "COORD_PR_FIX_AUTODISPATCH_ENABLED",
            master_flag_enabled: true,
          },
          {
            decision_domain: "red_main_fix",
            label: "Automatic fixer for code-class red main",
            master_flag: "COORD_RED_MAIN_FIX_AUTODISPATCH_ENABLED",
            master_flag_enabled: false,
          },
        ],
        false
      )
    );
    const user = userEvent.setup();
    render(<CoordinationSettingsPage />);
    await user.click(
      await screen.findByText("Advanced: per-decision behavior")
    );
    await screen.findByText("Automatic fixer for stuck PRs", {
      selector: "span",
    });
    expect(screen.queryByTestId("domain-master-off-pr_fix")).toBeNull();
    // red_main_fix's own flag is off, and the row names it.
    expect(
      screen.getByTestId("domain-master-off-red_main_fix").textContent
    ).toBe("No (COORD_RED_MAIN_FIX_AUTODISPATCH_ENABLED off)");
  });

  it("reads UNKNOWN, not next_step's flag, for another domain when coord serves no per-domain value", async () => {
    serveSettings(
      settingsWith(
        [
          { decision_domain: "pr_fix" },
          {
            decision_domain: "next_step",
            label: "Next step after your session goes stale",
          },
        ],
        false
      )
    );
    const user = userEvent.setup();
    render(<CoordinationSettingsPage />);
    await user.click(
      await screen.findByText("Advanced: per-decision behavior")
    );
    expect(
      (await screen.findByTestId("domain-master-unknown-pr_fix")).textContent
    ).toBe("Unknown (coord did not report this domain's flag)");
    expect(screen.queryByTestId("domain-master-off-pr_fix")).toBeNull();
    // next_step itself may use master_enabled, which IS its flag.
    expect(screen.getByTestId("domain-master-off-next_step").textContent).toBe(
      "No (its autodispatch flag off)"
    );
  });

  it("says UNKNOWN, not OFF, when the settings could not be read", async () => {
    get.mockImplementation((url: unknown) =>
      String(url ?? "").includes("next-step-settings")
        ? Promise.reject(new Error("GET failed: 500"))
        : String(url ?? "").includes("pr-merge/settings")
          ? Promise.resolve(DIAL)
          : Promise.resolve({})
    );
    render(<CoordinationSettingsPage />);
    const banner = await screen.findByTestId("next-step-flag-banner");
    expect(banner.textContent).toContain(
      "Next-step autodispatch flag: UNKNOWN."
    );
    expect(banner.textContent).not.toContain("OFF");
  });

  it("describes the banner as the next_step flag, not a platform switch", async () => {
    serveSettings(
      settingsWith(
        [
          {
            decision_domain: "next_step",
            label: "Next step after your session goes stale",
            master_flag: "COORD_NEXT_STEP_AUTODISPATCH_ENABLED",
            master_flag_enabled: false,
          },
        ],
        false
      )
    );
    render(<CoordinationSettingsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("next-step-flag-banner").textContent).toContain(
        "Next-step autodispatch flag (COORD_NEXT_STEP_AUTODISPATCH_ENABLED): OFF by the operator."
      )
    );
    const banner = screen.getByTestId("next-step-flag-banner").textContent;
    expect(banner).toContain(
      "Other autodispatch domains are gated by their own flags; a domain whose flag is off says so under Advanced."
    );
    expect(banner).not.toMatch(/platform/i);
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

// Built once at module level so the case below reads a value, not the helper.
const EFFECTIVE_NEXT_STEP = nextStepSettings("effective");

describe("CoordinationSettingsPage — a fixer write whose outcome is open", () => {
  it("presses no fixer position while the re-read after the write is out", async () => {
    let releaseReread: (body: typeof DIAL) => void = () => {};
    let dialReads = 0;
    get.mockImplementation((url: string) => {
      const path = String(url ?? "");
      if (path.includes("next-step-settings")) {
        return Promise.resolve(EFFECTIVE_NEXT_STEP);
      }
      if (path.includes("pr-merge/settings")) {
        dialReads += 1;
        if (dialReads === 1) return Promise.resolve(DIAL);
        // The re-read the open outcome starts is held, so the outcome stays open.
        return new Promise((resolve) => {
          releaseReread = resolve;
        });
      }
      return Promise.resolve({});
    });
    // The PATCH answers 2xx with the tenant value still null: it did not read
    // back the "on" that was sent, so whether the write landed is open.
    patchViaFetch.mockReset();
    patchViaFetch.mockResolvedValue(DIAL);
    const user = userEvent.setup();
    render(<CoordinationSettingsPage />);

    await waitFor(() => expect(checkedAttr("default")).toBe("true"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("fixer-spawn-on") as HTMLButtonElement).disabled
      ).toBe(false)
    );
    await user.click(screen.getByTestId("fixer-spawn-on"));
    await waitFor(() => expect(patchViaFetch).toHaveBeenCalledTimes(1));
    expect(patchViaFetch.mock.calls[0]?.[1]).toEqual({ auto_fix_pr: true });
    await waitFor(() => expect(dialReads).toBe(2));

    // The value on hand is the pre-write "default": showing it pressed would
    // claim it is what coord holds after the write.
    for (const position of ["default", "on", "off"] as const) {
      expect(checkedAttr(position)).not.toBe("true");
      expect(
        screen
          .getByTestId(`fixer-spawn-${position}`)
          .getAttribute("aria-pressed")
      ).not.toBe("true");
    }

    await act(async () => {
      releaseReread(DIAL);
    });
    await waitFor(() => expect(checkedAttr("default")).toBe("true"));
  });
});

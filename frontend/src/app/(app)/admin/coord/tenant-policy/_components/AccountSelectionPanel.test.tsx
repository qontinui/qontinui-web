/**
 * AccountSelectionPanel — the states that must not collapse into a known mode.
 *
 * The hook is mocked; its read/write honesty and level parsing are covered in
 * `../_hooks/useAccountSelectionPolicy.test.ts` and the shared
 * `useTenantFleetPolicyDial.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const usePolicyMock = vi.fn();
vi.mock("../_hooks/useAccountSelectionPolicy", () => ({
  useAccountSelectionPolicy: () => usePolicyMock(),
}));

import { AccountSelectionPanel } from "./AccountSelectionPanel";

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
    displayLevel: null,
    isDefaulted: false,
    unrecognizedLevel: null,
    ...overrides,
  };
}

const LEAST_TENANT = {
  domain: "account_selection_mode",
  effective_level: "least_usage",
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

const leastTenant = (overrides: Record<string, unknown> = {}) =>
  hookState(LEAST_TENANT, { displayLevel: "least_usage", ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AccountSelectionPanel", () => {
  it("states force-apply, the pin exception, what off means, and old runners", () => {
    usePolicyMock.mockReturnValue(leastTenant());
    render(<AccountSelectionPanel />);

    const text =
      screen.getByTestId("account-selection-policy").textContent ?? "";
    expect(text).toMatch(/force-applied to every runner in this tenant/);
    expect(text).toMatch(
      /a machine whose operator pinned its local mode keeps its own mode/
    );
    expect(text).toMatch(
      /No fleet opinion means each runner uses its local setting/
    );
    expect(text).toMatch(
      /runners that predate fleet account selection ignore this value/
    );
  });

  it("warns that manual can leave a machine with no account", () => {
    usePolicyMock.mockReturnValue(leastTenant({ displayLevel: "manual" }));
    render(<AccountSelectionPanel />);
    const text =
      screen.getByTestId("account-selection-blurb").textContent ?? "";
    expect(text).toMatch(
      /A machine with no account configured cannot start sessions until one is set there or the machine is pinned/
    );
  });

  it("offers all four levels and writes the one clicked", () => {
    const state = leastTenant();
    usePolicyMock.mockReturnValue(state);
    render(<AccountSelectionPanel />);

    for (const level of [
      "off",
      "manual",
      "least_usage",
      "highest_expected_usage",
    ]) {
      expect(screen.getByTestId(`account-selection-${level}`)).toBeTruthy();
    }
    fireEvent.click(screen.getByTestId("account-selection-manual"));
    expect(state.setLevel).toHaveBeenCalledWith("manual");
  });

  it("shows the resolved level and band", () => {
    usePolicyMock.mockReturnValue(leastTenant());
    render(<AccountSelectionPanel />);

    const badge = screen.getByTestId("account-selection-effective");
    expect(badge.textContent).toBe("Least usage");
    expect(badge.getAttribute("data-level")).toBe("least_usage");
    expect(screen.getByTestId("account-selection-scope").textContent).toBe(
      "tenant"
    );
    expect(screen.getByTestId("account-selection-blurb").textContent).toMatch(
      /lowest usage relative to its expected pace/
    );
  });

  it("a fresh tenant (no row) shows no fleet opinion and says nobody chose it", () => {
    usePolicyMock.mockReturnValue(
      hookState(
        { ...LEAST_TENANT, effective_level: "off", resolved_scope: "none" },
        { displayLevel: "off", isDefaulted: true }
      )
    );
    render(<AccountSelectionPanel />);

    expect(screen.getByTestId("account-selection-effective").textContent).toBe(
      "No fleet opinion"
    );
    expect(screen.getByTestId("account-selection-no-row").textContent).toMatch(
      /nobody chose this.*each runner uses its local setting/
    );
    expect(screen.queryByTestId("account-selection-unrecognized")).toBeNull();
  });

  it("does not render the no-row copy once a real band answers", () => {
    usePolicyMock.mockReturnValue(leastTenant());
    render(<AccountSelectionPanel />);
    expect(screen.queryByTestId("account-selection-no-row")).toBeNull();
  });

  it("renders an unrecognised level as UNKNOWN and names it, selecting no button", () => {
    usePolicyMock.mockReturnValue(
      hookState(
        { ...LEAST_TENANT, effective_level: "round_robin" },
        { displayLevel: null, unrecognizedLevel: "round_robin" }
      )
    );
    render(<AccountSelectionPanel />);

    const badge = screen.getByTestId("account-selection-effective");
    expect(badge.textContent).toBe("unknown");
    expect(badge.getAttribute("data-level")).toBe("unknown");
    expect(
      screen.getByTestId("account-selection-unrecognized").querySelector("code")
        ?.textContent
    ).toBe("round_robin");
    expect(screen.getByTestId("account-selection-blurb").textContent).toMatch(
      /not one this console recognises/
    );
    // No known level is highlighted as though it were in force.
    const offClass = screen
      .getByTestId("account-selection-off")
      .getAttribute("class");
    for (const level of ["manual", "least_usage", "highest_expected_usage"]) {
      expect(
        screen.getByTestId(`account-selection-${level}`).getAttribute("class")
      ).toBe(offClass);
    }
  });

  it("explains that a system-band answer means a tenant write takes effect", () => {
    usePolicyMock.mockReturnValue(
      leastTenant({ policy: { ...LEAST_TENANT, resolved_scope: "system" } })
    );
    render(<AccountSelectionPanel />);

    expect(
      screen.getByTestId("account-selection-system-fallback").textContent
    ).toMatch(/takes effect immediately/);
    expect(
      screen.queryByTestId("account-selection-overridden-by-repo")
    ).toBeNull();
  });

  it("warns when a repo-band row overrides the tenant row", () => {
    usePolicyMock.mockReturnValue(
      leastTenant({ policy: { ...LEAST_TENANT, resolved_scope: "repo" } })
    );
    render(<AccountSelectionPanel />);
    expect(
      screen.getByTestId("account-selection-overridden-by-repo")
    ).toBeTruthy();
  });

  it("names the fleet_resources keys it does not show", () => {
    usePolicyMock.mockReturnValue(
      leastTenant({
        policy: {
          ...LEAST_TENANT,
          keys_not_shown: ["controls", "drain"],
          keys_not_shown_source: "fleet_resources_row",
        },
      })
    );
    render(<AccountSelectionPanel />);

    expect(
      screen.getByTestId("account-selection-keys-not-shown").textContent
    ).toMatch(/controls, drain.*fleet_resources row/);
  });

  it("disables the write for a non-admin and says why", () => {
    usePolicyMock.mockReturnValue(
      leastTenant({ policy: { ...LEAST_TENANT, can_edit: false } })
    );
    render(<AccountSelectionPanel />);

    expect(
      (screen.getByTestId("account-selection-manual") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getByTestId("account-selection-readonly").textContent
    ).toMatch(/not an admin/);
  });

  it("renders a failed read as unknown, never as no fleet opinion", () => {
    usePolicyMock.mockReturnValue(hookState(null, { error: "HTTP 502" }));
    render(<AccountSelectionPanel />);

    expect(screen.getByTestId("account-selection-effective").textContent).toBe(
      "unknown"
    );
    expect(
      screen.getByTestId("account-selection-readonly").textContent
    ).toMatch(/could not be read/);
    expect(screen.getByTestId("account-selection-error").textContent).toMatch(
      /unknown/
    );
    expect(screen.getByTestId("account-selection-blurb").textContent).toMatch(
      /could not be read/
    );
    expect(screen.queryByTestId("account-selection-no-row")).toBeNull();
  });

  it("surfaces a missing read-back instead of the written level", () => {
    usePolicyMock.mockReturnValue(
      leastTenant({
        readbackError: "read-back failed: coord returned 502",
        lastWrite: { written_level: "manual" },
      })
    );
    render(<AccountSelectionPanel />);

    expect(screen.getByTestId("account-selection-effective").textContent).toBe(
      "Least usage"
    );
    const banner = screen.getByTestId("account-selection-readback-error");
    expect(banner.textContent).toMatch(/502/);
    expect(banner.querySelector("code")?.textContent).toBe("manual");
  });
});

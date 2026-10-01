/**
 * The Regression Tests header names the project it is showing — resolved from
 * the MEMBERSHIP list, never the raw stored id (plan
 * `2026-09-17-regression-tests-target-the-selected-project` Phase 2).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./_components/GroupList", () => ({
  GroupList: () => <div data-testid="group-list" />,
}));

interface TenantMock {
  tenants: { id: string; slug: string; name: string }[];
  activeTenantId: string | null;
}
let tenantMock: TenantMock;
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    ...tenantMock,
    isMultiTenant: tenantMock.tenants.length > 1,
    loading: false,
    error: null,
    setActiveTenantId: () => {},
    refresh: async () => true,
  }),
}));

import ConditionsPage from "./page";

const HOME = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "home",
  name: "Home",
};
const SHOP = {
  id: "22222222-2222-2222-2222-222222222222",
  slug: "shop",
  name: "Pizza Shop",
};

describe("ConditionsPage project label", () => {
  afterEach(() => vi.clearAllMocks());

  it("names the active project beside the title", () => {
    tenantMock = { tenants: [HOME, SHOP], activeTenantId: SHOP.id };
    render(<ConditionsPage />);
    expect(
      screen.getByRole("heading", { name: "Regression Tests" })
    ).toBeTruthy();
    expect(screen.getByTestId("conditions-project").textContent).toBe(
      "Project: Pizza Shop"
    );
  });

  it("names the only project when the user has exactly one", () => {
    tenantMock = { tenants: [HOME], activeTenantId: HOME.id };
    render(<ConditionsPage />);
    expect(screen.getByTestId("conditions-project").textContent).toBe(
      "Project: Home"
    );
  });

  it("shows no project (and never a raw id) for a non-member selection", () => {
    const stale = "33333333-3333-3333-3333-333333333333";
    tenantMock = { tenants: [HOME, SHOP], activeTenantId: stale };
    const { container } = render(<ConditionsPage />);
    expect(screen.queryByTestId("conditions-project")).toBeNull();
    expect(container.textContent).not.toContain(stale);
  });

  it("shows no project while the membership list has not loaded", () => {
    tenantMock = { tenants: [], activeTenantId: SHOP.id };
    const { container } = render(<ConditionsPage />);
    expect(screen.queryByTestId("conditions-project")).toBeNull();
    expect(container.textContent).not.toContain(SHOP.id);
  });
});

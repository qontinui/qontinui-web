import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { TenantSwitcher } from "./TenantSwitcher";

/**
 * Tenant switcher render tests — plan §D12.
 *
 * Confirms the "conditional render" rule:
 *   - Operator in 1 tenant → switcher does NOT render
 *   - Operator in >1 tenant → switcher renders, options match tenants
 *
 * We mock the `useTenant` hook directly to keep the test focused on
 * the switcher's branching logic (the provider is tested elsewhere).
 */

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => useTenantMock(),
}));

let useTenantMock: () => ReturnType<typeof makeTenant>;

function makeTenant(opts: {
  count: number;
  activeId?: string;
  setActive?: (id: string) => void;
}) {
  const tenants = Array.from({ length: opts.count }, (_, i) => ({
    id: `tenant-${i + 1}`,
    slug: `t${i + 1}`,
    name: `Tenant ${i + 1}`,
  }));
  return {
    tenants,
    activeTenantId: opts.activeId ?? tenants[0]?.id ?? null,
    isMultiTenant: opts.count > 1,
    loading: false,
    error: null,
    setActiveTenantId: opts.setActive ?? (() => {}),
  };
}

describe("TenantSwitcher", () => {
  beforeEach(() => {
    useTenantMock = () => makeTenant({ count: 1 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when the operator belongs to exactly 1 tenant", () => {
    useTenantMock = () => makeTenant({ count: 1 });
    const { container } = render(<TenantSwitcher />);
    expect(
      container.querySelector("[data-ui-bridge-id='sessions.tenant-switcher']")
    ).toBeNull();
  });

  it("renders the switcher when the operator belongs to >1 tenant", () => {
    useTenantMock = () => makeTenant({ count: 2 });
    const { container } = render(<TenantSwitcher />);
    expect(
      container.querySelector("[data-ui-bridge-id='sessions.tenant-switcher']")
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-ui-bridge-id='sessions.tenant-switcher-trigger']"
      )
    ).not.toBeNull();
  });

  it("renders nothing when the operator has zero tenants (defensive)", () => {
    useTenantMock = () => makeTenant({ count: 0 });
    const { container } = render(<TenantSwitcher />);
    expect(
      container.querySelector("[data-ui-bridge-id='sessions.tenant-switcher']")
    ).toBeNull();
  });
});

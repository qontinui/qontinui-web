import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewShell } from "./OverviewShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/overview/financials",
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [{ id: "t1", name: "Project One" }],
    activeTenantId: "t1",
    loading: false,
    error: null,
  }),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  OverviewPermissionsProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
}));

describe("OverviewShell", () => {
  it("lays a page's body out at the viewport's width", () => {
    // Without this a wide table on any overview page widens the whole body, and
    // at phone width everything past the screen's edge is cut off.
    const { container } = render(
      <OverviewShell>
        <p>page body</p>
      </OverviewShell>
    );
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="scroll-area-viewport"]')?.className
    ).toContain("[&>div]:!block");
  });
});

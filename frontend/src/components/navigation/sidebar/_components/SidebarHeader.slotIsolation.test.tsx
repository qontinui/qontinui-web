/**
 * Fault-isolation guard for the `organizationSwitcher` component slot.
 *
 * The companion to `../CreateOrganizationDialogSlot.test.tsx`, which covers
 * the same contract for `createOrganizationDialog`. That file's boundary was
 * added after the 2026-08-26 outage and kept afterwards on a reason that is
 * not specific to dialogs: a slot component is FOREIGN code the host cannot
 * typecheck against its own provider tree, so it can throw for reasons the
 * host never sees — including cloud-control registering a component without
 * the provider it depends on, a one-line mistake in a different repo.
 *
 * That argument applies here with a strictly larger blast radius. The dialog
 * is one optional modal; the sidebar renders on EVERY authenticated page, so
 * an unguarded throw from the switcher reaches the root ErrorBoundary in
 * `app/layout.tsx` and white-screens all of them — which is the shape the
 * outage actually took.
 *
 * Contract under test:
 *   - no switcher section at all when the slot is empty (OSS-only)
 *   - the switcher renders when the slot is filled and the header is mounted
 *   - a switcher that THROWS is contained: the host tree survives, the
 *     full-page error card does not appear, and no empty bordered container
 *     is left behind — the same shape the OSS-only build renders
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { SidebarHeader } from "./SidebarHeader";
import { useSlotComponent } from "@/lib/extension-slots";

vi.mock("@/lib/extension-slots", () => ({
  useSlotComponent: vi.fn(),
}));

// Not under test here, and it reads the product-mode context.
vi.mock("./ProductModeSwitcher", () => ({
  ProductModeSwitcher: () => <div data-testid="product-mode" />,
}));

const mockUseSlotComponent = vi.mocked(useSlotComponent);

/** Stand-in for cloud-control's switcher: throws as its real one can. */
function ThrowingSwitcher(): React.ReactElement {
  throw new Error(
    "useOrganization must be used within an OrganizationProvider"
  );
}

/** Marker so we can assert the host tree still rendered. */
function HostSibling() {
  return <div data-testid="host-sibling">host survived</div>;
}

const props = {
  isCollapsed: false,
  mounted: true,
  loading: false,
  switcherOrganizations: [],
  switcherCurrentOrg: null,
  onOrganizationChange: () => {},
  onCreateOrganization: () => {},
};

/**
 * The switcher's wrapper and the product-mode row carry the SAME class list,
 * so presence is counted rather than matched: one such container means the
 * switcher section is absent, two means it is present.
 */
function borderedSections(container: HTMLElement): number {
  // Matched on the class list rather than with a CSS selector: the shared
  // class list contains `py-1.5`, and the `.` in that Tailwind class needs
  // escaping to survive `querySelectorAll`. The logo row above also carries
  // `border-border-subtle`, so `px-2` is what discriminates it (it uses
  // `p-2`).
  return Array.from(container.querySelectorAll("div")).filter(
    (el) =>
      el.className.includes("px-2") &&
      el.className.includes("border-border-subtle")
  ).length;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("SidebarHeader — organizationSwitcher slot", () => {
  it("renders no switcher section in OSS-only mode (no slot registered)", () => {
    mockUseSlotComponent.mockReturnValue(undefined);

    const { container } = render(<SidebarHeader {...props} />);

    expect(screen.queryByTestId("switcher")).not.toBeInTheDocument();
    expect(borderedSections(container)).toBe(1);
  });

  it("subscribes to the slot registry", () => {
    mockUseSlotComponent.mockReturnValue(undefined);

    render(<SidebarHeader {...props} />);

    // A bare `getComponent` read here would leave the switcher permanently
    // absent whenever cloud-control registers after the first render.
    expect(mockUseSlotComponent).toHaveBeenCalledWith("organizationSwitcher");
  });

  it("mounts the switcher when the slot is filled", () => {
    mockUseSlotComponent.mockReturnValue(() => <div data-testid="switcher" />);

    const { container } = render(<SidebarHeader {...props} />);

    expect(screen.getByTestId("switcher")).toBeInTheDocument();
    expect(borderedSections(container)).toBe(2);
  });

  it("contains a throwing switcher instead of taking down the host", () => {
    mockUseSlotComponent.mockReturnValue(ThrowingSwitcher);
    // React logs caught render errors; keep the test output readable.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <div>
        <HostSibling />
        <SidebarHeader {...props} />
      </div>
    );

    // The host tree is intact and the boundary rendered nothing visible — in
    // particular NOT the full-page "Something went wrong" card, which is what
    // a falsy `fallback` would have produced.
    expect(screen.getByTestId("host-sibling")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    // The boundary wraps the wrapper, so a throw leaves NO empty bordered
    // container behind — the same shape as the OSS-only case above.
    expect(borderedSections(container)).toBe(1);

    errorSpy.mockRestore();
  });
});

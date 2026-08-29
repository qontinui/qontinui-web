/**
 * Regression tests for ``<CreateOrganizationDialogSlot>``.
 *
 * Guards the 2026-08-26 production outage: the extension registry
 * transported components and services but NOT React providers, so
 * cloud-control's `CreateOrganizationDialog` — which calls its own
 * package's `useOrganization()`, a hook that THROWS when its Provider is
 * absent rather than returning a safe default — took down every
 * authenticated page via the root ErrorBoundary in `app/layout.tsx`.
 *
 * A `providers` slot has since closed that specific hole (`CloudProviders`),
 * so the outage's own trigger cannot recur. These tests still hold, and the
 * boundary they cover still earns its place: a slot component is foreign
 * code the host cannot typecheck against its own provider tree, and it can
 * throw for reasons the host never sees — including cloud-control
 * registering a component without the provider it depends on.
 *
 * Contract under test:
 *   - nothing renders when no slot component is registered (OSS-only)
 *   - nothing renders while `open` is false, so a closed dialog never
 *     runs the foreign component's hooks
 *   - a slot component that THROWS is contained: it renders nothing and
 *     the surrounding host tree survives
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { CreateOrganizationDialogSlot } from "./UnifiedSidebar";
import { useSlotComponent } from "@/lib/extension-slots";

vi.mock("@/lib/extension-slots", () => ({
  useSlotComponent: vi.fn(),
}));

const mockUseSlotComponent = vi.mocked(useSlotComponent);

/** Stand-in for cloud-control's dialog: throws exactly as it does in prod. */
function ThrowingDialog(): React.ReactElement {
  throw new Error("useOrganization must be used within an OrganizationProvider");
}

/** Marker so we can assert the host tree still rendered. */
function HostSibling() {
  return <div data-testid="host-sibling">host survived</div>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("CreateOrganizationDialogSlot", () => {
  it("renders nothing in OSS-only mode (no slot registered)", () => {
    mockUseSlotComponent.mockReturnValue(undefined);

    const { container } = render(
      <CreateOrganizationDialogSlot open onOpenChange={() => {}} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("does not mount the slot component while closed", () => {
    const slot = vi.fn(() => <div data-testid="dialog" />);
    mockUseSlotComponent.mockReturnValue(slot);

    render(
      <CreateOrganizationDialogSlot open={false} onOpenChange={() => {}} />
    );

    // The foreign component's body — and therefore its hooks — must not run.
    expect(slot).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("still subscribes to the slot registry while closed", () => {
    mockUseSlotComponent.mockReturnValue(undefined);

    render(
      <CreateOrganizationDialogSlot open={false} onOpenChange={() => {}} />
    );

    // The `open` guard must never short-circuit the subscribing hook, or a
    // late `registerCloudExtensions` would never reach this component.
    expect(mockUseSlotComponent).toHaveBeenCalledWith(
      "createOrganizationDialog"
    );
  });

  it("mounts the slot component when open", () => {
    mockUseSlotComponent.mockReturnValue(() => <div data-testid="dialog" />);

    render(<CreateOrganizationDialogSlot open onOpenChange={() => {}} />);

    expect(screen.getByTestId("dialog")).toBeInTheDocument();
  });

  it("contains a throwing slot component instead of taking down the host", () => {
    mockUseSlotComponent.mockReturnValue(ThrowingDialog);
    // React logs caught render errors; keep the test output readable.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      render(
        <div>
          <HostSibling />
          <CreateOrganizationDialogSlot open onOpenChange={() => {}} />
        </div>
      )
    ).not.toThrow();

    // The host tree is intact and the boundary rendered nothing visible —
    // in particular NOT the full-page "Something went wrong" card, which is
    // what a falsy `fallback` would have produced.
    expect(screen.getByTestId("host-sibling")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });
});

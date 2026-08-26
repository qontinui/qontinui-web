/**
 * Regression tests for ``<CreateOrganizationDialogSlot>``.
 *
 * Guards the 2026-08-26 production outage: the extension registry
 * transports components and services but NOT React providers, so
 * cloud-control's `CreateOrganizationDialog` — which calls its own
 * package's `useOrganization()`, a hook that THROWS when its Provider is
 * absent rather than returning a safe default — took down every
 * authenticated page via the root ErrorBoundary in `app/layout.tsx`.
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
import { getComponent } from "@/lib/extension-slots";

vi.mock("@/lib/extension-slots", () => ({
  getComponent: vi.fn(),
}));

const mockGetComponent = vi.mocked(getComponent);

/** Stand-in for cloud-control's dialog: throws exactly as it does in prod. */
function ThrowingDialog() {
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
    mockGetComponent.mockReturnValue(undefined);

    const { container } = render(
      <CreateOrganizationDialogSlot open onOpenChange={() => {}} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("does not mount the slot component while closed", () => {
    const slot = vi.fn(() => <div data-testid="dialog" />);
    mockGetComponent.mockReturnValue(slot);

    render(<CreateOrganizationDialogSlot open={false} onOpenChange={() => {}} />);

    // The foreign component's body — and therefore its hooks — must not run.
    expect(slot).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("mounts the slot component when open", () => {
    mockGetComponent.mockReturnValue(() => <div data-testid="dialog" />);

    render(<CreateOrganizationDialogSlot open onOpenChange={() => {}} />);

    expect(screen.getByTestId("dialog")).toBeInTheDocument();
  });

  it("contains a throwing slot component instead of taking down the host", () => {
    mockGetComponent.mockReturnValue(ThrowingDialog);
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
    // in particular NOT the full-page "Something went wrong" card, which
    // is what a falsy `fallback` would have produced.
    expect(screen.getByTestId("host-sibling")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });
});

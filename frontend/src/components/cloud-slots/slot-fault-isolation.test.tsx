/**
 * Fault-isolation guard for the `betaBanner` and `subscriptionBadge`
 * component slots.
 *
 * These two complete the set with `../navigation/sidebar/
 * CreateOrganizationDialogSlot.test.tsx` (`createOrganizationDialog`) and
 * `../navigation/sidebar/_components/SidebarHeader.slotIsolation.test.tsx`
 * (`organizationSwitcher`). All four assert the same contract, because the
 * reason the dialog's boundary was kept after the `providers` slot closed the
 * 2026-08-26 outage is not specific to dialogs: a slot component is FOREIGN
 * code the host cannot typecheck against its own provider tree, so it can
 * throw for reasons the host never sees — including cloud-control registering
 * a component without the provider it depends on.
 *
 * WHY THESE TWO LIVE IN THEIR OWN MODULES. They used to be local functions
 * inside `app/(app)/layout.tsx` and `app/(app)/profile/page.tsx`, which a
 * test cannot import: as `CloudProviders.test.tsx`'s mount-site block puts
 * it, doing so means mocking a dozen context providers, `next/dynamic` chunks
 * and `useAuth`, "leaving the assertion testing the mocks". Extracted, they
 * are importable on their own, so containment is asserted by rendering a
 * throwing slot rather than by scanning source text for an `<ErrorBoundary>`
 * tag — a scan that could not tell a truthy `fallback` from a falsy one, and
 * the falsy one is what renders the full-page error card.
 *
 * Contract under test, for each slot:
 *   - renders nothing when the slot is empty (OSS-only)
 *   - subscribes to the registry, so a late registration still lands
 *   - renders the slot component when the slot is filled
 *   - a slot component that THROWS is contained: the host tree survives and
 *     the full-page error card does not appear
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { BetaBannerSlot } from "./BetaBannerSlot";
import { SubscriptionBadgeSlot } from "./SubscriptionBadgeSlot";
import { useSlotComponent } from "@/lib/extension-slots";

vi.mock("@/lib/extension-slots", () => ({
  useSlotComponent: vi.fn(),
}));

const mockUseSlotComponent = vi.mocked(useSlotComponent);

/** Stand-in for a cloud-control slot component that throws in production. */
function ThrowingSlot(): React.ReactElement {
  throw new Error(
    "useOrganization must be used within an OrganizationProvider"
  );
}

/** Marker so we can assert the host tree still rendered. */
function HostSibling() {
  return <div data-testid="host-sibling">host survived</div>;
}

afterEach(() => {
  vi.clearAllMocks();
});

const CASES = [
  { name: "BetaBannerSlot", Slot: BetaBannerSlot, slotName: "betaBanner" },
  {
    name: "SubscriptionBadgeSlot",
    Slot: SubscriptionBadgeSlot,
    slotName: "subscriptionBadge",
  },
] as const;

describe.each(CASES)("$name", ({ Slot: Wrapper, slotName }) => {
  it("renders nothing in OSS-only mode (no slot registered)", () => {
    mockUseSlotComponent.mockReturnValue(undefined);

    const { container } = render(<Wrapper />);

    expect(container).toBeEmptyDOMElement();
  });

  it("subscribes to the slot registry", () => {
    mockUseSlotComponent.mockReturnValue(undefined);

    render(<Wrapper />);

    // A bare `getComponent` read would leave the slot permanently empty
    // whenever cloud-control registers after this component's first render.
    expect(mockUseSlotComponent).toHaveBeenCalledWith(slotName);
  });

  it("mounts the slot component when the slot is filled", () => {
    mockUseSlotComponent.mockReturnValue(() => <div data-testid="filled" />);

    render(<Wrapper />);

    expect(screen.getByTestId("filled")).toBeInTheDocument();
  });

  it("contains a throwing slot component instead of taking down the host", () => {
    mockUseSlotComponent.mockReturnValue(ThrowingSlot);
    // React logs caught render errors; keep the test output readable.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      render(
        <div>
          <HostSibling />
          <Wrapper />
        </div>
      )
    ).not.toThrow();

    // The host tree is intact and the boundary rendered nothing visible — in
    // particular NOT the full-page "Something went wrong" card, which is what
    // a falsy `fallback` would have produced.
    expect(screen.getByTestId("host-sibling")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });
});

"use client";

import React from "react";
import { useSlotComponent } from "@/lib/extension-slots";
import type { SubscriptionBadgeProps } from "@/lib/cloud-component-slots";
import { ErrorBoundary } from "@/components/error-boundary";

/**
 * Extracted from its route file so the boundary below can be tested for real.
 *
 * `CloudProviders.test.tsx`'s mount-site block explains why a test must not
 * import `app/(app)/layout.tsx`: doing so means mocking a dozen context
 * providers, `next/dynamic` chunks and `useAuth`, "leaving the assertion
 * testing the mocks". The same is true of `profile/page.tsx`. A slot wrapper
 * that lives in its own module is importable on its own, so its containment
 * can be asserted by rendering a throwing slot rather than by scanning source
 * text for the tag.
 */
/**
 * Renders cloud-control's subscription-tier badge if registered, or nothing
 * in OSS-only mode.
 *
 * `useSlotComponent` subscribes rather than reading once, so a registration
 * that lands after this page has mounted still causes the badge to appear.
 * That used to be the common case: the package was loaded by a
 * fire-and-forget `import(CLOUD_CONTROL_PKG)` in the root layout, which in
 * fact never loaded it at all. It is now a static import in
 * `components/cloud-extensions-boot.tsx`, so in the composed build the slot
 * is filled before hydration — but the subscription is still required,
 * because the boot module lives in the client graph and a server render sees
 * empty slots either way. See `lib/extension-slots.ts`.
 *
 * Fault-isolated for the reason spelled out on `CreateOrganizationDialogSlot`
 * in `components/navigation/sidebar/UnifiedSidebar.tsx`: a slot component is
 * foreign code the host cannot typecheck against its own provider tree, so it
 * can throw for reasons the host never sees. This badge is the narrowest of
 * the four sites — one page, not every authenticated one — but it also reads
 * the cloud BILLING service, so it is the one most likely to throw on a
 * network or shape error rather than a context one. Degrading a badge to
 * nothing beats losing the profile page.
 */
export function SubscriptionBadgeSlot() {
  const Slot = useSlotComponent<SubscriptionBadgeProps>("subscriptionBadge");
  if (!Slot) return null;
  return (
    // Truthy fallback: `ErrorBoundary` tests `if (this.props.fallback)`, so
    // `null` would fall through to its full-page error card.
    <ErrorBoundary fallback={<></>}>
      <Slot />
    </ErrorBoundary>
  );
}

"use client";

import React from "react";
import { useSlotProviders } from "@/lib/extension-slots";

/**
 * Mounts every context provider the cloud package registered, wrapped around
 * `children`. Renders `children` untouched in OSS-only builds, where the
 * provider slot is empty.
 *
 * WHY THIS EXISTS. The extension registry used to transport `components` and
 * `services` but no PROVIDERS. That is not a missing convenience — it made
 * one whole class of cloud component impossible to ship correctly, because a
 * component slot carries a component but not the React context that component
 * reads. Cloud-control's `CreateOrganizationDialog` calls its own package's
 * `useOrganization()`, which throws when its Provider is absent; qontinui-web
 * mounts only the OSS stub provider, a DIFFERENT context object. So the
 * composed build shipped a component that could only ever throw, and on
 * 2026-08-26 it took down every authenticated page on qontinui.io via the root
 * ErrorBoundary in `app/layout.tsx`.
 *
 * Nesting order is registration order: the first-registered provider ends up
 * OUTERMOST, so a later provider may read an earlier one's context. Cloud
 * packages that care must register in dependency order.
 *
 * A LATE registration REMOUNTS everything below. Adding a provider wraps the
 * innermost node in one more element, so the child at that position changes
 * type (a bare `<>{children}</>` becomes a `<Provider>`), and React deletes
 * that subtree and rebuilds it rather than moving it — discarding all of its
 * state. Here that subtree is the whole authenticated tree. It is not
 * fixable: wrapping a subtree in a provider *is* changing its parent.
 *
 * Two separate things keep it from happening in production, and BOTH are
 * load-bearing:
 *
 * 1. `cloud-extensions-boot.tsx` registers through a STATIC import, so the
 *    slot is full before anything here mounts. See
 *    `docs/composed-cloud-build.md`, "Why the boot import is static".
 * 2. `app/(app)/layout.tsx`'s `AppAuthGate` renders `AuthLoadingShell`
 *    instead of its children while `useAuth()` is loading — which on the
 *    server is always — so `CloudProviders` is never in the HYDRATION
 *    render. That matters because `useSyncExternalStore` must use
 *    `getServerSnapshot` when hydrating, and ours is a frozen empty array
 *    (`extension-slots.ts`): a `CloudProviders` present at hydration would
 *    render zero providers and then swap to the real snapshot, which is this
 *    remount, on every composed-build page load. Making auth resolve
 *    synchronously would therefore reintroduce it — a change with no visible
 *    connection to extension slots.
 *
 * `CloudProviders.test.tsx` pins the remount itself. It does NOT pin either
 * condition above: it registers by hand and never imports the boot module.
 * The check that fails if the boot import stops being static is the composed
 * half of `cloud-extensions-boot.registration.test.tsx`, which runs in its
 * own CI job.
 *
 * Each provider is mounted directly, WITHOUT a fault boundary. That is
 * deliberate: a provider is infrastructure for the subtree beneath it, so
 * swallowing its failure would leave every consumer reading a missing context
 * and failing one by one, which is strictly harder to diagnose than one loud
 * error. Fault isolation belongs at the leaf slots that render optional UI
 * (see `CreateOrganizationDialogSlot`), not here.
 */
export function CloudProviders({ children }: { children: React.ReactNode }) {
  const providers = useSlotProviders();

  // reduceRight so providers[0] is the OUTERMOST wrapper.
  return providers.reduceRight<React.ReactElement>(
    (acc, Provider, i) => <Provider key={i}>{acc}</Provider>,
    <>{children}</>
  );
}

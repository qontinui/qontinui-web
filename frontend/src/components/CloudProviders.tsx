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
 *    connection to extension slots, which is why `AppAuthGate` carries a doc
 *    block saying so at the place someone would make that change.
 *
 * `CloudProviders.test.tsx` pins the remount itself. Its rendering cases do
 * NOT pin either condition above: they register by hand and never import the
 * boot module. Condition 1 is pinned by the composed half of
 * `cloud-extensions-boot.registration.test.tsx`, which runs in its own CI
 * job; condition 2 by the "mount site" block at the bottom of
 * `CloudProviders.test.tsx`, which reads `app/(app)/layout.tsx` as source
 * and asserts that this component is rendered at all, that it sits inside
 * `AppAuthGate`, and that the gate's early return is still keyed on
 * `loading`. That block's header states what a source scan does and does not
 * buy; read it before trusting or extending it.
 *
 * A THIRD thing makes the OSS-only build immune independently of both: the
 * client and server provider snapshots start as the same frozen array, not
 * two equal ones, so React finds nothing changed after hydrating. That holds
 * only until a registration lands, so it protects OSS-only builds and not
 * composed ones — see `NO_PROVIDERS` in `extension-slots.ts`.
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

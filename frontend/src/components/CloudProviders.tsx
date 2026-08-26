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

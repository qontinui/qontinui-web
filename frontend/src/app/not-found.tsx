"use client";

/**
 * Root not-found boundary.
 *
 * Rendered by Next.js for every unmatched URL (and for any `notFound()` call
 * without a nearer boundary) INSIDE the root layout, where
 * `RouteAwarenessProvider` is mounted with `useParams() == {}`. On its own that
 * provider would derive its route "pattern" from the concrete pathname —
 * `/search/<what the user typed>` — and report it to the UI Bridge navigation
 * tracker as a template.
 *
 * `useMarkRouteUnmatched()` raises the provider-owned not-found signal in a
 * layout effect, which runs before the provider's passive effect in the same
 * commit, so the provider reports `pattern: null` instead. Do NOT call
 * `useRouteAwareness` here: the provider's passive effect runs after this
 * component's and would overwrite it.
 *
 * The no-argument form reads `RouteUnmatchedContext` from
 * `RouteAwarenessProvider`, which must stay an ancestor (root layout ->
 * `UIBridgeWrapper` -> `RouteAwarenessProvider` -> children). Without it the
 * hook silently does nothing.
 */

import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { useMarkRouteUnmatched } from "@qontinui/ui-bridge/react";

export default function NotFound() {
  useMarkRouteUnmatched();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="empty-state">
        <FileQuestion className="empty-state-icon" aria-hidden="true" />
        <h1 className="empty-state-title">Page not found</h1>
        <p className="empty-state-desc">
          The page you are looking for does not exist or has moved.
        </p>
        <Link href="/" className="btn-primary mt-6">
          Go to the home page
        </Link>
      </div>
    </main>
  );
}

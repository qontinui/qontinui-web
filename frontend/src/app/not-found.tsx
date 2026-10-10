"use client";

/**
 * Root not-found boundary.
 *
 * Rendered by Next.js INSIDE the root layout, below `RouteAwarenessProvider`,
 * for every unmatched URL and for any `notFound()` call without a nearer
 * boundary. For an unmatched URL `useParams()` is `{}`, so on its own that
 * provider would derive its route "pattern" from the concrete pathname —
 * `/search/<what the user typed>` — and report it to the UI Bridge navigation
 * tracker as a template. A `notFound()` thrown from a dynamic page still has
 * that page's params; the signal reports `pattern: null` there too.
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
 *
 * Precondition: this boundary must mount in the SAME commit as the navigation
 * that reached it. A future root-level `loading.tsx`, or a Suspense boundary
 * between the provider and its children, would first commit a loading state
 * with the new concrete pathname, and the provider would report it once.
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

"use client";

/**
 * Build refresh banner for qontinui-web.
 *
 * Mirrors the supervisor dashboard's `BuildRefreshBanner` (see
 * `qontinui-supervisor/frontend/src/components/BuildRefreshBanner.tsx`).
 *
 * Flow:
 *   1. `npm run build` regenerates `<meta name="build-id">` (rendered in
 *      `app/layout.tsx`) plus the SW's `CACHE_NAME = qontinui-<build-id>`.
 *   2. `useBuildIdWatcher` polls `/api/health`, comparing the returned
 *      `buildId` against the meta-tag value the page was served with.
 *   3. On divergence, we postMessage `BUILD_ID_CHANGED` to the active SW
 *      (which purges stale caches + calls `skipWaiting`) and flip `stale`
 *      to render the banner.
 *   4. User clicks "Refresh" → `window.location.reload()` picks up the new
 *      bundle.
 *
 * Inline styles mirror the supervisor's banner so the visual feel matches
 * across hosts even though qontinui-web uses Tailwind elsewhere.
 */
import { useState } from "react";
import { useBuildIdWatcher } from "@qontinui/ui-bridge/react";
import { serviceWorkerManager } from "@/lib/service-worker";

export function BuildRefreshBanner() {
  const [stale, setStale] = useState(false);

  useBuildIdWatcher({
    pollUrl: "/api/health",
    pollIntervalMs: 30_000,
    onBuildIdChange: (_oldId, newId) => {
      // Best-effort cache purge before user reload. If the SW isn't
      // controlling the page yet, this is a no-op and the next `load`
      // event registers the freshly-deployed SW anyway.
      try {
        serviceWorkerManager.notifyBuildIdChange(newId);
      } catch {
        /* swallow — we still want to surface the banner */
      }
      setStale(true);
    },
  });

  if (!stale) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: "var(--bg-tertiary, #242837)",
        color: "var(--text-primary, #e4e4e7)",
        border: "1px solid var(--accent, #6366f1)",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
        fontSize: "0.875rem",
      }}
    >
      <span>New version available — refresh to update</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          background: "var(--accent, #6366f1)",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          padding: "4px 10px",
          fontSize: "0.8125rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Refresh
      </button>
    </div>
  );
}

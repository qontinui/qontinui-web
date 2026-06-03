/**
 * Ξ_ClientTelemetry — release resolution (plan §3.1 ``release`` field).
 *
 * Plan: D:/qontinui-root/plans/2026-05-31-twin-client-telemetry-layer.md
 *
 * ``release`` is the spine of the layer — it ties every event to a deploy,
 * which is what makes the continuous post-deploy gate (§4.3) possible.
 *
 * We reuse the SAME build-id source the rest of the app already uses (the
 * ``<meta name="build-id">`` tag mirror): ``NEXT_PUBLIC_BUILD_ID`` (primary,
 * baked at build time) falling back to the generated ``BUILD_ID`` module
 * (regenerated on every ``npm run build`` by ``scripts/inject-build-id.mjs``).
 * This keeps the telemetry ``release`` identical to the build-id the
 * ``useBuildIdWatcher`` reload-banner keys on, so a deploy correlates 1:1.
 */

import { BUILD_ID } from "@/generated/build-id";

/**
 * Resolve the current bundle release (build-id). Returns ``"unknown"`` only if
 * both the env var and the generated module are unset (should not happen in a
 * real build — the generated module ships a ``"dev"`` placeholder).
 */
export function resolveRelease(): string {
  const fromEnv = process.env.NEXT_PUBLIC_BUILD_ID;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  if (BUILD_ID && BUILD_ID.trim()) return BUILD_ID.trim();
  return "unknown";
}

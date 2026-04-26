/**
 * GET /api/health — liveness probe + build-id source.
 *
 * Polled by `useBuildIdWatcher` from @qontinui/ui-bridge/react (configured
 * in `BuildRefreshBanner.tsx`). Response shape mirrors the supervisor's
 * `/health` JSON so the same hook drives both hosts.
 *
 * Must NOT be cached — the whole point is to detect a build-id change
 * within one polling interval after deploy.
 */
import { NextResponse } from "next/server";
import { BUILD_ID } from "@/generated/build-id";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  // BUILD_ID is inlined at build time from src/generated/build-id.ts (which
  // scripts/inject-build-id.mjs regenerates pre-build). The previous
  // `process.env.NEXT_PUBLIC_BUILD_ID` fallback was redundant — both come
  // from the same pre-build step and Next inlines NEXT_PUBLIC_* env vars
  // at build time too, so they're literally identical strings.
  const buildId = BUILD_ID || "unknown";
  return NextResponse.json(
    { ok: true, buildId },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    }
  );
}

"use client";

/**
 * Locks helper-only users to the /help portal.
 *
 * Mounted inside the (app) shell's auth gate. Once the session is
 * authenticated it asks the backend whether the user is *helper-only*
 * (holds a HELPER org role and nothing above it in any shared org) and, if
 * so, replaces the current route with /help. Non-helpers are untouched —
 * they can still visit /help voluntarily (owners test the queue).
 *
 * This is a client-side soft gate, deliberately matching the app's existing
 * auth posture (`middleware.ts` is a cookie-presence soft gate; the real
 * gate is `AppAuthGate` + the backend). The hard boundary for helpers is
 * server-side regardless: every dev API requires roles a helper does not
 * have (HELPER ranks below VIEWER).
 *
 * The verdict is cached in sessionStorage — KEYED BY USER ID — so route
 * changes within a session redirect synchronously instead of re-fetching
 * (and to avoid a visible flash of the app shell). Keying by user id is
 * load-bearing: an unkeyed cached "1" would bounce the NEXT user in the
 * same tab to /help forever. A cached value is only ever a hint for the
 * CURRENT user; with no user id resolved yet the cache is not consulted.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { fetchHelperStatus } from "./api";

const CACHE_KEY_PREFIX = "qontinui.helper_only:";
// Pre-fix unkeyed key — always removed so a stale verdict from an older
// build can never lock a different user out.
const LEGACY_CACHE_KEY = "qontinui.helper_only";

function cacheKeyFor(userId: string): string {
  return `${CACHE_KEY_PREFIX}${userId}`;
}

function readCachedVerdict(userId: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKeyFor(userId));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // sessionStorage unavailable — fall through to a fresh fetch.
  }
  return null;
}

function writeCachedVerdict(userId: string, value: boolean): void {
  try {
    const ownKey = cacheKeyFor(userId);
    // Drop verdicts cached for OTHER users (and the legacy unkeyed key) so
    // a stale entry can never gate the next user in this tab.
    window.sessionStorage.removeItem(LEGACY_CACHE_KEY);
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(CACHE_KEY_PREFIX) && key !== ownKey) {
        window.sessionStorage.removeItem(key);
      }
    }
    window.sessionStorage.setItem(ownKey, value ? "1" : "0");
  } catch {
    // Best-effort cache only.
  }
}

export function HelperRedirectGate() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !user?.id) return;
    const userId = user.id;

    const cached = readCachedVerdict(userId);
    if (cached === true) {
      router.replace("/help");
      return;
    }
    if (cached === false) return;

    let cancelled = false;
    fetchHelperStatus()
      .then((status) => {
        if (cancelled) return;
        writeCachedVerdict(userId, status.is_helper_only);
        if (status.is_helper_only) {
          router.replace("/help");
        }
      })
      .catch(() => {
        // Status unavailable (backend restart, coord down) — fail open for
        // this navigation; the next mount retries. Server-side permission
        // checks remain the hard boundary.
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user, router, pathname]);

  return null;
}

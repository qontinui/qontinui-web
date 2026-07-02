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
 * The verdict is cached in sessionStorage so route changes within a session
 * redirect synchronously instead of re-fetching (and to avoid a visible
 * flash of the app shell).
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { fetchHelperStatus } from "./api";

const CACHE_KEY = "qontinui.helper_only";

function readCachedVerdict(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // sessionStorage unavailable — fall through to a fresh fetch.
  }
  return null;
}

function writeCachedVerdict(value: boolean): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, value ? "1" : "0");
  } catch {
    // Best-effort cache only.
  }
}

export function HelperRedirectGate() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !user) return;

    const cached = readCachedVerdict();
    if (cached === true) {
      router.replace("/help");
      return;
    }
    if (cached === false) return;

    let cancelled = false;
    fetchHelperStatus()
      .then((status) => {
        if (cancelled) return;
        writeCachedVerdict(status.is_helper_only);
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

"use client";

/**
 * Dev Reset Page - Clears all browser state and shows auth debug info
 * Only available in development mode
 *
 * Visit /dev/reset to:
 * - Clear localStorage
 * - Clear sessionStorage
 * - Clear cookies (via backend logout)
 * - Show current auth state for debugging
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface DebugInfo {
  timestamp: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: string[];
  cleared: boolean;
}

export default function DevResetPage() {
  const router = useRouter();
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [isClearing, setIsClearing] = useState(true);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null); // null = no auto-redirect

  useEffect(() => {
    // Only run in development
    if (process.env.NODE_ENV !== "development") {
      router.push("/");
      return;
    }

    const clearAndCollectDebug = async () => {
      // Collect debug info BEFORE clearing
      const localStorageData: Record<string, string> = {};
      const sessionStorageData: Record<string, string> = {};

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          localStorageData[key] = localStorage.getItem(key) || "";
        }
      }

      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          sessionStorageData[key] = sessionStorage.getItem(key) || "";
        }
      }

      const cookies = document.cookie.split(";").map(c => c.trim()).filter(Boolean);

      // Clear localStorage
      localStorage.clear();
      console.log("[DevReset] localStorage cleared");

      // Clear sessionStorage
      sessionStorage.clear();
      console.log("[DevReset] sessionStorage cleared");

      // Clear cookies by calling logout endpoint (clears HttpOnly cookies)
      try {
        await fetch("/api/v1/auth/jwt/logout", {
          method: "POST",
          credentials: "include",
        });
        console.log("[DevReset] Logout endpoint called (HttpOnly cookies cleared)");
      } catch (e) {
        console.log("[DevReset] Logout endpoint failed (may already be logged out)");
      }

      // Clear any remaining accessible cookies
      document.cookie.split(";").forEach(cookie => {
        const name = cookie.split("=")[0].trim();
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      });
      console.log("[DevReset] Accessible cookies cleared");

      // Clear IndexedDB databases (project data, screenshots)
      try {
        const databases = await indexedDB.databases();
        for (const db of databases) {
          if (db.name) {
            indexedDB.deleteDatabase(db.name);
            console.log(`[DevReset] IndexedDB "${db.name}" deleted`);
          }
        }
      } catch (e) {
        console.log("[DevReset] IndexedDB clear failed:", e);
      }

      setDebugInfo({
        timestamp: new Date().toISOString(),
        localStorage: localStorageData,
        sessionStorage: sessionStorageData,
        cookies,
        cleared: true,
      });

      setIsClearing(false);
    };

    clearAndCollectDebug();
  }, [router]);

  // Countdown and redirect (only if countdown is active)
  useEffect(() => {
    if (!isClearing && redirectCountdown !== null && redirectCountdown > 0) {
      const timer = setTimeout(() => {
        setRedirectCountdown(redirectCountdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (redirectCountdown === 0) {
      router.push("/");
    }
  }, [isClearing, redirectCountdown, router]);

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-[#00D9FF]">Dev Reset</h1>
        <p className="text-gray-400 mb-8">Browser state cleared for debugging</p>

        {isClearing ? (
          <div className="flex items-center gap-3">
            <div className="animate-spin w-6 h-6 border-2 border-[#00D9FF] border-t-transparent rounded-full" />
            <span>Clearing browser state...</span>
          </div>
        ) : (
          <>
            {/* Status */}
            <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-medium text-green-400">All browser state cleared successfully</span>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() => router.push("/")}
                  className="px-4 py-2 bg-[#00D9FF] text-black font-medium rounded-lg hover:bg-[#00D9FF]/80 transition-colors"
                >
                  Go to Login
                </button>
                <button
                  onClick={() => router.push("/dashboard")}
                  className="px-4 py-2 bg-gray-700 text-white font-medium rounded-lg hover:bg-gray-600 transition-colors"
                >
                  Go to Dashboard
                </button>
              </div>
            </div>

            {/* Debug Info */}
            {debugInfo && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-2 text-gray-300">
                    Cleared at: {debugInfo.timestamp}
                  </h2>
                </div>

                {/* localStorage (before clear) */}
                <div>
                  <h3 className="text-md font-medium mb-2 text-[#BD00FF]">
                    localStorage (was {Object.keys(debugInfo.localStorage).length} items)
                  </h3>
                  <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-48 overflow-y-auto">
                    {Object.keys(debugInfo.localStorage).length === 0 ? (
                      <span className="text-gray-500">Empty</span>
                    ) : (
                      <pre className="text-xs text-gray-300">
                        {Object.entries(debugInfo.localStorage).map(([key, value]) => (
                          <div key={key} className="mb-1">
                            <span className="text-[#00D9FF]">{key}:</span>{" "}
                            <span className="text-gray-400">
                              {value.length > 100 ? value.substring(0, 100) + "..." : value}
                            </span>
                          </div>
                        ))}
                      </pre>
                    )}
                  </div>
                </div>

                {/* sessionStorage (before clear) */}
                <div>
                  <h3 className="text-md font-medium mb-2 text-[#BD00FF]">
                    sessionStorage (was {Object.keys(debugInfo.sessionStorage).length} items)
                  </h3>
                  <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-32 overflow-y-auto">
                    {Object.keys(debugInfo.sessionStorage).length === 0 ? (
                      <span className="text-gray-500">Empty</span>
                    ) : (
                      <pre className="text-xs text-gray-300">
                        {Object.entries(debugInfo.sessionStorage).map(([key, value]) => (
                          <div key={key} className="mb-1">
                            <span className="text-[#00D9FF]">{key}:</span>{" "}
                            <span className="text-gray-400">
                              {value.length > 100 ? value.substring(0, 100) + "..." : value}
                            </span>
                          </div>
                        ))}
                      </pre>
                    )}
                  </div>
                </div>

                {/* Cookies (before clear) */}
                <div>
                  <h3 className="text-md font-medium mb-2 text-[#BD00FF]">
                    Cookies (was {debugInfo.cookies.length} accessible)
                  </h3>
                  <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-32 overflow-y-auto">
                    {debugInfo.cookies.length === 0 ? (
                      <span className="text-gray-500">No accessible cookies (HttpOnly cookies not visible)</span>
                    ) : (
                      <pre className="text-xs text-gray-300">
                        {debugInfo.cookies.map((cookie, i) => (
                          <div key={i} className="mb-1">{cookie}</div>
                        ))}
                      </pre>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Note: HttpOnly cookies (auth tokens) are cleared via logout endpoint
                  </p>
                </div>

                {/* What was cleared */}
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <h3 className="text-md font-medium mb-2 text-white">Actions Taken:</h3>
                  <ul className="text-sm text-gray-400 space-y-1">
                    <li>✓ localStorage.clear()</li>
                    <li>✓ sessionStorage.clear()</li>
                    <li>✓ Called /api/v1/auth/jwt/logout (clears HttpOnly cookies)</li>
                    <li>✓ Cleared accessible document.cookie entries</li>
                    <li>✓ Deleted IndexedDB databases (project data)</li>
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOfflineRef = useRef(false);
  const reconnectedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    // Only run in browser
    if (typeof window === "undefined") return;

    const updateOnlineStatus = () => {
      const currentlyOnline = navigator.onLine;
      // Use ref to track previous state without causing re-renders
      if (wasOfflineRef.current && currentlyOnline) {
        setShowReconnected(true);
        if (reconnectedTimeoutRef.current) {
          clearTimeout(reconnectedTimeoutRef.current);
        }
        reconnectedTimeoutRef.current = setTimeout(
          () => setShowReconnected(false),
          3000
        );
      }
      wasOfflineRef.current = !currentlyOnline;
      setIsOnline(currentlyOnline);
    };

    // Check initial status
    setIsOnline(navigator.onLine);
    wasOfflineRef.current = !navigator.onLine;

    // Listen for online/offline events (no polling needed — browser fires these reliably)
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
      if (reconnectedTimeoutRef.current) {
        clearTimeout(reconnectedTimeoutRef.current);
      }
    };
  }, []); // Empty dependency array - effect only runs once on mount

  if (isOnline && !showReconnected) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ${
        !isOnline ? "animate-pulse" : ""
      }`}
    >
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg ${
          isOnline
            ? "bg-green-500 text-white"
            : "bg-destructive text-destructive-foreground"
        }`}
      >
        {isOnline ? (
          <>
            <Wifi className="h-4 w-4" />
            <span className="text-sm font-medium">Back online</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span className="text-sm font-medium">No internet connection</span>
          </>
        )}
      </div>
    </div>
  );
}

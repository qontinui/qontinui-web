'use client';

import React, { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    const updateOnlineStatus = () => {
      const wasOffline = !isOnline;
      setIsOnline(navigator.onLine);

      // Show reconnected message briefly
      if (wasOffline && navigator.onLine) {
        setShowReconnected(true);
        setTimeout(() => setShowReconnected(false), 3000);
      }
    };

    // Check initial status
    setIsOnline(navigator.onLine);

    // Listen for online/offline events
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Periodic check (every 5 seconds)
    const interval = setInterval(updateOnlineStatus, 5000);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      clearInterval(interval);
    };
  }, [isOnline]);

  if (isOnline && !showReconnected) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ${
        !isOnline ? 'animate-pulse' : ''
      }`}
    >
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg ${
          isOnline
            ? 'bg-green-500 text-white'
            : 'bg-destructive text-destructive-foreground'
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

"use client";

import React, { useState, useEffect } from 'react';
import { X, Calendar, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Early Access Dashboard Banner
 *
 * Slim banner shown at the top of the dashboard to remind users about early access status.
 * Dismissible per session (reappears on next login).
 *
 * Based on: EARLY-ACCESS-WARNING-IMPLEMENTATION.md lines 136-143
 */

const BANNER_STORAGE_KEY = 'qontinui-early-access-banner-dismissed';

interface EarlyAccessBannerProps {
  onExport?: () => void;
}

export function EarlyAccessBanner({ onExport }: EarlyAccessBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  // Check if banner was dismissed this session
  useEffect(() => {
    const dismissed = sessionStorage.getItem(BANNER_STORAGE_KEY);
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    sessionStorage.setItem(BANNER_STORAGE_KEY, 'true');
    setIsDismissed(true);
  };

  const handleExport = () => {
    if (onExport) {
      onExport();
    } else {
      // Fallback: show info toast if export handler not provided
      console.log('Export functionality - please wire up export handler');
    }
  };

  if (isDismissed) {
    return null;
  }

  return (
    <div className={cn(
      "w-full bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-blue-500/10",
      "border-b border-blue-500/30",
      "shadow-[0_2px_10px_rgba(59,130,246,0.1)]",
      "animate-in slide-in-from-top duration-300"
    )}>
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Message */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-blue-400" />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="text-blue-300 font-semibold">🚀 Early Access</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-300">Launches Feb 2026</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-300">Export your work regularly</span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              className={cn(
                "border-blue-500/50 text-blue-300 hover:bg-blue-500/10 hover:text-blue-200",
                "hover:border-blue-400/70 transition-all duration-200",
                "text-xs h-8"
              )}
            >
              <Download className="h-3 w-3 mr-1.5" />
              Export
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 h-8 w-8 p-0"
              title="Dismiss for this session"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

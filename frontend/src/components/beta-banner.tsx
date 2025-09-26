'use client';

import React, { useState, useEffect } from 'react';
import { X, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function BetaBanner() {
  const [isVisible, setIsVisible] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
    const dismissed = localStorage.getItem('beta-banner-dismissed') === 'true';
    setIsVisible(!dismissed);
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem('beta-banner-dismissed', 'true');
    }
  };

  // Don't render anything until hydration is complete to avoid mismatch
  if (!isHydrated) {
    return null;
  }

  if (!isVisible) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 flex-shrink-0" />
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
              <span className="font-semibold">Welcome to Qontinui Beta!</span>
              <span className="text-sm opacity-90">
                We're actively developing new features. Your feedback helps us improve.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/20"
              onClick={() => window.open('https://github.com/qontinui/feedback', '_blank')}
            >
              Give Feedback
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={handleDismiss}
              aria-label="Dismiss beta banner"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BetaBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-white">
      <Sparkles className="h-3 w-3" />
      BETA
    </span>
  );
}

export function BetaFeatureAlert({ feature }: { feature: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
      <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
      <div className="text-sm">
        <span className="font-medium text-blue-900 dark:text-blue-100">Beta Feature: </span>
        <span className="text-blue-700 dark:text-blue-300">{feature}</span>
      </div>
    </div>
  );
}

"use client";

/**
 * OnboardingTour Component
 *
 * Thin wrapper that triggers the onboarding tutorial using the new tutorial system.
 * The actual tutorial rendering is handled by ContextualTutorialEnhanced.
 *
 * Features:
 * - Auto-starts tutorial for new users
 * - Provides a "Start Tour" button for users who have completed or skipped
 * - Respects admin page and superuser exclusions
 */

import React, { useEffect, useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PlayCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useTutorialStore } from "@/stores/tutorial-store";
import { getTutorialById } from "@/components/tutorial/data";

const ONBOARDING_TUTORIAL_ID = "onboarding-tour";

export function OnboardingTour() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  const {
    openTutorial,
    isOpen,
    completedTutorials,
  } = useTutorialStore();

  // Check if onboarding has been completed
  const isOnboardingCompleted = completedTutorials.includes(ONBOARDING_TUTORIAL_ID);

  // Start the onboarding tour
  const startTour = useCallback(() => {
    const tutorial = getTutorialById(ONBOARDING_TUTORIAL_ID);
    if (tutorial) {
      openTutorial(tutorial, "contextual");
    }
  }, [openTutorial]);

  // Auto-start tour for new users
  useEffect(() => {
    // Only run on client
    if (typeof window === "undefined") return;

    // Don't auto-start if already started or completed
    if (hasAutoStarted || isOnboardingCompleted) return;

    // Don't auto-start if a tutorial is already running
    if (isOpen) return;

    // Only auto-start if user is logged in
    if (!user) return;

    // Don't show tour on admin page or for admin users
    const isAdminPage = pathname?.startsWith("/admin");
    if (isAdminPage || user.is_superuser) return;

    // Check legacy localStorage for users who completed the old tour
    const legacyCompleted = localStorage.getItem("onboarding-tour-completed");
    if (legacyCompleted) {
      // Mark as completed in the new system too
      useTutorialStore.getState().markTutorialCompleted(ONBOARDING_TUTORIAL_ID);
      return;
    }

    // Auto-start tour for new users after a short delay
    const timer = setTimeout(() => {
      setHasAutoStarted(true);
      startTour();
    }, 2000);

    return () => clearTimeout(timer);
  }, [
    user,
    pathname,
    isOpen,
    hasAutoStarted,
    isOnboardingCompleted,
    startTour,
  ]);

  // Don't render anything if user is not logged in
  if (!user) {
    return null;
  }

  // Don't show tour button on admin page or for admin users
  const isAdminPage = pathname?.startsWith("/admin");
  if (isAdminPage || user.is_superuser) {
    return null;
  }

  // Don't show button if any tutorial is currently active
  if (isOpen) {
    return null;
  }

  // Only show button if the tour has been completed or skipped
  // (otherwise it will auto-start)
  if (!isOnboardingCompleted && !hasAutoStarted) {
    return null;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={startTour}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2"
      data-tutorial-id="start-tour-btn"
    >
      <PlayCircle className="h-4 w-4" />
      Start Tour
    </Button>
  );
}

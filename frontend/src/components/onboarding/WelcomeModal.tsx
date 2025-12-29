"use client";

import React, { useState, useEffect } from "react";
import { Brain, Target, Zap, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface Benefit {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
}

// ============================================================================
// Constants
// ============================================================================

const BENEFITS: Benefit[] = [
  {
    icon: Brain,
    title: "Intelligent Automation",
    description:
      "AI-powered visual recognition that understands your applications",
    color: "text-[#00D9FF]",
  },
  {
    icon: Target,
    title: "Adaptive Precision",
    description:
      "Automatically adapts to UI changes without breaking workflows",
    color: "text-[#BD00FF]",
  },
  {
    icon: Zap,
    title: "Lightning Fast",
    description: "Build complex automations in minutes with our visual editor",
    color: "text-[#00FF88]",
  },
];

// ============================================================================
// Component
// ============================================================================

export function WelcomeModal() {
  const {
    showWelcomeModal,
    dontShowWelcomeAgain,
    toggleWelcomeModal,
    setDontShowWelcomeAgain,
    completeWelcome,
    startTour,
  } = useOnboardingStore();

  const [dontShowAgain, setDontShowAgain] = useState(dontShowWelcomeAgain);
  const [isClosing, setIsClosing] = useState(false);

  // Update local state when store changes
  useEffect(() => {
    setDontShowAgain(dontShowWelcomeAgain);
  }, [dontShowWelcomeAgain]);

  // Handle modal close with animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      toggleWelcomeModal(false);
      setIsClosing(false);
    }, 200);
  };

  // Handle "Take Tour" button
  const handleTakeTour = () => {
    if (dontShowAgain) {
      setDontShowWelcomeAgain(true);
    }
    completeWelcome();
    startTour();
    handleClose();
  };

  // Handle "Skip to Dashboard" button
  const handleSkipToDashboard = () => {
    if (dontShowAgain) {
      setDontShowWelcomeAgain(true);
    }
    completeWelcome();
    handleClose();
  };

  // Handle checkbox change
  const handleDontShowAgainChange = (checked: boolean) => {
    setDontShowAgain(checked);
  };

  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showWelcomeModal) {
        handleSkipToDashboard();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showWelcomeModal, dontShowAgain]);

  return (
    <Dialog open={showWelcomeModal} onOpenChange={toggleWelcomeModal}>
      <DialogContent
        className={cn(
          "max-w-2xl border-gray-800/50 bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] p-0 overflow-hidden",
          "shadow-[0_0_50px_rgba(0,217,255,0.15)]",
          isClosing && "animate-out fade-out-0 zoom-out-95"
        )}
        showCloseButton={false}
      >
        {/* Neon Glow Background Effects */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-[#00D9FF]/10 rounded-full blur-[120px] animate-pulse" />
          <div
            className="absolute bottom-0 left-0 w-96 h-96 bg-[#BD00FF]/10 rounded-full blur-[120px] animate-pulse"
            style={{ animationDelay: "1s" }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 p-8">
          {/* Header */}
          <DialogHeader className="text-center mb-8">
            <DialogTitle className="text-4xl font-bold mb-4 bg-gradient-to-r from-[#00D9FF] via-[#BD00FF] to-[#00FF88] bg-clip-text text-transparent animate-in fade-in-0 slide-in-from-top-4 duration-500">
              Welcome to Qontinui!
            </DialogTitle>
            <DialogDescription className="text-lg text-gray-300 animate-in fade-in-0 slide-in-from-top-4 duration-700 delay-150">
              Intelligent automation that adapts to changes
            </DialogDescription>
          </DialogHeader>

          {/* Benefits Grid */}
          <div className="grid gap-6 mb-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-700 delay-300">
            {BENEFITS.map((benefit, index) => {
              const Icon = benefit.icon;
              return (
                <div
                  key={benefit.title}
                  className="group flex items-start gap-4 p-4 rounded-lg bg-[#1A1A1B]/30 border border-gray-800/50 hover:border-gray-700/50 transition-all duration-300 hover:bg-[#1A1A1B]/50"
                  style={{
                    animationDelay: `${index * 100 + 400}ms`,
                  }}
                >
                  <div
                    className={cn(
                      "flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center",
                      "bg-gradient-to-br from-gray-900 to-gray-800/50 border border-gray-700/50",
                      "group-hover:border-gray-600/50 transition-all duration-300"
                    )}
                  >
                    <Icon className={cn("w-6 h-6", benefit.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-white mb-1">
                      {benefit.title}
                    </h3>
                    <p className="text-sm text-gray-400">
                      {benefit.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-700 delay-700">
            <Button
              onClick={handleTakeTour}
              className={cn(
                "flex-1 h-12 text-base font-semibold",
                "bg-gradient-to-r from-[#00D9FF] to-[#00D9FF]/80 hover:from-[#00D9FF]/90 hover:to-[#00D9FF]/70",
                "text-black border-0",
                "shadow-[0_0_20px_rgba(0,217,255,0.3)] hover:shadow-[0_0_30px_rgba(0,217,255,0.5)]",
                "transition-all duration-300"
              )}
              aria-label="Take the interactive tour"
            >
              Take Tour
            </Button>
            <Button
              onClick={handleSkipToDashboard}
              variant="outline"
              className={cn(
                "flex-1 h-12 text-base font-semibold",
                "bg-transparent border-gray-700 hover:border-[#BD00FF] hover:bg-[#BD00FF]/10",
                "text-gray-300 hover:text-[#BD00FF]",
                "shadow-[0_0_15px_rgba(189,0,255,0)] hover:shadow-[0_0_25px_rgba(189,0,255,0.3)]",
                "transition-all duration-300"
              )}
              aria-label="Skip tour and go to dashboard"
            >
              Skip to Dashboard
            </Button>
          </div>

          {/* Don't Show Again Checkbox */}
          <div className="flex items-center gap-2 mb-6 animate-in fade-in-0 duration-700 delay-900">
            <Checkbox
              id="dontShowAgain"
              checked={dontShowAgain}
              onCheckedChange={handleDontShowAgainChange}
              className="border-gray-600 data-[state=checked]:bg-[#00D9FF] data-[state=checked]:border-[#00D9FF]"
              aria-label="Don't show this welcome message again"
            />
            <Label
              htmlFor="dontShowAgain"
              className="text-sm text-gray-400 cursor-pointer select-none"
            >
              Don&apos;t show this again
            </Label>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 animate-in fade-in-0 duration-700 delay-1000">
            <HelpCircle className="w-4 h-4" />
            <span>
              You can always access help and tutorials from the dashboard
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

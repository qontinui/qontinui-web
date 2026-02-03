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
    color: "text-brand-primary",
  },
  {
    icon: Target,
    title: "Adaptive Precision",
    description:
      "Automatically adapts to UI changes without breaking workflows",
    color: "text-brand-secondary",
  },
  {
    icon: Zap,
    title: "Lightning Fast",
    description: "Build complex automations in minutes with our visual editor",
    color: "text-brand-success",
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSkipToDashboard uses dontShowAgain internally
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
          "max-w-2xl border-border-subtle/50 bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas p-0 overflow-hidden",
          "shadow-[0_0_50px_rgba(0,217,255,0.15)]",
          isClosing && "animate-out fade-out-0 zoom-out-95"
        )}
        showCloseButton={false}
        data-ui-id="dialog-welcome"
      >
        {/* Neon Glow Background Effects */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-brand-primary/10 rounded-full blur-[120px] animate-pulse" />
          <div
            className="absolute bottom-0 left-0 w-96 h-96 bg-brand-secondary/10 rounded-full blur-[120px] animate-pulse"
            style={{ animationDelay: "1s" }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 p-8">
          {/* Header */}
          <DialogHeader className="text-center mb-8">
            <DialogTitle className="text-4xl font-bold mb-4 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-success bg-clip-text text-transparent animate-in fade-in-0 slide-in-from-top-4 duration-500">
              Welcome to Qontinui!
            </DialogTitle>
            <DialogDescription className="text-lg text-text-secondary animate-in fade-in-0 slide-in-from-top-4 duration-700 delay-150">
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
                  className="group flex items-start gap-4 p-4 rounded-lg bg-surface-raised/30 border border-border-subtle/50 hover:border-border-default/50 transition-all duration-300 hover:bg-surface-raised/50"
                  style={{
                    animationDelay: `${index * 100 + 400}ms`,
                  }}
                >
                  <div
                    className={cn(
                      "flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center",
                      "bg-gradient-to-br from-surface-canvas to-surface-raised/50 border border-border-default/50",
                      "group-hover:border-border-default transition-all duration-300"
                    )}
                  >
                    <Icon className={cn("w-6 h-6", benefit.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-white mb-1">
                      {benefit.title}
                    </h3>
                    <p className="text-sm text-text-muted">
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
                "bg-gradient-to-r from-brand-primary to-brand-primary/80 hover:from-brand-primary/90 hover:to-brand-primary/70",
                "text-black border-0",
                "shadow-[0_0_20px_rgba(0,217,255,0.3)] hover:shadow-[0_0_30px_rgba(0,217,255,0.5)]",
                "transition-all duration-300"
              )}
              aria-label="Take the interactive tour"
              data-ui-id="dialog-welcome-tour-btn"
            >
              Take Tour
            </Button>
            <Button
              onClick={handleSkipToDashboard}
              variant="outline"
              className={cn(
                "flex-1 h-12 text-base font-semibold",
                "bg-transparent border-border-default hover:border-brand-secondary hover:bg-brand-secondary/10",
                "text-text-secondary hover:text-brand-secondary",
                "shadow-[0_0_15px_rgba(189,0,255,0)] hover:shadow-[0_0_25px_rgba(189,0,255,0.3)]",
                "transition-all duration-300"
              )}
              aria-label="Skip tour and go to dashboard"
              data-ui-id="dialog-welcome-skip-btn"
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
              className="border-border-default data-[state=checked]:bg-brand-primary data-[state=checked]:border-brand-primary"
              aria-label="Don't show this welcome message again"
              data-ui-id="dialog-welcome-dont-show-checkbox"
            />
            <Label
              htmlFor="dontShowAgain"
              className="text-sm text-text-muted cursor-pointer select-none"
            >
              Don&apos;t show this again
            </Label>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-center gap-2 text-xs text-text-muted animate-in fade-in-0 duration-700 delay-1000">
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

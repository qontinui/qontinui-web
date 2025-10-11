'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, ChevronRight, X, PlayCircle } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';

interface TourStep {
  target: string;
  title: string;
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

const tourSteps: TourStep[] = [
  {
    target: '.project-manager',
    title: 'Welcome to Qontinui!',
    content: "Let's take a quick tour to help you get started with building visual automation workflows.",
    placement: 'bottom',
  },
  {
    target: '.new-project-btn',
    title: 'Create Your First Project',
    content: 'Click here to create a new automation project. Each project contains a state machine that defines your workflow.',
    placement: 'bottom',
  },
  {
    target: '.state-machine-canvas',
    title: 'Design Your Workflow',
    content: 'This is your canvas. Right-click to add states, then connect them with transitions to build your automation flow.',
    placement: 'right',
  },
  {
    target: '.action-editor',
    title: 'Configure Actions',
    content: 'Select a state to add actions like clicking, typing, or waiting. Each state can have multiple actions.',
    placement: 'left',
  },
  {
    target: '.image-selector',
    title: 'Image-Based Actions',
    content: 'Upload screenshots for image recognition. The automation will find and interact with these elements on screen.',
    placement: 'left',
  },
  {
    target: '.save-project-btn',
    title: 'Save Your Work',
    content: "Don't forget to save! Your projects are stored securely and can be accessed anytime.",
    placement: 'top',
  },
  {
    target: '.export-config-btn',
    title: 'Export Configuration',
    content: 'Export your automation as JSON to use with the Qontinui automation engine.',
    placement: 'top',
  },
];

export function OnboardingTour() {
  const { user } = useAuth();
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    // Only show tour if user is logged in and hasn't completed it
    // Don't show tour on admin page
    if (user && typeof window !== 'undefined') {
      const isAdminPage = window.location.pathname.startsWith('/admin');
      if (isAdminPage || user.is_superuser) {
        return; // Don't show tour for admin users or on admin page
      }

      const tourCompleted = localStorage.getItem('onboarding-tour-completed');
      if (!tourCompleted) {
        // Auto-start tour for new users after a short delay
        setTimeout(() => {
          setIsActive(true);
        }, 2000);
      }
    }
  }, [user]);

  useEffect(() => {
    if (isActive && tourSteps[currentStep]) {
      updatePosition();
      highlightElement(tourSteps[currentStep].target);
    }

    return () => {
      removeHighlight();
    };
  }, [isActive, currentStep]);

  const updatePosition = () => {
    if (typeof window === 'undefined') return;

    const step = tourSteps[currentStep];
    const element = document.querySelector(step.target);

    if (element) {
      const rect = element.getBoundingClientRect();
      const placement = step.placement || 'bottom';

      let top = 0;
      let left = 0;

      switch (placement) {
        case 'top':
          top = rect.top - 200;
          left = rect.left + rect.width / 2 - 150;
          break;
        case 'bottom':
          top = rect.bottom + 20;
          left = rect.left + rect.width / 2 - 150;
          break;
        case 'left':
          top = rect.top + rect.height / 2 - 100;
          left = rect.left - 320;
          break;
        case 'right':
          top = rect.top + rect.height / 2 - 100;
          left = rect.right + 20;
          break;
      }

      // Keep within viewport bounds
      top = Math.max(20, Math.min(top, window.innerHeight - 220));
      left = Math.max(20, Math.min(left, window.innerWidth - 320));

      setPosition({ top, left });
    }
  };

  const highlightElement = (selector: string) => {
    if (typeof window === 'undefined') return;

    removeHighlight();
    const element = document.querySelector(selector);
    if (element) {
      element.classList.add('tour-highlight');
      // Add overlay
      const overlay = document.createElement('div');
      overlay.className = 'tour-overlay';
      document.body.appendChild(overlay);
    }
  };

  const removeHighlight = () => {
    if (typeof window === 'undefined') return;

    document.querySelectorAll('.tour-highlight').forEach((el) => {
      el.classList.remove('tour-highlight');
    });
    document.querySelectorAll('.tour-overlay').forEach((el) => {
      el.remove();
    });
  };

  const handleNext = () => {
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    setIsActive(false);
    removeHighlight();
  };

  const handleComplete = () => {
    setIsActive(false);
    removeHighlight();
    if (typeof window !== 'undefined') {
      localStorage.setItem('onboarding-tour-completed', 'true');
    }
  };

  const handleRestart = () => {
    setCurrentStep(0);
    setIsActive(true);
  };

  // Don't render anything if user is not logged in
  if (!user) {
    return null;
  }

  // Don't show tour button on admin page or for admin users
  if (typeof window !== 'undefined') {
    const isAdminPage = window.location.pathname.startsWith('/admin');
    if (isAdminPage || user.is_superuser) {
      return null;
    }
  }

  if (!isActive) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleRestart}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2"
      >
        <PlayCircle className="h-4 w-4" />
        Start Tour
      </Button>
    );
  }

  const step = tourSteps[currentStep];

  return (
    <>
      <style jsx global>{`
        .tour-highlight {
          position: relative;
          z-index: 9999 !important;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.5);
          border-radius: 4px;
        }

        .tour-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 9998;
        }
      `}</style>

      <Card
        className="fixed z-[10000] w-[300px] shadow-xl"
        style={{ top: `${position.top}px`, left: `${position.left}px` }}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              {step.title}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSkip}
              className="h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {step.content}
          </p>
        </CardContent>
        <CardFooter className="flex items-center justify-between pt-3">
          <div className="flex items-center gap-1">
            {tourSteps.map((_, index) => (
              <div
                key={index}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  index === currentStep ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevious}
              disabled={currentStep === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={handleNext}
            >
              {currentStep === tourSteps.length - 1 ? 'Finish' : 'Next'}
              {currentStep < tourSteps.length - 1 && (
                <ChevronRight className="h-4 w-4 ml-1" />
              )}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </>
  );
}

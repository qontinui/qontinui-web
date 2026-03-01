"use client";

import * as React from "react";
import { useOnboardingStore } from "@/stores/onboarding-store";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  ChevronUp,
  X,
  HelpCircle,
  Check,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface ChecklistTask {
  id: keyof typeof TASK_MAPPING;
  label: string;
  helpText: string;
}

// ============================================================================
// Constants
// ============================================================================

// Map UI task IDs to store progress keys
const TASK_MAPPING = {
  "upload-screenshot": "uploadedScreenshot",
  "define-state": "definedState",
  "create-transition": "createdTransition",
  "test-automation": "testedAutomation",
  "export-configuration": "exportedConfig",
  "watch-tutorial": "watchedTutorial",
} as const;

const CHECKLIST_TASKS: ChecklistTask[] = [
  {
    id: "upload-screenshot",
    label: "Upload your first screenshot",
    helpText:
      "Take a screenshot of your application and upload it to start building your automation.",
  },
  {
    id: "define-state",
    label: "Define a state",
    helpText:
      "Create a state to represent a screen or condition in your automation flow.",
  },
  {
    id: "create-transition",
    label: "Create a transition",
    helpText:
      "Connect states with transitions to define how your automation moves between screens.",
  },
  {
    id: "test-automation",
    label: "Test your automation (mock run)",
    helpText:
      "Run a simulation to verify your automation logic before deploying it.",
  },
  {
    id: "export-configuration",
    label: "Export configuration",
    helpText:
      "Export your automation configuration to use with the Qontinui runtime.",
  },
  {
    id: "watch-tutorial",
    label: "Watch tutorial video",
    helpText:
      "Learn best practices and advanced features by watching our tutorial video.",
  },
];

// ============================================================================
// Confetti Animation Component
// ============================================================================

const ConfettiCelebration: React.FC<{ show: boolean }> = ({ show }) => {
  const [particles, setParticles] = React.useState<
    Array<{ id: number; left: number; color: string }>
  >([]);

  React.useEffect(() => {
    if (show) {
      // Using CSS variable values for confetti colors (brand-primary, brand-secondary, brand-success)
      const colors = [
        "hsl(var(--brand-primary))",
        "hsl(var(--brand-secondary))",
        "hsl(var(--brand-success))",
      ];
      const newParticles = Array.from({ length: 30 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: colors[Math.floor(Math.random() * colors.length)] as string,
      }));
      setParticles(newParticles);

      // Clean up particles after animation
      const timer = setTimeout(() => setParticles([]), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [show]);

  if (!show || particles.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute"
          style={{
            left: `${particle.left}%`,
            top: "-10px",
            width: "8px",
            height: "8px",
            backgroundColor: particle.color,
            borderRadius: "50%",
            animation: `confetti-fall 3s ease-out forwards`,
            animationDelay: `${Math.random() * 0.5}s`,
          }}
        />
      ))}
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const QuickStartChecklist: React.FC = () => {
  const [isMinimized, setIsMinimized] = React.useState(false);
  const [showCelebration, setShowCelebration] = React.useState(false);
  const [lastCompletedCount, setLastCompletedCount] = React.useState(0);

  const {
    quickStartProgress,
    showQuickStartChecklist,
    toggleQuickStartChecklist,
    isQuickStartComplete,
    getCompletedQuickStartTasks,
  } = useOnboardingStore();

  const completedTasks = getCompletedQuickStartTasks();
  const totalTasks = CHECKLIST_TASKS.length;
  const progressPercentage = Math.round((completedTasks / totalTasks) * 100);
  const isComplete = isQuickStartComplete();

  // Handle celebration when all tasks complete
  React.useEffect(() => {
    if (completedTasks > lastCompletedCount) {
      setLastCompletedCount(completedTasks);

      if (isComplete) {
        setShowCelebration(true);
        // Auto-hide after showing celebration
        setTimeout(() => {
          toggleQuickStartChecklist(false);
        }, 3000);
      }
    }
    return undefined;
  }, [
    completedTasks,
    lastCompletedCount,
    isComplete,
    toggleQuickStartChecklist,
  ]);

  // Don't render if dismissed or permanently hidden after completion
  if (!showQuickStartChecklist) {
    return null;
  }

  const handleDismiss = () => {
    toggleQuickStartChecklist(false);
  };

  const handleToggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  return (
    <>
      <ConfettiCelebration show={showCelebration} />

      <TooltipProvider>
        <Card
          className={cn(
            "fixed bottom-6 right-6 w-[380px] z-40 transition-all duration-300",
            "bg-surface-raised/95 backdrop-blur-sm border-border-default",
            "shadow-2xl",
            isComplete && "glow-green animate-pulse-slow",
            !isComplete && "glow-cyan"
          )}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  {isComplete ? (
                    <>
                      <Sparkles className="size-5 text-brand-success" />
                      <span className="text-brand-success">All Done!</span>
                    </>
                  ) : (
                    <>
                      <span className="bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-success bg-clip-text text-transparent">
                        Quick Start
                      </span>
                    </>
                  )}
                </CardTitle>
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {completedTasks}/{totalTasks} Complete
                  </span>
                  <span className="text-brand-primary">•</span>
                  <span>{progressPercentage}%</span>
                </div>
              </div>

              <CardAction className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 hover:bg-border-default"
                  onClick={handleToggleMinimize}
                >
                  {isMinimized ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 hover:bg-border-default hover:text-destructive"
                  onClick={handleDismiss}
                >
                  <X className="size-4" />
                </Button>
              </CardAction>
            </div>

            {/* Progress Bar */}
            <div className="mt-3">
              <Progress
                value={progressPercentage}
                max={100}
                className={cn(
                  "h-2 bg-border-subtle",
                  isComplete && "bg-brand-success/20"
                )}
              />
            </div>
          </CardHeader>

          {!isMinimized && (
            <CardContent className="space-y-3">
              {isComplete ? (
                <div className="rounded-lg bg-brand-success/10 border border-brand-success/30 p-4 text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Check className="size-5 text-brand-success" />
                    <span className="font-semibold text-brand-success">
                      Congratulations!
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    You&apos;ve completed all quick start tasks. You&apos;re
                    ready to build amazing automations!
                  </p>
                </div>
              ) : (
                CHECKLIST_TASKS.map((task) => {
                  const storeKey = TASK_MAPPING[task.id];
                  const isCompleted = quickStartProgress[storeKey];

                  return (
                    <ChecklistItem
                      key={task.id}
                      task={task}
                      isCompleted={isCompleted}
                    />
                  );
                })
              )}
            </CardContent>
          )}
        </Card>
      </TooltipProvider>
    </>
  );
};

// ============================================================================
// Checklist Item Component
// ============================================================================

interface ChecklistItemProps {
  task: ChecklistTask;
  isCompleted: boolean;
}

const ChecklistItem: React.FC<ChecklistItemProps> = ({ task, isCompleted }) => {
  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg p-3 transition-all duration-200",
        "hover:bg-surface-hover/50",
        isCompleted && "bg-brand-primary/5"
      )}
    >
      {/* Checkbox */}
      <div className="pt-0.5">
        <Checkbox
          checked={isCompleted}
          disabled
          className={cn(
            "size-5 border-2 transition-all",
            isCompleted
              ? "border-brand-primary bg-brand-primary/20 data-[state=checked]:bg-brand-primary data-[state=checked]:text-surface-canvas"
              : "border-border-default"
          )}
        />
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            "text-sm font-medium leading-tight cursor-default transition-colors",
            isCompleted
              ? "text-muted-foreground line-through"
              : "text-foreground"
          )}
        >
          {task.label}
        </span>
      </div>

      {/* Help Icon */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
              "text-muted-foreground hover:text-brand-primary"
            )}
          >
            <HelpCircle className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          className="max-w-[250px] bg-surface-raised border-border-default"
        >
          <p className="text-sm">{task.helpText}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
};

export default QuickStartChecklist;

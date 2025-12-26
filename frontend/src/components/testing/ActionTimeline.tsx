"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Compass,
  Route,
  MousePointer2,
  Keyboard,
  Move,
  Eye,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
} from "lucide-react";
import type { ExecutionStep, ActionStep } from "@/types/integration-testing";

interface ActionTimelineProps {
  steps: ExecutionStep[];
  currentIndex: number;
  onSelectStep: (index: number) => void;
  className?: string;
  orientation?: "horizontal" | "vertical";
}

export function ActionTimeline({
  steps,
  currentIndex,
  onSelectStep,
  className,
  orientation = "horizontal",
}: ActionTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to keep current step visible
  useEffect(() => {
    if (activeItemRef.current && containerRef.current) {
      const container = containerRef.current;
      const item = activeItemRef.current;

      if (orientation === "horizontal") {
        const itemLeft = item.offsetLeft;
        const itemWidth = item.offsetWidth;
        const containerWidth = container.offsetWidth;
        const scrollLeft = container.scrollLeft;

        // Check if item is outside visible area
        if (itemLeft < scrollLeft) {
          container.scrollTo({ left: itemLeft - 20, behavior: "smooth" });
        } else if (itemLeft + itemWidth > scrollLeft + containerWidth) {
          container.scrollTo({
            left: itemLeft + itemWidth - containerWidth + 20,
            behavior: "smooth",
          });
        }
      } else {
        const itemTop = item.offsetTop;
        const itemHeight = item.offsetHeight;
        const containerHeight = container.offsetHeight;
        const scrollTop = container.scrollTop;

        if (itemTop < scrollTop) {
          container.scrollTo({ top: itemTop - 20, behavior: "smooth" });
        } else if (itemTop + itemHeight > scrollTop + containerHeight) {
          container.scrollTo({
            top: itemTop + itemHeight - containerHeight + 20,
            behavior: "smooth",
          });
        }
      }
    }
  }, [currentIndex, orientation]);

  if (steps.length === 0) {
    return (
      <div className={cn("text-center text-gray-500 py-4", className)}>
        No steps to display
      </div>
    );
  }

  if (orientation === "vertical") {
    return (
      <VerticalTimeline
        steps={steps}
        currentIndex={currentIndex}
        onSelectStep={onSelectStep}
        containerRef={containerRef}
        activeItemRef={activeItemRef}
        className={className}
      />
    );
  }

  return (
    <HorizontalTimeline
      steps={steps}
      currentIndex={currentIndex}
      onSelectStep={onSelectStep}
      containerRef={containerRef}
      activeItemRef={activeItemRef}
      className={className}
    />
  );
}

// =============================================================================
// Timeline Variants
// =============================================================================

interface TimelineVariantProps {
  steps: ExecutionStep[];
  currentIndex: number;
  onSelectStep: (index: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  activeItemRef: React.RefObject<HTMLButtonElement | null>;
  className?: string;
}

function HorizontalTimeline({
  steps,
  currentIndex,
  onSelectStep,
  containerRef,
  activeItemRef,
  className,
}: TimelineVariantProps) {
  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center gap-1 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent pb-2",
        className
      )}
    >
      {steps.map((step, index) => {
        const isActive = index === currentIndex;
        const isPast = index < currentIndex;
        const isFuture = index > currentIndex;

        return (
          <div key={index} className="flex items-center">
            <TimelineItem
              step={step}
              index={index}
              isActive={isActive}
              isPast={isPast}
              isFuture={isFuture}
              onClick={() => onSelectStep(index)}
              ref={isActive ? activeItemRef : null}
            />
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "w-4 h-0.5 mx-0.5 transition-colors",
                  isPast ? "bg-[#00D9FF]/50" : "bg-gray-700"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function VerticalTimeline({
  steps,
  currentIndex,
  onSelectStep,
  containerRef,
  activeItemRef,
  className,
}: TimelineVariantProps) {
  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col gap-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent max-h-96",
        className
      )}
    >
      {steps.map((step, index) => {
        const isActive = index === currentIndex;
        const isPast = index < currentIndex;
        const isFuture = index > currentIndex;

        return (
          <div key={index} className="flex flex-col items-center">
            <TimelineItemVertical
              step={step}
              index={index}
              isActive={isActive}
              isPast={isPast}
              isFuture={isFuture}
              onClick={() => onSelectStep(index)}
              ref={isActive ? activeItemRef : null}
            />
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "w-0.5 h-2 transition-colors",
                  isPast ? "bg-[#00D9FF]/50" : "bg-gray-700"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Timeline Item Components
// =============================================================================

interface TimelineItemProps {
  step: ExecutionStep;
  index: number;
  isActive: boolean;
  isPast: boolean;
  isFuture: boolean;
  onClick: () => void;
}

const TimelineItem = ({
  step,
  index,
  isActive,
  isPast,
  isFuture,
  onClick,
  ref,
}: TimelineItemProps & { ref: React.Ref<HTMLButtonElement> }) => {
  const Icon = getStepIcon(step);
  const isSuccess = getStepSuccess(step);

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all",
        "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[#00D9FF]/50",
        isActive && "ring-2 ring-[#00D9FF] ring-offset-2 ring-offset-[#1A1A1B]",
        isPast &&
          isSuccess &&
          "bg-green-500/20 border-green-500 text-green-400",
        isPast && !isSuccess && "bg-red-500/20 border-red-500 text-red-400",
        isActive && "bg-[#00D9FF]/20 border-[#00D9FF] text-[#00D9FF] scale-110",
        isFuture && "bg-gray-800/50 border-gray-600 text-gray-500"
      )}
      title={getStepTitle(step, index)}
    >
      <Icon className="w-4 h-4" />
      {/* Success/Failure indicator */}
      {isPast && (
        <span className="absolute -top-1 -right-1">
          {isSuccess ? (
            <CheckCircle2 className="w-3 h-3 text-green-400 bg-[#1A1A1B] rounded-full" />
          ) : (
            <XCircle className="w-3 h-3 text-red-400 bg-[#1A1A1B] rounded-full" />
          )}
        </span>
      )}
    </button>
  );
};

const TimelineItemVertical = ({
  step,
  index,
  isActive,
  isPast,
  isFuture,
  onClick,
  ref,
}: TimelineItemProps & { ref: React.Ref<HTMLButtonElement> }) => {
  const Icon = getStepIcon(step);
  const isSuccess = getStepSuccess(step);

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-all",
        "hover:bg-gray-800/50 focus:outline-none focus:ring-2 focus:ring-[#00D9FF]/50",
        isActive && "bg-[#00D9FF]/10 ring-1 ring-[#00D9FF]",
        isPast && isSuccess && "bg-green-500/5",
        isPast && !isSuccess && "bg-red-500/5"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full border-2",
          isPast &&
            isSuccess &&
            "bg-green-500/20 border-green-500 text-green-400",
          isPast && !isSuccess && "bg-red-500/20 border-red-500 text-red-400",
          isActive && "bg-[#00D9FF]/20 border-[#00D9FF] text-[#00D9FF]",
          isFuture && "bg-gray-800/50 border-gray-600 text-gray-500"
        )}
      >
        <Icon className="w-4 h-4" />
      </div>

      {/* Label */}
      <div className="flex-1 text-left">
        <div
          className={cn(
            "text-sm font-medium",
            isActive && "text-white",
            isPast && "text-gray-400",
            isFuture && "text-gray-500"
          )}
        >
          {getStepLabel(step)}
        </div>
        <div className="text-xs text-gray-500">Step {index + 1}</div>
      </div>

      {/* Status indicator */}
      {isPast && (
        <span>
          {isSuccess ? (
            <CheckCircle2 className="w-4 h-4 text-green-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
        </span>
      )}
    </button>
  );
};

// =============================================================================
// Helper Functions
// =============================================================================

function getStepIcon(step: ExecutionStep) {
  switch (step.type) {
    case "state_discovery":
      return Compass;
    case "path_calculation":
      return Route;
    case "action":
      return getActionIcon(step as ActionStep);
    case "state_update":
      return RefreshCw;
  }
}

function getActionIcon(actionStep: ActionStep) {
  switch (actionStep.action_type) {
    case "click":
      return MousePointer2;
    case "type":
      return Keyboard;
    case "drag":
      return Move;
    case "find":
      return Eye;
    case "screenshot":
      return ImageIcon;
    default:
      return Play;
  }
}

function getStepSuccess(step: ExecutionStep): boolean {
  switch (step.type) {
    case "state_discovery":
      return step.initial_states_match;
    case "path_calculation":
      return !step.no_path_found;
    case "action":
      return step.result.success;
    case "state_update":
      return true; // State updates are always "successful"
  }
}

function getStepTitle(step: ExecutionStep, index: number): string {
  const prefix = `Step ${index + 1}: `;
  switch (step.type) {
    case "state_discovery":
      return `${prefix}State Discovery - ${step.active_states.length} states`;
    case "path_calculation":
      return `${prefix}Path to ${step.target_state}`;
    case "action":
      return `${prefix}${step.action_type.toUpperCase()} - ${step.action_name}`;
    case "state_update":
      return `${prefix}State Update (+${step.activated_states.length}/-${step.deactivated_states.length})`;
  }
}

function getStepLabel(step: ExecutionStep): string {
  switch (step.type) {
    case "state_discovery":
      return "State Discovery";
    case "path_calculation":
      return `Path to ${step.target_state}`;
    case "action":
      return step.action_name || step.action_type.toUpperCase();
    case "state_update":
      return "State Update";
  }
}

export default ActionTimeline;

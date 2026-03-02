"use client";

import React from "react";
import { Image as ImageIcon, Compass, Route, RefreshCw } from "lucide-react";
import type {
  ExecutionStep,
  ActionAnimation,
  HighlightRegion,
} from "@/types/integration-testing";
import { getActionIcon } from "../utils";

interface ScreenshotWithOverlayProps {
  screenshotUrl: string;
  highlightRegions: HighlightRegion[];
  animation: ActionAnimation | null;
}

export function ScreenshotWithOverlay({
  screenshotUrl,
  highlightRegions,
  animation,
}: ScreenshotWithOverlayProps) {
  return (
    <div className="relative w-full h-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={screenshotUrl}
        alt="Automation screenshot"
        className="w-full h-full object-contain"
      />

      {highlightRegions.map((region, index) => (
        <HighlightBox key={`highlight-${index}`} region={region} />
      ))}

      {animation && <ActionAnimationOverlay animation={animation} />}
    </div>
  );
}

function HighlightBox({ region }: { region: HighlightRegion }) {
  const styleClasses = {
    solid: "border-2",
    dashed: "border-2 border-dashed",
    pulse: "border-2 animate-pulse",
  };

  return (
    <div
      className={`absolute ${styleClasses[region.style || "solid"]}`}
      style={{
        left: `${region.x}px`,
        top: `${region.y}px`,
        width: `${region.width}px`,
        height: `${region.height}px`,
        borderColor: region.color || "var(--color-brand-primary)",
      }}
    >
      {region.label && (
        <div
          className="absolute -top-6 left-0 px-1 py-0.5 text-xs font-medium rounded whitespace-nowrap"
          style={{
            backgroundColor: region.color || "var(--color-brand-primary)",
            color: "black",
          }}
        >
          {region.label}
        </div>
      )}
    </div>
  );
}

function ActionAnimationOverlay({ animation }: { animation: ActionAnimation }) {
  switch (animation.animation_type) {
    case "click_ripple":
      return (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${animation.start_position?.x ?? 0}px`,
            top: `${animation.start_position?.y ?? 0}px`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="w-8 h-8 rounded-full bg-brand-primary/50 animate-ping" />
          <div className="absolute inset-0 w-8 h-8 rounded-full bg-brand-primary animate-pulse" />
        </div>
      );

    case "type_indicator":
      return (
        <div
          className="absolute pointer-events-none px-2 py-1 bg-yellow-500/80 text-black text-sm font-mono rounded"
          style={{
            left: `${animation.start_position?.x ?? 0}px`,
            top: `${animation.start_position?.y ?? 0}px`,
          }}
        >
          {animation.text || "..."}
          <span className="animate-pulse">|</span>
        </div>
      );

    case "drag_path":
      if (!animation.start_position || !animation.end_position) return null;
      return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <line
            x1={animation.start_position.x}
            y1={animation.start_position.y}
            x2={animation.end_position.x}
            y2={animation.end_position.y}
            stroke="var(--color-brand-primary)"
            strokeWidth="3"
            strokeDasharray="8,4"
            className="animate-pulse"
          />
          <circle
            cx={animation.start_position.x}
            cy={animation.start_position.y}
            r="6"
            fill="var(--color-brand-primary)"
          />
          <circle
            cx={animation.end_position.x}
            cy={animation.end_position.y}
            r="6"
            fill="#F59E0B"
          />
        </svg>
      );

    case "scroll_indicator":
      return (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${animation.start_position?.x ?? 0}px`,
            top: `${animation.start_position?.y ?? 0}px`,
          }}
        >
          <div className="flex flex-col items-center text-brand-primary animate-bounce">
            <div className="w-6 h-10 border-2 border-current rounded-full flex justify-center pt-2">
              <div className="w-1.5 h-3 bg-current rounded-full animate-scroll" />
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

interface ScreenshotPlaceholderProps {
  step?: ExecutionStep;
}

export function ScreenshotPlaceholder({ step }: ScreenshotPlaceholderProps) {
  const getPlaceholderContent = () => {
    if (!step) {
      return {
        icon: <ImageIcon className="w-16 h-16 text-text-muted" />,
        title: "No Screenshot Available",
        description: "Select a step to view its visual representation",
      };
    }

    switch (step.type) {
      case "state_discovery":
        return {
          icon: <Compass className="w-16 h-16 text-blue-500" />,
          title: "State Discovery",
          description: `Detected ${step.active_states.length} active state(s)`,
        };
      case "path_calculation":
        return {
          icon: <Route className="w-16 h-16 text-purple-500" />,
          title: "Path Calculation",
          description: `Target: ${step.target_state}`,
        };
      case "action":
        return {
          icon: getActionIcon(step),
          title: `${step.action_type.toUpperCase()}: ${step.action_name}`,
          description: step.result.success
            ? "Action completed successfully"
            : `Failed: ${step.result.error_message || "Unknown error"}`,
        };
      case "state_update":
        return {
          icon: <RefreshCw className="w-16 h-16 text-cyan-500" />,
          title: "State Update",
          description: `+${step.activated_states.length} / -${step.deactivated_states.length} states`,
        };
    }
  };

  const content = getPlaceholderContent();

  return (
    <div className="flex flex-col items-center justify-center text-center p-8">
      {content.icon}
      <h3 className="text-lg font-medium text-white mt-4">{content.title}</h3>
      <p className="text-sm text-text-muted mt-1">{content.description}</p>
    </div>
  );
}

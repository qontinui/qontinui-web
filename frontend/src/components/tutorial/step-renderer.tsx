"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  useTutorialStore,
  Tutorial,
  TutorialStep,
} from "@/stores/tutorial-store";

interface StepRendererProps {
  currentTutorial: Tutorial;
  onTryIt?: (config: unknown) => void;
}

/**
 * StepRenderer Component
 *
 * Renders the main content for each tutorial step, including:
 * - Step title (h2)
 * - Step description content
 * - Keyboard shortcuts (if available)
 * - Additional details/code examples
 * - Action instructions
 * - Smooth transitions between steps
 */
export function StepRenderer({ currentTutorial, onTryIt }: StepRendererProps) {
  const currentStepIndex = useTutorialStore((state) => state.currentStepIndex);
  const step = currentTutorial.steps[currentStepIndex];
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Trigger fade-in animation on step change
    setIsVisible(false);
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, [currentStepIndex]);

  if (!step) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-muted">No step content available</p>
      </div>
    );
  }

  return (
    <div
      className={`space-y-6 transition-all duration-300 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {/* Step Title */}
      <div className="space-y-2">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-cyan-600 to-green-600 bg-clip-text text-transparent">
          {step.title}
        </h2>
      </div>

      {/* Step Content */}
      <div className="text-text-secondary leading-relaxed space-y-4">
        <p className="text-lg whitespace-pre-wrap">{step.content}</p>
      </div>

      {/* Action Instructions */}
      {step.action && (
        <Card className="border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                →
              </div>
              <div>
                <p className="font-semibold text-cyan-900 dark:text-cyan-100">
                  Try this:
                </p>
                <p className="text-cyan-800 dark:text-cyan-200 mt-1">
                  {step.action}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Additional Details */}
      {step.details && (
        <div className="space-y-3">
          <h3 className="font-semibold text-text-primary">More Details</h3>
          <Card className="border-border-subtle bg-surface-canvas">
            <CardContent className="p-4">
              <p className="text-text-secondary whitespace-pre-wrap">
                {step.details}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Keyboard Shortcuts */}
      {step.shortcuts && step.shortcuts.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-text-primary">
            Keyboard Shortcuts
          </h3>
          <div className="grid grid-cols-1 gap-2">
            {step.shortcuts.map((shortcut, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-2 bg-surface-raised rounded-lg border border-border-subtle"
              >
                <code className="text-sm font-mono font-semibold text-text-primary">
                  {shortcut}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Try It Button */}
      {step.shortcuts && (
        <div className="pt-2">
          <Button
            onClick={() => onTryIt?.({ step: step.id })}
            className="bg-gradient-to-r from-cyan-600 to-green-600 hover:from-cyan-700 hover:to-green-700 text-white font-semibold"
          >
            Test Your Understanding
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * AnnotatedImage Component
 *
 * Displays an image with interactive annotations
 */
interface AnnotatedImageProps {
  src: string;
  alt: string;
  annotations: Array<{
    id: string;
    x: number;
    y: number;
    text: string;
  }>;
}

function AnnotatedImage({ src, alt, annotations }: AnnotatedImageProps) {
  const [hoveredAnnotation, setHoveredAnnotation] = useState<string | null>(
    null
  );
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
  };

  return (
    <Card className="border-border-default bg-slate-900 overflow-hidden">
      <CardContent className="p-0">
        <div className="relative inline-block w-full">
          {/* Image */}
          <img
            src={src}
            alt={alt}
            onLoad={handleImageLoad}
            className="w-full h-auto rounded-lg"
          />

          {/* Annotations Overlay */}
          {imageSize &&
            annotations.length > 0 &&
            annotations.map((annotation) => {
              const x = (annotation.x / 100) * imageSize.width;
              const y = (annotation.y / 100) * imageSize.height;
              const isHovered = hoveredAnnotation === annotation.id;

              return (
                <div key={annotation.id}>
                  {/* Annotation Pin */}
                  <div
                    className="absolute w-8 h-8 cursor-pointer transition-all duration-200 transform -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: `${x}px`,
                      top: `${y}px`,
                    }}
                    onMouseEnter={() => setHoveredAnnotation(annotation.id)}
                    onMouseLeave={() => setHoveredAnnotation(null)}
                  >
                    {/* Outer ring */}
                    <div
                      className={`absolute inset-0 rounded-full border-2 ${
                        isHovered
                          ? "border-brand-primary bg-brand-primary/20"
                          : "border-brand-secondary bg-brand-secondary/10"
                      } transition-all duration-200`}
                    />
                    {/* Center dot */}
                    <div
                      className={`absolute top-1/2 left-1/2 w-2 h-2 rounded-full transform -translate-x-1/2 -translate-y-1/2 ${
                        isHovered ? "bg-brand-primary" : "bg-brand-secondary"
                      } transition-all duration-200`}
                    />
                  </div>

                  {/* Annotation Tooltip */}
                  {isHovered && (
                    <div
                      className="absolute z-10 px-3 py-2 bg-slate-950 border border-brand-primary rounded-lg shadow-lg text-sm text-white whitespace-nowrap pointer-events-none"
                      style={{
                        left: `${Math.min(x + 16, imageSize.width - 150)}px`,
                        top: `${Math.max(y - 36, 10)}px`,
                      }}
                    >
                      {annotation.text}
                      {/* Arrow pointing to pin */}
                      <div
                        className="absolute w-2 h-2 bg-slate-950 border-r border-t border-brand-primary transform rotate-45"
                        style={{
                          left: "-4px",
                          bottom: "4px",
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * ConfigPreview Component
 *
 * Displays JSON configuration with syntax highlighting
 */
interface ConfigPreviewProps {
  config: Record<string, unknown>;
}

function ConfigPreview({ config }: ConfigPreviewProps) {
  return (
    <Card className="border-border-default bg-slate-900">
      <CardContent className="p-4">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text-muted">
            Configuration
          </h3>
          <div className="rounded-lg bg-slate-950 p-4 overflow-x-auto">
            <pre className="text-sm text-slate-100 font-mono whitespace-pre-wrap break-words">
              {JSON.stringify(config, null, 2)}
            </pre>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * TryItButton Component
 *
 * Interactive button that triggers a tutorial step action
 */
interface TryItButtonProps {
  config: TutorialStep["tryIt"];
  onTryIt?: (config: TutorialStep["tryIt"]) => void;
}

function TryItButton({ config, onTryIt }: TryItButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      if (onTryIt) {
        onTryIt(config);
      }
      // Simulate action completion
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={isLoading}
      className="bg-brand-primary hover:bg-brand-primary/80 text-black font-semibold px-6 py-2 h-auto transition-all duration-200"
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
          Running...
        </span>
      ) : (
        "Try It"
      )}
    </Button>
  );
}

export { AnnotatedImage, ConfigPreview, TryItButton };

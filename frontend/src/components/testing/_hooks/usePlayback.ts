"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ExecutionStep,
  ActionStep,
  ActionAnimation,
  PlaybackFrame,
} from "@/types/integration-testing";
import { generatePlaybackFrame, getAnimationForAction } from "../utils";

interface UsePlaybackOptions {
  steps: ExecutionStep[];
}

interface UsePlaybackReturn {
  isPlaying: boolean;
  currentStepIndex: number;
  playbackSpeed: number;
  activeAnimation: ActionAnimation | null;
  currentStep: ExecutionStep | undefined;
  currentFrame: PlaybackFrame | null;
  handlePlay: () => void;
  handlePause: () => void;
  handleNext: () => void;
  handlePrevious: () => void;
  handleReset: () => void;
  handleJumpTo: (index: number) => void;
  setPlaybackSpeed: (speed: number) => void;
}

export function usePlayback({ steps }: UsePlaybackOptions): UsePlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [activeAnimation, setActiveAnimation] =
    useState<ActionAnimation | null>(null);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const currentStep = steps[currentStepIndex] as ExecutionStep | undefined;

  const currentFrame: PlaybackFrame | null = currentStep
    ? generatePlaybackFrame(currentStep, currentStepIndex)
    : null;

  // Auto-play logic
  useEffect(() => {
    if (isPlaying && steps.length > 0) {
      const baseDuration = 2000;
      const interval = baseDuration / playbackSpeed;

      playIntervalRef.current = setInterval(() => {
        setCurrentStepIndex((prev) => {
          if (prev >= steps.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, interval);

      return () => {
        if (playIntervalRef.current) {
          clearInterval(playIntervalRef.current);
        }
      };
    }
    return undefined;
  }, [isPlaying, playbackSpeed, steps.length]);

  const triggerActionAnimation = useCallback((step: ActionStep) => {
    const animation = getAnimationForAction(step);
    setActiveAnimation(animation);

    if (animation) {
      const timeout = setTimeout(() => {
        setActiveAnimation(null);
      }, animation.duration_ms);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, []);

  // Trigger animation when step changes
  useEffect(() => {
    if (currentStep?.type === "action") {
      const actionStep = currentStep as ActionStep;
      triggerActionAnimation(actionStep);
    }
  }, [currentStepIndex, currentStep, triggerActionAnimation]);

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleNext = () => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  };
  const handlePrevious = () => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };
  const handleReset = () => {
    setIsPlaying(false);
    setCurrentStepIndex(0);
  };
  const handleJumpTo = (index: number) => {
    setIsPlaying(false);
    setCurrentStepIndex(index);
  };

  return {
    isPlaying,
    currentStepIndex,
    playbackSpeed,
    activeAnimation,
    currentStep,
    currentFrame,
    handlePlay,
    handlePause,
    handleNext,
    handlePrevious,
    handleReset,
    handleJumpTo,
    setPlaybackSpeed,
  };
}

// hooks/useExecutionPlayback.ts

import { useState, useEffect, useCallback } from 'react';
import type { ActionVisualization } from '@/types/integration-testing';

interface UseExecutionPlaybackProps {
  actions: ActionVisualization[];
  autoPlay?: boolean;
  playbackSpeed?: number; // milliseconds per action
}

export function useExecutionPlayback({
  actions,
  autoPlay = false,
  playbackSpeed = 1000,
}: UseExecutionPlaybackProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);

  const currentAction = actions[currentIndex];
  const hasNext = currentIndex < actions.length - 1;
  const hasPrevious = currentIndex > 0;

  const next = useCallback(() => {
    if (hasNext) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
    }
  }, [hasNext]);

  const previous = useCallback(() => {
    if (hasPrevious) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [hasPrevious]);

  const jumpTo = useCallback((index: number) => {
    if (index >= 0 && index < actions.length) {
      setCurrentIndex(index);
    }
  }, [actions.length]);

  const play = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const reset = useCallback(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, []);

  // Auto-play effect
  useEffect(() => {
    if (!isPlaying || !hasNext) return;

    const timer = setTimeout(next, playbackSpeed);
    return () => clearTimeout(timer);
  }, [isPlaying, hasNext, next, playbackSpeed]);

  return {
    currentAction,
    currentIndex,
    isPlaying,
    hasNext,
    hasPrevious,
    next,
    previous,
    jumpTo,
    play,
    pause,
    reset,
  };
}

/**
 * TutorialTooltip Component
 *
 * Tooltip anchored to UI elements for contextual tutorials.
 * Positions relative to target element with arrow pointer.
 * Includes navigation buttons and responsive positioning.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';
import type { TooltipPosition } from '../../../types/tutorial';

export interface TutorialTooltipProps {
  /** Target element selector */
  targetSelector: string | null;
  /** Tooltip title */
  title: string;
  /** Tooltip content/description */
  content: string;
  /** Preferred position relative to target */
  position?: TooltipPosition;
  /** Current step number (1-indexed) */
  currentStep?: number;
  /** Total number of steps */
  totalSteps?: number;
  /** Whether this is the first step */
  isFirstStep?: boolean;
  /** Whether this is the last step */
  isLastStep?: boolean;
  /** Show Previous button */
  showPrevious?: boolean;
  /** Show Next button */
  showNext?: boolean;
  /** Show Skip button */
  showSkip?: boolean;
  /** Show Close button */
  showClose?: boolean;
  /** Callback when Next is clicked */
  onNext?: () => void;
  /** Callback when Previous is clicked */
  onPrevious?: () => void;
  /** Callback when Skip is clicked */
  onSkip?: () => void;
  /** Callback when Close is clicked */
  onClose?: () => void;
  /** Offset from target element (pixels) */
  offset?: { x: number; y: number };
  /** Whether tooltip is visible */
  isVisible?: boolean;
  /** Custom class name */
  className?: string;
}

interface TooltipRect {
  top: number;
  left: number;
  arrowPosition: 'top' | 'bottom' | 'left' | 'right';
  arrowOffset: number;
}

export const TutorialTooltip: React.FC<TutorialTooltipProps> = ({
  targetSelector,
  title,
  content,
  position = 'bottom',
  currentStep,
  totalSteps,
  isFirstStep = false,
  isLastStep = false,
  showPrevious = true,
  showNext = true,
  showSkip = true,
  showClose = true,
  onNext,
  onPrevious,
  onSkip,
  onClose,
  offset = { x: 0, y: 0 },
  isVisible = true,
  className = '',
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipRect, setTooltipRect] = useState<TooltipRect | null>(null);
  const [actualPosition, setActualPosition] = useState<TooltipPosition>(position);

  const calculatePosition = useCallback(() => {
    if (!targetSelector || !tooltipRef.current) {
      setTooltipRect(null);
      return;
    }

    const target = document.querySelector(targetSelector);
    if (!target) {
      setTooltipRect(null);
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const tooltipElement = tooltipRef.current;
    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;
    const arrowSize = 8;
    const gap = 12;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = 0;
    let left = 0;
    let finalPosition: TooltipPosition = position;
    let arrowPos: 'top' | 'bottom' | 'left' | 'right' = 'top';
    let arrowOffset = 0;

    // Calculate position based on preference
    const positions: Record<TooltipPosition, () => void> = {
      top: () => {
        top = targetRect.top - tooltipHeight - gap + offset.y;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2 + offset.x;
        arrowPos = 'bottom';
      },
      bottom: () => {
        top = targetRect.bottom + gap + offset.y;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2 + offset.x;
        arrowPos = 'top';
      },
      left: () => {
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2 + offset.y;
        left = targetRect.left - tooltipWidth - gap + offset.x;
        arrowPos = 'right';
      },
      right: () => {
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2 + offset.y;
        left = targetRect.right + gap + offset.x;
        arrowPos = 'left';
      },
      center: () => {
        top = viewportHeight / 2 - tooltipHeight / 2 + offset.y;
        left = viewportWidth / 2 - tooltipWidth / 2 + offset.x;
        arrowPos = 'top';
      },
    };

    // Try preferred position
    positions[position]();
    finalPosition = position;

    // Check if tooltip is off-screen and flip if needed
    if (position !== 'center') {
      const isOffScreenTop = top < 10;
      const isOffScreenBottom = top + tooltipHeight > viewportHeight - 10;
      const isOffScreenLeft = left < 10;
      const isOffScreenRight = left + tooltipWidth > viewportWidth - 10;

      // Flip vertical position
      if ((position === 'top' && isOffScreenTop) || (position === 'bottom' && isOffScreenBottom)) {
        finalPosition = position === 'top' ? 'bottom' : 'top';
        positions[finalPosition]();
      }

      // Flip horizontal position
      if ((position === 'left' && isOffScreenLeft) || (position === 'right' && isOffScreenRight)) {
        finalPosition = position === 'left' ? 'right' : 'left';
        positions[finalPosition]();
      }

      // Adjust horizontal overflow
      if (left < 10) {
        left = 10;
      } else if (left + tooltipWidth > viewportWidth - 10) {
        left = viewportWidth - tooltipWidth - 10;
      }

      // Adjust vertical overflow
      if (top < 10) {
        top = 10;
      } else if (top + tooltipHeight > viewportHeight - 10) {
        top = viewportHeight - tooltipHeight - 10;
      }
    }

    // Calculate arrow offset for non-centered positions
    if (arrowPos === 'top' || arrowPos === 'bottom') {
      const targetCenter = targetRect.left + targetRect.width / 2;
      arrowOffset = targetCenter - left;
      arrowOffset = Math.max(20, Math.min(arrowOffset, tooltipWidth - 20));
    } else if (arrowPos === 'left' || arrowPos === 'right') {
      const targetCenter = targetRect.top + targetRect.height / 2;
      arrowOffset = targetCenter - top;
      arrowOffset = Math.max(20, Math.min(arrowOffset, tooltipHeight - 20));
    }

    setActualPosition(finalPosition);
    setTooltipRect({
      top,
      left,
      arrowPosition: arrowPos,
      arrowOffset,
    });
  }, [targetSelector, position, offset]);

  useEffect(() => {
    calculatePosition();
  }, [calculatePosition]);

  useEffect(() => {
    const handleUpdate = () => {
      calculatePosition();
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
    };
  }, [calculatePosition]);

  if (!isVisible || !tooltipRect) {
    return null;
  }

  const arrowClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-white dark:border-b-gray-800',
    bottom: 'top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-white dark:border-t-gray-800',
    left: 'right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-white dark:border-r-gray-800',
    right: 'left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-white dark:border-l-gray-800',
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={tooltipRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className={`
          fixed z-[10002] bg-white dark:bg-gray-800 rounded-lg shadow-2xl
          border border-gray-200 dark:border-gray-700 max-w-md
          ${className}
        `}
        style={{
          top: tooltipRect.top,
          left: tooltipRect.left,
        }}
        role="dialog"
        aria-labelledby="tooltip-title"
        aria-describedby="tooltip-content"
      >
        {/* Arrow */}
        <div
          className={`absolute w-0 h-0 border-8 ${arrowClasses[tooltipRect.arrowPosition]}`}
          style={{
            [tooltipRect.arrowPosition === 'top' || tooltipRect.arrowPosition === 'bottom' ? 'left' : 'top']:
              `${tooltipRect.arrowOffset}px`,
            transform:
              tooltipRect.arrowPosition === 'top' || tooltipRect.arrowPosition === 'bottom'
                ? 'translateX(-50%)'
                : 'translateY(-50%)',
          }}
        />

        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1 pr-2">
            <h3 id="tooltip-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              {title}
            </h3>
            {currentStep !== undefined && totalSteps !== undefined && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Step {currentStep} of {totalSteps}
              </p>
            )}
          </div>
          {showClose && (
            <button
              onClick={onClose}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="Close tutorial"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div id="tooltip-content" className="p-4">
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {content}
          </p>
        </div>

        {/* Footer with navigation buttons */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700 gap-2">
          <div className="flex gap-2">
            {showPrevious && !isFirstStep && (
              <button
                onClick={onPrevious}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                aria-label="Previous step"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>
            )}
          </div>

          <div className="flex gap-2">
            {showSkip && !isLastStep && (
              <button
                onClick={onSkip}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                aria-label="Skip tutorial"
              >
                Skip
              </button>
            )}
            {showNext && (
              <button
                onClick={onNext}
                className="inline-flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded transition-colors"
                aria-label={isLastStep ? 'Finish tutorial' : 'Next step'}
              >
                <span>{isLastStep ? 'Finish' : 'Next'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default TutorialTooltip;

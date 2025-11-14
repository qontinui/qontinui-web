/**
 * TutorialPanel Component
 *
 * Collapsible side panel showing tutorial progress and step list.
 * Allows jumping to specific steps and shows completion status.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, CheckCircle, Circle, PlayCircle } from 'lucide-react';
import type { TutorialStep } from '../../../types/tutorial';

export interface TutorialPanelProps {
  /** Tutorial steps */
  steps: TutorialStep[];
  /** Current step index (0-based) */
  currentStepIndex: number;
  /** Completed step IDs */
  completedStepIds?: string[];
  /** Callback when a step is clicked */
  onStepClick?: (stepIndex: number) => void;
  /** Initial collapsed state */
  initialCollapsed?: boolean;
  /** Panel position */
  position?: 'left' | 'right';
  /** Custom class name */
  className?: string;
}

export const TutorialPanel: React.FC<TutorialPanelProps> = ({
  steps,
  currentStepIndex,
  completedStepIds = [],
  onStepClick,
  initialCollapsed = false,
  position = 'right',
  className = '',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  const completedCount = completedStepIds.length;
  const totalSteps = steps.length;
  const progressPercentage = Math.round((completedCount / totalSteps) * 100);

  const isStepCompleted = (stepId: string) => completedStepIds.includes(stepId);
  const isStepCurrent = (index: number) => index === currentStepIndex;

  const getStepIcon = (step: TutorialStep, index: number) => {
    if (isStepCompleted(step.id)) {
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
    if (isStepCurrent(index)) {
      return <PlayCircle className="w-5 h-5 text-blue-500" />;
    }
    return <Circle className="w-5 h-5 text-gray-400 dark:text-gray-600" />;
  };

  const panelPosition = position === 'left' ? 'left-0' : 'right-0';
  const togglePosition = position === 'left' ? 'right-0 translate-x-full' : 'left-0 -translate-x-full';
  const collapseDirection = position === 'left' ? -1 : 1;

  return (
    <div className={`fixed top-0 ${panelPosition} h-full z-[10003] ${className}`}>
      <AnimatePresence mode="wait">
        {!isCollapsed ? (
          <motion.div
            key="expanded"
            initial={{ x: collapseDirection * 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: collapseDirection * 100, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="h-full w-80 bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Tutorial Progress
                </h2>
                <button
                  onClick={() => setIsCollapsed(true)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label="Collapse panel"
                >
                  {position === 'left' ? (
                    <ChevronLeft className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {completedCount} of {totalSteps} completed
                  </span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    {progressPercentage}%
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-400 dark:to-blue-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercentage}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
              </div>
            </div>

            {/* Step list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {steps.map((step, index) => {
                const isCurrent = isStepCurrent(index);
                const isCompleted = isStepCompleted(step.id);
                const isClickable = !!onStepClick;

                return (
                  <motion.button
                    key={step.id}
                    onClick={() => isClickable && onStepClick(index)}
                    disabled={!isClickable}
                    className={`
                      w-full text-left p-3 rounded-lg border transition-all
                      ${
                        isCurrent
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700'
                          : isCompleted
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                          : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600'
                      }
                      ${isClickable ? 'hover:shadow-md cursor-pointer' : 'cursor-default'}
                    `}
                    whileHover={isClickable ? { scale: 1.02 } : {}}
                    whileTap={isClickable ? { scale: 0.98 } : {}}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        {getStepIcon(step, index)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            Step {index + 1}
                          </span>
                          {isCurrent && (
                            <span className="px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 rounded">
                              Current
                            </span>
                          )}
                        </div>
                        <h4
                          className={`text-sm font-medium line-clamp-2 ${
                            isCurrent
                              ? 'text-blue-900 dark:text-blue-100'
                              : isCompleted
                              ? 'text-green-900 dark:text-green-100'
                              : 'text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {step.title}
                        </h4>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                Click on any step to jump to it
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="collapsed"
            initial={{ x: collapseDirection * -40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: collapseDirection * -40, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            onClick={() => setIsCollapsed(false)}
            className={`
              absolute top-1/2 ${togglePosition} -translate-y-1/2
              bg-white dark:bg-gray-800 shadow-lg rounded-full p-3
              border border-gray-200 dark:border-gray-700
              hover:shadow-xl transition-shadow
            `}
            aria-label="Expand panel"
          >
            <div className="relative">
              {position === 'left' ? (
                <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              ) : (
                <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              )}

              {/* Progress indicator on collapsed button */}
              <div className="absolute -top-1 -right-1 w-6 h-6">
                <svg className="transform -rotate-90" viewBox="0 0 24 24">
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-gray-200 dark:text-gray-700"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={`${progressPercentage * 0.628} 62.8`}
                    className="text-blue-500 dark:text-blue-400"
                  />
                </svg>
              </div>
            </div>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TutorialPanel;

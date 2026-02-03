/**
 * PageTutorialMenu Component
 *
 * Dropdown menu showing tutorials available on a specific page.
 * Can be rendered as a button, compact icon, or inline text.
 */

"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  BookOpen,
  ChevronDown,
  CheckCircle,
  PlayCircle,
  BarChart3,
} from "lucide-react";
import type {
  Tutorial,
  DifficultyLevel,
  TutorialFocusPage,
} from "@/types/tutorial";
import { useTutorialStore } from "@/stores/tutorial-store";

export interface PageTutorialMenuProps {
  /** Page identifier to filter tutorials */
  focusPage: TutorialFocusPage;
  /** Available tutorials (filtered by focusPage) */
  tutorials: Tutorial[];
  /** Display variant */
  variant?: "button" | "compact" | "inline";
  /** Callback when a tutorial is selected */
  onSelectTutorial?: (tutorial: Tutorial) => void;
  /** Custom class name */
  className?: string;
}

const difficultyColors: Record<DifficultyLevel, string> = {
  beginner: "text-green-500",
  intermediate: "text-amber-500",
  advanced: "text-purple-500",
};

export const PageTutorialMenu: React.FC<PageTutorialMenuProps> = ({
  focusPage,
  tutorials,
  variant = "button",
  onSelectTutorial,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const {
    completedTutorials,
    inProgressTutorials,
    isOpen: tutorialIsOpen,
    openTutorial,
  } = useTutorialStore();

  // Filter tutorials for this page
  const pageTutorials = tutorials.filter(
    (t) => t.focusPage === focusPage || t.targetPage?.includes(focusPage)
  );

  // Count completed
  const completedCount = pageTutorials.filter((t) =>
    completedTutorials.includes(t.id)
  ).length;

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Close when tutorial opens
  useEffect(() => {
    if (tutorialIsOpen) {
      setIsOpen(false);
    }
  }, [tutorialIsOpen]);

  const handleSelectTutorial = (tutorial: Tutorial) => {
    if (onSelectTutorial) {
      onSelectTutorial(tutorial);
    } else {
      openTutorial(tutorial, "contextual");
    }
    setIsOpen(false);
  };

  // Don't render if no tutorials for this page
  if (pageTutorials.length === 0) {
    return null;
  }

  // Don't render when tutorial is active
  if (tutorialIsOpen) {
    return null;
  }

  const renderButton = () => {
    switch (variant) {
      case "compact":
        return (
          <button
            ref={buttonRef}
            onClick={() => setIsOpen(!isOpen)}
            className={`
              relative p-2 rounded-md text-text-secondary hover:text-text-primary
              hover:bg-surface-hover transition-colors
              ${className}
            `}
            aria-label={`${pageTutorials.length} tutorials available`}
          >
            <BookOpen className="w-5 h-5" />
            {pageTutorials.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-white text-xs flex items-center justify-center">
                {pageTutorials.length}
              </span>
            )}
          </button>
        );

      case "inline":
        return (
          <button
            ref={buttonRef}
            onClick={() => setIsOpen(!isOpen)}
            className={`
              inline-flex items-center gap-1 text-sm text-primary hover:underline
              ${className}
            `}
          >
            <BookOpen className="w-4 h-4" />
            <span>{pageTutorials.length} tutorials</span>
          </button>
        );

      default: // "button"
        return (
          <button
            ref={buttonRef}
            onClick={() => setIsOpen(!isOpen)}
            className={`
              inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium
              text-text-secondary hover:text-text-primary
              border border-border-default hover:border-border-strong
              rounded-md transition-colors
              ${className}
            `}
          >
            <BookOpen className="w-4 h-4" />
            <span>Tutorials</span>
            {pageTutorials.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded-full">
                {completedCount}/{pageTutorials.length}
              </span>
            )}
            <ChevronDown
              className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </button>
        );
    }
  };

  return (
    <div className="relative">
      {renderButton()}

      {/* Dropdown menu */}
      {isOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-surface-raised border border-border-default rounded-lg shadow-xl z-50 tutorial-scale-in"
        >
          <div className="p-3 border-b border-border-subtle">
            <h3 className="font-semibold text-text-primary dark:text-white text-sm">
              Page Tutorials
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {completedCount} of {pageTutorials.length} completed
            </p>
          </div>

          <div className="p-2">
            {pageTutorials.map((tutorial) => {
              const isCompleted = completedTutorials.includes(tutorial.id);
              const isInProgress = inProgressTutorials.includes(tutorial.id);

              return (
                <button
                  key={tutorial.id}
                  onClick={() => handleSelectTutorial(tutorial)}
                  className="w-full text-left p-3 rounded-md hover:bg-surface-hover transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    {/* Status icon */}
                    <div
                      className={`
                        flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center
                        ${
                          isCompleted
                            ? "bg-green-500/10 text-green-500"
                            : isInProgress
                              ? "bg-primary/10 text-primary"
                              : "bg-surface-hover text-text-muted group-hover:text-text-secondary"
                        }
                      `}
                    >
                      {isCompleted ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : isInProgress ? (
                        <BarChart3 className="w-4 h-4" />
                      ) : (
                        <PlayCircle className="w-4 h-4" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-text-primary dark:text-white truncate">
                          {tutorial.title}
                        </span>
                        <span
                          className={`text-xs ${difficultyColors[tutorial.difficulty]}`}
                        >
                          {tutorial.difficulty}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-1">
                        {tutorial.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                        <span>{tutorial.duration}</span>
                        <span>&middot;</span>
                        <span>{tutorial.steps.length} steps</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default PageTutorialMenu;

/**
 * Tutorial Data Registry
 *
 * Central registry for all tutorials with helper functions for
 * querying and organizing tutorials.
 */

import type {
  Tutorial,
  DifficultyLevel,
  TutorialFocusPage,
} from "@/types/tutorial";
import { testTutorial, eventDrivenTestTutorial } from "./test-tutorial";
import { gettingStartedTutorial, quickTourTutorial } from "./getting-started";
import { onboardingTourTutorial } from "./onboarding-tour";
import { deferredFeedbackTutorial } from "./deferred-feedback";
import { recordingStateMachineTutorial } from "./recording-state-machine";

// ============================================================================
// Tutorial Registry
// ============================================================================

/**
 * All registered tutorials
 * Add new tutorials to this array
 */
export const tutorials: Tutorial[] = [
  // Real tutorials
  gettingStartedTutorial,
  quickTourTutorial,
  onboardingTourTutorial,
  deferredFeedbackTutorial,
  recordingStateMachineTutorial,

  // Test tutorials (can be removed in production)
  testTutorial,
  eventDrivenTestTutorial,

  // Legacy example tutorial
  {
    id: "getting-started",
    title: "Getting Started with Qontinui",
    description:
      "Learn the basics of creating and managing automation projects in Qontinui.",
    duration: "5 minutes",
    estimatedTime: 5,
    difficulty: "beginner",
    mode: "contextual",
    focusPage: "projects",
    category: "Getting Started",
    tags: ["basics", "projects", "introduction"],
    learningObjectives: [
      "Create a new automation project",
      "Understand the project structure",
      "Navigate the interface",
    ],
    steps: [
      {
        id: "welcome",
        title: "Welcome to Qontinui",
        content:
          "Qontinui is a visual automation platform that lets you create powerful automation workflows using a state machine approach.",
        action: "Click anywhere to continue",
      },
      {
        id: "create-project",
        title: "Create Your First Project",
        content:
          "Projects contain your automation workflows. Click the 'New Project' button to get started.",
        targetElement: {
          selector: "[data-tutorial-id='new-project-btn']",
          highlightType: "spotlight",
          position: "bottom",
          allowInteraction: true,
        },
        wait: {
          type: "dom-event",
          event: "click",
          selector: "[data-tutorial-id='new-project-btn']",
          timeout: 30000,
          onTimeout: "show-hint",
          hint: "Click the 'New Project' button to continue",
        },
      },
      {
        id: "project-created",
        title: "Project Created!",
        content:
          "Great job! You've created your first project. You can now start building your automation workflow.",
        action: "Click 'Finish' to complete this tutorial",
      },
    ],
  },
];

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get a tutorial by its ID
 */
export function getTutorialById(id: string): Tutorial | undefined {
  return tutorials.find((t) => t.id === id);
}

/**
 * Get tutorials by category
 */
export function getTutorialsByCategory(category: string): Tutorial[] {
  return tutorials.filter((t) => t.category === category);
}

/**
 * Get tutorials by difficulty level
 */
export function getTutorialsByDifficulty(
  difficulty: DifficultyLevel
): Tutorial[] {
  return tutorials.filter((t) => t.difficulty === difficulty);
}

/**
 * Get tutorials by focus page
 */
export function getTutorialsByFocusPage(
  focusPage: TutorialFocusPage
): Tutorial[] {
  return tutorials.filter((t) => t.focusPage === focusPage);
}

/**
 * Get tutorials by tag
 */
export function getTutorialsByTag(tag: string): Tutorial[] {
  return tutorials.filter((t) => t.tags?.includes(tag));
}

/**
 * Get all unique categories
 */
export function getAllCategories(): string[] {
  const categories = new Set<string>();
  tutorials.forEach((t) => {
    if (t.category) {
      categories.add(t.category);
    }
  });
  return Array.from(categories).sort();
}

/**
 * Get all unique tags
 */
export function getAllTags(): string[] {
  const tags = new Set<string>();
  tutorials.forEach((t) => {
    t.tags?.forEach((tag) => tags.add(tag));
  });
  return Array.from(tags).sort();
}

// ============================================================================
// Special Tutorials
// ============================================================================

/**
 * Get the first-time user tutorial
 * This should be shown to new users
 */
export function getFirstTimeTutorial(): Tutorial | undefined {
  return (
    tutorials.find((t) => t.id === "getting-started-web") ||
    tutorials.find((t) => t.id === "getting-started") ||
    tutorials.find((t) => t.difficulty === "beginner")
  );
}

/**
 * Get featured tutorials for the home/dashboard
 */
export function getFeaturedTutorials(limit = 3): Tutorial[] {
  // Prioritize: first-time, then beginner, then by category variety
  const featured: Tutorial[] = [];

  // Add first-time tutorial
  const firstTime = getFirstTimeTutorial();
  if (firstTime) {
    featured.push(firstTime);
  }

  // Add beginner tutorials
  const beginnerTutorials = getTutorialsByDifficulty("beginner").filter(
    (t) => !featured.includes(t)
  );
  featured.push(...beginnerTutorials.slice(0, limit - featured.length));

  // Fill with other tutorials if needed
  if (featured.length < limit) {
    const others = tutorials.filter((t) => !featured.includes(t));
    featured.push(...others.slice(0, limit - featured.length));
  }

  return featured.slice(0, limit);
}

/**
 * Get recommended next tutorial based on completed tutorials
 */
export function getRecommendedNextTutorial(
  completedTutorialIds: string[]
): Tutorial | undefined {
  // Find tutorials that:
  // 1. Haven't been completed
  // 2. Have their prerequisites met

  const incompleteWithPrereqs = tutorials.filter((t) => {
    // Skip if already completed
    if (completedTutorialIds.includes(t.id)) {
      return false;
    }

    // Check if prerequisites are met
    if (t.prerequisites && t.prerequisites.length > 0) {
      return t.prerequisites.every((prereq) =>
        completedTutorialIds.includes(prereq)
      );
    }

    return true;
  });

  // Sort by difficulty (beginner first) then by estimated time
  incompleteWithPrereqs.sort((a, b) => {
    const difficultyOrder: Record<DifficultyLevel, number> = {
      beginner: 0,
      intermediate: 1,
      advanced: 2,
    };

    const diffDiff =
      difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
    if (diffDiff !== 0) return diffDiff;

    return (a.estimatedTime ?? 0) - (b.estimatedTime ?? 0);
  });

  return incompleteWithPrereqs[0];
}

/**
 * Search tutorials by query string
 */
export function searchTutorials(query: string): Tutorial[] {
  const lowerQuery = query.toLowerCase();

  return tutorials.filter((t) => {
    return (
      t.title.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery)) ||
      t.category?.toLowerCase().includes(lowerQuery)
    );
  });
}

/**
 * Get tutorial statistics
 */
export function getTutorialStats(completedTutorialIds: string[]): {
  total: number;
  completed: number;
  inProgress: number;
  byDifficulty: Record<DifficultyLevel, { total: number; completed: number }>;
  byCategory: Record<string, { total: number; completed: number }>;
} {
  const byDifficulty: Record<
    DifficultyLevel,
    { total: number; completed: number }
  > = {
    beginner: { total: 0, completed: 0 },
    intermediate: { total: 0, completed: 0 },
    advanced: { total: 0, completed: 0 },
  };

  const byCategory: Record<string, { total: number; completed: number }> = {};

  let completed = 0;

  tutorials.forEach((t) => {
    const isCompleted = completedTutorialIds.includes(t.id);
    if (isCompleted) completed++;

    // By difficulty
    byDifficulty[t.difficulty].total++;
    if (isCompleted) byDifficulty[t.difficulty].completed++;

    // By category
    const category = t.category ?? "Uncategorized";
    if (!byCategory[category]) {
      byCategory[category] = { total: 0, completed: 0 };
    }
    byCategory[category].total++;
    if (isCompleted) byCategory[category].completed++;
  });

  return {
    total: tutorials.length,
    completed,
    inProgress: 0, // Would need progress data to calculate
    byDifficulty,
    byCategory,
  };
}

/**
 * Tutorial Data Index
 *
 * This file exports all available tutorials for the Qontinui learning system.
 * Each tutorial provides a comprehensive guided experience for learning
 * specific automation workflows and features.
 */

import { civ6EarlyGameTutorial } from './civ6-early-game';
import firstAutomationTutorial from './workflow-builder/first-automation';
import visualWorkflowTutorial from './workflow-builder/visual-workflow';
import annotationBasicsTutorial from './image-annotation/annotation-basics';

// Re-export individual tutorials
export { civ6EarlyGameTutorial };
export { firstAutomationTutorial };
export { visualWorkflowTutorial };
export { annotationBasicsTutorial };

/**
 * Array of all available tutorials
 *
 * This can be used to:
 * - Display available tutorials in the UI
 * - Filter tutorials by category, difficulty, or tags
 * - Build tutorial navigation and learning paths
 * - Implement tutorial search functionality
 */
export const allTutorials = [
  firstAutomationTutorial,
  visualWorkflowTutorial,
  annotationBasicsTutorial,
  civ6EarlyGameTutorial,
];

/**
 * Helper function to get a tutorial by ID
 *
 * @param tutorialId - The unique identifier of the tutorial
 * @returns The tutorial object, or undefined if not found
 *
 * @example
 * const tutorial = getTutorialById('civ6-early-game');
 */
export function getTutorialById(tutorialId: string) {
  return allTutorials.find((tutorial) => tutorial.id === tutorialId);
}

/**
 * Helper function to filter tutorials by category
 *
 * @param category - The category to filter by (e.g., 'Gaming', 'Enterprise')
 * @returns Array of tutorials in the specified category
 *
 * @example
 * const gamingTutorials = getTutorialsByCategory('Gaming');
 */
export function getTutorialsByCategory(category: string) {
  return allTutorials.filter((tutorial) => tutorial.category === category);
}

/**
 * Helper function to filter tutorials by difficulty
 *
 * @param difficulty - The difficulty level to filter by ('beginner', 'intermediate', 'advanced')
 * @returns Array of tutorials at the specified difficulty level
 *
 * @example
 * const beginnerTutorials = getTutorialsByDifficulty('beginner');
 */
export function getTutorialsByDifficulty(difficulty: string) {
  return allTutorials.filter((tutorial) => tutorial.difficulty === difficulty);
}

/**
 * Helper function to filter tutorials by tags
 *
 * @param tag - The tag to filter by
 * @returns Array of tutorials that include the specified tag
 *
 * @example
 * const gamingTutorials = getTutorialsByTag('gaming');
 */
export function getTutorialsByTag(tag: string) {
  return allTutorials.filter((tutorial) => tutorial.tags?.includes(tag));
}

/**
 * Helper function to search tutorials by title or description
 *
 * @param query - The search query
 * @returns Array of tutorials matching the query
 *
 * @example
 * const results = searchTutorials('automation');
 */
export function searchTutorials(query: string) {
  const normalizedQuery = query.toLowerCase();
  return allTutorials.filter(
    (tutorial) =>
      tutorial.title.toLowerCase().includes(normalizedQuery) ||
      tutorial.description.toLowerCase().includes(normalizedQuery)
  );
}

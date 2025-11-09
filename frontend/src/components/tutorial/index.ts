/**
 * Tutorial System - Main Export File
 *
 * This file provides convenient access to all tutorial components and utilities.
 * Import from here instead of individual component files.
 */

// Main Components
export { TutorialDialog } from './tutorial-dialog';
export { TutorialSidebar } from './tutorial-sidebar';
export { StepRenderer } from './step-renderer';
export {
  AnnotatedImage,
  type Annotation,
  type AnnotatedImageProps,
  type AnnotationType,
  type AnnotationColor,
  type ArrowDirection,
} from "./annotated-image";
export {
  TryItButton,
  type TryItButtonProps,
} from "./try-it-button";

// Types (re-exported for convenience)
export type {
  Tutorial,
  TutorialStep,
  TutorialProgress,
  StepProgress,
  TryItConfig,
} from '@/types/tutorial';

// Store hook (for external use)
export { useTutorialStore } from '@/stores/tutorial-store';

/**
 * Quick Start Example:
 *
 * ```tsx
 * import { TutorialDialog, useTutorialStore } from '@/components/tutorial';
 * import { civ6EarlyGameTutorial } from '@/data/tutorials';
 *
 * function MyComponent() {
 *   const openTutorial = useTutorialStore((s) => s.openTutorial);
 *
 *   return (
 *     <>
 *       <button onClick={() => openTutorial(civ6EarlyGameTutorial, 'standalone')}>
 *         Start Tutorial
 *       </button>
 *       <TutorialDialog />
 *     </>
 *   );
 * }
 * ```
 */

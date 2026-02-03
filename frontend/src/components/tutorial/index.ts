/**
 * Tutorial System - Main Export File
 *
 * This file provides convenient access to all tutorial components and utilities.
 * Import from here instead of individual component files.
 */

// Main Components
export { TutorialDialog } from "./tutorial-dialog";
export { TutorialSidebar } from "./tutorial-sidebar";
export { StepRenderer } from "./step-renderer";
export {
  AnnotatedImage,
  type Annotation,
  type AnnotatedImageProps,
  type AnnotationType,
  type AnnotationColor,
  type ArrowDirection,
} from "./annotated-image";
export { TryItButton, type TryItButtonProps } from "./try-it-button";

// Contextual Tutorial Components (Enhanced)
export {
  ContextualTutorial,
  ContextualTutorialEnhanced,
  SpotlightOverlay,
  TutorialTooltip,
  CenteredTooltip,
  TutorialPanel,
  ValidationFeedback,
  ProgressIndicator,
  type ContextualTutorialProps,
  type ContextualTutorialEnhancedProps,
  type SpotlightOverlayProps,
  type TutorialTooltipProps,
  type CenteredTooltipProps,
  type TutorialPanelProps,
  type ValidationFeedbackProps,
  type ValidationStatus,
  type ProgressIndicatorProps,
} from "./contextual";

// Tutorial Cards and Menus
export { TutorialCard, type TutorialCardProps } from "./TutorialCard";
export { PageTutorialMenu, type PageTutorialMenuProps } from "./PageTutorialMenu";
export { TutorialMenuButton } from "./TutorialMenuButton";

// Tutorial Data Registry
export {
  tutorials,
  getTutorialById,
  getTutorialsByCategory,
  getTutorialsByDifficulty,
  getTutorialsByFocusPage,
  getTutorialsByTag,
  getAllCategories,
  getAllTags,
  getFirstTimeTutorial,
  getFeaturedTutorials,
  getRecommendedNextTutorial,
  searchTutorials,
  getTutorialStats,
} from "./data";

// Types (re-exported for convenience)
export type {
  Tutorial,
  TutorialStep,
  TutorialProgress,
  StepProgress,
  TryItConfig,
  TutorialMode,
  TutorialFocusPage,
  StepWaitCondition,
  WaitEventType,
  TourState,
  ValidationFeedback as ValidationFeedbackType,
  PersistedTutorialState,
} from "@/types/tutorial";

// Store hook (for external use)
export { useTutorialStore } from "@/stores/tutorial-store";

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

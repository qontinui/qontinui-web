/**
 * Tutorial Framework Type Definitions
 *
 * Comprehensive type system for the Qontinui tutorial framework, supporting
 * interactive learning experiences with screenshots, annotations, and interactive
 * "Try It" moments for hands-on practice.
 */

/**
 * Tutorial display modes
 * - overlay: Full-screen modal with sidebar navigation (original mode)
 * - contextual: Embedded in-page tutorial with tooltips and spotlights
 * - hybrid: Combination of both modes, switching as needed
 */
export type TutorialMode = "overlay" | "contextual" | "hybrid";

/**
 * Highlight types for contextual tutorials
 */
export type HighlightType = "spotlight" | "border" | "pulse" | "arrow";

/**
 * Tooltip position relative to target element
 */
export type TooltipPosition = "top" | "bottom" | "left" | "right" | "center";

/**
 * Validation types for interactive steps
 */
export type ValidationType = "action" | "state" | "input" | "custom";

/**
 * Target element configuration for contextual tutorials
 * Defines which UI element to highlight and how to interact with it
 */
export interface TargetElement {
  /** CSS selector or data-tutorial-id attribute to find the element */
  selector: string;

  /** Type of visual highlighting to apply */
  highlightType: HighlightType;

  /** Position of the tooltip relative to the target */
  position: TooltipPosition;

  /** Whether user can interact with the highlighted element */
  allowInteraction: boolean;

  /** Optional scroll behavior when focusing element */
  scrollIntoView?: boolean;

  /** Optional delay before highlighting (milliseconds) */
  delay?: number;

  /** Optional custom offset from element (pixels) */
  offset?: { x: number; y: number };
}

/**
 * Validation configuration for interactive tutorial steps
 * Ensures users complete required actions before proceeding
 */
export interface StepValidation {
  /** Type of validation to perform */
  type: ValidationType;

  /** Validation function (stored as string for serialization) */
  condition: string;

  /** Feedback messages for different outcomes */
  feedback: {
    /** Message shown when validation passes */
    success: string;

    /** Message shown when validation fails */
    failure: string;

    /** Optional hint to help user succeed */
    hint?: string;
  };

  /** Optional timeout for validation (milliseconds) */
  timeout?: number;

  /** Optional flag to allow skipping validation */
  optional?: boolean;
}

/**
 * Tutorial trigger configuration
 * Defines when and how tutorials should be automatically started
 */
export interface TutorialTriggers {
  /** Auto-start on first page load */
  automatic?: boolean;

  /** Can be manually started from help menu */
  manual?: boolean;

  /** Contextual triggers based on user actions or page state */
  contextual?: {
    /** Event that triggers the tutorial */
    event: string;

    /** Condition function (stored as string) */
    condition: string;
  }[];
}

/**
 * Workflow integration configuration
 * Controls how tutorials interact with actual workflow editing
 */
export interface WorkflowIntegration {
  /** Allow real editing during tutorial (vs. read-only demo) */
  enableRealEditing: boolean;

  /** Pre-populate with sample data */
  provideSampleData: boolean;

  /** Validate user actions match tutorial expectations */
  validateUserActions: boolean;

  /** Optional sample data to use */
  sampleData?: Record<string, any>;

  /** Optional cleanup function after tutorial */
  cleanup?: boolean;
}

/**
 * Step actions for setup and teardown
 */
export interface StepActions {
  /** Function to run before step is shown */
  before?: string;

  /** Function to run after step is completed */
  after?: string;

  /** Whether to automatically execute the action (for demos) */
  autoExecute?: boolean;
}

/**
 * Annotation types for highlighting and guiding users on screenshots
 *
 * @example
 * // Highlight annotation
 * { type: 'highlight', x: 100, y: 200, width: 200, height: 100, label: 'Click here' }
 *
 * @example
 * // Arrow pointing to element
 * { type: 'arrow', x: 150, y: 250, label: 'Find this button' }
 *
 * @example
 * // Pulse animation effect
 * { type: 'pulse', x: 200, y: 300, width: 50, height: 50 }
 */
export type AnnotationType = "highlight" | "arrow" | "pulse" | "label";

/**
 * Annotation for marking up screenshots with visual guides
 *
 * Different annotation types serve different purposes:
 * - 'highlight': Rectangular highlight box around an area
 * - 'arrow': Arrow pointing to a specific coordinate
 * - 'pulse': Pulsing circle animation to draw attention
 * - 'label': Text label at a specific location
 */
export interface Annotation {
  /** Type of annotation */
  type: AnnotationType;

  /** X coordinate (pixels from left) */
  x: number;

  /** Y coordinate (pixels from top) */
  y: number;

  /** Optional text label for the annotation */
  label?: string;

  /** Optional width for highlight boxes (pixels) */
  width?: number;

  /** Optional height for highlight boxes (pixels) */
  height?: number;

  /** Optional CSS color for the annotation (defaults based on type) */
  color?: string;

  /** Optional Z-index for layering multiple annotations */
  zIndex?: number;

  /** Optional animation duration in milliseconds (for pulse) */
  duration?: number;
}

/**
 * Types of interactive "Try It" configurations for hands-on learning
 *
 * @example
 * // Screenshot upload exercise
 * { type: 'upload-screenshots', component: 'ScreenshotUploader' }
 *
 * @example
 * // Element identification exercise
 * { type: 'identify-element', component: 'ElementHighlighter', preloadedData: { gameScreenshot: '...' } }
 */
export type TryItType =
  | "upload-screenshots"
  | "identify-element"
  | "create-action"
  | "configure-automation"
  | "test-automation"
  | "debug-pattern"
  | "optimize-automation"
  | "custom";

/**
 * Configuration for interactive "Try It" moments in tutorials
 *
 * These allow users to practice what they've learned by interacting with
 * the actual tools in a guided way.
 */
export interface TryItConfig {
  /** Type of interactive exercise */
  type: TryItType;

  /** Name of the component to render for this exercise */
  component: string;

  /** Optional data to preload into the component */
  preloadedData?: Record<string, any>;

  /** Optional success criteria for completion */
  successCriteria?: {
    /** Description of what constitutes success */
    description: string;

    /** Function or rule to validate completion (stored as JSON-serializable criteria) */
    validation?: Record<string, any>;
  };

  /** Optional hints to help users complete the exercise */
  hints?: string[];

  /** Optional timeout in milliseconds for completing the exercise */
  timeLimit?: number;

  /** Optional flag to skip step if exercise is not completed */
  optional?: boolean;
}

/**
 * Difficulty levels for tutorials and steps
 */
export type DifficultyLevel = "beginner" | "intermediate" | "advanced";

/**
 * Individual step in a tutorial sequence
 *
 * Each step guides the user through a specific part of learning,
 * combining explanatory content, visual aids, and interactive practice.
 */
export interface TutorialStep {
  /** Unique identifier for this step */
  id: string;

  /** Title of this step */
  title: string;

  /** Main content (supports markdown formatting) */
  content: string;

  /** Optional additional details text */
  details?: string;

  /** Optional keyboard shortcuts for this step */
  shortcuts?: string[];

  /** Optional path to a screenshot image for this step */
  screenshot?: string;

  /** Optional array of annotations to overlay on the screenshot */
  annotations?: Annotation[];

  /** Optional interactive "Try It" configuration for hands-on practice */
  tryIt?: TryItConfig;

  /** Optional JSON configuration to display to the user */
  config?: Record<string, any>;

  /** Optional difficulty level specific to this step */
  difficulty?: DifficultyLevel;

  /** Optional estimated duration for this step in minutes */
  estimatedDuration?: number;

  /** Optional learning objectives for this step */
  learningObjectives?: string[];

  /** Optional tips or best practices relevant to this step */
  tips?: string[];

  /** Optional links to external resources or documentation */
  resources?: {
    title: string;
    url: string;
    type?: "documentation" | "video" | "article" | "api-reference";
  }[];

  /** Optional target element for contextual tutorials */
  targetElement?: TargetElement;

  /** Optional validation for interactive steps */
  validation?: StepValidation;

  /** Optional setup/teardown actions */
  actions?: StepActions;

  /** Optional action instruction string to display to user */
  action?: string;

  /** Optional flag to wait for user action before auto-advancing */
  waitForUserAction?: boolean;

  /** Optional custom component to render for this step */
  customComponent?: string;
}

/**
 * Complete tutorial definition
 *
 * A tutorial is a comprehensive guide that takes users through learning
 * a specific feature or workflow of Qontinui.
 */
export interface Tutorial {
  /** Unique identifier for the tutorial */
  id: string;

  /** Display title of the tutorial */
  title: string;

  /** Detailed description of what the tutorial teaches */
  description: string;

  /** Estimated duration (e.g., "15 minutes", "1 hour") */
  duration: string;

  /** Estimated time in minutes (numeric) */
  estimatedTime?: number;

  /** Overall difficulty level of the tutorial */
  difficulty: DifficultyLevel;

  /** Ordered array of tutorial steps */
  steps: TutorialStep[];

  /** Tutorial display mode */
  mode: TutorialMode;

  /** Optional target page/route for contextual tutorials */
  targetPage?: string;

  /** Optional trigger configuration */
  triggers?: TutorialTriggers;

  /** Optional workflow integration settings */
  workflowIntegration?: WorkflowIntegration;

  /** Optional complete automation configuration resulting from following the tutorial */
  finalProject?: Record<string, any>;

  /** Optional prerequisites (tutorial IDs that should be completed first) */
  prerequisites?: string[];

  /** Optional learning objectives for the entire tutorial */
  learningObjectives?: string[];

  /** Optional category or tag for organizing tutorials */
  category?: string;

  /** Optional tags for search and filtering */
  tags?: string[];

  /** Optional URL to a video walkthrough of the tutorial */
  videoUrl?: string;

  /** Optional author information */
  author?: {
    name: string;
    avatar?: string;
  };

  /** Optional creation and last update timestamps */
  metadata?: {
    createdAt: number;
    updatedAt: number;
    version: string;
  };

  /** Optional flag indicating if tutorial is in draft/beta status */
  isPublished?: boolean;
}

/**
 * User progress for a single tutorial step
 *
 * Tracks completion status and metadata for individual steps within a tutorial.
 */
export interface StepProgress {
  /** ID of the tutorial step */
  stepId: string;

  /** Whether the step's main content has been viewed/completed */
  completed: boolean;

  /** Whether the optional "Try It" exercise has been completed */
  tryItCompleted: boolean;

  /** Timestamp when step was marked as completed (milliseconds since epoch) */
  timestamp: number;

  /** Optional number of attempts for the Try It exercise */
  attempts?: number;

  /** Optional timestamp when user first opened this step */
  firstOpenedAt?: number;

  /** Optional time spent on this step in milliseconds */
  timeSpent?: number;

  /** Optional notes from user about this step */
  notes?: string;
}

/**
 * Overall user progress tracking for a complete tutorial
 *
 * Maintains state for a user's journey through a tutorial, including
 * which step they're on and their completion status.
 */
export interface TutorialProgress {
  /** ID of the tutorial being tracked */
  tutorialId: string;

  /** Current step index (0-based) */
  currentStepIndex: number;

  /** Array of progress records for each step */
  stepProgress: StepProgress[];

  /** Timestamp when user started the tutorial (milliseconds since epoch) */
  startedAt: number;

  /** Optional timestamp when user completed the tutorial (milliseconds since epoch) */
  completedAt?: number;

  /** Optional user ID for multi-user systems */
  userId?: string;

  /** Optional overall completion percentage (0-100) */
  completionPercentage?: number;

  /** Optional flag indicating if tutorial is active/in-progress */
  isActive?: boolean;

  /** Optional custom metadata for extended tracking */
  metadata?: Record<string, any>;
}

/**
 * Tutorial lesson/chapter containing multiple related tutorials
 *
 * Useful for organizing tutorials into learning paths or curriculum.
 */
export interface TutorialModule {
  /** Unique identifier for the module */
  id: string;

  /** Display title for the module */
  title: string;

  /** Description of the module's contents */
  description: string;

  /** Array of tutorial IDs in this module, in recommended order */
  tutorialIds: string[];

  /** Overall difficulty level of the module */
  difficulty: DifficultyLevel;

  /** Estimated total duration of all tutorials in minutes */
  estimatedDuration: number;

  /** Optional learning objectives for the entire module */
  learningObjectives?: string[];

  /** Optional category for organizing modules */
  category?: string;

  /** Optional sequence number for ordering modules */
  order?: number;
}

/**
 * Tutorial system configuration and settings
 *
 * Defines how the tutorial system should behave globally.
 */
export interface TutorialSystemConfig {
  /** Whether tutorials should auto-play on startup */
  autoPlayOnStartup: boolean;

  /** Whether to show progress indicators */
  showProgressBar: boolean;

  /** Whether to enable keyboard navigation between steps */
  keyboardNavigation: boolean;

  /** Optional theme override for tutorial components */
  theme?: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
  };

  /** Optional custom CSS class prefix */
  classNamePrefix?: string;

  /** Optional analytics tracking settings */
  analytics?: {
    trackCompletion: boolean;
    trackTimeSpent: boolean;
    trackInteractions: boolean;
  };
}

/**
 * Type guard to check if a value is a valid AnnotationType
 */
export function isAnnotationType(value: any): value is AnnotationType {
  return ["highlight", "arrow", "pulse", "label"].includes(value);
}

/**
 * Type guard to check if a value is a valid TryItType
 */
export function isTryItType(value: any): value is TryItType {
  return [
    "upload-screenshots",
    "identify-element",
    "create-action",
    "configure-automation",
    "test-automation",
    "debug-pattern",
    "optimize-automation",
    "custom",
  ].includes(value);
}

/**
 * Type guard to check if a value is a valid DifficultyLevel
 */
export function isDifficultyLevel(value: any): value is DifficultyLevel {
  return ["beginner", "intermediate", "advanced"].includes(value);
}

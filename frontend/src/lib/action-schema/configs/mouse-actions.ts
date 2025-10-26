/**
 * Mouse action configurations
 */

import { TargetConfig } from '../shared/target-config';
import { Coordinates, MouseButton, Region } from '../shared/common-types';
import { VerificationConfig } from '../shared/verification-config';

/**
 * CLICK - Click on a target
 * Unified click action that handles left, right, middle, and double clicks.
 * If no target is provided or target is "Current Position", clicks at the current mouse position (pure action).
 */
export interface ClickActionConfig {
  /**
   * Click target - can be:
   * - "Last Find Result": Click on the last found image
   * - "Current Position": Click at current mouse position (pure action)
   * - "Coordinates": Click at specific X,Y coordinates
   * - "StateImage": Click on a state image
   * - "StateRegion": Click on a state region
   * - "StateLocation": Click on a state location
   */
  target?: string;

  /** X coordinate (used when target is "Coordinates") */
  x?: number;

  /** Y coordinate (used when target is "Coordinates") */
  y?: number;

  /** Type of click: "left", "right", "middle", or "double" */
  clickType?: 'left' | 'right' | 'middle' | 'double';

  /** Number of times to click (1 = single, 2 = double, etc.) */
  clickCount?: number;

  /** How long to hold the button down in milliseconds */
  hold_duration?: number;

  /** Verification after click */
  verify?: VerificationConfig;
}

/**
 * MOUSE_MOVE - Move mouse to a location
 */
export interface MouseMoveActionConfig {
  target: TargetConfig;
  moveInstantly?: boolean; // If false, animated movement
  moveDuration?: number; // milliseconds (for animated movement)
}

/**
 * MOUSE_DOWN - Press mouse button down
 */
export interface MouseDownActionConfig {
  target?: TargetConfig;
  coordinates?: Coordinates;
  mouseButton?: MouseButton;
}

/**
 * MOUSE_UP - Release mouse button
 */
export interface MouseUpActionConfig {
  target?: TargetConfig;
  coordinates?: Coordinates;
  mouseButton?: MouseButton;
}

/**
 * DRAG - Drag from one location to another
 */
export interface DragActionConfig {
  /** Starting point (required) */
  source: TargetConfig;

  /** Ending point (required) */
  destination: TargetConfig | Coordinates | Region;

  /** Mouse button to use */
  mouseButton?: MouseButton;

  /** Duration of drag movement (milliseconds) */
  dragDuration?: number;

  /** Delay before starting drag (milliseconds) */
  delayBeforeMove?: number;

  /** Delay after completing drag (milliseconds) */
  delayAfterDrag?: number;

  /** Verification after drag */
  verify?: VerificationConfig;
}

/**
 * SCROLL - Scroll in a direction
 */
export interface ScrollActionConfig {
  /** Scroll direction */
  direction: 'up' | 'down' | 'left' | 'right';

  /** Number of scroll clicks */
  clicks?: number;

  /** Location to scroll at (optional, defaults to current mouse position) */
  target?: TargetConfig;

  /** Use smooth scrolling */
  smooth?: boolean;

  /** Delay between scroll actions (milliseconds) */
  delayBetweenScrolls?: number;
}

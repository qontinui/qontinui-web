/**
 * Mouse action configurations
 */

import { TargetConfig } from '../shared/target-config';
import { Coordinates, MouseButton, Region } from '../shared/common-types';
import { VerificationConfig } from '../shared/verification-config';

/**
 * CLICK - Click on a target
 */
export interface ClickActionConfig {
  target: TargetConfig;
  numberOfClicks?: number; // 1 = single, 2 = double, etc.
  mouseButton?: MouseButton;
  pressDuration?: number; // milliseconds
  pauseAfterPress?: number; // milliseconds
  pauseAfterRelease?: number; // milliseconds
  verify?: VerificationConfig;
}

/**
 * DOUBLE_CLICK - Double click on a target
 */
export interface DoubleClickActionConfig {
  target: TargetConfig;
  mouseButton?: MouseButton;
  clickInterval?: number; // milliseconds between clicks
  pressDuration?: number; // milliseconds
  verify?: VerificationConfig;
}

/**
 * RIGHT_CLICK - Right click on a target
 */
export interface RightClickActionConfig {
  target: TargetConfig;
  pressDuration?: number; // milliseconds
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

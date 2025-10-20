/**
 * Keyboard action configurations
 */

import { TargetConfig } from '../shared/target-config';

/**
 * TYPE - Type text
 */
export interface TypeActionConfig {
  /** Text to type (use this OR textSource) */
  text?: string;

  /** Get text from a state string instead */
  textSource?: {
    stateId: string;
    stringIds: string[];
    useAll?: boolean;
  };

  /** Delay between keystrokes (milliseconds) */
  typeDelay?: number;

  /** Modifier keys to hold while typing (e.g., "SHIFT", "CTRL") */
  modifiers?: string[];

  /** Click target before typing (optional) */
  clickTarget?: TargetConfig;

  /** Clear existing text before typing */
  clearBefore?: boolean;

  /** Press enter after typing */
  pressEnter?: boolean;
}

/**
 * KEY_PRESS - Press and release a key (or key combination)
 */
export interface KeyPressActionConfig {
  /** Keys to press */
  keys: string[];

  /** Modifier keys (CTRL, ALT, SHIFT, etc.) */
  modifiers?: string[];

  /** Duration to hold key (milliseconds) */
  holdDuration?: number;

  /** Pause between multiple key presses (milliseconds) */
  pauseBetweenKeys?: number;
}

/**
 * KEY_DOWN - Press key down (without releasing)
 */
export interface KeyDownActionConfig {
  /** Keys to press down */
  keys: string[];

  /** Modifier keys to press first */
  modifiers?: string[];
}

/**
 * KEY_UP - Release key
 */
export interface KeyUpActionConfig {
  /** Keys to release */
  keys: string[];

  /** Release modifiers first */
  releaseModifiersFirst?: boolean;
}

/**
 * HOTKEY - Press a hotkey combination
 */
export interface HotkeyActionConfig {
  /** Hotkey combination (e.g., "CTRL+C", "ALT+F4") */
  hotkey: string;

  /** Duration to hold the combination (milliseconds) */
  holdDuration?: number;

  /** Parse hotkey string (e.g., "ctrl+shift+s") */
  parseString?: boolean;
}

/**
 * Timing and logging configuration shared across all actions
 */

import { LogLevel } from './common-types';

/**
 * Base settings that apply to ALL actions
 */
export interface BaseActionSettings {
  /** Pause before action starts (milliseconds) */
  pauseBeforeBegin?: number;

  /** Pause after action completes (milliseconds) */
  pauseAfterEnd?: number;

  /** Override global illustration setting */
  illustrate?: 'YES' | 'NO' | 'USE_GLOBAL';

  /** Logging options for this action */
  loggingOptions?: LoggingOptions;
}

/**
 * Execution control settings
 */
export interface ExecutionSettings {
  /** Maximum time for action to complete (milliseconds) */
  timeout?: number;

  /** Number of times to retry on failure */
  retryCount?: number;

  /** Continue executing subsequent actions even if this fails */
  continueOnError?: boolean;

  /** Repetition options */
  repetition?: RepetitionOptions;
}

/**
 * Repetition configuration for actions
 */
export interface RepetitionOptions {
  /** Number of times to repeat the action */
  count?: number;

  /** Pause between repetitions (milliseconds) */
  pauseBetween?: number;

  /** Stop repeating on first success */
  stopOnSuccess?: boolean;

  /** Stop repeating on first failure */
  stopOnFailure?: boolean;
}

/**
 * Logging configuration
 */
export interface LoggingOptions {
  /** Message to log before action starts */
  beforeActionMessage?: string;

  /** Message to log after action completes */
  afterActionMessage?: string;

  /** Message to log on success */
  successMessage?: string;

  /** Message to log on failure */
  failureMessage?: string;

  /** Log before action */
  logBeforeAction?: boolean;

  /** Log after action */
  logAfterAction?: boolean;

  /** Log on success */
  logOnSuccess?: boolean;

  /** Log on failure */
  logOnFailure?: boolean;

  /** Log level before action */
  beforeActionLevel?: LogLevel;

  /** Log level after action */
  afterActionLevel?: LogLevel;

  /** Log level on success */
  successLevel?: LogLevel;

  /** Log level on failure */
  failureLevel?: LogLevel;

  /** Log event type for categorization */
  logType?: string;
}

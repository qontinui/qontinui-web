/**
 * Verification configuration - verify that an action had the expected result
 */

import { TargetConfig } from "./target-config";

export type VerificationMode =
  | "IMAGE_APPEARS"
  | "IMAGE_DISAPPEARS"
  | "TEXT_APPEARS"
  | "TEXT_DISAPPEARS"
  | "STATE_CHANGE"
  | "NONE";

export interface VerificationConfig {
  /** What to verify */
  mode: VerificationMode;

  /** Target to verify (image, text, etc.) */
  target?: TargetConfig;

  /** State to verify (for STATE_CHANGE mode) */
  stateId?: string;

  /** Maximum time to wait for verification (milliseconds) */
  timeout?: number;

  /** Continue even if verification fails */
  continueOnFailure?: boolean;

  /** Custom verification message */
  message?: string;
}

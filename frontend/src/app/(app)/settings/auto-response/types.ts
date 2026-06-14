/**
 * Auto-Response Rules — shared types.
 *
 * The canonical interfaces live in the api-client (mirroring the backend
 * contract); we re-export them here so feature components import from a
 * local, feature-scoped module.
 */
export type {
  AutoResponseRule,
  AutoResponseRuleCreate,
  AutoResponseRuleUpdate,
  BackoffConfig,
} from "@/lib/api-client";

import type { BackoffConfig } from "@/lib/api-client";

/** Sensible defaults for a brand-new rule's backoff schedule. */
export const DEFAULT_BACKOFF: BackoffConfig = {
  initial_delay_secs: 5,
  multiplier: 2,
  max_delay_secs: 300,
};

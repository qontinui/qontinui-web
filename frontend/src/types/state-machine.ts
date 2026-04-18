/**
 * Unified State Machine Types
 *
 * Re-exports from @qontinui/shared-types for state discovery types.
 * Some types are locally extended to ensure required fields (the shared
 * generated types mark certain fields as optional since they're optional
 * on the wire, but after conversion they're always populated).
 */

// =============================================================================
// Direct re-exports (types that match exactly)
// =============================================================================

export type { DiscoverySourceType } from "@qontinui/shared-types";
export type { DiscoveryBoundingBox } from "@qontinui/shared-types";
export type { DiscoveredStateImage } from "@qontinui/shared-types";
export type { StateDiscoveryResultListResponse } from "@qontinui/shared-types";

// =============================================================================
// Aliased re-exports (different names, same shapes)
// =============================================================================

/**
 * BoundingBox is an alias for DiscoveryBoundingBox (for backward compat).
 */
export type { DiscoveryBoundingBox as BoundingBox } from "@qontinui/shared-types";

/**
 * StateImage is an alias for DiscoveredStateImage (for backward compat).
 */
export type { DiscoveredStateImage as StateImage } from "@qontinui/shared-types";

// =============================================================================
// Extended types (local adds required-ness the shared type doesn't enforce)
// =============================================================================

import type { DiscoverySourceType } from "@qontinui/shared-types";
import type { DiscoveredStateImage } from "@qontinui/shared-types";

/**
 * TransitionTrigger: local alias for DiscoveryTransitionTrigger with required
 * `type` field and simpler type union.
 */
export interface TransitionTrigger {
  type: "click" | "type" | "scroll" | "hover" | "custom";
  imageId?: string;
  elementId?: string;
  selector?: string;
  value?: string;
}

/**
 * DiscoveredState with array fields guaranteed non-optional (populated by
 * converter functions with defaults).
 */
export interface DiscoveredState {
  id: string;
  name: string;
  imageIds: string[];
  renderIds: string[];
  elementIds: string[];
  confidence: number;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * StateTransition with fromStateId/toStateId guaranteed required and a
 * simpler trigger type.
 */
export interface StateTransition {
  id: string;
  fromStateId: string;
  toStateId: string;
  trigger?: TransitionTrigger;
  confidence: number;
  metadata?: Record<string, unknown>;
}

/**
 * StateDiscoveryResult with collection fields guaranteed required
 * (populated by converter functions with defaults).
 *
 * We define this explicitly rather than extending the shared type to avoid
 * inheriting the `[k: string]: unknown` index signature, which causes
 * property accesses to resolve as `unknown`.
 */
export interface StateDiscoveryResult {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  sourceType: DiscoverySourceType;
  sourceSessionId?: string | null;
  discoveryStrategy?: string | null;
  images: DiscoveredStateImage[];
  states: DiscoveredState[];
  transitions: StateTransition[];
  elementToRenders: Record<string, string[]>;
  imageCount: number;
  stateCount: number;
  transitionCount: number;
  renderCount: number;
  uniqueElementCount: number;
  confidence: number;
  discoveryMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Summary of a state discovery result (for lists).
 * Defined explicitly to avoid inheriting `[k: string]: unknown` index
 * signature from the shared type.
 */
export interface StateDiscoveryResultSummary {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  sourceType: DiscoverySourceType;
  discoveryStrategy?: string | null;
  imageCount: number;
  stateCount: number;
  transitionCount: number;
  confidence: number;
  createdAt: string;
}

// =============================================================================
// Converter functions — imported from shared types
// =============================================================================

import {
  toStateDiscoveryResult as sharedToStateDiscoveryResult,
  toDiscoveredState as sharedToDiscoveredState,
  toDiscoveredStateImage,
  toDiscoveredTransition as sharedToDiscoveredTransition,
  toStateDiscoveryResultSummary as sharedToStateDiscoveryResultSummary,
} from "@qontinui/shared-types";

/**
 * Convert API response (snake_case) to frontend types (camelCase).
 *
 * Delegates to shared converter and casts to the stricter local type
 * (which has required fields that the shared type marks optional).
 */
export function toStateDiscoveryResult(
  data: Record<string, unknown>
): StateDiscoveryResult {
  const raw = sharedToStateDiscoveryResult(data);
  return {
    ...raw,
    images: raw.images ?? [],
    states: (raw.states ?? []).map(toDiscoveredState),
    transitions: (raw.transitions ?? []).map(toStateTransition),
    elementToRenders: raw.elementToRenders ?? {},
    discoveryMetadata: raw.discoveryMetadata ?? {},
  } as StateDiscoveryResult;
}

export function toStateImage(data: unknown): DiscoveredStateImage {
  return toDiscoveredStateImage(data);
}

export function toDiscoveredState(data: unknown): DiscoveredState {
  const raw = sharedToDiscoveredState(data);
  return {
    ...raw,
    imageIds: raw.imageIds ?? [],
    renderIds: raw.renderIds ?? [],
    elementIds: raw.elementIds ?? [],
  };
}

export function toStateTransition(data: unknown): StateTransition {
  const raw = sharedToDiscoveredTransition(data);
  return {
    id: raw.id,
    fromStateId: raw.fromStateId,
    toStateId: raw.toStateId,
    trigger: raw.trigger
      ? {
          type: (raw.trigger.type ?? "click") as TransitionTrigger["type"],
          imageId: raw.trigger.imageId ?? undefined,
          elementId: raw.trigger.elementId ?? undefined,
          selector: raw.trigger.selector ?? undefined,
          value: raw.trigger.value ?? undefined,
        }
      : undefined,
    confidence: raw.confidence,
    metadata: raw.metadata ?? undefined,
  };
}

export function toStateDiscoveryResultSummary(
  data: Record<string, unknown>
): StateDiscoveryResultSummary {
  return sharedToStateDiscoveryResultSummary(data);
}

// =============================================================================
// Display Helpers — imported from shared types
// =============================================================================

export { SOURCE_TYPE_LABELS, SOURCE_TYPE_COLORS } from "@qontinui/shared-types";

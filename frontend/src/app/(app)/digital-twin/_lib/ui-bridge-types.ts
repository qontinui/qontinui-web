/**
 * Defensive shapes for the runner's Spec API + live snapshot, read through the
 * relay. Kept loose (optional fields, index signatures) because they originate
 * from the runner and the digital-twin tab only summarizes + shows raw.
 */

export interface SpecConfigLike {
  description?: string;
  groups?: unknown[];
  assertions?: unknown[];
  stateMachine?: { states?: unknown[] };
  metadata?: { url?: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface DiscoveredSpecLike {
  specId: string;
  config?: SpecConfigLike;
}

export interface SpecListResponse {
  ok?: boolean;
  specs?: DiscoveredSpecLike[];
  reason?: string;
}

export interface SpecGraphResponse {
  pages?: Array<{
    id?: string;
    states?: unknown[];
    transitions?: unknown[];
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface UiBridgeSnapshot {
  elements?: unknown[];
  states?: unknown[];
  transitions?: unknown[];
  activeStates?: unknown[];
  [k: string]: unknown;
}

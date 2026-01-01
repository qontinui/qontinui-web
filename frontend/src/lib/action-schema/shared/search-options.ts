/**
 * Search options - used by actions that search for targets on screen
 *
 * NOTE: These types are now sourced from @qontinui/schemas via target-config.ts.
 * This file re-exports them for backward compatibility with existing imports.
 */

// Re-export the SearchStrategy enum (as value, not just type)
export { SearchStrategy } from "./target-config";

// Re-export all search-related types from target-config (which gets them from @qontinui/schemas)
export type {
  SearchOptions,
  SearchStrategyValue,
  PollingConfig,
  PatternOptions,
  MatchAdjustment,
} from "./target-config";

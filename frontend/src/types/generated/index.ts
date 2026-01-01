/**
 * Generated Types Index
 *
 * Re-exports all auto-generated types from qontinui-schemas.
 * Import from this file for convenience.
 *
 * NOTE: Some types have the same names in execution.ts and testing.ts
 * (e.g., Pagination, ScreenshotType). Import these directly from
 * the specific module if you need the testing version.
 */

// Unified Execution API types (preferred for new code)
export * from "./execution";

// Legacy Testing API types - selective exports to avoid conflicts
// Import directly from "./testing" if you need conflicting types
export type {
  // Create types
  TestRunCreate,
  TransitionCreate,
  TransitionBatchCreate,
  DeficiencyCreate,
  DeficiencyBatchCreate,
  DeficiencyUpdate,
  CoverageUpdate,
  TestRunComplete,
  ScreenshotMetadata,
  // Response types
  TestRunResponse,
  TestRunDetail,
  TestRunListResponse,
  TransitionResponse,
  TransitionBatchResponse,
  DeficiencyResponse,
  DeficiencyDetail,
  DeficiencyListResponse,
  DeficiencyBatchResponse,
  CoverageUpdateResponse,
  TestRunCompleteResponse,
  ScreenshotUploadResponse,
  VisualComparisonSummary,
  // Analytics types
  CoverageTrendDataPoint,
  CoverageTrendResponse,
  TransitionReliabilityStats,
  ReliabilityResponse,
  // Historical types
  HistoricalResultRequest,
  HistoricalResultResponse,
  ActionDataCreate,
  ActionDataBatch,
  ActionDataBatchResponse,
  HistoricalFrameResponse,
  PlaybackRequest,
} from "./testing";

// Enums need regular export (they have runtime values)
export {
  TestRunStatus,
  TransitionStatus,
  DeficiencySeverity,
  DeficiencyStatus,
  DeficiencyType,
} from "./testing";

// Pagination is exported from execution.ts
// Use TestingPagination if you need the testing version:
export type { Pagination as TestingPagination } from "./testing";

// ScreenshotType is exported from execution.ts
// Use TestingScreenshotType if you need the testing version:
export { ScreenshotType as TestingScreenshotType } from "./testing";

# Frontend Migration Plan: Unified Execution API

## Overview

This document outlines the migration strategy for transitioning the frontend from the
fragmented testing/automation APIs to the unified execution API.

## Current State

The frontend currently uses multiple API endpoints with different schemas:

- `/api/v1/testing/*` - QA Testing endpoints (TestRun, Deficiency, Transition)
- `/api/v1/execution/*` - Unified execution endpoints (already partially integrated)
- `/api/integration-testing/*` - Mock mode testing (local route handlers)

## Target State

All execution-related data flows through the unified execution API:

- `/api/v1/execution/runs/*` - All run types (QA test, integration test, live automation)
- `/api/v1/execution/issues/*` - All issues (replacing deficiencies)
- `/api/v1/execution/analytics/*` - Trends and reliability stats

## Migration Strategy

### Phase 1: Preparation (COMPLETE)

- [x] Created `executionApi` client (`services/execution-service.ts`)
- [x] Created adapter layer (`lib/api/adapters/testing-to-execution.ts`)
- [x] Updated type definitions (`types/generated/index.ts`)
- [x] Documented component mapping (this file)

### Phase 2: Feature Flag Setup (TODO)

Add feature flag to enable gradual rollout:

```typescript
// lib/feature-flags.ts
export const FEATURE_FLAGS = {
  USE_UNIFIED_EXECUTION_API:
    process.env.NEXT_PUBLIC_USE_UNIFIED_EXECUTION_API === "true",
};
```

### Phase 3: Component Migration (TODO)

Migrate components in order of dependency (leaf nodes first).

---

## Component Migration Map

### QA Dashboard Components

| Component               | File                                             | Current API                            | Target API                                     | Complexity | Notes                                 |
| ----------------------- | ------------------------------------------------ | -------------------------------------- | ---------------------------------------------- | ---------- | ------------------------------------- |
| TestRunsList            | `components/testing/TestRunsList.tsx`            | `testingService.getTestRuns()`         | `executionApi.listRuns({run_type: 'qa_test'})` | Medium     | Uses useTesting hook                  |
| DeficiencyList          | `components/testing/DeficiencyList.tsx`          | `testingService.getDeficiencies()`     | `executionApi.listIssues()`                    | Medium     | Field mapping needed                  |
| CoverageTrendChart      | `components/testing/CoverageTrendChart.tsx`      | `testingService.getCoverageTrends()`   | `executionApi.getTrends()`                     | Low        | Response format similar               |
| ReliabilityStats        | `components/testing/ReliabilityStats.tsx`        | `testingService.getReliabilityStats()` | `executionApi.getReliability()`                | Low        | Response format similar               |
| TestRunDetails          | `components/testing/TestRunDetails.tsx`          | `testingService.getTestRun()`          | `executionApi.getRun()`                        | High       | Many nested fields                    |
| LiveTestExecution       | `components/testing/LiveTestExecution.tsx`       | WebSocket                              | WebSocket (same)                               | None       | No change needed                      |
| StateGraphVisualization | `components/testing/StateGraphVisualization.tsx` | `testingService.getStateGraph()`       | Keep as-is                                     | None       | State graph not part of execution API |
| CoverageSummaryCard     | `components/testing/CoverageSummaryCard.tsx`     | Multiple hooks                         | `executionApi.getTrends()`                     | Low        | Simplifies data fetching              |
| ComparisonSelector      | `components/testing/ComparisonSelector.tsx`      | `testingService.getTestRuns()`         | `executionApi.listRuns()`                      | Low        | Simple list query                     |
| TestRunComparison       | `components/testing/TestRunComparison.tsx`       | `testingService.compareTestRuns()`     | Client-side comparison                         | Medium     | May need new endpoint                 |

### Integration Testing Components

| Component              | File                             | Current API              | Target API                                              | Complexity | Notes                       |
| ---------------------- | -------------------------------- | ------------------------ | ------------------------------------------------------- | ---------- | --------------------------- |
| IntegrationTestResults | `app/(app)/integration-testing/` | Mock execution           | `executionApi.listRuns({run_type: 'integration_test'})` | High       | Complex data structure      |
| VisualPlayback         | Multiple                         | `executionApi.getTree()` | Same                                                    | None       | Already using execution API |

### Data Fetching Hooks

| Hook                | File                           | Current Service | Target Service   | Notes                 |
| ------------------- | ------------------------------ | --------------- | ---------------- | --------------------- |
| useTesting          | `hooks/useTesting.ts`          | testingService  | executionService | Main migration target |
| useTestingWebSocket | `hooks/useTestingWebSocket.ts` | WebSocket       | Same             | No change needed      |

---

## Detailed Migration Steps per Component

### 1. TestRunsList.tsx

**Current:**

```typescript
const { data } = useTestRuns(filters);
// data: { runs: TestRunResponse[], pagination }
```

**Target:**

```typescript
const { data } = useExecutionRuns({ ...filters, run_type: "qa_test" });
// data: { runs: ExecutionRunResponse[], pagination }
```

**Adapter usage during transition:**

```typescript
import { mapTestRunsToExecutionRuns } from "@/lib/api/adapters";

// In component, with feature flag:
const runs = FEATURE_FLAGS.USE_UNIFIED_EXECUTION_API
  ? data.runs
  : mapTestRunsToExecutionRuns(legacyData.runs);
```

### 2. DeficiencyList.tsx

**Current:**

```typescript
const { data } = useDeficiencies(filters);
// data: { deficiencies: DeficiencyResponse[], pagination, summary }
```

**Target:**

```typescript
const { data } = useExecutionIssues(filters);
// data: { issues: ExecutionIssueResponse[], pagination, summary }
```

**Field Mapping:**

- `deficiency_id` → `id`
- `deficiency_type` → `issue_type`
- `state` → `state_name`
- `transition_sequence_number` → `action_sequence_number`

### 3. TestRunDetails.tsx

**Current:**

```typescript
const { data: testRun } = useTestRun(runId);
// testRun: TestRunDetail with transitions, deficiencies, screenshots arrays
```

**Target:**

```typescript
const { data: run } = useExecutionRun(runId);
const { data: actions } = useExecutionActions(runId);
const { data: issues } = useExecutionRunIssues(runId);
// Separate queries for better caching and pagination
```

**Note:** This is the most complex migration due to nested data requirements.

---

## New Hooks to Create

### useExecutionRuns

```typescript
// hooks/useExecution.ts

export function useExecutionRuns(params: {
  project_id?: string;
  run_type?: RunType;
  status?: RunStatus;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["execution", "runs", params],
    queryFn: () => executionApi.listRuns(params),
    staleTime: 30_000,
  });
}
```

### useExecutionRun

```typescript
export function useExecutionRun(runId: string) {
  return useQuery({
    queryKey: ["execution", "runs", runId],
    queryFn: () => executionApi.getRun(runId),
    enabled: !!runId,
  });
}
```

### useExecutionIssues

```typescript
export function useExecutionIssues(params: {
  project_id?: string;
  run_id?: string;
  status?: IssueStatus;
  severity?: IssueSeverity;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["execution", "issues", params],
    queryFn: () => executionApi.listIssues(params),
    staleTime: 30_000,
  });
}
```

---

## Feature Flag Rollout Plan

1. **Development:** Enable flag locally for testing
2. **Staging:** Enable flag for QA testing
3. **Production Canary:** Enable for 10% of users
4. **Production Full:** Enable for all users
5. **Cleanup:** Remove feature flag and legacy code

---

## Backward Compatibility During Migration

During migration, components can use adapters to maintain compatibility:

```typescript
import { FEATURE_FLAGS } from '@/lib/feature-flags';
import { mapTestRunToExecutionRun } from '@/lib/api/adapters';
import { testingService } from '@/services/testing-service';
import { executionApi } from '@/services/execution-service';

async function fetchRuns(projectId: string) {
  if (FEATURE_FLAGS.USE_UNIFIED_EXECUTION_API) {
    return executionApi.listRuns({ project_id: projectId, run_type: 'qa_test' });
  } else {
    const { runs } = await testingService.getTestRuns({ project_id: projectId });
    return {
      runs: runs.map(mapTestRunToExecutionRun),
      pagination: { ... },
    };
  }
}
```

---

## Files to Update

### Services

- [x] `services/execution-service.ts` - Enhanced with all endpoints
- [ ] `services/testing-service.ts` - Mark as deprecated after migration

### Hooks

- [ ] `hooks/useTesting.ts` - Add feature flag or create parallel useExecution.ts
- [ ] `hooks/useExecution.ts` - Create new unified hooks

### Types

- [x] `types/generated/execution.ts` - Already comprehensive
- [x] `types/generated/index.ts` - Created re-export index

### API Clients

- [x] `lib/api/adapters/testing-to-execution.ts` - Created
- [x] `lib/api/adapters/index.ts` - Created

### Pages

- [ ] `app/(app)/qa-dashboard/*` - Update after hooks migration
- [ ] `app/(app)/integration-testing/*` - May need minimal changes

---

## DO NOT Implement Yet

Per task requirements, actual component migrations are deferred until:

1. Backend consolidation is complete
2. Feature flag infrastructure is in place
3. Testing hooks are ready

This document serves as the implementation guide when ready.

---

## Estimated Migration Order

1. Create `useExecution.ts` hooks (parallel to existing)
2. Add feature flag infrastructure
3. Migrate simple components (CoverageTrendChart, ReliabilityStats)
4. Migrate list components (TestRunsList, DeficiencyList)
5. Migrate detail components (TestRunDetails)
6. Remove legacy testing-service after validation
7. Remove adapters and feature flags

---

## Testing Strategy

For each migrated component:

1. Unit test: Verify data transformation
2. Integration test: Verify API calls
3. E2E test: Verify UI behavior unchanged
4. A/B test: Compare metrics between old/new implementations

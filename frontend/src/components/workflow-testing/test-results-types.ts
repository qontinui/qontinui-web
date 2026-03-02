import type {
  TestCase,
  TestResult,
  TestStatistics,
} from "@/services/workflow-testing-service";

export interface TestResultsProps {
  testCase: TestCase;
  results: TestResult[];
  onRunTest: () => void;
  onClearResults: () => void;
  className?: string;
}

export type SortField = "timestamp" | "duration" | "status";
export type SortOrder = "asc" | "desc";
export type FilterStatus = "all" | "passed" | "failed";

export interface PassRateGroup {
  label: string;
  passRate: number;
}

export type Trend = "improving" | "declining" | "stable";

export interface UseTestResultsReturn {
  sortField: SortField;
  sortOrder: SortOrder;
  filterStatus: FilterStatus;
  setFilterStatus: (status: FilterStatus) => void;
  selectedResult: TestResult | null;
  setSelectedResult: (result: TestResult | null) => void;
  isRunning: boolean;
  statistics: TestStatistics | null;
  trend: Trend;
  filteredAndSortedResults: TestResult[];
  passRateHistory: PassRateGroup[];
  handleRunTest: () => void;
  handleClearResults: () => void;
  handleExportResults: () => void;
  toggleSort: (field: SortField) => void;
}

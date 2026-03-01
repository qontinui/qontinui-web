"use client";

/**
 * Test Orchestrator
 *
 * AI-driven multi-step API test orchestration component for the web frontend.
 * Guides users through 4 phases:
 *   1. Selection  - Choose saved API requests to chain
 *   2. Planning   - AI creates execution plan with variable chaining
 *   3. Execution  - Run orchestrated test steps with live progress
 *   4. Generation - AI generates test code from execution results
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Sparkles,
  Check,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Trash2,
  FileCode,
  Search,
  Variable,
  Link2,
  Loader2,
  Copy,
  ArrowRight,
  Clock,
  X,
  Settings,
  Send,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { runnerFetch } from "@/lib/runner/api-client";
import { runnerApi } from "@/lib/runner/runner-api-object";
import type { SavedApiRequest } from "@/lib/runner/types/library";

// =============================================================================
// Types
// =============================================================================

type TestType = "python_script" | "playwright_cdp";

type OrchestratorPhase = "selection" | "planning" | "execution" | "generation";

interface VariableExtraction {
  variable_name: string;
  json_path: string;
  default_value?: string;
}

interface VariableMappingInfo {
  variable_name: string;
  source_step: number;
  json_path: string;
  used_in_steps: number[];
  description: string;
}

interface VerificationSuggestion {
  condition: string;
  description: string;
  json_path?: string;
  step_index: number;
}

interface OrchestrationStep {
  step_index: number;
  name: string;
  request_id: string;
  extractions: VariableExtraction[];
  depends_on: number[];
  purpose: string;
  url_template: string;
  body_template?: string;
}

interface OrchestrationPlan {
  id: string;
  request: {
    request_ids: string[];
    test_description: string;
    context?: string;
  };
  steps: OrchestrationStep[];
  variable_mappings: VariableMappingInfo[];
  verification_suggestions: VerificationSuggestion[];
  explanation: string;
  created_at: string;
}

interface ExecutedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

interface ExecutedResponse {
  status_code: number;
  headers: Record<string, string>;
  body: unknown;
  content_type?: string;
  size_bytes: number;
}

interface StepExecutionResult {
  step_index: number;
  step_name: string;
  request: ExecutedRequest;
  response: ExecutedResponse;
  extracted_variables: Record<string, unknown>;
  success: boolean;
  error?: string;
  duration_ms: number;
}

interface OrchestrationExecutionResult {
  plan_id: string;
  step_results: StepExecutionResult[];
  all_variables: Record<string, unknown>;
  success: boolean;
  failed_at_step?: number;
  total_duration_ms: number;
  started_at: string;
  completed_at: string;
}

interface TestStep {
  step_number: number;
  action: string;
  expected: string;
  step_type: "setup" | "request" | "assertion" | "cleanup";
}

interface GeneratedTest {
  name: string;
  description: string;
  code: string;
  test_type: string;
  explanation: string;
  steps: TestStep[];
}

// =============================================================================
// Props
// =============================================================================

interface TestOrchestratorProps {
  /** Callback when test code is generated and applied */
  onTestGenerated?: (code: string, testType: TestType) => void;
  /** Optional className for the root element */
  className?: string;
}

// =============================================================================
// Main Component
// =============================================================================

export function TestOrchestrator({
  onTestGenerated,
  className,
}: TestOrchestratorProps) {
  // Phase management
  const [phase, setPhase] = useState<OrchestratorPhase>("selection");

  // Selection phase state
  const [availableRequests, setAvailableRequests] = useState<SavedApiRequest[]>(
    []
  );
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingRequests, setLoadingRequests] = useState(false);

  // Planning phase state
  const [testDescription, setTestDescription] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [testType, setTestType] = useState<TestType>("python_script");
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null);
  const [planning, setPlanning] = useState(false);

  // Execution phase state
  const [executionResult, setExecutionResult] =
    useState<OrchestrationExecutionResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Generation phase state
  const [generatedTest, setGeneratedTest] = useState<GeneratedTest | null>(
    null
  );
  const [generating, setGenerating] = useState(false);

  // Shared state
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data Loading
  // ---------------------------------------------------------------------------

  const loadSavedRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const requests = await runnerApi.getSavedApiRequests();
      setAvailableRequests(requests);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load saved API requests"
      );
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    loadSavedRequests();
  }, [loadSavedRequests]);

  // ---------------------------------------------------------------------------
  // Filtered & Selected Requests
  // ---------------------------------------------------------------------------

  const filteredRequests = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return availableRequests;
    return availableRequests.filter(
      (req) =>
        req.name.toLowerCase().includes(q) ||
        req.url.toLowerCase().includes(q) ||
        (req.description ?? "").toLowerCase().includes(q)
    );
  }, [availableRequests, searchQuery]);

  // ---------------------------------------------------------------------------
  // Selection Actions
  // ---------------------------------------------------------------------------

  const toggleRequest = (id: string) => {
    setSelectedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedRequestIds(new Set(filteredRequests.map((r) => r.id)));
  };

  const clearSelection = () => {
    setSelectedRequestIds(new Set());
  };

  // ---------------------------------------------------------------------------
  // Phase: Planning - Create AI Plan
  // ---------------------------------------------------------------------------

  const createPlan = useCallback(async () => {
    if (selectedRequestIds.size === 0) {
      setError("Please select at least one API request");
      return;
    }
    if (!testDescription.trim()) {
      setError("Please describe what the test should verify");
      return;
    }

    setPlanning(true);
    setError(null);
    setPhase("planning");

    try {
      const response = await runnerFetch<OrchestrationPlan>(
        "/test-orchestration/plan",
        {
          method: "POST",
          body: JSON.stringify({
            request_ids: Array.from(selectedRequestIds),
            test_description: testDescription.trim(),
            context: additionalContext.trim() || undefined,
          }),
          timeoutMs: 120000,
        }
      );

      setPlan(response);
    } catch (err) {
      setError(
        `Failed to create plan: ${err instanceof Error ? err.message : String(err)}`
      );
      setPhase("selection");
    } finally {
      setPlanning(false);
    }
  }, [selectedRequestIds, testDescription, additionalContext]);

  // ---------------------------------------------------------------------------
  // Phase: Execution - Run the Plan
  // ---------------------------------------------------------------------------

  const executePlan = useCallback(async () => {
    if (!plan) return;

    setExecuting(true);
    setError(null);
    setPhase("execution");
    setCurrentStepIndex(0);

    try {
      const response = await runnerFetch<OrchestrationExecutionResult>(
        "/test-orchestration/execute",
        {
          method: "POST",
          body: JSON.stringify({ plan }),
          timeoutMs: 300000,
        }
      );

      setExecutionResult(response);

      if (!response.success) {
        const failedIdx = response.failed_at_step;
        const failedStep =
          failedIdx !== undefined
            ? response.step_results[failedIdx]
            : undefined;
        const statusCode = failedStep?.response?.status_code;
        const errorDetail =
          failedStep?.error || `HTTP ${statusCode || "unknown"}`;
        const isAuthError = statusCode === 401 || statusCode === 403;
        const authHint = isAuthError
          ? " Auth tokens may have expired. Try re-capturing the requests."
          : "";
        setError(
          `Step ${failedIdx !== undefined ? failedIdx + 1 : "?"} failed: ${errorDetail}${authHint}`
        );
      }
    } catch (err) {
      setError(
        `Execution failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setExecuting(false);
    }
  }, [plan]);

  // ---------------------------------------------------------------------------
  // Phase: Generation - Generate Test Code
  // ---------------------------------------------------------------------------

  const generateTestCode = useCallback(async () => {
    if (!plan || !executionResult) return;

    setGenerating(true);
    setError(null);
    setPhase("generation");

    try {
      const response = await runnerFetch<GeneratedTest>(
        "/test-orchestration/generate",
        {
          method: "POST",
          body: JSON.stringify({
            execution_result: executionResult,
            plan,
            test_type: testType,
          }),
          timeoutMs: 120000,
        }
      );

      setGeneratedTest(response);
    } catch (err) {
      setError(
        `Failed to generate test: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setGenerating(false);
    }
  }, [plan, executionResult, testType]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const applyTest = useCallback(() => {
    if (generatedTest && onTestGenerated) {
      onTestGenerated(generatedTest.code, testType);
    }
  }, [generatedTest, testType, onTestGenerated]);

  const copyCode = useCallback(() => {
    if (generatedTest?.code) {
      navigator.clipboard.writeText(generatedTest.code);
    }
  }, [generatedTest]);

  const reset = () => {
    setPhase("selection");
    setPlan(null);
    setExecutionResult(null);
    setGeneratedTest(null);
    setError(null);
    setCurrentStepIndex(0);
  };

  // Navigate to next phase (for completed phases)
  const canAdvance =
    (phase === "selection" &&
      selectedRequestIds.size > 0 &&
      testDescription.trim() !== "") ||
    (phase === "planning" && plan !== null && !planning) ||
    (phase === "execution" &&
      executionResult?.success === true &&
      !executing) ||
    (phase === "generation" && generatedTest !== null && !generating);

  const canGoBack =
    phase === "planning" || phase === "execution" || phase === "generation";

  const advancePhase = () => {
    if (phase === "selection") {
      createPlan();
    } else if (phase === "planning") {
      executePlan();
    } else if (phase === "execution") {
      generateTestCode();
    } else if (phase === "generation" && generatedTest) {
      applyTest();
    }
  };

  const goBack = () => {
    setError(null);
    if (phase === "planning") {
      setPhase("selection");
    } else if (phase === "execution") {
      setPhase("planning");
    } else if (phase === "generation") {
      setPhase("execution");
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className={cn(
        "flex flex-col h-full border border-border-subtle/50 rounded-lg bg-surface-raised/20 overflow-hidden",
        className
      )}
    >
      {/* Phase Indicator Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle/30 bg-surface-raised/40">
        <PhaseIndicator currentPhase={phase} />
        <div className="flex-1" />
        {phase !== "selection" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            className="gap-1.5 text-text-muted"
          >
            <Trash2 className="size-3.5" />
            Reset
          </Button>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20">
          <AlertCircle className="size-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-400 flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-400/50 hover:text-red-400"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {phase === "selection" && (
          <SelectionPhase
            requests={filteredRequests}
            selectedIds={selectedRequestIds}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onToggle={toggleRequest}
            onSelectAll={selectAll}
            onClear={clearSelection}
            loadingRequests={loadingRequests}
            totalAvailable={availableRequests.length}
            testDescription={testDescription}
            onDescriptionChange={setTestDescription}
            additionalContext={additionalContext}
            onContextChange={setAdditionalContext}
            testType={testType}
            onTestTypeChange={setTestType}
          />
        )}

        {phase === "planning" && (
          <PlanningPhase
            plan={plan}
            planning={planning}
            selectedCount={selectedRequestIds.size}
          />
        )}

        {phase === "execution" && (
          <ExecutionPhase
            plan={plan}
            executionResult={executionResult}
            executing={executing}
            currentStepIndex={currentStepIndex}
          />
        )}

        {phase === "generation" && (
          <GenerationPhase
            generatedTest={generatedTest}
            generating={generating}
            testType={testType}
            onCopyCode={copyCode}
          />
        )}
      </div>

      {/* Footer with Navigation */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle/30 bg-surface-raised/40">
        {canGoBack && (
          <Button
            variant="outline"
            size="sm"
            onClick={goBack}
            className="gap-1.5"
          >
            <ChevronLeft className="size-3.5" />
            Back
          </Button>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={advancePhase}
          disabled={!canAdvance || planning || executing || generating}
          className={cn(
            "gap-1.5",
            phase === "generation"
              ? "bg-purple-600 hover:bg-purple-700 text-white"
              : ""
          )}
        >
          {(planning || executing || generating) && (
            <Loader2 className="size-3.5 animate-spin" />
          )}
          {!planning && !executing && !generating && (
            <>
              {phase === "selection" && (
                <>
                  <Sparkles className="size-3.5" />
                  Create Plan
                </>
              )}
              {phase === "planning" && (
                <>
                  <Play className="size-3.5" />
                  Execute Plan
                </>
              )}
              {phase === "execution" && (
                <>
                  <FileCode className="size-3.5" />
                  Generate Test
                </>
              )}
              {phase === "generation" && (
                <>
                  <Check className="size-3.5" />
                  Apply to Test
                </>
              )}
            </>
          )}
          {planning && "Creating Plan..."}
          {executing && "Executing..."}
          {generating && "Generating..."}
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Phase Indicator
// =============================================================================

const PHASES: { key: OrchestratorPhase; label: string; number: number }[] = [
  { key: "selection", label: "Select", number: 1 },
  { key: "planning", label: "Plan", number: 2 },
  { key: "execution", label: "Execute", number: 3 },
  { key: "generation", label: "Generate", number: 4 },
];

function PhaseIndicator({ currentPhase }: { currentPhase: OrchestratorPhase }) {
  const currentIndex = PHASES.findIndex((p) => p.key === currentPhase);

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, idx) => {
        const isComplete = idx < currentIndex;
        const isCurrent = idx === currentIndex;

        return (
          <div key={p.key} className="flex items-center">
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                isComplete &&
                  "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
                isCurrent &&
                  "bg-purple-500/10 text-purple-400 border border-purple-500/30",
                !isComplete &&
                  !isCurrent &&
                  "bg-surface-raised/50 text-text-muted border border-border-subtle/30"
              )}
            >
              {isComplete ? (
                <Check className="size-3" />
              ) : (
                <span className="size-4 flex items-center justify-center rounded-full bg-current/10 text-[10px]">
                  {p.number}
                </span>
              )}
              {p.label}
            </div>
            {idx < PHASES.length - 1 && (
              <ChevronRight className="size-3.5 text-text-muted/40 mx-0.5" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Phase 1: Selection
// =============================================================================

interface SelectionPhaseProps {
  requests: SavedApiRequest[];
  selectedIds: Set<string>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  loadingRequests: boolean;
  totalAvailable: number;
  testDescription: string;
  onDescriptionChange: (d: string) => void;
  additionalContext: string;
  onContextChange: (c: string) => void;
  testType: TestType;
  onTestTypeChange: (t: TestType) => void;
}

function SelectionPhase({
  requests,
  selectedIds,
  searchQuery,
  onSearchChange,
  onToggle,
  onSelectAll,
  onClear,
  loadingRequests,
  totalAvailable,
  testDescription,
  onDescriptionChange,
  additionalContext,
  onContextChange,
  testType,
  onTestTypeChange,
}: SelectionPhaseProps) {
  return (
    <div className="p-4 space-y-5">
      {/* Step 1: Select API Requests */}
      <div className="space-y-3">
        <StepHeader
          number={1}
          title="Select API Requests"
          subtitle={`${selectedIds.size} of ${totalAvailable} selected`}
        />

        {/* Search bar + actions */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search requests..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-surface-canvas/50 border border-border-subtle/50 rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20"
            />
          </div>
          <Button variant="outline" size="sm" onClick={onSelectAll}>
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>

        {/* Request list */}
        <div className="max-h-56 overflow-auto border border-border-subtle/50 rounded-md bg-surface-canvas/30">
          {loadingRequests ? (
            <div className="flex items-center justify-center p-8 text-text-muted">
              <Loader2 className="size-5 animate-spin mr-2" />
              Loading saved requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="p-6 text-center text-sm text-text-muted">
              {totalAvailable === 0
                ? "No saved API requests found. Create some in the API Request Library first."
                : "No requests match your search."}
            </div>
          ) : (
            requests.map((req) => (
              <div
                key={req.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 border-b border-border-subtle/20 last:border-b-0 cursor-pointer",
                  "hover:bg-surface-raised/40 transition-colors",
                  selectedIds.has(req.id) && "bg-purple-500/5"
                )}
                onClick={() => onToggle(req.id)}
              >
                <Checkbox
                  checked={selectedIds.has(req.id)}
                  onCheckedChange={() => onToggle(req.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <HttpMethodBadge method={req.method} />
                    <span className="text-sm text-text-primary truncate">
                      {req.name}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted truncate mt-0.5">
                    {req.url}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Step 2: Describe Test */}
      <div className="space-y-3">
        <StepHeader
          number={2}
          title="Describe Your Test"
          subtitle="What should the test verify?"
        />
        <Textarea
          value={testDescription}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="e.g., Verify that creating a user returns a valid ID, then fetching that user returns the correct data"
          className="min-h-[80px] text-sm bg-surface-canvas/50 resize-none"
        />
      </div>

      {/* Step 3: Additional Context */}
      <div className="space-y-3">
        <StepHeader
          number={3}
          title="Additional Context"
          subtitle="Optional"
          optional
        />
        <Textarea
          value={additionalContext}
          onChange={(e) => onContextChange(e.target.value)}
          placeholder="Any additional constraints or context for the AI..."
          className="min-h-[60px] text-sm bg-surface-canvas/50 resize-none"
        />
      </div>

      {/* Test type */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-secondary">Test Type:</span>
        <Select
          value={testType}
          onValueChange={(v) => onTestTypeChange(v as TestType)}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="python_script">Python Script</SelectItem>
            <SelectItem value="playwright_cdp">Playwright CDP</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// =============================================================================
// Phase 2: Planning
// =============================================================================

interface PlanningPhaseProps {
  plan: OrchestrationPlan | null;
  planning: boolean;
  selectedCount: number;
}

function PlanningPhase({ plan, planning, selectedCount }: PlanningPhaseProps) {
  if (planning) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <Loader2 className="size-10 text-purple-400 animate-spin mb-4" />
        <p className="text-sm text-text-primary font-medium">
          AI is creating your execution plan...
        </p>
        <p className="text-xs text-text-muted mt-2">
          Analyzing {selectedCount} requests and planning variable chaining
        </p>
      </div>
    );
  }

  if (!plan) return null;

  return (
    <div className="p-4 space-y-4">
      {/* Plan Explanation */}
      <div className="p-3 rounded-md bg-purple-500/5 border border-purple-500/20">
        <p className="text-sm text-text-secondary">{plan.explanation}</p>
      </div>

      {/* Plan Visualization */}
      <PlanVisualization plan={plan} currentStepIndex={-1} />

      {/* Verification Suggestions */}
      {plan.verification_suggestions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Suggested Verifications
          </h4>
          {plan.verification_suggestions.map((suggestion, idx) => (
            <div
              key={idx}
              className="p-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-md"
            >
              <div className="text-sm text-emerald-400">
                {suggestion.description}
              </div>
              <code className="text-xs text-emerald-500/70 font-mono mt-1 block">
                {suggestion.condition}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Phase 3: Execution
// =============================================================================

interface ExecutionPhaseProps {
  plan: OrchestrationPlan | null;
  executionResult: OrchestrationExecutionResult | null;
  executing: boolean;
  currentStepIndex: number;
}

function ExecutionPhase({
  plan,
  executionResult,
  executing,
  currentStepIndex,
}: ExecutionPhaseProps) {
  if (executing && plan) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-primary">
            Executing Plan
          </h3>
          <span className="text-xs text-text-muted">
            Step {currentStepIndex + 1} of {plan.steps.length}
          </span>
        </div>

        <Progress
          value={((currentStepIndex + 1) / plan.steps.length) * 100}
          variant="brand-primary"
          className="h-2"
        />

        <PlanVisualization
          plan={plan}
          currentStepIndex={currentStepIndex}
          isExecuting
        />

        <div className="flex items-center justify-center p-4 gap-2">
          <Loader2 className="size-5 text-blue-400 animate-spin" />
          <span className="text-sm text-text-secondary">
            Running {plan.steps[currentStepIndex]?.name || "..."}
          </span>
        </div>
      </div>
    );
  }

  if (!executionResult) return null;

  return (
    <div className="p-4 space-y-4">
      <ExecutionLog result={executionResult} />
    </div>
  );
}

// =============================================================================
// Phase 4: Generation
// =============================================================================

interface GenerationPhaseProps {
  generatedTest: GeneratedTest | null;
  generating: boolean;
  testType: TestType;
  onCopyCode: () => void;
}

function GenerationPhase({
  generatedTest,
  generating,
  testType,
  onCopyCode,
}: GenerationPhaseProps) {
  const [showCode, setShowCode] = useState(true);

  if (generating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <Loader2 className="size-10 text-purple-400 animate-spin mb-4" />
        <p className="text-sm text-text-primary font-medium">
          AI is generating test code...
        </p>
        <p className="text-xs text-text-muted mt-2">
          Creating {testType.replace("_", " ")} from execution results
        </p>
      </div>
    );
  }

  if (!generatedTest) return null;

  return (
    <div className="p-4 space-y-4">
      {/* Success header */}
      <div className="flex items-center gap-2">
        <div className="size-6 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <Check className="size-3.5 text-emerald-400" />
        </div>
        <span className="text-sm font-medium text-emerald-400">
          Test Generated Successfully
        </span>
      </div>

      {/* Test info */}
      <div className="p-3 rounded-md bg-surface-canvas/50 border border-border-subtle/50">
        <div className="text-sm font-medium text-text-primary">
          {generatedTest.name}
        </div>
        <div className="text-xs text-text-muted mt-1">
          {generatedTest.description}
        </div>
      </div>

      {/* AI Explanation */}
      <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-md">
        <div className="text-xs font-medium text-purple-400 uppercase tracking-wider mb-1">
          AI Explanation
        </div>
        <p className="text-sm text-text-secondary">
          {generatedTest.explanation}
        </p>
      </div>

      {/* Test Steps Preview */}
      {generatedTest.steps.length > 0 && (
        <TestStepsPreview steps={generatedTest.steps} />
      )}

      {/* Code preview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            className="flex items-center gap-1.5 text-xs font-medium text-text-muted uppercase tracking-wider hover:text-text-secondary"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                !showCode && "-rotate-90"
              )}
            />
            Generated Code
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopyCode}
            className="gap-1.5 h-6 text-xs text-text-muted"
          >
            <Copy className="size-3" />
            Copy
          </Button>
        </div>
        {showCode && (
          <pre className="p-3 bg-surface-canvas/80 rounded-md border border-border-subtle/50 text-xs text-text-secondary font-mono overflow-auto max-h-72 whitespace-pre-wrap">
            {generatedTest.code}
          </pre>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Sub-Components
// =============================================================================

function StepHeader({
  number,
  title,
  subtitle,
  optional,
}: {
  number: number;
  title: string;
  subtitle?: string;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-6 rounded-full bg-purple-600 text-white text-xs font-medium flex items-center justify-center shrink-0">
        {number}
      </span>
      <span className="text-sm font-medium text-text-primary">{title}</span>
      {subtitle && (
        <span className="text-xs text-text-muted">
          {optional ? `(${subtitle})` : subtitle}
        </span>
      )}
    </div>
  );
}

function HttpMethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase();
  const colors: Record<string, string> = {
    GET: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    POST: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    PUT: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    PATCH: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    DELETE: "bg-red-500/10 text-red-400 border-red-500/30",
  };
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-mono px-1.5 py-0",
        colors[m] || "text-text-muted"
      )}
    >
      {m}
    </Badge>
  );
}

function StatusCodeBadge({ code }: { code: number }) {
  let colorClass = "text-text-muted border-border-subtle/50";
  if (code >= 200 && code < 300) {
    colorClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  } else if (code >= 400 && code < 500) {
    colorClass = "bg-amber-500/10 text-amber-400 border-amber-500/30";
  } else if (code >= 500) {
    colorClass = "bg-red-500/10 text-red-400 border-red-500/30";
  }
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-mono px-1.5 py-0", colorClass)}
    >
      {code}
    </Badge>
  );
}

// =============================================================================
// Plan Visualization
// =============================================================================

interface PlanVisualizationProps {
  plan: OrchestrationPlan;
  currentStepIndex: number;
  isExecuting?: boolean;
}

function PlanVisualization({
  plan,
  currentStepIndex = -1,
  isExecuting = false,
}: PlanVisualizationProps) {
  const variablesByStep = useMemo(() => {
    const map = new Map<number, VariableMappingInfo[]>();
    for (const mapping of plan.variable_mappings) {
      const existing = map.get(mapping.source_step) || [];
      existing.push(mapping);
      map.set(mapping.source_step, existing);
    }
    return map;
  }, [plan]);

  return (
    <div className="space-y-2">
      {plan.steps.map((step, idx) => {
        const isComplete = idx < currentStepIndex;
        const isCurrent = idx === currentStepIndex && isExecuting;
        const variables = variablesByStep.get(idx) || [];

        return (
          <div key={step.step_index} className="relative">
            {/* Connection line */}
            {idx < plan.steps.length - 1 && (
              <div className="absolute left-5 top-full w-0.5 h-2 bg-border-subtle/30" />
            )}

            {/* Step card */}
            <div
              className={cn(
                "flex items-start gap-3 p-3 rounded-md border transition-all",
                isComplete && "bg-emerald-500/5 border-emerald-500/20",
                isCurrent &&
                  "bg-blue-500/5 border-blue-500/30 shadow-sm shadow-blue-500/5",
                !isComplete &&
                  !isCurrent &&
                  "bg-surface-canvas/30 border-border-subtle/40"
              )}
            >
              {/* Step indicator circle */}
              <div
                className={cn(
                  "size-8 rounded-full flex items-center justify-center shrink-0",
                  isComplete && "bg-emerald-500/20",
                  isCurrent && "bg-blue-500/20 animate-pulse",
                  !isComplete && !isCurrent && "bg-surface-raised/50"
                )}
              >
                {isComplete ? (
                  <Check className="size-4 text-emerald-400" />
                ) : isCurrent ? (
                  <Play className="size-4 text-blue-400" />
                ) : (
                  <span className="text-xs font-medium text-text-muted">
                    {idx + 1}
                  </span>
                )}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {step.name}
                  </span>
                  {step.depends_on.length > 0 && (
                    <span className="text-[10px] text-text-muted">
                      (needs step {step.depends_on.map((d) => d + 1).join(", ")}
                      )
                    </span>
                  )}
                </div>

                <p className="text-xs text-text-muted mt-0.5">{step.purpose}</p>

                {/* URL template */}
                <div className="mt-2 flex items-center gap-2">
                  <code className="text-xs text-text-muted/80 truncate flex-1 font-mono">
                    <HighlightVariables text={step.url_template} />
                  </code>
                </div>

                {/* Extractions */}
                {step.extractions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {step.extractions.map((ext, extIdx) => (
                      <div
                        key={extIdx}
                        className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded text-[10px]"
                      >
                        <Variable className="size-2.5 text-purple-400" />
                        <span className="text-purple-300">
                          {ext.variable_name}
                        </span>
                        <span className="text-purple-500/60">&larr;</span>
                        <span className="text-purple-400/70 font-mono">
                          {ext.json_path}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Variable flow */}
                {variables.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-text-muted">
                    <Link2 className="size-2.5" />
                    <span>
                      Passes{" "}
                      <span className="text-purple-400">
                        {variables.map((v) => v.variable_name).join(", ")}
                      </span>{" "}
                      to step(s){" "}
                      {variables
                        .flatMap((v) => v.used_in_steps)
                        .map((s) => s + 1)
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .join(", ")}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Variable flow arrow between steps */}
            {variables.length > 0 && idx < plan.steps.length - 1 && (
              <div className="flex items-center justify-center py-0.5">
                <div className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/5 rounded text-[10px] text-purple-400">
                  <Variable className="size-2.5" />
                  {variables.map((v) => v.variable_name).join(", ")}
                  <ArrowRight className="size-2.5" />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HighlightVariables({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, idx) => {
        if (part.match(/^\{\{[^}]+\}\}$/)) {
          return (
            <span key={idx} className="text-purple-400 font-semibold">
              {part}
            </span>
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </>
  );
}

// =============================================================================
// Execution Log
// =============================================================================

interface ExecutionLogProps {
  result: OrchestrationExecutionResult;
}

function ExecutionLog({ result }: ExecutionLogProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(
    new Set(result.failed_at_step !== undefined ? [result.failed_at_step] : [])
  );

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div
        className={cn(
          "flex items-center justify-between p-3 rounded-md border",
          result.success
            ? "bg-emerald-500/5 border-emerald-500/20"
            : "bg-red-500/5 border-red-500/20"
        )}
      >
        <div className="flex items-center gap-2">
          {result.success ? (
            <Check className="size-4 text-emerald-400" />
          ) : (
            <X className="size-4 text-red-400" />
          )}
          <span
            className={cn(
              "text-sm font-medium",
              result.success ? "text-emerald-400" : "text-red-400"
            )}
          >
            {result.success ? "Execution Successful" : "Execution Failed"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {result.total_duration_ms}ms
          </span>
          <span>
            {result.step_results.filter((s) => s.success).length}/
            {result.step_results.length} passed
          </span>
        </div>
      </div>

      {/* Expand/Collapse */}
      <div className="flex items-center gap-2 text-xs">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-text-muted"
          onClick={() =>
            setExpandedSteps(new Set(result.step_results.map((_, i) => i)))
          }
        >
          Expand All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-text-muted"
          onClick={() => setExpandedSteps(new Set())}
        >
          Collapse All
        </Button>
      </div>

      {/* All variables */}
      {Object.keys(result.all_variables).length > 0 && (
        <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-md">
          <div className="flex items-center gap-2 text-xs font-medium text-purple-400 uppercase tracking-wider mb-2">
            <Variable className="size-3.5" />
            All Extracted Variables
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(result.all_variables).map(([name, value]) => (
              <div
                key={name}
                className="px-2 py-1 bg-surface-canvas/50 rounded text-xs font-mono"
              >
                <span className="text-purple-400">{name}</span>
                <span className="text-text-muted"> = </span>
                <span className="text-text-secondary">
                  {formatValue(value, 50)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step results */}
      <div className="space-y-1.5">
        {result.step_results.map((step, idx) => (
          <StepResultCard
            key={idx}
            step={step}
            isExpanded={expandedSteps.has(idx)}
            onToggle={() => toggleStep(idx)}
          />
        ))}
      </div>
    </div>
  );
}

function StepResultCard({
  step,
  isExpanded,
  onToggle,
}: {
  step: StepExecutionResult;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "border rounded-md overflow-hidden",
        step.success ? "border-border-subtle/40" : "border-red-500/20"
      )}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 text-left",
          "hover:bg-surface-raised/30 transition-colors",
          step.success ? "bg-surface-canvas/30" : "bg-red-500/5"
        )}
      >
        {isExpanded ? (
          <ChevronDown className="size-3.5 text-text-muted" />
        ) : (
          <ChevronRight className="size-3.5 text-text-muted" />
        )}

        <div
          className={cn(
            "size-5 rounded-full flex items-center justify-center",
            step.success ? "bg-emerald-500/20" : "bg-red-500/20"
          )}
        >
          {step.success ? (
            <Check className="size-3 text-emerald-400" />
          ) : (
            <X className="size-3 text-red-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-primary font-medium truncate">
              {step.step_name}
            </span>
            <StatusCodeBadge code={step.response.status_code} />
            <span className="text-[10px] text-text-muted">
              {step.duration_ms}ms
            </span>
          </div>
          <div className="text-xs text-text-muted truncate">
            {step.request.method} {step.request.url}
          </div>
        </div>

        {Object.keys(step.extracted_variables).length > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20"
          >
            <Variable className="size-2.5" />
            {Object.keys(step.extracted_variables).length} var
          </Badge>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border-subtle/30 px-3 py-3 space-y-3 bg-surface-canvas/20">
          {/* Error */}
          {step.error && (
            <div className="p-2 bg-red-500/5 border border-red-500/20 rounded text-xs text-red-400">
              {step.error}
            </div>
          )}

          {/* Request */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
              Request
            </div>
            <div className="p-2 bg-surface-canvas/50 rounded">
              <div className="flex items-center gap-2 text-xs">
                <HttpMethodBadge method={step.request.method} />
                <code className="text-text-secondary break-all text-xs">
                  {step.request.url}
                </code>
              </div>
              {step.request.body && (
                <div className="mt-2">
                  <div className="text-[10px] text-text-muted mb-1">Body:</div>
                  <pre className="text-xs text-text-muted font-mono overflow-auto max-h-24 whitespace-pre-wrap">
                    {formatJson(step.request.body)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* Response */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] font-medium text-text-muted uppercase tracking-wider">
              Response
              <span className="text-text-muted/60">
                ({step.response.size_bytes} bytes)
              </span>
            </div>
            <pre className="p-2 bg-surface-canvas/50 rounded text-xs text-text-muted font-mono overflow-auto max-h-40 whitespace-pre-wrap">
              {formatJson(step.response.body)}
            </pre>
          </div>

          {/* Extracted variables */}
          {Object.keys(step.extracted_variables).length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-purple-400 uppercase tracking-wider">
                <Variable className="size-3" />
                Extracted Variables
              </div>
              <div className="space-y-1">
                {Object.entries(step.extracted_variables).map(
                  ([name, value]) => (
                    <div
                      key={name}
                      className="flex items-start gap-2 p-2 bg-purple-500/5 rounded text-xs font-mono"
                    >
                      <span className="text-purple-400 shrink-0">{name}</span>
                      <span className="text-text-muted">=</span>
                      <span className="text-text-secondary break-all">
                        {formatValue(value, 200)}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Test Steps Preview
// =============================================================================

interface TestStepsPreviewProps {
  steps: TestStep[];
}

function TestStepsPreview({ steps }: TestStepsPreviewProps) {
  if (!steps || steps.length === 0) return null;

  const stepTypeConfig: Record<
    string,
    { bg: string; iconColor: string; badgeColor: string; Icon: typeof Settings }
  > = {
    setup: {
      bg: "bg-surface-canvas/30",
      iconColor: "text-text-muted",
      badgeColor: "bg-surface-raised/50 text-text-muted",
      Icon: Settings,
    },
    request: {
      bg: "bg-blue-500/5",
      iconColor: "text-blue-400",
      badgeColor: "bg-blue-500/10 text-blue-400",
      Icon: Send,
    },
    assertion: {
      bg: "bg-emerald-500/5",
      iconColor: "text-emerald-400",
      badgeColor: "bg-emerald-500/10 text-emerald-400",
      Icon: CheckCircle,
    },
    cleanup: {
      bg: "bg-orange-500/5",
      iconColor: "text-orange-400",
      badgeColor: "bg-orange-500/10 text-orange-400",
      Icon: Trash2,
    },
  };

  const defaultConfig = stepTypeConfig["setup"]!;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider flex items-center gap-1.5">
        <ChevronRight className="size-3.5" />
        Test Steps Preview
      </h4>

      <div className="border border-border-subtle/40 rounded-md overflow-hidden">
        {steps.map((step, idx) => {
          const config = stepTypeConfig[step.step_type] ?? defaultConfig;
          const StepIcon = config.Icon;

          return (
            <div
              key={idx}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5",
                idx > 0 && "border-t border-border-subtle/20",
                config.bg
              )}
            >
              <div className="flex items-center gap-2 shrink-0">
                <span className="size-5 rounded-full bg-surface-raised/50 text-text-muted text-[10px] font-medium flex items-center justify-center">
                  {step.step_number}
                </span>
                <StepIcon className={cn("size-3.5", config.iconColor)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 text-[10px] rounded",
                      config.badgeColor
                    )}
                  >
                    {step.step_type}
                  </span>
                  <span className="text-sm text-text-secondary">
                    {step.action}
                  </span>
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  Expected: {step.expected}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary counts */}
      <div className="flex items-center gap-3 text-[10px] text-text-muted px-1">
        {(["setup", "request", "assertion", "cleanup"] as const).map((type) => {
          const count = steps.filter((s) => s.step_type === type).length;
          if (count === 0) return null;
          return (
            <span key={type}>
              {count} {type}
              {count !== 1 && type !== "cleanup" ? "s" : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Utility Functions
// =============================================================================

function formatValue(value: unknown, maxLength: number): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  let str: string;
  if (typeof value === "string") {
    str = `"${value}"`;
  } else if (typeof value === "object") {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }

  if (str.length > maxLength) {
    return str.slice(0, maxLength) + "...";
  }
  return str;
}

function formatJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

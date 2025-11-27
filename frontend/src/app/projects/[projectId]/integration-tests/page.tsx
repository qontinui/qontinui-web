'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Play, StopCircle, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAutomation } from '@/contexts/automation-context';
import { WorkflowSelector } from '@/components/integration-tests/WorkflowSelector';
import { TestExecutionPanel } from '@/components/integration-tests/TestExecutionPanel';
import { TestResultsPanel } from '@/components/integration-tests/TestResultsPanel';
import { TestResultsDetailPanel } from '@/components/integration-tests/TestResultsDetailPanel';
import { IntegrationTestPlayback } from '@/components/integration-tests/IntegrationTestPlayback';
import { ApiConfig } from '@/services/api-config';
import type {
  WorkflowTestExecution,
  WorkflowTestResult,
  StepResult,
} from '@/types/integration-tests';

/**
 * Integration Tests Page
 *
 * This page allows users to run integration tests on automation workflows.
 * Integration testing is simply running workflows with MockMode.MOCK enabled,
 * which uses the qontinui library's existing mock system with historical data.
 *
 * Key concept: Integration testing = Normal workflow execution with mode: "full_mock"
 * - Uses the same /workflow/execute endpoint
 * - qontinui library's ExecutionMode is set to MockMode.MOCK
 * - Historical data from ActionHistories provides realistic mock responses
 * - Each test run is different due to random selection from historical data
 */
export default function IntegrationTestsPage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const { workflows, states, categories } = useAutomation();

  // State
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentExecution, setCurrentExecution] = useState<WorkflowTestExecution | null>(null);
  const [testResults, setTestResults] = useState<WorkflowTestResult[]>([]);
  const [completedWorkflows, setCompletedWorkflows] = useState(0);
  const [activeSessionIds, setActiveSessionIds] = useState<Map<string, string>>(new Map());
  // Playback state
  const [playbackOpen, setPlaybackOpen] = useState(false);
  const [playbackHistoricalIds, setPlaybackHistoricalIds] = useState<number[]>([]);
  const [playbackWorkflowName, setPlaybackWorkflowName] = useState('');
  // Track historical result IDs per workflow
  const [workflowHistoricalIds, setWorkflowHistoricalIds] = useState<Map<string, number[]>>(new Map());
  // Detail view state
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);

  // Refs for polling
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Poll for workflow status
  const pollWorkflowStatus = useCallback(async () => {
    if (activeSessionIds.size === 0) return;

    const updatedResults: WorkflowTestResult[] = [];
    let completed = 0;
    let hasRunning = false;

    for (const [workflowId, sessionId] of activeSessionIds.entries()) {
      try {
        const response = await fetch(
          `${ApiConfig.QONTINUI_API_URL}/workflow/status/${sessionId}`
        );

        if (!response.ok) {
          continue;
        }

        const status = await response.json();
        const workflow = workflows.find((w) => w.id === workflowId);

        const result: WorkflowTestResult = {
          workflowId,
          workflowName: workflow?.name || workflowId,
          status: status.success_rate === 100 ? 'passed' : status.success_rate > 0 ? 'running' : 'failed',
          successRate: status.success_rate,
          totalActions: status.total_actions,
          executedActions: status.successful_actions,
        };

        updatedResults.push(result);

        if (result.status === 'passed' || result.status === 'failed') {
          completed++;
          // Complete the workflow to clean up
          await fetch(
            `${ApiConfig.QONTINUI_API_URL}/workflow/complete/${sessionId}`,
            { method: 'POST' }
          );
        } else {
          hasRunning = true;
        }
      } catch (error) {
        console.error(`Failed to poll status for workflow ${workflowId}:`, error);
      }
    }

    setTestResults(updatedResults);
    setCompletedWorkflows(completed);

    // Stop polling if all workflows are done
    if (!hasRunning && completed === activeSessionIds.size) {
      setIsRunning(false);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setCurrentExecution(null);
    }
  }, [activeSessionIds, workflows]);

  // Start polling when tests are running
  useEffect(() => {
    if (isRunning && activeSessionIds.size > 0) {
      // Poll immediately
      pollWorkflowStatus();

      // Then poll every 1 second
      pollIntervalRef.current = setInterval(pollWorkflowStatus, 1000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
    }
  }, [isRunning, activeSessionIds, pollWorkflowStatus]);

  /**
   * Run integration tests using the existing workflow execution endpoints
   * with mode: "full_mock" to enable qontinui library's mock system.
   */
  const handleRunTests = async () => {
    if (selectedWorkflowIds.length === 0) return;

    setIsRunning(true);
    setTestResults([]);
    setCompletedWorkflows(0);
    setActiveSessionIds(new Map());
    setWorkflowHistoricalIds(new Map());

    const newSessionIds = new Map<string, string>();
    const newHistoricalIds = new Map<string, number[]>();

    // Execute each selected workflow in mock mode
    for (const workflowId of selectedWorkflowIds) {
      const workflow = workflows.find((w) => w.id === workflowId);
      if (!workflow) continue;

      // Update current execution display
      setCurrentExecution({
        workflowId,
        workflowName: workflow.name,
        status: 'running',
        currentAction: 0,
        totalActions: workflow.actions?.length || 0,
      });

      const workflowHistoricalResultIds: number[] = [];
      const stepResults: StepResult[] = [];
      const startTime = Date.now();

      try {
        // Execute workflow with mode: "full_mock" to use qontinui library's mock system
        // This sets ExecutionMode to MockMode.MOCK which routes all actions through mock implementations
        const response = await fetch(`${ApiConfig.QONTINUI_API_URL}/workflow/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflow: workflow,
            screenshots: [], // Screenshots from historical data, or empty for pure mock
            states: states,
            categories: categories,
            mode: 'full_mock', // This is the key - enables MockMode.MOCK in qontinui library
            similarity: 0.8,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }

        const result = await response.json();
        newSessionIds.set(workflowId, result.session_id);

        let successfulSteps = 0;
        const totalSteps = workflow.actions?.length || 0;

        // Execute each action step and collect historical result IDs
        for (let i = 0; i < (workflow.actions || []).length; i++) {
          const action = workflow.actions![i];
          const stepStartTime = Date.now();

          setCurrentExecution({
            workflowId,
            workflowName: workflow.name,
            status: 'running',
            currentAction: i + 1,
            totalActions: totalSteps,
          });

          const stepResponse = await fetch(
            `${ApiConfig.QONTINUI_API_URL}/workflow/execute_step/${result.session_id}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(action),
            }
          );

          const stepDuration = Date.now() - stepStartTime;

          if (stepResponse.ok) {
            const stepResult = await stepResponse.json();
            if (stepResult.success) {
              successfulSteps++;
            }
            // Collect historical result ID if available (for visual playback)
            if (stepResult.historical_result_id) {
              workflowHistoricalResultIds.push(stepResult.historical_result_id);
            }

            // Collect step details
            stepResults.push({
              stepIndex: i,
              actionId: action.id,
              actionType: action.type,
              actionName: action.name || `Step ${i + 1}`,
              patternName: action.config?.image_id || action.config?.object_id,
              success: stepResult.success,
              message: stepResult.message || (stepResult.success ? 'Success' : 'Failed'),
              duration: stepResult.duration || stepDuration,
              historicalResultId: stepResult.historical_result_id,
              timestamp: new Date().toISOString(),
            });
          } else {
            console.warn(`Action ${action.id} failed`);
            // Record failed step
            stepResults.push({
              stepIndex: i,
              actionId: action.id,
              actionType: action.type,
              actionName: action.name || `Step ${i + 1}`,
              patternName: action.config?.image_id || action.config?.object_id,
              success: false,
              message: 'Request failed',
              duration: stepDuration,
              timestamp: new Date().toISOString(),
            });
          }
        }

        // Store historical IDs for this workflow
        newHistoricalIds.set(workflowId, workflowHistoricalResultIds);

        const duration = Date.now() - startTime;
        const passed = successfulSteps === totalSteps;

        // Add completed result
        setTestResults((prev) => [
          ...prev.filter(r => r.workflowId !== workflowId),
          {
            workflowId,
            workflowName: workflow.name,
            status: passed ? 'passed' : 'failed',
            successRate: totalSteps > 0 ? (successfulSteps / totalSteps) * 100 : 0,
            totalActions: totalSteps,
            executedActions: successfulSteps,
            passed,
            totalSteps,
            successfulSteps,
            failedSteps: totalSteps - successfulSteps,
            duration,
            historicalResultIds: workflowHistoricalResultIds,
            stepResults,
          },
        ]);

        // Complete the workflow session
        await fetch(
          `${ApiConfig.QONTINUI_API_URL}/workflow/complete/${result.session_id}`,
          { method: 'POST' }
        );

      } catch (error) {
        console.error(`Failed to run workflow ${workflowId}:`, error);

        // Add failed result
        setTestResults((prev) => [
          ...prev,
          {
            workflowId,
            workflowName: workflow.name,
            status: 'failed',
            successRate: 0,
            totalActions: workflow.actions?.length || 0,
            executedActions: 0,
            passed: false,
            totalSteps: workflow.actions?.length || 0,
            successfulSteps: 0,
            failedSteps: workflow.actions?.length || 0,
            duration: Date.now() - startTime,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        ]);
      }
    }

    setActiveSessionIds(newSessionIds);
    setWorkflowHistoricalIds(newHistoricalIds);
    setIsRunning(false);
    setCurrentExecution(null);
  };

  // Stop tests
  const handleStopTests = async () => {
    // Complete all active sessions
    for (const sessionId of activeSessionIds.values()) {
      try {
        await fetch(`${ApiConfig.QONTINUI_API_URL}/workflow/complete/${sessionId}`, {
          method: 'POST',
        });
      } catch (error) {
        console.error(`Failed to complete session ${sessionId}:`, error);
      }
    }

    setIsRunning(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setCurrentExecution(null);
    setActiveSessionIds(new Map());
  };

  // View workflow details
  const handleViewDetails = (workflowId: string) => {
    setSelectedResultId(workflowId);
  };

  // Go back from detail view
  const handleBackFromDetails = () => {
    setSelectedResultId(null);
  };

  // Get selected result for detail view
  const selectedResult = selectedResultId
    ? testResults.find((r) => r.workflowId === selectedResultId)
    : null;

  // Handle playback request
  const handlePlayback = (workflowId: string, historicalResultIds: number[]) => {
    const workflow = workflows.find((w) => w.id === workflowId);
    setPlaybackWorkflowName(workflow?.name || workflowId);
    setPlaybackHistoricalIds(historicalResultIds);
    setPlaybackOpen(true);
  };

  // Close playback
  const handleClosePlayback = () => {
    setPlaybackOpen(false);
    setPlaybackHistoricalIds([]);
    setPlaybackWorkflowName('');
  };

  const canRunTests = selectedWorkflowIds.length > 0 && !isRunning;

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Integration Tests</h1>
            <p className="text-sm text-gray-600 mt-1">
              Test automation workflows using mock mode with historical data
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                onClick={handleStopTests}
                variant="destructive"
                className="gap-2"
              >
                <StopCircle className="w-4 h-4" />
                Stop Tests
              </Button>
            ) : (
              <Button
                onClick={handleRunTests}
                disabled={!canRunTests}
                className="gap-2 bg-blue-600 hover:bg-blue-700"
              >
                <Play className="w-4 h-4" />
                Run ({selectedWorkflowIds.length})
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden p-6">
        <div className="h-full grid grid-cols-2 gap-6">
          {/* Left Column - Workflow Selection */}
          <div className="flex flex-col gap-6 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden">
              <WorkflowSelector
                workflows={workflows}
                selectedIds={selectedWorkflowIds}
                onSelectionChange={setSelectedWorkflowIds}
                disabled={isRunning}
              />
            </div>

            {/* Mock Mode Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-medium text-blue-800">Mock Mode Integration Testing</h3>
              <p className="text-sm text-blue-600 mt-1">
                Tests run using the qontinui library with MockMode.MOCK enabled.
                Actions return historical data from ActionHistories, with random
                selection for realistic test variation.
              </p>
            </div>
          </div>

          {/* Right Column - Execution & Results */}
          <div className="flex flex-col gap-6 overflow-hidden">
            {/* Execution Panel */}
            <div className="flex-shrink-0">
              <TestExecutionPanel
                execution={currentExecution}
                totalWorkflows={selectedWorkflowIds.length}
                completedWorkflows={completedWorkflows}
              />
            </div>

            {/* Results Panel - shows list or detail view */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {selectedResult ? (
                <TestResultsDetailPanel
                  result={selectedResult}
                  onBack={handleBackFromDetails}
                  onPlayback={(historicalIds) => {
                    setPlaybackWorkflowName(selectedResult.workflowName);
                    setPlaybackHistoricalIds(historicalIds);
                    setPlaybackOpen(true);
                  }}
                />
              ) : (
                <TestResultsPanel
                  results={testResults}
                  loading={isRunning && testResults.length === 0}
                  onViewDetails={handleViewDetails}
                  onPlayback={handlePlayback}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Playback Modal */}
      {playbackOpen && playbackHistoricalIds.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-6xl h-[80vh] mx-4">
            <IntegrationTestPlayback
              historicalResultIds={playbackHistoricalIds}
              workflowName={playbackWorkflowName}
              onClose={handleClosePlayback}
            />
          </div>
        </div>
      )}
    </div>
  );
}

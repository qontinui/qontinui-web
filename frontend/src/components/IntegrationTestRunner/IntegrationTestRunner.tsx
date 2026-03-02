"use client";

import React from "react";
import { useIntegrationTests } from "./_hooks/useIntegrationTests";
import { NewTestRunForm } from "./_components/NewTestRunForm";
import { AssertionForm } from "./_components/AssertionForm";
import { MockModeControl } from "./_components/MockModeControl";
import { TestRunsList } from "./_components/TestRunsList";
import { TestResultsPanel } from "./_components/TestResultsPanel";
import { StateMachineBrowser } from "./_components/StateMachineBrowser";

export function IntegrationTestRunner() {
  const {
    testRuns,
    selectedRunId,
    testResults,
    loading,
    error,
    states,
    activeStates,
    mockMode,
    testConfig,
    newAssertion,
    isRunnerConnected,
    setSelectedRunId,
    setError,
    setTestConfig,
    setNewAssertion,
    loadTestRuns,
    loadStates,
    loadActiveStates,
    startTestRun,
    runAssertion,
    handleSetMockMode,
    endTestRun,
    traverseToState,
  } = useIntegrationTests();

  if (!isRunnerConnected) {
    return (
      <div className="p-6 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
        <h3 className="text-lg font-medium text-yellow-800 dark:text-yellow-200 mb-2">
          Runner Not Connected
        </h3>
        <p className="text-yellow-700 dark:text-yellow-300">
          The qontinui runner is not available. Please ensure it is running on
          port 9876.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Integration Test Runner</h2>
        <div className="flex items-center gap-2">
          <span
            className={`w-3 h-3 rounded-full ${
              isRunnerConnected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {isRunnerConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-4 text-sm underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column - Test Configuration */}
        <div className="space-y-4">
          <NewTestRunForm
            testConfig={testConfig}
            loading={loading}
            onConfigChange={setTestConfig}
            onStart={startTestRun}
          />
          <AssertionForm
            newAssertion={newAssertion}
            loading={loading}
            onAssertionChange={setNewAssertion}
            onRun={runAssertion}
          />
          <MockModeControl mockMode={mockMode} onSetMode={handleSetMockMode} />
        </div>

        {/* Right column - Results and State */}
        <div className="space-y-4">
          <TestRunsList
            testRuns={testRuns}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            onRefresh={loadTestRuns}
          />
          {selectedRunId && (
            <TestResultsPanel
              testResults={testResults}
              loading={loading}
              onEndRun={endTestRun}
            />
          )}
          <StateMachineBrowser
            states={states}
            activeStates={activeStates}
            loading={loading}
            onRefresh={() => {
              loadStates();
              loadActiveStates();
            }}
            onTraverseToState={traverseToState}
          />
        </div>
      </div>
    </div>
  );
}

export default IntegrationTestRunner;

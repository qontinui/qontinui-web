import React, { useState, useEffect } from "react";
import {
  Play,
  Pause,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Screenshot } from "../../types/Screenshot";
import { State } from "../../contexts/automation-context/types";
import {
  qontinuiAPI,
  runStateDetection,
  getCurrentActiveStates,
} from "../../lib/qontinui-api-client";

interface VisualTestRunnerProps {
  screenshots: Screenshot[];
  states: State[];
  onTestComplete?: (results: TestResults) => void;
}

interface TestCase {
  id: string;
  name: string;
  type:
    | "state_detection"
    | "location_validation"
    | "transition"
    | "mask_matching";
  screenshot: Screenshot;
  expectedStates?: string[];
  similarity?: number;
  useMask?: boolean;
  maskThreshold?: number;
}

interface TestResult {
  testId: string;
  passed: boolean;
  message: string;
  details?: any;
  duration: number;
}

interface TestResults {
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

const VisualTestRunner: React.FC<VisualTestRunnerProps> = ({
  screenshots,
  states,
  onTestComplete,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [currentTestIndex, setCurrentTestIndex] = useState(-1);
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    // Check API connection
    checkAPIConnection();
    // Generate test cases
    generateTestCases();
  }, [screenshots, states]);

  const checkAPIConnection = async () => {
    const connected = await qontinuiAPI.testConnection();
    setApiConnected(connected);

    // If connected, ensure state manager is initialized
    if (connected) {
      await qontinuiAPI.resetStateManager();
    }
  };

  const generateTestCases = () => {
    const cases: TestCase[] = [];

    // Create state detection tests for each screenshot
    screenshots.forEach((screenshot) => {
      if (screenshot.associatedStates.length > 0) {
        cases.push({
          id: `state-detect-${screenshot.id}`,
          name: `State Detection: ${screenshot.name}`,
          type: "state_detection",
          screenshot,
          expectedStates: screenshot.associatedStates,
          similarity: 0.8,
        });

        // Add mask matching test if masks are available
        cases.push({
          id: `mask-match-${screenshot.id}`,
          name: `Mask Matching: ${screenshot.name}`,
          type: "mask_matching",
          screenshot,
          expectedStates: screenshot.associatedStates,
          similarity: 0.9,
          useMask: true,
          maskThreshold: 0.5,
        });
      }
    });

    setTestCases(cases);
  };

  const runTests = async () => {
    if (!apiConnected) {
      alert(
        "Qontinui API is not connected. Please ensure the API service is running."
      );
      return;
    }

    setIsRunning(true);
    setTestResults([]);
    const results: TestResult[] = [];

    for (let i = 0; i < testCases.length; i++) {
      setCurrentTestIndex(i);
      const testCase = testCases[i];
      const startTime = Date.now();

      try {
        const result = await runTestCase(testCase);
        results.push({
          testId: testCase.id,
          passed: result.passed,
          message: result.message,
          details: result.details,
          duration: Date.now() - startTime,
        });
      } catch (error) {
        results.push({
          testId: testCase.id,
          passed: false,
          message: `Test failed: ${error}`,
          duration: Date.now() - startTime,
        });
      }

      setTestResults([...results]);
    }

    setIsRunning(false);
    setCurrentTestIndex(-1);

    const summary: TestResults = {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      results,
    };

    if (onTestComplete) {
      onTestComplete(summary);
    }
  };

  const runTestCase = async (
    testCase: TestCase
  ): Promise<{
    passed: boolean;
    message: string;
    details?: any;
  }> => {
    switch (testCase.type) {
      case "state_detection":
        // First reset state manager
        await qontinuiAPI.resetStateManager();

        // Register all states
        await qontinuiAPI.registerStates(states);

        // Run state detection
        const detectedStates = await runStateDetection(
          testCase.screenshot,
          states.filter((s) => testCase.expectedStates?.includes(s.id)),
          testCase.similarity || 0.8
        );

        // Get active states from Qontinui
        const activeStates = await getCurrentActiveStates();

        const detectedIds = detectedStates.map((ds) => ds.state_id);
        const expectedIds = testCase.expectedStates || [];

        const allExpectedFound = expectedIds.every((id) =>
          activeStates.includes(id)
        );
        const noUnexpectedFound = activeStates.every((id) =>
          expectedIds.includes(id)
        );

        return {
          passed: allExpectedFound && noUnexpectedFound,
          message:
            allExpectedFound && noUnexpectedFound
              ? `All ${expectedIds.length} expected states detected`
              : `Expected: ${expectedIds.length}, Found: ${activeStates.length}`,
          details: {
            expected: expectedIds,
            detected: detectedIds,
            activeStates,
            detectedStates,
          },
        };

      default:
        return {
          passed: false,
          message: "Unsupported test type",
        };
    }
  };

  const getTestStatus = (testId: string) => {
    const result = testResults.find((r) => r.testId === testId);
    if (!result) {
      if (currentTestIndex >= 0 && testCases[currentTestIndex]?.id === testId) {
        return "running";
      }
      return "pending";
    }
    return result.passed ? "passed" : "failed";
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "passed":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
      case "running":
        return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  const passedCount = testResults.filter((r) => r.passed).length;
  const failedCount = testResults.filter((r) => !r.passed).length;

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Visual Test Runner</h2>
          <p className="text-sm text-gray-600 mt-1">
            Using real Qontinui pattern matching
          </p>
        </div>

        {/* API Status */}
        <div className="flex items-center gap-4">
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
              apiConnected
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                apiConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            {apiConnected ? "API Connected" : "API Disconnected"}
          </div>

          <button
            onClick={runTests}
            disabled={isRunning || !apiConnected || testCases.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              isRunning || !apiConnected
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {isRunning ? (
              <>
                <Pause className="w-4 h-4" />
                Running...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Tests
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      {testResults.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-600">
              Progress: {testResults.length} / {testCases.length}
            </span>
            <div className="flex items-center gap-4">
              <span className="text-green-600">✓ {passedCount}</span>
              <span className="text-red-600">✗ {failedCount}</span>
            </div>
          </div>
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full flex">
              <div
                className="bg-green-500 transition-all"
                style={{ width: `${(passedCount / testCases.length) * 100}%` }}
              />
              <div
                className="bg-red-500 transition-all"
                style={{ width: `${(failedCount / testCases.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Test Cases List */}
      <div className="space-y-2">
        {testCases.map((testCase) => {
          const status = getTestStatus(testCase.id);
          const result = testResults.find((r) => r.testId === testCase.id);

          return (
            <div
              key={testCase.id}
              className={`p-4 border rounded-lg transition-colors ${
                status === "running"
                  ? "border-blue-300 bg-blue-50"
                  : "border-gray-200"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {getStatusIcon(status)}
                  <div>
                    <h4 className="font-medium">{testCase.name}</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      Type: {testCase.type} | Screenshot:{" "}
                      {testCase.screenshot.name}
                    </p>
                    {result && (
                      <div className="mt-2">
                        <p
                          className={`text-sm ${result.passed ? "text-green-600" : "text-red-600"}`}
                        >
                          {result.message}
                        </p>
                        {result.details && (
                          <details className="mt-1">
                            <summary className="text-xs text-gray-500 cursor-pointer">
                              View Details
                            </summary>
                            <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto">
                              {JSON.stringify(result.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {result && (
                  <span className="text-xs text-gray-500">
                    {result.duration}ms
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {testCases.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <AlertCircle className="w-12 h-12 mx-auto mb-3" />
          <p>No test cases generated</p>
          <p className="text-sm mt-1">
            Upload screenshots and associate them with states
          </p>
        </div>
      )}
    </div>
  );
};

export default VisualTestRunner;

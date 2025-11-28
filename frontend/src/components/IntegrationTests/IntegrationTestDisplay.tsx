import React, { useState, useMemo } from "react";
import {
  TestTube2,
  Play,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  Target,
  MousePointer,
  Type,
  Move,
  ArrowRight,
  Filter,
  FileText,
  Download,
  Upload,
} from "lucide-react";
import { useAutomation } from "../../contexts/automation-context";
import { ActionSnapshot } from "../../lib/integration-testing-framework";
import { Screenshot } from "../../types/Screenshot";

interface IntegrationTestDisplayProps {
  screenshots: Screenshot[];
}

interface TestScenario {
  id: string;
  name: string;
  description: string;
  snapshots: ActionSnapshot[];
  states: string[];
  startScreenshot?: string;
  endScreenshot?: string;
}

export const IntegrationTestDisplay: React.FC<IntegrationTestDisplayProps> = ({
  screenshots,
}) => {
  const { states } = useAutomation();
  const [selectedScenario, setSelectedScenario] = useState<TestScenario | null>(
    null
  );
  const [filterState, setFilterState] = useState<string>("");
  const [filterActionType, setFilterActionType] = useState<string>("");
  const [showOnlySuccessful, setShowOnlySuccessful] = useState(false);

  // Collect all snapshots from all state objects
  const allSnapshots = useMemo(() => {
    const snapshots: ActionSnapshot[] = [];

    states.forEach((state) => {
      // Collect from StateImages
      state.stateImages?.forEach((img) => {
        if (img.actionHistory?.snapshots) {
          snapshots.push(...img.actionHistory.snapshots);
        }
      });

      // Collect from StateLocations
      state.locations?.forEach((loc) => {
        if (loc.actionHistory?.snapshots) {
          snapshots.push(...loc.actionHistory.snapshots);
        }
      });

      // Collect from StateRegions
      state.regions?.forEach((reg) => {
        if (reg.actionHistory?.snapshots) {
          snapshots.push(...reg.actionHistory.snapshots);
        }
      });
    });

    return snapshots;
  }, [states]);

  // Build test scenarios from snapshot sequences
  const testScenarios = useMemo(() => {
    const scenarios: TestScenario[] = [];

    // Group snapshots by screenshot sequence
    const screenshotChains = new Map<string, ActionSnapshot[]>();

    allSnapshots.forEach((snapshot) => {
      const key = snapshot.screenshotId;
      if (!screenshotChains.has(key)) {
        screenshotChains.set(key, []);
      }
      screenshotChains.get(key)!.push(snapshot);
    });

    // Build scenarios from chains
    screenshotChains.forEach((snapshots, startScreenshotId) => {
      // Follow the chain through transitions
      const scenarioSnapshots: ActionSnapshot[] = [];
      const visitedScreenshots = new Set<string>();
      let currentScreenshotId = startScreenshotId;

      while (
        currentScreenshotId &&
        !visitedScreenshots.has(currentScreenshotId)
      ) {
        visitedScreenshots.add(currentScreenshotId);
        const screenshotSnapshots =
          screenshotChains.get(currentScreenshotId) || [];

        for (const snapshot of screenshotSnapshots) {
          scenarioSnapshots.push(snapshot);
          if (
            snapshot.nextScreenshotId &&
            !visitedScreenshots.has(snapshot.nextScreenshotId)
          ) {
            currentScreenshotId = snapshot.nextScreenshotId;
            break;
          }
        }
      }

      if (scenarioSnapshots.length > 0) {
        const involvedStates = new Set<string>();
        scenarioSnapshots.forEach((s) => {
          s.activeStates.forEach((state) => involvedStates.add(state));
        });

        const scenario: TestScenario = {
          id: `scenario-${startScreenshotId}`,
          name: `Test Flow from ${screenshots.find((s) => s.id === startScreenshotId)?.name || "Unknown"}`,
          description: `${scenarioSnapshots.length} actions across ${visitedScreenshots.size} screenshots`,
          snapshots: scenarioSnapshots,
          states: Array.from(involvedStates),
          startScreenshot: startScreenshotId,
          endScreenshot:
            scenarioSnapshots[scenarioSnapshots.length - 1]?.nextScreenshotId ||
            startScreenshotId,
        };

        scenarios.push(scenario);
      }
    });

    return scenarios;
  }, [allSnapshots, screenshots]);

  // Filter snapshots
  const filteredSnapshots = useMemo(() => {
    let filtered = allSnapshots;

    if (filterState) {
      filtered = filtered.filter((s) => s.activeStates.includes(filterState));
    }

    if (filterActionType) {
      filtered = filtered.filter((s) => s.actionType === filterActionType);
    }

    if (showOnlySuccessful) {
      filtered = filtered.filter((s) => s.actionSuccess && s.resultSuccess);
    }

    return filtered;
  }, [allSnapshots, filterState, filterActionType, showOnlySuccessful]);

  const getActionIcon = (type: ActionSnapshot["actionType"]) => {
    switch (type) {
      case "FIND":
        return <Target className="w-4 h-4" />;
      case "CLICK":
        return <MousePointer className="w-4 h-4" />;
      case "TYPE":
        return <Type className="w-4 h-4" />;
      case "DRAG":
        return <Move className="w-4 h-4" />;
      case "SCROLL":
        return <Move className="w-4 h-4 rotate-90" />;
      case "WAIT":
        return <Clock className="w-4 h-4" />;
    }
  };

  const exportScenario = (scenario: TestScenario) => {
    const data = JSON.stringify(scenario, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `test-scenario-${scenario.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TestTube2 className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-semibold">Integration Tests</h2>
              <p className="text-sm text-gray-600">
                {testScenarios.length} test scenarios, {allSnapshots.length}{" "}
                total snapshots
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
              <Play className="w-4 h-4" />
              Run All Tests
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <Filter className="w-4 h-4 text-gray-500" />

          <select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value)}
            className="px-3 py-1 border rounded-lg text-sm"
          >
            <option value="">All States</option>
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>

          <select
            value={filterActionType}
            onChange={(e) => setFilterActionType(e.target.value)}
            className="px-3 py-1 border rounded-lg text-sm"
          >
            <option value="">All Actions</option>
            <option value="FIND">Find</option>
            <option value="CLICK">Click</option>
            <option value="TYPE">Type</option>
            <option value="DRAG">Drag</option>
            <option value="SCROLL">Scroll</option>
            <option value="WAIT">Wait</option>
          </select>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showOnlySuccessful}
              onChange={(e) => setShowOnlySuccessful(e.target.checked)}
              className="w-4 h-4"
            />
            Only Successful
          </label>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Scenarios List */}
        <div className="w-1/3 border-r bg-white overflow-y-auto">
          <div className="p-4">
            <h3 className="font-medium mb-3">Test Scenarios</h3>
            <div className="space-y-2">
              {testScenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  onClick={() => setSelectedScenario(scenario)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedScenario?.id === scenario.id
                      ? "bg-blue-50 border-blue-300"
                      : "hover:bg-gray-50 border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">{scenario.name}</h4>
                      <p className="text-xs text-gray-600 mt-1">
                        {scenario.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                          {scenario.snapshots.length} actions
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                          {scenario.states.length} states
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 mt-1" />
                  </div>
                </button>
              ))}
            </div>

            {testScenarios.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <TestTube2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No test scenarios found</p>
                <p className="text-xs mt-1">
                  Record actions to create test scenarios
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Scenario Details */}
        <div className="flex-1 overflow-y-auto">
          {selectedScenario ? (
            <div className="p-6">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">
                    {selectedScenario.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => exportScenario(selectedScenario)}
                      className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2 text-sm"
                    >
                      <Download className="w-4 h-4" />
                      Export
                    </button>
                    <button className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm">
                      <Play className="w-4 h-4" />
                      Run Test
                    </button>
                  </div>
                </div>

                <p className="text-sm text-gray-600">
                  {selectedScenario.description}
                </p>

                <div className="flex flex-wrap gap-2 mt-3">
                  {selectedScenario.states.map((stateId) => {
                    const state = states.find((s) => s.id === stateId);
                    return (
                      <span
                        key={stateId}
                        className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded"
                      >
                        {state?.name || stateId}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Action Flow */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm mb-3">Action Flow</h4>

                {selectedScenario.snapshots.map((snapshot, index) => (
                  <div key={snapshot.id} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          snapshot.actionSuccess && snapshot.resultSuccess
                            ? "bg-green-100 text-green-600"
                            : "bg-red-100 text-red-600"
                        }`}
                      >
                        {index + 1}
                      </div>
                      {index < selectedScenario.snapshots.length - 1 && (
                        <div className="w-0.5 h-12 bg-gray-300 mt-1" />
                      )}
                    </div>

                    <div className="flex-1 bg-white border rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {getActionIcon(snapshot.actionType)}
                            <span className="font-medium text-sm">
                              {snapshot.actionType}
                            </span>
                            {snapshot.actionSuccess &&
                            snapshot.resultSuccess ? (
                              <CheckCircle className="w-4 h-4 text-green-500" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-500" />
                            )}
                          </div>

                          <div className="text-xs text-gray-600 space-y-1">
                            <div>State: {snapshot.stateName}</div>
                            {snapshot.matches.length > 0 && (
                              <div>Matches: {snapshot.matches.length}</div>
                            )}
                            {snapshot.text && (
                              <div>Text: "{snapshot.text}"</div>
                            )}
                            <div>Duration: {snapshot.duration}ms</div>
                          </div>

                          {snapshot.nextScreenshotId && (
                            <div className="flex items-center gap-1 mt-2 text-xs text-blue-600">
                              <ArrowRight className="w-3 h-3" />
                              Transitions to:{" "}
                              {
                                screenshots.find(
                                  (s) => s.id === snapshot.nextScreenshotId
                                )?.name
                              }
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">
                  Select a test scenario to view details
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IntegrationTestDisplay;

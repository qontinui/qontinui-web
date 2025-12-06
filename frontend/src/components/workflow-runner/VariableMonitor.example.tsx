/**
 * VariableMonitor - Usage Examples
 *
 * This file demonstrates various ways to use the VariableMonitor component
 * for real-time workflow variable monitoring.
 */

"use client";

import { useState } from "react";
import { VariableMonitor } from "./VariableMonitor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Example 1: Basic Usage
 *
 * Minimal setup with default configuration
 */
export function BasicExample() {
  const runId = "workflow-run-123";

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Basic Variable Monitor</h1>
      <VariableMonitor runId={runId} />
    </div>
  );
}

/**
 * Example 2: Custom Refresh Interval
 *
 * Use a slower refresh interval for less active workflows
 */
export function CustomRefreshExample() {
  const runId = "workflow-run-123";
  const refreshInterval = 5000; // 5 seconds

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Custom Refresh Interval (5s)</h1>
      <VariableMonitor runId={runId} refreshInterval={refreshInterval} />
    </div>
  );
}

/**
 * Example 3: Dynamic Run ID
 *
 * Allow users to switch between different workflow runs
 */
export function DynamicRunIdExample() {
  const [runId, setRunId] = useState("workflow-run-123");
  const [inputValue, setInputValue] = useState(runId);

  const handleChange = () => {
    setRunId(inputValue);
  };

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Dynamic Workflow Run</h1>

      {/* Run ID selector */}
      <Card className="p-4 bg-[#1A1A1B] border-gray-800">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <Label htmlFor="runId">Workflow Run ID</Label>
            <Input
              id="runId"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Enter workflow run ID"
              className="bg-gray-900 border-gray-700"
            />
          </div>
          <Button onClick={handleChange}>Load Run</Button>
        </div>
      </Card>

      {/* Variable monitor */}
      <VariableMonitor runId={runId} />
    </div>
  );
}

/**
 * Example 4: Workflow Runner Dashboard
 *
 * Integrate variable monitor into a complete workflow runner view
 */
export function WorkflowRunnerDashboard() {
  const runId = "workflow-run-123";
  const [refreshInterval, setRefreshInterval] = useState(1000);

  return (
    <div className="min-h-screen bg-[#0F0F10] p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Workflow Execution
            </h1>
            <p className="text-gray-400 mt-1">Run ID: {runId}</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-400">
              Refresh: {refreshInterval}ms
            </div>
          </div>
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - Execution status */}
          <div className="lg:col-span-1">
            <Card className="bg-[#1A1A1B] border-gray-800 p-6">
              <h2 className="text-xl font-semibold text-white mb-4">
                Execution Status
              </h2>
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-gray-400">Status</div>
                  <div className="text-lg text-green-500 font-semibold">
                    Running
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Progress</div>
                  <div className="text-lg text-white font-semibold">45%</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Current Action</div>
                  <div className="text-lg text-white font-semibold">
                    Data Processing
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Elapsed Time</div>
                  <div className="text-lg text-white font-semibold">2m 34s</div>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-700">
                <Button variant="destructive" className="w-full">
                  Stop Execution
                </Button>
              </div>
            </Card>
          </div>

          {/* Right column - Variable monitor */}
          <div className="lg:col-span-2">
            <VariableMonitor
              runId={runId}
              refreshInterval={refreshInterval}
              onRefreshIntervalChange={setRefreshInterval}
            />
          </div>
        </div>

        {/* Bottom section - Execution log */}
        <Card className="bg-[#1A1A1B] border-gray-800 p-6">
          <h2 className="text-xl font-semibold text-white mb-4">
            Execution Log
          </h2>
          <div className="bg-gray-900 rounded p-4 font-mono text-sm text-gray-300 h-48 overflow-y-auto">
            <div>[2025-11-23 10:15:23] Workflow started</div>
            <div>[2025-11-23 10:15:24] Initializing variables...</div>
            <div>[2025-11-23 10:15:25] Action 'Data Fetch' started</div>
            <div className="text-[#00D9FF]">
              [2025-11-23 10:15:26] Variable 'data' created
            </div>
            <div>[2025-11-23 10:15:27] Action 'Data Fetch' completed</div>
            <div>[2025-11-23 10:15:28] Action 'Data Processing' started</div>
            <div className="text-[#00D9FF]">
              [2025-11-23 10:15:29] Variable 'processed_data' created
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Example 5: Split View with History
 *
 * Show current values and history side by side
 */
export function SplitViewExample() {
  const runId = "workflow-run-123";

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Split View</h1>

      {/* Start with history tab open */}
      <VariableMonitor runId={runId} defaultTab="history" />
    </div>
  );
}

/**
 * Example 6: Standalone History Component
 *
 * Use the VariableHistory component independently
 */
export function StandaloneHistoryExample() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Variable Change Timeline</h1>

      <Card className="bg-[#1A1A1B] border-gray-800 p-6">
        {/* Import VariableHistory directly */}
        {/* <VariableHistory runId={runId} refreshInterval={1000} /> */}
        <div className="text-gray-400">
          Import VariableHistory component to use it standalone
        </div>
      </Card>
    </div>
  );
}

/**
 * Example 7: Disable Auto-refresh
 *
 * For completed workflows, disable auto-refresh to reduce API calls
 */
export function DisableRefreshExample() {
  const runId = "workflow-run-123";
  const isWorkflowComplete = true;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Completed Workflow</h1>
      <p className="text-gray-400 mb-4">
        Auto-refresh is disabled for completed workflows
      </p>

      <VariableMonitor
        runId={runId}
        refreshInterval={isWorkflowComplete ? 0 : 1000}
      />
    </div>
  );
}

/**
 * Example 8: Global Variables Only
 *
 * Start with global variables tab for configuration review
 */
export function GlobalVariablesExample() {
  const runId = "workflow-run-123";

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Global Configuration</h1>

      <VariableMonitor runId={runId} defaultTab="global" />
    </div>
  );
}

/**
 * Complete Examples Page
 */
export default function VariableMonitorExamples() {
  const [activeExample, setActiveExample] = useState<string>("basic");

  const examples = [
    { id: "basic", name: "Basic Usage", component: BasicExample },
    { id: "refresh", name: "Custom Refresh", component: CustomRefreshExample },
    { id: "dynamic", name: "Dynamic Run ID", component: DynamicRunIdExample },
    {
      id: "dashboard",
      name: "Full Dashboard",
      component: WorkflowRunnerDashboard,
    },
    { id: "split", name: "Split View", component: SplitViewExample },
    {
      id: "history",
      name: "Standalone History",
      component: StandaloneHistoryExample,
    },
    {
      id: "disabled",
      name: "Disabled Refresh",
      component: DisableRefreshExample,
    },
    {
      id: "global",
      name: "Global Variables",
      component: GlobalVariablesExample,
    },
  ];

  const ActiveComponent =
    examples.find((ex) => ex.id === activeExample)?.component || BasicExample;

  return (
    <div className="min-h-screen bg-[#0F0F10]">
      <div className="flex">
        {/* Sidebar */}
        <div className="w-64 bg-[#1A1A1B] border-r border-gray-800 p-4">
          <h2 className="text-lg font-semibold text-white mb-4">Examples</h2>
          <div className="space-y-1">
            {examples.map((example) => (
              <button
                key={example.id}
                onClick={() => setActiveExample(example.id)}
                className={`w-full text-left px-3 py-2 rounded transition-colors ${
                  activeExample === example.id
                    ? "bg-[#00D9FF]/10 text-[#00D9FF]"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                }`}
              >
                {example.name}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}

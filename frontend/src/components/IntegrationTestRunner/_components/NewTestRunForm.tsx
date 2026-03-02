import React from "react";
import type { TestConfig } from "../types";

interface NewTestRunFormProps {
  testConfig: TestConfig;
  loading: boolean;
  onConfigChange: (config: TestConfig) => void;
  onStart: () => void;
}

export function NewTestRunForm({
  testConfig,
  loading,
  onConfigChange,
  onStart,
}: NewTestRunFormProps) {
  return (
    <div className="border rounded-lg p-4 dark:border-gray-700">
      <h3 className="text-lg font-medium mb-4">New Test Run</h3>
      <div className="space-y-3">
        <div>
          <label
            htmlFor="itr-test-name"
            className="block text-sm font-medium mb-1"
          >
            Test Name
          </label>
          <input
            id="itr-test-name"
            type="text"
            value={testConfig.name}
            onChange={(e) =>
              onConfigChange({ ...testConfig, name: e.target.value })
            }
            className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
            placeholder="Integration Test"
          />
        </div>
        <div>
          <label
            htmlFor="itr-config-path"
            className="block text-sm font-medium mb-1"
          >
            Config Path (optional)
          </label>
          <input
            id="itr-config-path"
            type="text"
            value={testConfig.config_path || ""}
            onChange={(e) =>
              onConfigChange({
                ...testConfig,
                config_path: e.target.value || undefined,
              })
            }
            className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
            placeholder="C:\path\to\config.json"
          />
        </div>
        <button
          onClick={onStart}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Starting..." : "Start Test Run"}
        </button>
      </div>
    </div>
  );
}

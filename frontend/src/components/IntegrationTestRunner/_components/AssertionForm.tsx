import React from "react";
import type { NewAssertion } from "../types";

interface AssertionFormProps {
  newAssertion: NewAssertion;
  loading: boolean;
  onAssertionChange: (assertion: NewAssertion) => void;
  onRun: () => void;
}

export function AssertionForm({
  newAssertion,
  loading,
  onAssertionChange,
  onRun,
}: AssertionFormProps) {
  return (
    <div className="border rounded-lg p-4 dark:border-gray-700">
      <h3 className="text-lg font-medium mb-4">Run Assertion</h3>
      <div className="space-y-3">
        <div>
          <label
            htmlFor="itr-assertion-type"
            className="block text-sm font-medium mb-1"
          >
            Assertion Type
          </label>
          <select
            id="itr-assertion-type"
            value={newAssertion.type}
            onChange={(e) =>
              onAssertionChange({ ...newAssertion, type: e.target.value })
            }
            className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
          >
            <option value="state_reached">State Reached</option>
            <option value="element_found">Element Found</option>
            <option value="action_performed">Action Performed</option>
            <option value="transition_completed">Transition Completed</option>
            <option value="workflow_completed">Workflow Completed</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="itr-target"
            className="block text-sm font-medium mb-1"
          >
            Target
          </label>
          <input
            id="itr-target"
            type="text"
            value={newAssertion.target}
            onChange={(e) =>
              onAssertionChange({ ...newAssertion, target: e.target.value })
            }
            className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
            placeholder="State name or element ID"
          />
        </div>
        <div>
          <label
            htmlFor="itr-expected"
            className="block text-sm font-medium mb-1"
          >
            Expected (optional)
          </label>
          <input
            id="itr-expected"
            type="text"
            value={newAssertion.expected}
            onChange={(e) =>
              onAssertionChange({
                ...newAssertion,
                expected: e.target.value,
              })
            }
            className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
            placeholder="Expected value"
          />
        </div>
        <button
          onClick={onRun}
          disabled={loading || !newAssertion.target}
          className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? "Running..." : "Run Assertion"}
        </button>
      </div>
    </div>
  );
}
